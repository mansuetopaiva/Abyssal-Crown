import { BIOMES, SKILL_UNLOCK_LEVELS, TICK_MS, TICK_RATE, TILE, skillUnlocked, xpForLevel } from '../../shared/constants';
import { decodeTiles, T_FLOOR } from '../../shared/dungeon';
import { moveWithCollision } from '../../shared/movement';
import { allSkills, CLASS_BY_ID } from '../../shared/stats';
import type { Stats } from '../../shared/types';
import { wsUrl } from './api';
import { $, h, fmt } from './dom';
import { Pool } from './render/pool';
import { F_DEAD, K_BOSS, K_LOOT, K_MONSTER, K_PLAYER, type Ent, type MapState } from './render3d/common';
import { Renderer3D } from './render3d/renderer3d';
import { Panels } from './ui/panels';

const INTERP_MS = 100;

export class Game {
  ws!: WebSocket;
  r: Renderer3D;
  ents = new Map<number, Ent>();
  entPool = new Pool<Ent>(() => ({ id: 0, kind: 0, x: 0, y: 0, hp: 100, flags: 0, meta: {}, buf: [], seen: 0, flash: 0, face: 1, prevX: 0, bob: 0, active: false }), 2000);
  selfEid = 0;
  char: any = null;
  stats: Stats | null = null;
  map: MapState | null = null;
  me = { hp: 1, maxHp: 1, mana: 0, maxMana: 1, speed: 72 };
  // predição do jogador local
  px = 0; py = 0; prevPx = 0; prevPy = 0;
  seq = 0;
  pending: { seq: number; dx: number; dy: number }[] = [];
  lastDir = [0, 0];
  acc = 0;
  // entrada
  keys = new Set<string>();
  mouse = { x: 0, y: 0, down: false };
  stick = { x: 0, y: 0 };
  touchAttack = false;
  aim = 0;
  nextAtkAt = 0;
  cds = new Map<string, { until: number; total: number }>();
  party: any = null;
  partyIds = new Set<number>();
  boss: { id: number; name: string; max: number } | null = null;
  snapTick = 0;
  running = false;
  raf = 0;
  last = 0;
  fps = { frames: 0, t: 0, value: 0, worst: 0 };
  hudT = 0;
  miniT = 0;
  hoverId = 0;
  panels: Panels;
  touchMode = matchMedia('(pointer: coarse)').matches;
  closed = false;
  onExit: () => void = () => {};

  constructor(public charId: number) {
    this.r = new Renderer3D($<HTMLCanvasElement>('#game-canvas'), $<HTMLCanvasElement>('#overlay'), $<HTMLCanvasElement>('#minimap'));
    this.panels = new Panels(this);
    this.bindInput();
  }

  // ---------------- rede ----------------
  connect() {
    $('#loading').hidden = false;
    this.ws = new WebSocket(wsUrl());
    this.ws.onopen = () => this.send({ t: 'join', charId: this.charId });
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    this.ws.onclose = (ev) => {
      if (this.closed) return;
      this.stop();
      const why = ev.code === 4001 ? 'Sua conta entrou em outro lugar.' : ev.code === 4003 ? 'Personagem inválido.' : 'Conexão perdida com o servidor.';
      alert(why);
      this.onExit();
    };
  }

  send(m: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.closed = true;
    this.stop();
    this.ws?.close();
  }

