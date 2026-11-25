import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/index';
import { TILE } from '../shared/constants';

let srv: ReturnType<typeof startServer>;
let base = '';

before(async () => {
  srv = startServer({ port: 0, dbFile: ':memory:', quiet: true });
  base = `http://127.0.0.1:${await srv.ready}`;
});
after(async () => { await srv.close(); });

async function api(path: string, body?: unknown, cookie = '', method?: string) {
  const res = await fetch(base + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { status: res.status, json: (await res.json()) as any, cookie: setCookie.split(';')[0], raw: setCookie };
}

function connect(cookie: string): Promise<{ ws: WebSocket; next: (t: string, pred?: (m: any) => boolean) => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { Cookie: cookie } });
    const waiters: { t: string; pred?: (m: any) => boolean; res: (m: any) => void }[] = [];
    ws.on('message', (raw: Buffer) => {
      const m = JSON.parse(raw.toString());
      for (const w of [...waiters]) if (w.t === m.t && (!w.pred || w.pred(m))) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
    });
    ws.on('open', () => resolve({
      ws,
      next: (t, pred) => new Promise((res, rej) => { waiters.push({ t, pred, res }); setTimeout(() => rej(new Error(`timeout esperando ${t}`)), 4000); }),
    }));
    ws.on('error', reject);
  });
}

test('cadastro, login, personagens e limite de 3', async () => {
  const r = await api('/api/register', { username: 'heroi1', email: 'h1@x.com', password: 'abc12345' });
  assert.equal(r.status, 201);
  assert.match(r.cookie, /^ac_session=/);
  const dup = await api('/api/register', { username: 'HEROI1', email: 'outro@x.com', password: 'abc12345' });
  assert.equal(dup.status, 409);
  const bad = await api('/api/login', { login: 'heroi1', password: 'errada123' });
  assert.equal(bad.status, 401);
  const ok = await api('/api/login', { login: 'h1@x.com', password: 'abc12345', remember: true });
  assert.equal(ok.status, 200);
  assert.match(ok.raw, /Max-Age=2592000/, 'manter conectado = cookie de 30 dias');
  const temp = await api('/api/login', { login: 'heroi1', password: 'abc12345' });
  assert.doesNotMatch(temp.raw, /Max-Age/, 'sem marcar = cookie de sessão');
  for (const [i, cls] of ['warrior', 'mage', 'rogue'].entries()) {
    const c = await api('/api/characters', { name: `Heroi${i}`, classId: cls }, ok.cookie);
    assert.equal(c.status, 201, JSON.stringify(c.json));
  }
  const fourth = await api('/api/characters', { name: 'Heroi9', classId: 'cleric' }, ok.cookie);
  assert.equal(fourth.status, 400);
  const list = await api('/api/characters', undefined, ok.cookie);
  assert.equal(list.json.characters.length, 3);
});

test('rotas protegidas exigem sessão', async () => {
  assert.equal((await api('/api/characters')).status, 401);
  assert.equal((await api('/api/characters', undefined, 'ac_session=lixo')).status, 401);
});

test('rate limit bloqueia força bruta no login', async () => {
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await api('/api/login', { login: 'ninguem', password: 'x1234567' })).status;
  assert.equal(last, 429);
});

