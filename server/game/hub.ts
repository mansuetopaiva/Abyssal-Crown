import type { WebSocket } from 'ws';
import { CHECKPOINT_EVERY, INV_EXPANSION_SLOTS, MARKET_TAX, MAX_INV_SLOTS, RANKS, TICK_MS, TICK_RATE, TILE, type Slot } from '../../shared/constants';
import {
  GEM_SHOP, MARKET_MAX_LISTINGS, MARKET_MAX_PRICE, MAX_GEM_TIER, POTION_HEAL, STASH_SLOTS, canRefine, combineCost, gemKey, gemPrice, isGemId,
  merchantPeriod, merchantRerollCost, merchantStock,
  potionPrice, refineChance, refineCost, repairCost, smithStock, unsocketCost,
} from '../../shared/economy';
import { rollItem } from '../../shared/loot';
import { skillUnlockLevel, validLoadout } from '../../shared/stats';
import type { Repo } from '../db';
import {
  ACHIEVEMENTS, DAILIES, checkAchievements, ensureDaily, migrateData, talentPointsSpent, talentPointsTotal, today,
} from './character';
import { Dungeon } from './dungeon';
import { addToInventory, equip, freeSlot, isSlot, locate, sellPrice, sortInventory, unequip, validIndex, type Result } from './inventory';
import { Party } from './party';
import { Player } from './player';
import { Town, type HubApi } from './world';

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

export class Hub implements HubApi {
  town: Town;
  dungeons = new Set<Dungeon>();
  byChar = new Map<number, Player>();
  byUser = new Map<number, Player>();
  private timer: NodeJS.Timeout | null = null;
  tickStats = { last: 0, avg: 0, max: 0 };

  constructor(public repo: Repo) {
    this.town = new Town(this);
  }