  private onMessage(m: any) {
    switch (m.t) {
      case 'welcome': this.selfEid = m.eid; break;
      case 'char':
        this.char = m.char; this.stats = m.stats;
        this.updateHudStatic();
        this.panels.refresh();
        break;
      case 'map': this.loadMap(m); break;
      case 's': this.onSnapshot(m); break;
      case 'tile': this.r.setTile(m.x, m.y, m.v); break;
      case 'obj':
        if (!this.map) break;
        if (m.stairs && this.map.stairs) { this.map.stairs.open = true; this.r.openStairs(); }
        if (typeof m.i === 'number' && this.map.objects[m.i]) { this.map.objects[m.i].open = !!m.open; if (m.open) this.r.openChest(m.i); }
        break;
      case 'pos': this.px = this.prevPx = m.x; this.py = this.prevPy = m.y; this.pending = []; break;
      case 'cd': this.cds.set(m.id, { until: performance.now() + m.ms, total: m.ms }); break;
      case 'fx': for (const f of m.fx) this.r.serverFx(f, this.selfEid); break;
      case 'chat': this.chat(m); break;
      case 'toast': this.toast(m.text, m.kind); break;
      case 'party': this.party = m.party; this.renderParty(); break;
      case 'invite': this.chat({ kind: 'party', text: `${m.from} convidou você para um grupo. Digite /aceitar ${m.from}` }); this.toast(`Convite de grupo de ${m.from} — /aceitar ${m.from}`, 'good'); break;
      case 'pickup': {
        if (m.item) this.r.text(this.px, this.py - 16, m.item.name, '#ffffff', 1);
        else if (m.gold) this.r.text(this.px, this.py - 12, `+${m.gold} gold`, '#ffd23f', 0.8);
        if (m.gems) this.r.text(this.px, this.py - 20, `+${m.gems} gemas`, '#7fe3ff', 1);
        break;
      }
      case 'stock': case 'market': case 'refined': case 'chestOpened': this.panels.onServer(m); break;
    }
  }

  private loadMap(m: any) {
    const tiles = decodeTiles(m.tiles, m.w * m.h);
    this.map = { w: m.w, h: m.h, tiles, biome: m.biome, world: m.world, objects: m.objects ?? [], stairs: m.stairs, explored: new Uint8Array(m.w * m.h) };
    this.r.setMap(this.map);
    for (const e of this.ents.values()) e.active = false;
    this.ents.clear();
    this.entPool.sweep();
    this.px = this.prevPx = m.x; this.py = this.prevPy = m.y;
    this.pending = [];
    this.boss = null;
    $('#boss-bar').hidden = true;
    $('#hud-floor').textContent = m.world === 'town' ? 'Cidade de Vhal' : `Andar ${m.floor}`;
    $('#hud-biome').textContent = m.world === 'town' ? 'Refúgio dos aventureiros' : BIOMES[m.biome].name;
    $('#btn-town').hidden = m.world === 'town';
    $('#loading').hidden = true;
    this.panels.close();
    if (m.world === 'dungeon') this.centerMsg(m.boss ? `Andar ${m.floor} — ${m.boss}` : `Andar ${m.floor} · ${BIOMES[m.biome].name}`);
    if (!this.running) this.start();
  }

  private onSnapshot(m: any) {
    const now = performance.now();
    const tick = ++this.snapTick;
    for (const row of m.e as any[]) {
      const [id, kind, x10, y10, hp, flags, meta] = row;
      let e = this.ents.get(id);
      if (!e) {
        e = this.entPool.get() ?? undefined;
        if (!e) continue;
        e.id = id; e.kind = kind; e.buf.length = 0; e.meta = {}; e.flash = 0; e.face = 1; e.bob = Math.random() * 6;
        e.x = e.prevX = x10 / 10; e.y = y10 / 10; e.hp = hp;
        this.ents.set(id, e);
      }
      if (meta) Object.assign(e.meta, meta);
      if (hp < e.hp && kind !== K_LOOT) e.flash = 0.12;
      e.hp = hp; e.flags = flags; e.seen = tick;
      e.buf.push({ t: now, x: x10 / 10, y: y10 / 10 });
      if (e.buf.length > 8) e.buf.shift();
      if (kind === K_BOSS) {
        if (!this.boss || this.boss.id !== id) this.boss = { id, name: e.meta.n, max: e.meta.hp };
        if (meta?.hp) this.boss.max = meta.hp;
      }
    }
    for (const [id, e] of this.ents) if (e.seen !== tick) { e.active = false; this.ents.delete(id); if (this.boss?.id === id) this.boss = null; }
    this.entPool.sweep();

    // reconciliação do jogador local
    const [hp, maxHp, mana, maxMana, ack, sx, sy, speed] = m.me;
    Object.assign(this.me, { hp, maxHp, mana, maxMana, speed });
    this.pending = this.pending.filter((p) => p.seq > ack);
    let x = sx, y = sy;
    if (this.map) for (const p of this.pending) ({ x, y } = moveWithCollision(this.map, x, y, (p.dx * speed) / TICK_RATE, (p.dy * speed) / TICK_RATE, 5));
    const err = Math.hypot(x - this.px, y - this.py);
    if (err > 0.01) {
      // correção suave para erros pequenos, imediata para grandes (teleporte, investida)
      if (err < 6) { this.px += (x - this.px) * 0.5; this.py += (y - this.py) * 0.5; }
      else { this.px = this.prevPx = x; this.py = this.prevPy = y; }
    }
    if (m.fx) for (const f of m.fx) {
      if (f[0] === 'ph') this.centerMsg(String(f[1]));
      else this.r.serverFx(f, this.selfEid);
    }
  }