test('dois jogadores se veem na cidade, conversam e jogam uma dungeon', async () => {
  // contas novas (o IP de teste está limitado pelo teste anterior → usa login direto via repo)
  const mk = async (u: string) => {
    const { hashPassword, signJwt } = await import('../server/auth');
    const id = srv.repo.createUser(u, `${u}@x.com`, await hashPassword('abc12345'));
    const { newCharacterData } = await import('../server/game/character');
    const ch = srv.repo.createCharacter(id, `${u}C`, 'warrior', newCharacterData('warrior'), 50);
    void signJwt;
    return { id, ch };
  };
  const a = await mk('alfa');
  const b = await mk('beta');
  // gera cookies assinados pelo servidor real via login HTTP seria limitado; usamos o mesmo segredo através do hub
  const loginCookie = async (u: string) => {
    const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': u }, body: JSON.stringify({ login: u, password: 'abc12345' }) });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  process.env.TRUST_PROXY = '1';
  const ca = await loginCookie('alfa');
  const cb = await loginCookie('beta');
  assert.ok(ca && cb, 'cookies de sessão');

  const A = await connect(ca);
  A.ws.send(JSON.stringify({ t: 'join', charId: a.ch.id }));
  await A.next('map', (m) => m.world === 'town');
  const B = await connect(cb);
  B.ws.send(JSON.stringify({ t: 'join', charId: b.ch.id }));
  await B.next('map');

  const snap = await A.next('s', (m) => m.e.some((row: any[]) => row[6]?.n === 'betaC'));
  assert.ok(snap.e.length >= 2);

  // movimento: A anda para a direita e o servidor confirma
  const pa = srv.hub.byChar.get(a.ch.id)!;
  const x0 = pa.x;
  for (let s = 1; s <= 10; s++) A.ws.send(JSON.stringify({ t: 'i', s, x: 1, y: 0 }));
  await A.next('s', (m) => m.me[4] >= 10);
  assert.ok(pa.x > x0 + 20, `andou ${pa.x - x0}`);

  // chat global
  A.ws.send(JSON.stringify({ t: 'chat', text: 'olá <b>mundo</b>' }));
  const chat = await B.next('chat', (m) => m.from === 'alfaC');
  assert.equal(chat.text, 'olá <b>mundo</b>'); // o cliente renderiza como texto, nunca HTML

  // grupo
  A.ws.send(JSON.stringify({ t: 'party', op: 'invite', name: 'betaC' }));
  await B.next('invite');
  B.ws.send(JSON.stringify({ t: 'party', op: 'accept', name: 'alfaC' }));
  const party = await A.next('party', (m) => m.party?.members.length === 2);
  assert.equal(party.party.members.length, 2);

  // entrar na dungeon: longe do portal é recusado
  A.ws.send(JSON.stringify({ t: 'enter', floor: 1 }));
  await A.next('toast', (m) => /Portal/.test(m.text));
  const portal = srv.hub.town.town.npcs.find((n) => n.role === 'portal')!;
  pa.x = portal.x * TILE; pa.y = (portal.y + 1.5) * TILE;
  A.ws.send(JSON.stringify({ t: 'enter', floor: 11 })); // checkpoint não desbloqueado
  await A.next('toast', (m) => /inválido/.test(m.text));
  A.ws.send(JSON.stringify({ t: 'enter', floor: 1 }));
  const [ma, mb] = await Promise.all([A.next('map', (m) => m.world === 'dungeon'), B.next('map', (m) => m.world === 'dungeon')]);
  assert.equal(ma.floor, 1);
  assert.equal(mb.floor, 1);
  assert.ok(ma.tiles.length < 4096);

  // combate: teleporta A ao lado de um monstro e ataca até matar (dano decidido no servidor)
  const d = srv.hub.dungeons.values().next().value!;
  const mon = [...d.monsters.values()][0];
  const hp0 = mon.hp;
  pa.x = mon.x - 10; pa.y = mon.y;
  mon.stunUntil = 1e9;
  let gotDamage = false;
  for (let i = 0; i < 60 && d.monsters.has(mon.id); i++) {
    A.ws.send(JSON.stringify({ t: 'atk', a: 0 }));
    const s = await A.next('s');
    if (s.fx?.some((f: any[]) => f[0] === 'd')) gotDamage = true;
    pa.x = mon.x - 10; pa.y = mon.y; pa.hp = pa.stats.maxHp;
  }
  assert.ok(gotDamage, 'recebeu números de dano');
  assert.ok(!d.monsters.has(mon.id) || mon.hp < hp0, 'monstro sofreu dano');

  // cliente não consegue forjar dano/gold: mensagens desconhecidas são ignoradas
  const gold = pa.char.gold;
  A.ws.send(JSON.stringify({ t: 'gold', amount: 999999 }));
  A.ws.send(JSON.stringify({ t: 'i', s: 99999, x: 1000, y: 0 }));
  await A.next('s');
  await A.next('s');
  assert.ok(pa.char.gold < gold + 1000);

  // escada → próximo andar
  pa.x = (d.map.stairs.x + 0.5) * TILE; pa.y = (d.map.stairs.y + 0.5) * TILE;
  A.ws.send(JSON.stringify({ t: 'use' }));
  const next = await A.next('map', (m) => m.floor === 2).catch(() => null);
  if (!next) {
    // a contagem é de 3 s; espera mais
    const n2 = await new Promise<any>((res) => setTimeout(async () => res(await A.next('map', (m) => m.floor === 2).catch(() => null)), 1000));
    assert.ok(n2 || d.floor === 2, 'desceu ao andar 2');
  }

  // voltar à cidade e salvar
  A.ws.send(JSON.stringify({ t: 'town' }));
  await A.next('map', (m) => m.world === 'town');

  // baú pessoal: guardar e pegar de volta (persistido no banco)
  const { rollItem } = await import('../shared/loot');
  const { mulberry32 } = await import('../shared/rng');
  const npc = (role: string) => srv.hub.town.town.npcs.find((n) => n.role === role)!;
  pa.char.data.inventory[0] = rollItem(mulberry32(1), { ilvl: 5, rank: 'C' });
  pa.x = npc('stash').x * TILE; pa.y = (npc('stash').y + 1) * TILE;
  A.ws.send(JSON.stringify({ t: 'stash', op: 'put', idx: 0 }));
  const st = await A.next('stash', (m) => m.items.length === 1);
  assert.equal(srv.repo.getStash(a.id, 48).filter(Boolean).length, 1, 'baú salvo no banco');
  assert.equal(pa.char.data.inventory.filter(Boolean).length, 0);
  A.ws.send(JSON.stringify({ t: 'stash', op: 'take', idx: st.items[0].i }));
  await A.next('stash', (m) => m.items.length === 0);
  assert.equal(pa.char.data.inventory.filter(Boolean).length, 1);

  // mercador vende armas por gold
  pa.x = npc('market').x * TILE; pa.y = (npc('market').y - 1) * TILE;
  A.ws.send(JSON.stringify({ t: 'shop', op: 'mstock' }));
  const ms = await A.next('mstock');
  assert.equal(ms.items.length, 12);
  assert.ok(ms.items.every((s: any) => s.item.slotType === 'weapon' && s.price > 0));
  pa.char.gold = 1_000_000;
  A.ws.send(JSON.stringify({ t: 'shop', op: 'mbuy', i: 0 }));
  await A.next('mstock', (m) => m.items[0].sold);
  assert.equal(pa.char.gold, 1_000_000 - ms.items[0].price);
  assert.ok(pa.char.data.inventory.some((it) => it?.baseType === ms.items[0].item.baseType));

  // largar item na cidade = descartar
  const before = pa.char.data.inventory.filter(Boolean).length;
  A.ws.send(JSON.stringify({ t: 'drop', idx: 0 }));
  await A.next('char');
  assert.equal(pa.char.data.inventory.filter(Boolean).length, before - 1);
  A.ws.close(); B.ws.close();
  await new Promise((r) => setTimeout(r, 100));
  const saved = srv.repo.getCharacter(a.ch.id)!;
  assert.ok(saved.maxFloor >= 1);
});