  start() {
    let last = performance.now();
    let acc = 0;
    const dt = 1 / TICK_RATE;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(250, now - last);
      last = now;
      while (acc >= TICK_MS) {
        acc -= TICK_MS;
        const t0 = performance.now();
        this.town.step(dt);
        for (const d of this.dungeons) {
          if (d.players.size === 0) { this.closeDungeon(d); continue; }
          d.step(dt);
        }
        const ms = performance.now() - t0;
        this.tickStats.last = ms;
        this.tickStats.avg = this.tickStats.avg * 0.98 + ms * 0.02;
        this.tickStats.max = Math.max(this.tickStats.max * 0.999, ms);
      }
      this.autosave();
    }, TICK_MS / 2);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const p of this.byChar.values()) this.save(p);
  }

  private closeDungeon(d: Dungeon) {
    d.closed = true;
    this.dungeons.delete(d);
    if (d.party?.dungeon === d) d.party.dungeon = null;
  }

  private autosave() {
    const now = Date.now();
    for (const p of this.byChar.values()) if (p.dirty && now - p.lastSave > 30_000) this.save(p);
  }

  save(p: Player) {
    try {
      this.repo.saveCharacter(p.char);
      p.dirty = false;
      p.lastSave = Date.now();
    } catch (e) {
      console.error('[save]', p.char.id, e);
    }
  }

  isOnline(charId: number) { return this.byChar.has(charId); }

  // ---------- conexão ----------
  connect(ws: WebSocket, userId: number) {
    let player: Player | null = null;
    const joinTimeout = setTimeout(() => !player && ws.close(4000, 'join timeout'), 10_000);
    ws.on('message', (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString('utf8'));
        if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;
      } catch { return; }
      if (!player) {
        if (msg.t !== 'join') return;
        player = this.join(ws, userId, num(msg.charId));
        clearTimeout(joinTimeout);
        return;
      }
      // limite simples de mensagens por segundo
      if (player.msgTokens <= 0) return;
      player.msgTokens--;
      try { this.handle(player, msg); } catch (e) { console.error('[msg]', msg.t, e); }
    });
    const refill = setInterval(() => { if (player) player.msgTokens = Math.min(80, player.msgTokens + 40); }, 1000);
    ws.on('close', () => {
      clearTimeout(joinTimeout);
      clearInterval(refill);
      if (player) this.leave(player);
    });
  }

  private join(ws: WebSocket, userId: number, charId: number): Player | null {
    const ch = Number.isInteger(charId) ? this.repo.getCharacter(charId) : undefined;
    if (!ch || ch.userId !== userId) { ws.close(4003, 'personagem inválido'); return null; }
    // uma sessão por conta: derruba a anterior
    const prev = this.byUser.get(userId);
    if (prev) { prev.toast('Sua conta entrou em outro lugar.', 'error'); prev.ws.close(4001, 'outra sessão'); this.leave(prev); }
    migrateData(ch);
    const p = new Player(ws, ch, userId);
    this.byChar.set(ch.id, p);
    this.byUser.set(userId, p);
    p.send({ t: 'welcome', eid: p.eid, tickRate: TICK_RATE });
    p.sendChar();
    const sp = this.town.spawnPoint();
    this.town.add(p, sp.x, sp.y);
    this.announce(`${p.name} entrou em Abyssal Crown.`, 'sys');
    this.onAchievements(p);
    return p;
  }

  private leave(p: Player) {
    if (this.byChar.get(p.char.id) !== p) return;
    this.byChar.delete(p.char.id);
    if (this.byUser.get(p.userId) === p) this.byUser.delete(p.userId);
    p.world?.remove(p);
    p.party?.remove(p);
    this.save(p);
  }

  // ---------- HubApi ----------
  announce(text: string, kind = 'sys') {
    const msg = { t: 'chat', from: '', text, kind };
    for (const p of this.byChar.values()) p.send(msg);
  }

  sendToTown(p: Player) {
    if (p.dead) {
      p.dead = false;
      for (const it of Object.values(p.char.data.equipment)) if (it) it.durability = Math.max(0, it.durability - 10);
      p.recompute();
      p.sendChar();
    }
    p.hp = p.stats.maxHp;
    p.mana = p.stats.maxMana;
    p.poison = null; p.buffs = []; p.stunUntil = 0;
    const sp = this.town.spawnPoint();
    this.town.add(p, sp.x, sp.y);
    this.save(p);
  }

  onAchievements(p: Player) {
    for (const a of checkAchievements(p.char)) {
      p.toast(`Conquista: ${a.name} (+${a.gems} gemas)`, 'good');
      this.repo.logTx(p.char.id, 'achievement', 0, a.gems, a.id);
      p.dirty = true;
      p.sendChar();
    }
  }

  // ---------- mensagens ----------
  private handle(p: Player, m: Record<string, unknown>) {
    const w = p.world;
    switch (m.t) {
      case 'i': { // input de movimento
        const seq = num(m.s);
        if (!Number.isInteger(seq) || seq <= p.lastSeq) return;
        p.inputs.push({ seq, dx: num(m.x), dy: num(m.y) });
        return;
      }
      case 'atk': if (w instanceof Dungeon) w.basicAttack(p, num(m.a)); return;
      case 'sk': {
        const i = num(m.i);
        if (w instanceof Dungeon && Number.isInteger(i) && i >= 0 && i <= 4) w.useSkill(p, i, num(m.a), num(m.x), num(m.y));
        return;
      }
      case 'use': if (w instanceof Dungeon) w.interact(p); return;
      case 'potion': return this.drinkPotion(p, m.k === 'mana' ? 'manaPotion' : 'hpPotion');
      case 'chat': return this.chat(p, str(m.text, 200));
      case 'party': return this.partyOp(p, str(m.op, 10), str(m.name, 20));
      case 'enter': return this.enterDungeon(p, num(m.floor));
      case 'town':
        if (w instanceof Dungeon && !p.dead) { this.sendToTown(p); p.party?.broadcast(); }
        return;
      case 'equip': return this.reply(p, equip(p.char, num(m.idx), isSlot(m.slot) ? m.slot : undefined), true);
      case 'unequip': return this.reply(p, isSlot(m.slot) ? unequip(p.char, m.slot) : { ok: false, msg: 'Slot inválido.' }, true);
      case 'sort': sortInventory(p.char); return this.reply(p, { ok: true }, false);
      case 'sell': return this.sell(p, num(m.idx));
      case 'sellBulk': return this.sellBulk(p, num(m.max));
      case 'drop': return this.drop(p, num(m.idx));
      case 'stash': return this.stashOp(p, str(m.op, 10), num(m.idx));
      case 'talent': return this.talent(p, str(m.id, 20));
      case 'loadout': {
        const cls = p.cls;
        const lo = validLoadout(cls, m.slots);
        if (lo !== m.slots || lo.some((i) => p.char.level < skillUnlockLevel(cls.skills[i]))) return p.toast('Barra inválida: escolha 4 habilidades diferentes já liberadas.', 'error');
        if (p.world?.kind === 'dungeon' && Object.values(p.cds).some((c) => c > p.world!.time)) return p.toast('Espere as recargas terminarem para trocar a barra.', 'error');
        p.char.data.loadout = [...lo];
        return this.reply(p, { ok: true, msg: 'Barra de habilidades atualizada.' }, false);
      }
      case 'shop': return this.shop(p, m);
      case 'market': return this.market(p, m);
      case 'daily': return this.claimDaily(p, str(m.id, 20));
      case 'cosmetic': {
        const id = str(m.id, 30);
        if (id && !p.char.data.cosmetics.includes(id)) return;
        p.char.data.cosmetic = id;
        p.known.clear();
        return this.reply(p, { ok: true }, false);
      }
      case 'ping': p.send({ t: 'pong', c: m.c }); return;
    }
  }

  private reply(p: Player, r: Result, recompute: boolean) {
    if (!r.ok) return p.toast(r.msg, 'error');
    if (r.msg) p.toast(r.msg, 'good');
    if (recompute) {
      p.recompute();
      // a arma pode ter mudado: reenvia os dados visuais deste jogador aos outros
      if (p.world) for (const o of p.world.players) o.known.delete(p.eid);
    }
    p.dirty = true;
    p.sendChar();
  }

  private drinkPotion(p: Player, kind: 'hpPotion' | 'manaPotion') {
    const now = p.world?.time ?? 0;
    if (p.dead || now < p.potionReady || p.char.data.consumables[kind] <= 0) return;
    p.char.data.consumables[kind]--;
    p.potionReady = now + 1;
    if (kind === 'hpPotion') p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * POTION_HEAL);
    else p.mana = Math.min(p.stats.maxMana, p.mana + p.stats.maxMana * POTION_HEAL);
    p.world?.emit(['h', p.x, p.y, 0]);
    p.dirty = true;
    p.sendChar();
  }

  private chat(p: Player, raw: string) {
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!text) return;
    if (text.startsWith('/')) {
      const [cmd, arg = ''] = text.slice(1).split(/\s+/, 2);
      if (cmd === 'convidar' || cmd === 'invite') return this.partyOp(p, 'invite', arg);
      if (cmd === 'aceitar' || cmd === 'accept') return this.partyOp(p, 'accept', arg);
      if (cmd === 'sair' || cmd === 'leave') return this.partyOp(p, 'leave', '');
      if (cmd === 'expulsar' || cmd === 'kick') return this.partyOp(p, 'kick', arg);
      return p.toast('Comandos: /convidar nome, /aceitar nome, /sair, /expulsar nome', 'info');
    }
    const now = Date.now();
    if (now - p.lastChat < 700) return p.toast('Calma! Aguarde para enviar outra mensagem.', 'error');
    p.lastChat = now;
    const msg = { t: 'chat', from: p.name, cls: p.char.classId, text, kind: 'player' };
    for (const o of this.byChar.values()) o.send(msg);
  }

  private findOnline(name: string) {
    const n = name.toLowerCase();
    for (const p of this.byChar.values()) if (p.name.toLowerCase() === n) return p;
    return null;
  }

  private partyOp(p: Player, op: string, name: string) {
    switch (op) {
      case 'invite': {
        const o = this.findOnline(name);
        if (!o || o === p) return p.toast('Jogador não encontrado.', 'error');
        if (o.party) return p.toast(`${o.name} já está em um grupo.`, 'error');
        const party = p.party ?? new Party(p);
        if (party.leader !== p) return p.toast('Só o líder pode convidar.', 'error');
        if (party.full) return p.toast('Grupo cheio (máx. 4).', 'error');
        party.invites.add(o.char.id);
        party.broadcast();
        o.send({ t: 'invite', from: p.name });
        return p.toast(`Convite enviado para ${o.name}.`, 'good');
      }
      case 'accept': {
        const o = this.findOnline(name);
        const party = o?.party;
        if (!party || !party.invites.has(p.char.id)) return p.toast('Convite não encontrado ou expirado.', 'error');
        if (p.party) p.party.remove(p);
        if (!party.add(p)) return p.toast('O grupo está cheio.', 'error');
        return this.announceParty(party, `${p.name} entrou no grupo.`);
      }
      case 'leave':
        if (!p.party) return;
        this.announceParty(p.party, `${p.name} saiu do grupo.`);
        return p.party.remove(p);
      case 'kick': {
        const party = p.party;
        if (!party || party.leader !== p) return p.toast('Só o líder pode expulsar.', 'error');
        const o = party.members.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!o || o === p) return;
        party.remove(o);
        o.toast('Você foi removido do grupo.', 'error');
        return;
      }
    }
  }

  private announceParty(party: Party, text: string) {
    for (const m of party.members) m.send({ t: 'chat', from: '', text, kind: 'party' });
  }

  private enterDungeon(p: Player, floor: number) {
    if (p.world !== this.town) return;
    if (!this.town.nearNpc(p, 'portal', 5)) return p.toast('Vá até o Portal do Abismo.', 'error');
    const c = p.char;
    const valid = floor === 1 || (Number.isInteger(floor) && floor > 1 && (floor - 1) % CHECKPOINT_EVERY === 0 && floor <= c.checkpoint);
    if (!valid) return p.toast('Andar inicial inválido.', 'error');
    const party = p.party;
    // grupo com instância ativa: entra nela
    if (party?.dungeon && !party.dungeon.closed) {
      const d = party.dungeon;
      d.add(p, (d.map.start.x + 0.5) * TILE, (d.map.start.y + 0.5) * TILE);
      d.onReachFloor(p);
      return;
    }
    if (party && party.leader !== p) return p.toast('Aguarde o líder abrir o portal.', 'error');
    const d = new Dungeon(this, party, floor);
    this.dungeons.add(d);
    const members = party ? party.members.filter((m) => m.world === this.town) : [p];
    if (party) party.dungeon = d;
    for (const m of members) {
      m.char.data.phoenixUsed = false;
      d.add(m, (d.map.start.x + 0.5) * TILE + (Math.random() - 0.5) * 20, (d.map.start.y + 0.5) * TILE + (Math.random() - 0.5) * 20);
      d.onReachFloor(m);
    }
  }

  private sell(p: Player, idx: number) {
    if (p.world !== this.town) return p.toast('Venda itens na cidade.', 'error');
    const c = p.char;
    if (!validIndex(c, idx) || !c.data.inventory[idx]) return;
    const it = c.data.inventory[idx]!;
    const price = sellPrice(it);
    c.data.inventory[idx] = null;
    c.gold += price;
    this.repo.logTx(c.id, 'sell', price, 0, `${it.name} [${it.rank}]`);
    this.reply(p, { ok: true, msg: `Vendido por ${price} gold.` }, false);
  }

  /** Larga um item: na dungeon ele fica no chão (dá para pegar de volta); na cidade é descartado. */
  private drop(p: Player, idx: number) {
    const c = p.char;
    if (!validIndex(c, idx) || !c.data.inventory[idx]) return;
    const it = c.data.inventory[idx]!;
    c.data.inventory[idx] = null;
    if (p.world instanceof Dungeon) {
      p.world.dropItem(p, it);
      this.repo.logTx(c.id, 'drop', 0, 0, `${it.name} [${it.rank}] no andar ${p.world.floor}`);
      this.reply(p, { ok: true, msg: `${it.name} largado no chão. Afaste-se e volte para pegar de novo.` }, false);
    } else {
      this.repo.logTx(c.id, 'discard', 0, 0, `${it.name} [${it.rank}]`);
      this.reply(p, { ok: true, msg: `${it.name} descartado.` }, false);
    }
  }

  /** Baú pessoal da conta (na cidade, junto ao baú). */
  private stashOp(p: Player, op: string, idx: number) {
    if (p.world !== this.town || !this.town.nearNpc(p, 'stash', 5)) return p.toast('Vá até o Baú Pessoal na cidade.', 'error');
    p.stash ??= this.repo.getStash(p.userId, STASH_SLOTS);
    const c = p.char, st = p.stash;
    if (op === 'put') {
      if (!validIndex(c, idx) || !c.data.inventory[idx]) return;
      const free = st.indexOf(null);
      if (free < 0) return p.toast('Baú cheio.', 'error');
      st[free] = c.data.inventory[idx];
      c.data.inventory[idx] = null;
    } else if (op === 'take') {
      if (!Number.isInteger(idx) || idx < 0 || idx >= st.length || !st[idx]) return;
      if (!addToInventory(c, st[idx]!)) return p.toast('Inventário cheio.', 'error');
      st[idx] = null;
    } else if (op !== 'open') return;
    if (op !== 'open') {
      // baú e personagem salvos juntos (nada se perde nem se duplica)
      this.repo.tx(() => { this.repo.saveStash(p.userId, st); this.repo.saveCharacter(c); });
      p.dirty = false;
      p.sendChar();
    }
    const order = st.map((it, i) => ({ it, i })).filter((x) => x.it).sort((a, b) => RANKS.indexOf(b.it!.rank) - RANKS.indexOf(a.it!.rank));
    p.send({ t: 'stash', items: order.map((x) => ({ i: x.i, item: x.it })), slots: STASH_SLOTS });
  }

  /** Vende ao mercador todos os itens do inventário até o rank indicado (0=F … 4=B). */
  private sellBulk(p: Player, maxRank: number) {
    if (p.world !== this.town) return p.toast('Venda itens na cidade.', 'error');
    if (!Number.isInteger(maxRank) || maxRank < 0 || maxRank > 4) return;
    const c = p.char;
    let total = 0, n = 0;
    for (let i = 0; i < c.data.invSlots; i++) {
      const it = c.data.inventory[i];
      if (!it || RANKS.indexOf(it.rank) > maxRank) continue;
      total += sellPrice(it);
      n++;
      c.data.inventory[i] = null;
    }
    if (!n) return p.toast('Nenhum item desses ranks para vender.', 'info');
    c.gold += total;
    this.repo.logTx(c.id, 'sell_bulk', total, 0, `${n} itens até rank ${RANKS[maxRank]}`);
    this.reply(p, { ok: true, msg: `${n} itens vendidos por ${total} gold.` }, false);
  }

  private talent(p: Player, id: string) {
    const t = p.cls.talents.find((x) => x.id === id);
    const c = p.char;
    if (!t) return;
    if (talentPointsSpent(c) >= talentPointsTotal(c.level)) return p.toast('Sem pontos de talento.', 'error');
    if ((c.data.talents[id] ?? 0) >= t.max) return p.toast('Talento no máximo.', 'error');
    c.data.talents[id] = (c.data.talents[id] ?? 0) + 1;
    this.reply(p, { ok: true }, true);
  }

  private claimDaily(p: Player, id: string) {
    const c = p.char;
    ensureDaily(c);
    const d = DAILIES.find((x) => x.id === id);
    if (!d || c.data.daily.claimed.includes(id)) return;
    if (c.data.daily[d.key] < d.goal) return p.toast('Missão ainda não concluída.', 'error');
    c.data.daily.claimed.push(id);
    c.gems += d.gems;
    this.repo.logTx(c.id, 'daily', 0, d.gems, id);
    this.reply(p, { ok: true, msg: `+${d.gems} gemas!` }, false);
  }

  // ---------- lojas ----------
  private shop(p: Player, m: Record<string, unknown>): void {
    if (p.world !== this.town) return p.toast('Lojas só na cidade.', 'error');
    const c = p.char;
    const op = str(m.op, 20);
    const need = (role: string) => {
      if (!this.town.nearNpc(p, role, 5)) { p.toast('Aproxime-se do vendedor.', 'error'); return false; }
      return true;
    };
    const pay = (gold: number, gems: number, kind: string, detail: string): boolean => {
      if (c.gold < gold) { p.toast('Gold insuficiente.', 'error'); return false; }
      if (c.gems < gems) { p.toast('Gemas insuficientes.', 'error'); return false; }
      c.gold -= gold; c.gems -= gems;
      this.repo.logTx(c.id, kind, -gold, -gems, detail);
      return true;
    };

    switch (op) {
      // ----- Ferreiro -----
      case 'stock': {
        const date = today();
        const bought = c.data.shop?.date === date ? c.data.shop.bought : [];
        return p.send({ t: 'stock', items: smithStock(c.id, date, c.maxFloor || 1).map((s, i) => ({ ...s, sold: bought.includes(i) })) });
      }
      case 'buy': {
        if (!need('smith')) return;
        const i = num(m.i);
        const date = today();
        const stock = smithStock(c.id, date, c.maxFloor || 1);
        if (!Number.isInteger(i) || !stock[i]) return;
        if (c.data.shop?.date !== date) c.data.shop = { date, bought: [] };
        if (c.data.shop.bought.includes(i)) return p.toast('Item já vendido.', 'error');
        if (freeSlot(c) < 0) return p.toast('Inventário cheio.', 'error');
        if (!pay(stock[i].price, 0, 'buy', stock[i].item.name)) return;
        const item = { ...stock[i].item, id: `${c.id}${Date.now().toString(36)}${i}` };
        addToInventory(c, item);
        c.data.shop.bought.push(i);
        this.reply(p, { ok: true, msg: `Comprou ${item.name}.` }, false);
        return this.shop(p, { op: 'stock' });
      }
      case 'refine': {
        if (!need('smith')) return;
        const it = locate(c, m.ref);
        if (!it) return p.toast('Item inválido.', 'error');
        if (!canRefine(it)) return p.toast('Refino máximo (+15).', 'error');
        const cost = refineCost(it);
        if (!pay(cost, 0, 'refine', `${it.name} +${it.refine}`)) return;
        const ok = Math.random() < refineChance(it);
        if (ok) it.refine++;
        else if (it.refine >= 10) it.refine--;
        p.send({ t: 'refined', ok, refine: it.refine });
        return this.reply(p, { ok: true, msg: ok ? `Sucesso! ${it.name} agora é +${it.refine}.` : it.refine >= 9 ? `Falhou... o item caiu para +${it.refine}.` : 'Falhou! O item não mudou.' }, true);
      }
      case 'repair': {
        if (!need('smith')) return;
        const items = Object.values(c.data.equipment).filter((x) => x && x.durability < 100);
        const cost = items.reduce((a, it) => a + repairCost(it!), 0);
        if (!cost) return p.toast('Nada para reparar.', 'info');
        if (!pay(cost, 0, 'repair', `${items.length} itens`)) return;
        for (const it of items) it!.durability = 100;
        return this.reply(p, { ok: true, msg: `Reparado por ${cost} gold.` }, true);
      }
      // ----- Mercador de armas (Mercado) -----
      case 'mstock': case 'mbuy': case 'mreroll': {
        const period = merchantPeriod();
        if (c.data.merchant?.period !== period) c.data.merchant = { period, reroll: 0, bought: [] };
        const mer = c.data.merchant;
        if (op === 'mreroll') {
          if (!need('market')) return;
          if (!pay(merchantRerollCost(c.level), 0, 'merchant_reroll', `renovação ${mer.reroll + 1}`)) return;
          mer.reroll++; mer.bought = [];
          p.dirty = true; p.sendChar();
        }
        const stock = merchantStock(c.id, period, mer.reroll, c.maxFloor || c.level);
        if (op === 'mbuy') {
          if (!need('market')) return;
          const i = num(m.i);
          if (!Number.isInteger(i) || !stock[i]) return;
          if (mer.bought.includes(i)) return p.toast('Essa arma já foi vendida.', 'error');
          if (freeSlot(c) < 0) return p.toast('Inventário cheio.', 'error');
          if (!pay(stock[i].price, 0, 'merchant_buy', `${stock[i].item.name} [${stock[i].item.rank}]`)) return;
          addToInventory(c, { ...stock[i].item, id: `${c.id}m${Date.now().toString(36)}${i}` });
          mer.bought.push(i);
          this.reply(p, { ok: true, msg: `Comprou ${stock[i].item.name}.` }, false);
        }
        const nextIn = (period + 1) * 3600_000 - Date.now();
        return p.send({ t: 'mstock', items: stock.map((s, i) => ({ ...s, sold: mer.bought.includes(i) })), rerollCost: merchantRerollCost(c.level), nextIn });
      }
      // ----- Alquimista -----
      case 'potion': {
        if (!need('alchemist')) return;
        const kind = m.k === 'mana' ? 'manaPotion' : 'hpPotion';
        const qty = Math.min(20, Math.max(1, Math.floor(num(m.n) || 1)));
        const cost = potionPrice(kind, c.level) * qty;
        if (c.data.consumables[kind] + qty > 99) return p.toast('Máximo de 99 poções.', 'error');
        if (!pay(cost, 0, 'potion', `${kind} x${qty}`)) return;
        c.data.consumables[kind] += qty;
        return this.reply(p, { ok: true, msg: `Comprou ${qty} poção(ões).` }, false);
      }
      // ----- Joalheiro -----
      case 'gem': {
        if (!need('jeweler')) return;
        const tier = num(m.tier);
        if (!isGemId(m.id) || ![1, 2, 3].includes(tier)) return;
        const price = gemPrice(tier);
        if (!pay(price.gold, price.gems, 'gem', `${m.id} T${tier}`)) return;
        const k = gemKey(m.id as string, tier);
        c.data.socketGems[k] = (c.data.socketGems[k] ?? 0) + 1;
        return this.reply(p, { ok: true, msg: 'Gema comprada.' }, false);
      }
      case 'combine': {
        if (!need('jeweler')) return;
        const tier = num(m.tier);
        if (!isGemId(m.id) || !Number.isInteger(tier) || tier < 1 || tier >= MAX_GEM_TIER) return;
        const k = gemKey(m.id as string, tier);
        if ((c.data.socketGems[k] ?? 0) < 3) return p.toast('Precisa de 3 gemas iguais.', 'error');
        if (!pay(combineCost(tier), 0, 'combine', k)) return;
        c.data.socketGems[k] -= 3;
        const up = gemKey(m.id as string, tier + 1);
        c.data.socketGems[up] = (c.data.socketGems[up] ?? 0) + 1;
        return this.reply(p, { ok: true, msg: `Gema aprimorada para nível ${tier + 1}!` }, false);
      }
      case 'socket': {
        if (!need('jeweler')) return;
        const it = locate(c, m.ref);
        const tier = num(m.tier);
        if (!it || !isGemId(m.id) || !Number.isInteger(tier)) return p.toast('Item ou gema inválidos.', 'error');
        const k = gemKey(m.id as string, tier);
        if ((c.data.socketGems[k] ?? 0) < 1) return p.toast('Você não tem essa gema.', 'error');
        if (it.gems.length >= it.sockets) return p.toast('Sem engastes livres neste item.', 'error');
        c.data.socketGems[k]--;
        it.gems.push({ id: m.id as string, tier });
        this.repo.logTx(c.id, 'socket', 0, 0, `${k} -> ${it.name}`);
        return this.reply(p, { ok: true, msg: 'Gema engastada.' }, true);
      }
      case 'unsocket': {
        if (!need('jeweler')) return;
        const it = locate(c, m.ref);
        if (!it || !it.gems.length) return;
        if (!pay(unsocketCost, 0, 'unsocket', it.name)) return;
        const g = it.gems.pop()!;
        const k = gemKey(g.id, g.tier);
        c.data.socketGems[k] = (c.data.socketGems[k] ?? 0) + 1;
        return this.reply(p, { ok: true, msg: 'Gema removida.' }, true);
      }
      // ----- Loja de gemas (premium) -----
      case 'premium': {
        const id = str(m.id, 30);
        const def = GEM_SHOP.find((x) => x.id === id);
        if (!def) return;
        if ('cosmetic' in def && c.data.cosmetics.includes(id)) return p.toast('Você já possui.', 'error');
        if (id === 'invExpand' && c.data.invSlots >= MAX_INV_SLOTS) return p.toast('Inventário no tamanho máximo.', 'error');
        if (id === 'chest' && freeSlot(c) < 0) return p.toast('Inventário cheio.', 'error');
        if (id === 'talentReset' && talentPointsSpent(c) === 0) return p.toast('Nenhum talento para resetar.', 'error');
        if (!pay(0, def.gems, 'premium', id)) return;
        if (id === 'chest') {
          const ilvl = Math.max(1, c.maxFloor) + 5;
          const item = rollItem(Math.random, { ilvl, floor: ilvl, bonus: { magicFind: p.stats.magicFind + 0.8 } });
          if (RANKS.indexOf(item.rank) < 3) item.rank = 'C';
          addToInventory(c, item);
          if (item.rank === 'SSS') this.announce(`✦ ${p.name} abriu um Baú de Equipamento e obteve ${item.name} [SSS]!`, 'sss');
          p.send({ t: 'chestOpened', item });
        } else if (id === 'invExpand') {
          c.data.invSlots = Math.min(MAX_INV_SLOTS, c.data.invSlots + INV_EXPANSION_SLOTS);
          while (c.data.inventory.length < c.data.invSlots) c.data.inventory.push(null);
        } else if (id === 'talentReset') {
          c.data.talents = {};
        } else {
          c.data.cosmetics.push(id);
          c.data.cosmetic = id;
          p.known.clear();
        }
        return this.reply(p, { ok: true, msg: `${def.name} adquirido!` }, true);
      }
    }
  }

  // ---------- mercado entre jogadores ----------
  private market(p: Player, m: Record<string, unknown>): void {
    const c = p.char;
    const op = str(m.op, 10);
    if (op === 'list') {
      return p.send({ t: 'market', listings: this.repo.listMarket().map((l) => ({ id: l.id, seller: l.seller_name, item: l.item, price: l.price, mine: l.seller_char_id === c.id })) });
    }
    if (p.world !== this.town || !this.town.nearNpc(p, 'market', 5)) return p.toast('Vá até o Mercado.', 'error');
    if (op === 'sell') {
      const idx = num(m.idx);
      const price = Math.floor(num(m.price));
      if (!validIndex(c, idx) || !c.data.inventory[idx]) return;
      if (!(price >= 1 && price <= MARKET_MAX_PRICE)) return p.toast('Preço inválido.', 'error');
      if (this.repo.countListings(c.id) >= MARKET_MAX_LISTINGS) return p.toast(`Máximo de ${MARKET_MAX_LISTINGS} anúncios.`, 'error');
      const it = c.data.inventory[idx]!;
      this.repo.tx(() => {
        this.repo.addListing(c.id, c.name, it, price);
        c.data.inventory[idx] = null;
        this.repo.saveCharacter(c);
        this.repo.logTx(c.id, 'market_list', 0, 0, `${it.name} por ${price}`);
      });
      this.reply(p, { ok: true, msg: 'Item anunciado no Mercado.' }, false);
      return this.market(p, { op: 'list' });
    }
    if (op === 'cancel' || op === 'buy') {
      const id = num(m.id);
      const l = Number.isInteger(id) ? this.repo.getListing(id) : undefined;
      if (!l) return p.toast('Anúncio não encontrado.', 'error');
      if (freeSlot(c) < 0) return p.toast('Inventário cheio.', 'error');
      if (op === 'cancel') {
        if (l.seller_char_id !== c.id) return;
        this.repo.tx(() => {
          if (!this.repo.removeListing(l.id)) throw new Error('race');
          addToInventory(c, l.item);
          this.repo.saveCharacter(c);
        });
        this.reply(p, { ok: true, msg: 'Anúncio cancelado.' }, false);
        return this.market(p, { op: 'list' });
      }
      if (l.seller_char_id === c.id) return p.toast('Esse anúncio é seu.', 'error');
      if (c.gold < l.price) return p.toast('Gold insuficiente.', 'error');
      const net = Math.floor(l.price * (1 - MARKET_TAX));
      const seller = this.byChar.get(l.seller_char_id);
      try {
        this.repo.tx(() => {
          if (!this.repo.removeListing(l.id)) throw new Error('race');
          c.gold -= l.price;
          addToInventory(c, l.item);
          this.repo.saveCharacter(c);
          if (seller) { seller.char.gold += net; this.repo.saveCharacter(seller.char); }
          else this.repo.addGold(l.seller_char_id, net);
          this.repo.logTx(c.id, 'market_buy', -l.price, 0, `${l.item.name} de ${l.seller_name}`);
          this.repo.logTx(l.seller_char_id, 'market_sale', net, 0, `${l.item.name} para ${c.name} (taxa ${l.price - net})`);
        });
      } catch {
        return p.toast('Este item acabou de ser vendido.', 'error');
      }
      if (seller) { seller.toast(`${c.name} comprou ${l.item.name}. +${net} gold (taxa de ${Math.round(MARKET_TAX * 100)}%).`, 'good'); seller.sendChar(); }
      this.reply(p, { ok: true, msg: `Comprou ${l.item.name}.` }, false);
      return this.market(p, { op: 'list' });
    }
  }

  stats() {
    return { online: this.byChar.size, dungeons: this.dungeons.size, tick: this.tickStats };
  }
}

export { ACHIEVEMENTS, DAILIES };
export type { Slot };