  // ---------------- loop ----------------
  start() {
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    $('#screen-game').hidden = false;
    this.r.resize();
    const frame = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(now: number) {
    const dtMs = Math.min(100, now - this.last);
    this.last = now;
    const dt = dtMs / 1000;
    // FPS
    this.fps.frames++; this.fps.t += dtMs; this.fps.worst = Math.max(this.fps.worst, dtMs);
    if (this.fps.t >= 1000) { this.fps.value = Math.round((this.fps.frames * 1000) / this.fps.t); $('#hud-fps').textContent = `${this.fps.value} FPS`; (window as any).__fps = { fps: this.fps.value, worst: this.fps.worst }; this.fps = { frames: 0, t: 0, value: this.fps.value, worst: 0 }; }

    // passo fixo de simulação/entrada (20 Hz), igual ao servidor
    this.acc += dtMs;
    while (this.acc >= TICK_MS) { this.acc -= TICK_MS; this.fixedStep(); }
    const alpha = this.acc / TICK_MS;

    // interpolação das outras entidades (100 ms no passado)
    const rt = now - INTERP_MS;
    for (const e of this.ents.values()) {
      if (e.id === this.selfEid) {
        e.x = this.prevPx + (this.px - this.prevPx) * alpha;
        e.y = this.prevPy + (this.py - this.prevPy) * alpha;
      } else {
        const b = e.buf;
        let i = b.length - 1;
        while (i > 0 && b[i - 1].t > rt) i--;
        const a = b[Math.max(0, i - 1)], c = b[i];
        if (!a || !c) continue;
        const k = c.t === a.t ? 1 : Math.max(0, Math.min(1, (rt - a.t) / (c.t - a.t)));
        e.x = a.x + (c.x - a.x) * k;
        e.y = a.y + (c.y - a.y) * k;
      }
      const dx = e.x - e.prevX;
      if (Math.abs(dx) > 0.05) e.face = dx > 0 ? 1 : -1;
      if (Math.abs(dx) > 0.02 || Math.abs(e.y - (e.buf[e.buf.length - 2]?.y ?? e.y)) > 0.02) e.bob += dt * 12;
      e.prevX = e.x;
      if (e.flash > 0) e.flash -= dt;
    }
    const self = this.ents.get(this.selfEid);
    if (self) {
      const [wx] = this.r.screenToWorld(this.mouse.x, this.mouse.y);
      if (!this.touchMode) self.face = wx >= self.x ? 1 : -1;
    }

    if (this.map?.world === 'dungeon' || !this.touchMode) this.r.selfAim = this.aimAngle();
    // câmera segue o jogador
    (window as any).__pos = { x: this.px, y: this.py }; // usado pelo teste E2E
    this.r.camX = this.prevPx + (this.px - this.prevPx) * alpha;
    this.r.camY = this.prevPy + (this.py - this.prevPy) * alpha;
    this.updateHover();
    this.r.draw(this.ents.values(), this.selfEid, dt, this.hoverId);

    this.hudT += dt; this.miniT += dt;
    if (this.hudT > 0.1) { this.hudT = 0; this.updateHud(); }
    if (this.miniT > 0.25) { this.miniT = 0; this.r.drawMinimap(this.ents.values(), this.selfEid, this.partyIds); }
  }

  private fixedStep() {
    this.prevPx = this.px; this.prevPy = this.py;
    if (!this.map) return;
    let dx = 0, dy = 0;
    const typing = document.activeElement?.tagName === 'INPUT';
    if (!typing) {
      if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
      if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    }
    if (this.stick.x || this.stick.y) { dx = this.stick.x; dy = this.stick.y; }
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const selfEnt = this.ents.get(this.selfEid);
    const dead = selfEnt ? (selfEnt.flags & F_DEAD) !== 0 : false;
    if ((dx || dy || this.lastDir[0] || this.lastDir[1]) && !dead) {
      const seq = ++this.seq;
      this.send({ t: 'i', s: seq, x: Math.round(dx * 1000) / 1000, y: Math.round(dy * 1000) / 1000 });
      this.pending.push({ seq, dx, dy });
      if (this.pending.length > 60) this.pending.shift();
      const r = moveWithCollision(this.map, this.px, this.py, (dx * this.me.speed) / TICK_RATE, (dy * this.me.speed) / TICK_RATE, 5);
      this.px = r.x; this.py = r.y;
    }
    this.lastDir = [dx, dy];
    // marca tiles explorados para o minimapa
    if (this.map.world === 'dungeon') {
      const tx = Math.floor(this.px / TILE), ty = Math.floor(this.py / TILE), R = 7;
      for (let y = Math.max(0, ty - R); y <= Math.min(this.map.h - 1, ty + R); y++)
        for (let x = Math.max(0, tx - R); x <= Math.min(this.map.w - 1, tx + R); x++) this.map.explored[y * this.map.w + x] = 1;
    }
    // ataque contínuo enquanto o botão está pressionado
    if ((this.mouse.down || this.touchAttack) && this.map.world === 'dungeon') this.attack();
    this.updateInteractHint();
  }

  // ---------------- ações ----------------
  private aimAngle(): number {
    if (this.touchMode) {
      const t = this.nearestMonster(200);
      if (t) return Math.atan2(t.y - this.py, t.x - this.px);
      return this.aim;
    }
    const [wx, wy] = this.r.screenToWorld(this.mouse.x, this.mouse.y);
    return Math.atan2(wy - this.py, wx - this.px);
  }

  private aimPoint(): [number, number] {
    if (this.touchMode) { const t = this.nearestMonster(220); return t ? [t.x, t.y] : [this.px + Math.cos(this.aim) * 60, this.py + Math.sin(this.aim) * 60]; }
    return this.r.screenToWorld(this.mouse.x, this.mouse.y);
  }

  private nearestMonster(maxD: number) {
    let best: Ent | null = null, bd = maxD;
    for (const e of this.ents.values()) {
      if (e.kind !== K_MONSTER && e.kind !== K_BOSS) continue;
      const d = Math.hypot(e.x - this.px, e.y - this.py);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  attack() {
    const now = performance.now();
    if (now < this.nextAtkAt || !this.stats) return;
    this.nextAtkAt = now + 1000 / (this.stats.atkSpd * 1.05);
    const a = this.aimAngle();
    this.send({ t: 'atk', a: Math.round(a * 1000) / 1000 });
  }

  skill(i: number) {
    if (this.map?.world !== 'dungeon' || !this.char) return;
    const sk = allSkills(CLASS_BY_ID[this.char.classId])[i];
    if (!skillUnlocked(this.char.level, i)) { this.toast(`${sk.name} é liberada no nível ${SKILL_UNLOCK_LEVELS[i]}.`, 'error'); return; }
    const cd = this.cds.get(sk.id);
    if (cd && cd.until > performance.now()) return;
    const [x, y] = this.aimPoint();
    this.send({ t: 'sk', i, a: Math.round(this.aimAngle() * 1000) / 1000, x: Math.round(x), y: Math.round(y) });
  }

  interact() {
    if (!this.map) return;
    if (this.map.world === 'dungeon') return this.send({ t: 'use' });
    const npc = this.nearNpc();
    if (npc) this.panels.open(npc.role === 'portal' ? 'portal' : npc.role === 'board' ? 'leaderboard' : npc.role);
  }

  private nearNpc() {
    let best = null, bd = 3.5 * TILE;
    for (const n of this.r.town.npcs) {
      const d = Math.hypot(n.x * TILE - this.px, n.y * TILE - this.py);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  private updateInteractHint() {
    const el = $('#interact-hint');
    let text = '';
    const m = this.map!;
    if (m.world === 'town') {
      const n = this.nearNpc();
      if (n) text = `E — ${n.name}`;
    } else {
      if (m.stairs && Math.hypot((m.stairs.x + 0.5) * TILE - this.px, (m.stairs.y + 0.5) * TILE - this.py) < 26)
        text = m.stairs.open ? 'E — Descer as escadas' : 'Derrote o chefe para liberar a escada';
      else for (const o of m.objects)
        if ((o.k === 'chest' || o.k === 'secretChest') && !o.open && Math.hypot((o.x + 0.5) * TILE - this.px, (o.y + 0.5) * TILE - this.py) < 26) { text = 'E — Abrir baú'; break; }
    }
    if (el.textContent !== text) { el.textContent = text; el.hidden = !text; }
  }

  private updateHover() {
    if (this.touchMode) return;
    const [wx, wy] = this.r.screenToWorld(this.mouse.x, this.mouse.y);
    let best = 0, bd = 12;
    for (const e of this.ents.values()) {
      if (e.kind === K_PLAYER && e.id === this.selfEid) continue;
      const d = Math.hypot(e.x - wx, e.y - wy);
      if (d < bd) { bd = d; best = e.id; }
    }
    this.hoverId = best;
  }

  // ---------------- entrada ----------------
  private bindInput() {
    const canvas = this.r.canvas;
    addEventListener('resize', () => this.r.resize());
    addEventListener('keydown', (e) => {
      if (!this.running) return;
      const k = e.key.toLowerCase();
      const typing = document.activeElement?.tagName === 'INPUT';
      if (k === 'escape') { (document.activeElement as HTMLElement)?.blur(); this.panels.close(); return; }
      if (k === 'enter') {
        const input = $<HTMLInputElement>('#chat-input');
        if (!typing) { e.preventDefault(); input.focus(); }
        return;
      }
      if (typing) return;
      this.keys.add(k);
      if (['1', '2', '3', '4'].includes(k)) this.skill(Number(k) - 1);
      else if (k === 'r') this.skill(4);
      else if (k === 'e') this.interact();
      else if (k === 'q') this.send({ t: 'potion', k: 'hp' });
      else if (k === 'f') this.send({ t: 'potion', k: 'mana' });
      else if (k === 'i') this.panels.toggle('inventory');
      else if (k === 'c') this.panels.toggle('character');
      else if (k === 'j') this.panels.toggle('quests');
      else if (k === 'l') this.panels.toggle('leaderboard');
      else if (k === 't' && this.map?.world === 'dungeon') this.send({ t: 'town' });
      else if (k === ' ') { e.preventDefault(); this.attack(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { this.mouse.down = true; this.attack(); } (document.activeElement as HTMLElement)?.blur(); });
    addEventListener('mouseup', () => { this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // pausa a renderização em segundo plano
    document.addEventListener('visibilitychange', () => {
      if (!this.map || this.closed) return;
      if (document.hidden) { this.stop(); this.keys.clear(); this.mouse.down = false; }
      else { this.pending = []; this.start(); }
    });

    $<HTMLFormElement>('#chat-form').onsubmit = (e) => {
      e.preventDefault();
      const input = $<HTMLInputElement>('#chat-input');
      const text = input.value.trim();
      if (text) this.send({ t: 'chat', text });
      input.value = '';
      input.blur();
    };
    $('#btn-hp').onclick = () => this.send({ t: 'potion', k: 'hp' });
    $('#btn-mp').onclick = () => this.send({ t: 'potion', k: 'mana' });
    $('#btn-town').onclick = () => this.send({ t: 'town' });
    for (const b of document.querySelectorAll<HTMLButtonElement>('.menu-buttons [data-panel]')) b.onclick = () => this.panels.toggle(b.dataset.panel!);

    // controles de toque
    if (this.touchMode) {
      $('#touch').hidden = false;
      const stick = $('#stick'), knob = stick.querySelector('i') as HTMLElement;
      let sid: number | null = null;
      const move = (t: Touch) => {
        const r = stick.getBoundingClientRect();
        let x = (t.clientX - r.left - r.width / 2) / (r.width / 2), y = (t.clientY - r.top - r.height / 2) / (r.height / 2);
        const l = Math.hypot(x, y);
        if (l > 1) { x /= l; y /= l; }
        this.stick = { x: Math.abs(x) < 0.15 ? 0 : x, y: Math.abs(y) < 0.15 ? 0 : y };
        if (l > 0.3) this.aim = Math.atan2(y, x);
        knob.style.transform = `translate(${x * 36}px, ${y * 36}px)`;
      };
      stick.addEventListener('touchstart', (e) => { e.preventDefault(); sid = e.changedTouches[0].identifier; move(e.changedTouches[0]); }, { passive: false });
      stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === sid) move(t); }, { passive: false });
      const end = () => { sid = null; this.stick = { x: 0, y: 0 }; knob.style.transform = ''; };
      stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
      const atk = $('#t-attack');
      atk.addEventListener('touchstart', (e) => { e.preventDefault(); this.touchAttack = true; this.attack(); }, { passive: false });
      atk.addEventListener('touchend', () => { this.touchAttack = false; });
      $('#t-use').addEventListener('touchstart', (e) => { e.preventDefault(); this.interact(); }, { passive: false });
    }
  }

  // ---------------- HUD ----------------
  private bar(sel: string, cur: number, max: number, label = true) {
    const el = $(sel);
    (el.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, cur / Math.max(1, max)))})`;
    if (label) (el.lastElementChild as HTMLElement).textContent = `${fmt(cur)} / ${fmt(max)}`;
    el.setAttribute('aria-valuenow', String(Math.round(cur)));
    el.setAttribute('aria-valuemax', String(Math.round(max)));
  }

  private updateHud() {
    this.bar('.bar.hp', this.me.hp, this.me.maxHp);
    this.bar('.bar.mp', this.me.mana, this.me.maxMana);
    if (this.boss) {
      const e = this.ents.get(this.boss.id);
      $('#boss-bar').hidden = !e;
      if (e) {
        $('#boss-bar .boss-name').textContent = this.boss.name;
        ($('#boss-bar .bar i') as HTMLElement).style.transform = `scaleX(${e.hp / 100})`;
      }
    } else $('#boss-bar').hidden = true;
    // recargas
    const now = performance.now();
    for (const el of document.querySelectorAll<HTMLElement>('#skillbar .skill')) {
      const cd = this.cds.get(el.dataset.id!);
      const ov = el.querySelector('.cd') as HTMLElement, txt = el.querySelector('.cdt') as HTMLElement;
      const left = cd ? cd.until - now : 0;
      ov.style.transform = `scaleY(${left > 0 ? left / cd!.total : 0})`;
      txt.textContent = left > 0 ? (left / 1000).toFixed(left < 1000 ? 1 : 0) : '';
      el.classList.toggle('nomana', this.me.mana < Number(el.dataset.mana));
    }
  }

  updateHudStatic() {
    const c = this.char;
    if (!c) return;
    const cls = CLASS_BY_ID[c.classId];
    $('#hud-name').textContent = c.name;
    $('#hud-level').textContent = `${cls.name} · Nv ${c.level}`;
    $('#hud-gold').textContent = fmt(c.gold);
    $('#hud-gems').textContent = fmt(c.gems);
    $('#pot-hp').textContent = String(c.data.consumables.hpPotion);
    $('#pot-mp').textContent = String(c.data.consumables.manaPotion);
    this.bar('.bar.xp', c.xp, xpForLevel(c.level), false);
    const bar = $('#skillbar');
    const unlocked = SKILL_UNLOCK_LEVELS.filter((lv) => c.level >= lv).length;
    const barKey = `${c.classId}:${unlocked}`;
    if (bar.dataset.key !== barKey) {
      bar.dataset.key = barKey;
      bar.replaceChildren(...allSkills(cls).map((s, i) => {
        const locked = !skillUnlocked(c.level, i);
        return h('button', {
          class: `skill${i === 4 ? ' ult' : ''}${locked ? ' locked' : ''}`, 'data-id': s.id, 'data-mana': s.mana,
          title: locked ? `${s.name} — liberada no nível ${SKILL_UNLOCK_LEVELS[i]}` : `${s.name} — ${s.desc} (${s.mana} mana, ${s.cd}s)`,
          'aria-label': `${s.name}, tecla ${i === 4 ? 'R' : i + 1}${locked ? `, bloqueada até o nível ${SKILL_UNLOCK_LEVELS[i]}` : ''}`, onclick: () => this.skill(i),
        }, h('span', { class: 'key', text: i === 4 ? 'R' : String(i + 1) }), locked ? '🔒' : s.name,
          locked ? h('span', { class: 'lock', text: `Nv ${SKILL_UNLOCK_LEVELS[i]}` }) : null, h('span', { class: 'cd' }), h('span', { class: 'cdt' }));
      }));
    }
  }

  private renderParty() {
    const box = $('#party-panel');
    this.partyIds.clear();
    if (!this.party) { box.replaceChildren(); return; }
    for (const m of this.party.members) this.partyIds.add(m.eid);
    box.replaceChildren(...this.party.members.filter((m: any) => m.id !== this.char?.id).map((m: any) => {
      const bar = h('div', { class: 'bar hp' }, h('i', { style: { transform: `scaleX(${m.hp / m.maxHp})` } }));
      const where = m.where === 'town' ? 'cidade' : m.where === 'dungeon' ? `andar ${m.floor}` : 'offline';
      return h('div', { class: 'party-member' }, `${m.name} · Nv ${m.level} · ${where}${m.id === this.party.leader ? ' ★' : ''}`, bar);
    }));
  }

  chat(m: { from?: string; text: string; kind?: string; cls?: string }) {
    const log = $('#chat-log');
    const li = h('li', { class: m.kind ?? 'player' });
    if (m.from) li.append(h('span', { class: 'from', text: `${m.from}: ` }));
    li.append(document.createTextNode(m.text));
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
    log.append(li);
    while (log.childElementCount > 80) log.firstElementChild!.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  toast(text: string, kind = 'info') {
    const box = $('#toasts');
    const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status', text });
    box.append(el);
    while (box.childElementCount > 4) box.firstElementChild!.remove();
    setTimeout(() => el.remove(), 3300);
  }

  private centerTimer = 0;
  centerMsg(text: string) {
    const el = $('#center-msg');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.centerTimer);
    this.centerTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
  }

  isFloor(x: number, y: number) {
    const m = this.map;
    return !!m && m.tiles[Math.floor(y / TILE) * m.w + Math.floor(x / TILE)] === T_FLOOR;
  }
}
