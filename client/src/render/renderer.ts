import { BIOMES, ELEMENT_COLOR, ELEMENTS, RANK_INFO, RANKS, TILE } from '../../../shared/constants';
import { T_FLOOR } from '../../../shared/dungeon';
import monsters from '../../../shared/data/monsters.json';
import bosses from '../../../shared/data/bosses.json';
import { CLASS_BY_ID } from '../../../shared/stats';
import { buildTown } from '../../../shared/town';
import { Pool } from './pool';
import { sprite, tileset, TOWN_BIOME, type TileSet } from './sprites';

export interface Ent {
  id: number; kind: number; x: number; y: number; hp: number; flags: number; meta: Record<string, any>;
  buf: { t: number; x: number; y: number }[]; seen: number; flash: number; face: number; prevX: number; bob: number;
  active: boolean;
}

export const K_PLAYER = 0, K_MONSTER = 1, K_PROJ = 2, K_MINION = 3, K_LOOT = 4, K_BOSS = 5;
export const F_DEAD = 1, F_STEALTH = 2, F_STUN = 4, F_SLOW = 8, F_POISON = 16, F_ELITE = 32, F_BUFF = 64, F_WINDUP = 128;

const MONSTER_DEF: Record<string, { shape: string; palette: string[] }> = Object.fromEntries(
  [...monsters, ...bosses].map((m) => [m.id, { shape: m.shape, palette: m.palette }]),
);
const elemColor = (i: number) => ELEMENT_COLOR[ELEMENTS[i] ?? 'physical'];
const CHUNK = 16;

interface Txt { active: boolean; x: number; y: number; vy: number; life: number; max: number; text: string; color: string; size: number }
interface Part { active: boolean; x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; grav: number }
interface Fx {
  active: boolean; type: string; x: number; y: number; x2: number; y2: number; r: number; a: number; len: number; wid: number;
  life: number; max: number; color: string; hostile: boolean; shape: number;
}

export interface MapState {
  w: number; h: number; tiles: Uint8Array; biome: number; world: 'town' | 'dungeon';
  objects: { k: string; x: number; y: number; open: boolean }[]; stairs?: { x: number; y: number; open: boolean };
  explored: Uint8Array;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; zoom = 3; dpr = 1;
  camX = 0; camY = 0;
  map: MapState | null = null;
  ts: TileSet = tileset(-1);
  private chunks = new Map<number, HTMLCanvasElement>();
  private vignette: HTMLCanvasElement | null = null;
  texts = new Pool<Txt>(() => ({ active: false, x: 0, y: 0, vy: 0, life: 0, max: 0, text: '', color: '', size: 0 }), 160);
  parts = new Pool<Part>(() => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, color: '', size: 1, grav: 0 }), 700);
  fx = new Pool<Fx>(() => ({ active: false, type: '', x: 0, y: 0, x2: 0, y2: 0, r: 0, a: 0, len: 0, wid: 0, life: 0, max: 0, color: '', hostile: false, shape: 0 }), 260);
  town = buildTown();
  time = 0;
  shake = 0;

  constructor(public canvas: HTMLCanvasElement, public minimap: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = this.canvas.clientWidth || window.innerWidth, ch = this.canvas.clientHeight || window.innerHeight;
    this.w = Math.round(cw * this.dpr);
    this.h = Math.round(ch * this.dpr);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    // ~24 tiles visíveis na largura, zoom inteiro (pixel perfeito)
    this.zoom = Math.max(2, Math.min(5, Math.round(Math.min(this.w / (24 * TILE), this.h / (15 * TILE)))));
    this.vignette = null;
  }

  setMap(m: MapState) {
    this.map = m;
    this.ts = tileset(m.world === 'town' ? -1 : m.biome); // carregamento preguiçoso por bioma
    this.chunks.clear();
    this.texts.clear(); this.parts.clear(); this.fx.clear();
  }

  setTile(x: number, y: number, v: number) {
    if (!this.map) return;
    this.map.tiles[y * this.map.w + x] = v;
    // invalida os chunks afetados (inclui o de cima, por causa da face da parede)
    for (const yy of [y, y - 1]) this.chunks.delete(Math.floor(yy / CHUNK) * 1000 + Math.floor(x / CHUNK));
  }

  private chunk(cx: number, cy: number): HTMLCanvasElement {
    const key = cy * 1000 + cx;
    let c = this.chunks.get(key);
    if (c) return c;
    const m = this.map!;
    c = document.createElement('canvas');
    c.width = c.height = CHUNK * TILE;
    const g = c.getContext('2d')!;
    for (let ty = 0; ty < CHUNK; ty++) for (let tx = 0; tx < CHUNK; tx++) {
      const x = cx * CHUNK + tx, y = cy * CHUNK + ty;
      if (x >= m.w || y >= m.h) continue;
      const v = m.tiles[y * m.w + x];
      let img: HTMLCanvasElement;
      if (v === T_FLOOR) {
        let hsh = (x * 374761393 + y * 668265263) | 0;
        hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177);
        const r = ((hsh ^ (hsh >>> 16)) >>> 0) % 100;
        img = this.ts.floor[r < 6 ? 2 : r < 30 ? 1 : 0];
      }
      else {
        const below = y + 1 < m.h ? m.tiles[(y + 1) * m.w + x] : 0;
        img = below === T_FLOOR ? (v === 3 ? this.ts.cracked : this.ts.wallFace) : this.ts.wallTop;
      }
      g.drawImage(img, tx * TILE, ty * TILE);
    }
    this.chunks.set(key, c);
    return c;
  }

  worldToScreen(x: number, y: number): [number, number] {
    return [(x - this.camX) * this.zoom + this.w / 2, (y - this.camY) * this.zoom + this.h / 2];
  }
  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx * this.dpr - this.w / 2) / this.zoom + this.camX, (sy * this.dpr - this.h / 2) / this.zoom + this.camY];
  }

  // ---------- efeitos ----------
  text(x: number, y: number, text: string, color: string, size = 1) {
    const t = this.texts.get();
    if (!t) return;
    t.x = x + (Math.random() - 0.5) * 8; t.y = y; t.vy = -28 - size * 8; t.life = 0; t.max = 0.9 + size * 0.15; t.text = text; t.color = color; t.size = size;
  }
  burst(x: number, y: number, color: string, n: number, speed = 60, size = 1.5, life = 0.6, grav = 0) {
    for (let i = 0; i < n; i++) {
      const p = this.parts.get();
      if (!p) return;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; p.life = 0; p.max = life * (0.6 + Math.random() * 0.6); p.color = color; p.size = size; p.grav = grav;
    }
  }
  effect(type: string, o: Partial<Fx> & { max: number }) {
    const f = this.fx.get();
    if (!f) return;
    f.type = type; f.x = o.x ?? 0; f.y = o.y ?? 0; f.x2 = o.x2 ?? 0; f.y2 = o.y2 ?? 0; f.r = o.r ?? 0; f.a = o.a ?? 0; f.len = o.len ?? 0;
    f.wid = o.wid ?? 0; f.life = 0; f.max = o.max; f.color = o.color ?? '#fff'; f.hostile = o.hostile ?? true; f.shape = o.shape ?? 0;
  }

  /** Converte um evento de efeito vindo do servidor. */
  serverFx(f: any[], selfEid: number) {
    switch (f[0]) {
      case 'd': {
        const crit = f[5] === 1, toPlayer = f[6] === 1;
        const color = toPlayer ? '#ff5a4a' : crit ? '#ffe04a' : elemColor(f[4]);
        this.text(f[1], f[2], String(f[3]), color, crit ? 1.6 : 1);
        if (!toPlayer) this.burst(f[1], f[2] + 4, elemColor(f[4]), crit ? 6 : 3, 40, 1);
        if (toPlayer && f[3] > 0) this.shake = Math.min(6, this.shake + 2);
        break;
      }
      case 'tg': this.effect('tg', { x: f[1], y: f[2], shape: f[3], r: f[4], a: f[5], len: f[6], wid: f[7], max: f[8] / 1000, hostile: f[9] === 1 }); break;
      case 'ex': this.effect('ring', { x: f[1], y: f[2], r: f[3], max: 0.35, color: elemColor(f[4]) }); this.burst(f[1], f[2], elemColor(f[4]), Math.min(24, 6 + f[3] / 3), f[3] * 2.2, 1.6, 0.5); break;
      case 'bm': this.effect('beam', { x: f[1], y: f[2], a: f[3], len: f[4], wid: f[5], max: 0.3, color: elemColor(f[6]) }); break;
      case 'sw': this.effect('swing', { x: f[1], y: f[2], a: f[3], wid: f[4], r: f[5], max: 0.14, color: f[6] === 9 ? '#ff6a5a' : elemColor(f[6]) }); break;
      case 'h': this.text(f[1], f[2] - 10, f[3] ? `+${f[3]}` : '♥', '#7aff8a', 1); this.burst(f[1], f[2], '#7aff8a', 10, 30, 1.5, 0.8, -40); break;
      case 'lv': this.effect('ring', { x: f[1], y: f[2], r: 40, max: 0.8, color: '#ffd23f' }); this.burst(f[1], f[2], '#ffd23f', 40, 80, 2, 1.2, -30); this.text(f[1], f[2] - 20, 'NÍVEL!', '#ffd23f', 2); break;
      case 'ch': this.effect('chain', { x: f[1], y: f[2], x2: f[3], y2: f[4], max: 0.2, color: '#fff35c' }); break;
      case 'da': this.effect('dash', { x: f[1], y: f[2], x2: f[3], y2: f[4], max: 0.25, color: elemColor(f[5]) }); break;
      case 'k': this.burst(f[1], f[2], '#3a3040', 10, 50, 2, 0.6); this.burst(f[1], f[2], '#8a7a9a', 6, 30, 1, 0.5); break;
      case 'tx': this.text(f[1], f[2], String(f[3]), '#cfe8ff', 1); break;
      case 'rr': {
        const ri = f[3] as number;
        const c = RANK_INFO[RANKS[ri]].color;
        this.effect('pillar', { x: f[1], y: f[2], max: 2.5, color: c === 'rainbow' ? '#ffffff' : c });
        this.burst(f[1], f[2], c === 'rainbow' ? '#ffd23f' : c, 40, 70, 2, 1.4, -20);
        break;
      }
    }
    void selfEid;
  }

  // ---------- quadro ----------
  draw(ents: Iterable<Ent>, selfId: number, dt: number, hoverId: number) {
    const g = this.ctx, z = this.zoom, m = this.map;
    this.time += dt;
    g.imageSmoothingEnabled = false;
    const biome = m?.world === 'town' ? TOWN_BIOME : BIOMES[m?.biome ?? 0];
    g.fillStyle = biome.fog;
    g.fillRect(0, 0, this.w, this.h);
    if (!m) return;
    let sx = 0, sy = 0;
    if (this.shake > 0) { sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 20); }
    const camX = Math.round((this.camX + sx) * z) / z, camY = Math.round((this.camY + sy) * z) / z;
    const halfW = this.w / 2 / z, halfH = this.h / 2 / z;
    const left = camX - halfW, top = camY - halfH;
    const ox = (-left) * z, oy = (-top) * z;

    // tiles: só os chunks visíveis (culling)
    const cs = CHUNK * TILE;
    const c0 = Math.max(0, Math.floor(left / cs)), c1 = Math.min(Math.ceil(m.w / CHUNK) - 1, Math.floor((left + halfW * 2) / cs));
    const r0 = Math.max(0, Math.floor(top / cs)), r1 = Math.min(Math.ceil(m.h / CHUNK) - 1, Math.floor((top + halfH * 2) / cs));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++)
      g.drawImage(this.chunk(cx, cy), Math.floor(ox + cx * cs * z), Math.floor(oy + cy * cs * z), cs * z, cs * z);

    const visible = (x: number, y: number, pad = 32) => x > left - pad && x < left + halfW * 2 + pad && y > top - pad && y < top + halfH * 2 + pad;
    const P = (x: number) => ox + x * z, Q = (y: number) => oy + y * z;

    // objetos do andar
    if (m.world === 'dungeon') {
      for (const o of m.objects) {
        const wx = o.x * TILE, wy = o.y * TILE;
        if (!visible(wx, wy)) continue;
        const key = o.k === 'trap' ? 'trap' : o.k === 'secretChest' ? (o.open ? 'secretChestOpen' : 'secretChest') : o.open ? 'chestOpen' : 'chest';
        g.drawImage(this.ts.objects[key], P(wx), Q(wy), TILE * z, TILE * z);
      }
      if (m.stairs) {
        const wx = m.stairs.x * TILE, wy = m.stairs.y * TILE;
        if (visible(wx, wy)) {
          g.drawImage(this.ts.objects[m.stairs.open ? 'stairs' : 'stairsClosed'], P(wx), Q(wy), TILE * z, TILE * z);
          if (m.stairs.open) { g.fillStyle = `rgba(255,220,140,${0.12 + Math.sin(this.time * 3) * 0.06})`; g.fillRect(P(wx), Q(wy), TILE * z, TILE * z); }
        }
      }
    } else {
      this.drawTown(g, P, Q, visible);
    }

    // telegrafias (embaixo das entidades)
    for (const f of this.fx.live) if (f.type === 'tg') this.drawTele(g, f, P, Q, z);

    // entidades ordenadas por y (profundidade)
    const list: Ent[] = [];
    for (const e of ents) if (visible(e.x, e.y)) list.push(e);
    list.sort((a, b) => (a.kind === K_LOOT ? -1 : 0) - (b.kind === K_LOOT ? -1 : 0) || a.y - b.y);
    for (const e of list) this.drawEnt(g, e, e.id === selfId, e.id === hoverId, P, Q, z);

    // efeitos por cima
    for (const f of this.fx.live) {
      f.life += dt;
      if (f.life >= f.max) { f.active = false; continue; }
      if (f.type !== 'tg') this.drawFx(g, f, P, Q, z);
    }
    this.fx.sweep();
    for (const p of this.parts.live) {
      p.life += dt;
      if (p.life >= p.max) { p.active = false; continue; }
      p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
      if (!visible(p.x, p.y, 8)) continue;
      g.globalAlpha = 1 - p.life / p.max;
      g.fillStyle = p.color;
      g.fillRect(P(p.x), Q(p.y), p.size * z, p.size * z);
    }
    g.globalAlpha = 1;
    this.parts.sweep();

    // iluminação: vinheta escura (dark fantasy)
    if (m.world === 'dungeon') {
      if (!this.vignette) this.vignette = this.makeVignette();
      g.drawImage(this.vignette, 0, 0);
    }

    // textos de dano
    g.textAlign = 'center';
    for (const t of this.texts.live) {
      t.life += dt;
      if (t.life >= t.max) { t.active = false; continue; }
      t.y += t.vy * dt; t.vy *= 0.92;
      const a = Math.min(1, (t.max - t.life) / 0.3);
      const size = Math.round((5 + t.size * 2.4) * z * (t.life < 0.08 ? 1.3 : 1));
      g.font = `bold ${size}px 'Courier New', monospace`;
      g.globalAlpha = a;
      g.fillStyle = '#000';
      g.fillText(t.text, P(t.x) + z * 0.6, Q(t.y) + z * 0.6);
      g.fillStyle = t.color;
      g.fillText(t.text, P(t.x), Q(t.y));
    }
    g.globalAlpha = 1;
    this.texts.sweep();
  }

  private makeVignette() {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const g = c.getContext('2d')!;
    const r = Math.max(this.w, this.h);
    const grad = g.createRadialGradient(this.w / 2, this.h / 2, r * 0.18, this.w / 2, this.h / 2, r * 0.62);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.82)');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.w, this.h);
    return c;
  }

  private drawTown(g: CanvasRenderingContext2D, P: (x: number) => number, Q: (y: number) => number, visible: (x: number, y: number) => boolean) {
    const z = this.zoom;
    for (const n of this.town.npcs) {
      const x = n.x * TILE, y = n.y * TILE;
      if (!visible(x, y)) continue;
      if (n.role === 'portal') {
        const t = this.time;
        for (let i = 0; i < 3; i++) {
          g.strokeStyle = `rgba(${180 + i * 30},80,255,${0.5 - i * 0.12})`;
          g.lineWidth = z * 2;
          g.beginPath(); g.ellipse(P(x), Q(y), (12 + i * 3 + Math.sin(t * 3 + i) * 2) * z, (16 + i * 3) * z, 0, 0, 7); g.stroke();
        }
        g.fillStyle = '#1a0a30cc';
        g.beginPath(); g.ellipse(P(x), Q(y), 11 * z, 15 * z, 0, 0, 7); g.fill();
        if (Math.random() < 0.3) this.burst(x + (Math.random() - 0.5) * 20, y + 10, '#b07cff', 1, 20, 1.2, 1, -30);
      } else if (n.role === 'board') {
        g.fillStyle = '#3a2a1a'; g.fillRect(P(x - 8), Q(y - 10), 16 * z, 12 * z);
        g.fillStyle = '#e8dcc2'; g.fillRect(P(x - 6), Q(y - 8), 12 * z, 8 * z);
        g.fillStyle = '#5a4a3a'; g.fillRect(P(x - 1), Q(y + 2), 2 * z, 8 * z);
      } else {
        const pal = n.role === 'smith' ? ['#6a4a3a', '#3a2a1a', '#c9a24a'] : n.role === 'alchemist' ? ['#3a7a4a', '#1a3a2a', '#c06cff'] : n.role === 'jeweler' ? ['#4a4a9a', '#2a2a5a', '#7fe3ff'] : ['#8a6a3a', '#4a3a1a', '#ffd23f'];
        g.drawImage(sprite('npc', pal), P(x - 7), Q(y - 12), 14 * z, 14 * z);
      }
      g.font = `${4 * z}px Georgia, serif`;
      g.textAlign = 'center';
      g.fillStyle = '#000';
      g.fillText(n.name, P(x) + z / 2, Q(y - 15) + z / 2);
      g.fillStyle = '#f0d48a';
      g.fillText(n.name, P(x), Q(y - 15));
    }
  }

  private drawTele(g: CanvasRenderingContext2D, f: Fx, P: (x: number) => number, Q: (y: number) => number, z: number) {
    const k = Math.min(1, f.life / f.max);
    const col = f.hostile ? '255,60,40' : '90,170,255';
    g.save();
    if (f.shape === 0) {
      g.fillStyle = `rgba(${col},0.12)`;
      g.strokeStyle = `rgba(${col},0.7)`;
      g.lineWidth = z;
      g.beginPath(); g.arc(P(f.x), Q(f.y), f.r * z, 0, 7); g.fill(); g.stroke();
      g.fillStyle = `rgba(${col},0.28)`;
      g.beginPath(); g.arc(P(f.x), Q(f.y), f.r * z * k, 0, 7); g.fill();
    } else {
      g.translate(P(f.x), Q(f.y)); g.rotate(f.a);
      g.fillStyle = `rgba(${col},0.14)`;
      g.fillRect(0, (-f.wid / 2) * z, f.len * z, f.wid * z);
      g.fillStyle = `rgba(${col},0.32)`;
      g.fillRect(0, (-f.wid / 2) * z, f.len * z * k, f.wid * z);
      g.strokeStyle = `rgba(${col},0.7)`; g.lineWidth = z;
      g.strokeRect(0, (-f.wid / 2) * z, f.len * z, f.wid * z);
    }
    g.restore();
  }

  private drawFx(g: CanvasRenderingContext2D, f: Fx, P: (x: number) => number, Q: (y: number) => number, z: number) {
    const k = f.life / f.max;
    g.save();
    g.globalAlpha = 1 - k;
    g.strokeStyle = f.color; g.fillStyle = f.color;
    switch (f.type) {
      case 'ring': g.lineWidth = z * 2 * (1 - k) + z; g.beginPath(); g.arc(P(f.x), Q(f.y), f.r * z * (0.4 + k * 0.6), 0, 7); g.stroke(); break;
      case 'swing': {
        g.globalAlpha = 0.55 * (1 - k);
        g.beginPath(); g.moveTo(P(f.x), Q(f.y)); g.arc(P(f.x), Q(f.y), f.r * z, f.a - f.wid / 2, f.a + f.wid / 2); g.closePath(); g.fill();
        break;
      }
      case 'beam': g.translate(P(f.x), Q(f.y)); g.rotate(f.a); g.fillRect(0, (-f.wid / 2) * z, f.len * z, f.wid * z); break;
      case 'chain': case 'dash': {
        g.lineWidth = z * (f.type === 'chain' ? 1.5 : 4);
        g.beginPath(); g.moveTo(P(f.x), Q(f.y));
        if (f.type === 'chain') {
          const n = 5;
          for (let i = 1; i < n; i++) g.lineTo(P(f.x + ((f.x2 - f.x) * i) / n + (Math.random() - 0.5) * 8), Q(f.y + ((f.y2 - f.y) * i) / n + (Math.random() - 0.5) * 8));
        }
        g.lineTo(P(f.x2), Q(f.y2)); g.stroke();
        break;
      }
      case 'pillar': {
        g.globalAlpha = 0.5 * (1 - k);
        const grad = g.createLinearGradient(0, Q(f.y - 80), 0, Q(f.y));
        grad.addColorStop(0, 'transparent'); grad.addColorStop(1, f.color);
        g.fillStyle = grad;
        g.fillRect(P(f.x - 4), Q(f.y - 80), 8 * z, 80 * z);
        break;
      }
    }
    g.restore();
  }

  private drawEnt(g: CanvasRenderingContext2D, e: Ent, self: boolean, hover: boolean, P: (x: number) => number, Q: (y: number) => number, z: number) {
    const t = this.time;
    const dead = (e.flags & F_DEAD) !== 0;
    switch (e.kind) {
      case K_PLAYER: case K_MINION: {
        const isMinion = e.kind === K_MINION;
        const cls = CLASS_BY_ID[e.meta.c];
        const pal = isMinion ? ['#d8d0bc', '#5a4a6e', '#7ad84a'] : cls?.palette ?? ['#888', '#444', '#fff'];
        const img = sprite(isMinion ? 'skeleton' : 'hero', pal);
        const size = isMinion ? 11 : 14;
        const bob = Math.sin(e.bob) * (isMinion ? 0.5 : 0.8);
        // sombra
        g.fillStyle = '#0006';
        g.beginPath(); g.ellipse(P(e.x), Q(e.y + 5), 5 * z, 2 * z, 0, 0, 7); g.fill();
        // aura cosmética
        const cos = e.meta.cos as string | undefined;
        if (cos && !dead) {
          const col = cos === 'aura_fire' ? '#ff7a2e' : cos === 'aura_void' ? '#b07cff' : cos === 'aura_gold' ? '#ffd23f' : `hsl(${(t * 120) % 360},90%,60%)`;
          if (Math.random() < 0.4) this.burst(e.x + (Math.random() - 0.5) * 10, e.y + 4, col, 1, 12, 1, 0.9, -25);
        }
        g.save();
        if (dead) g.globalAlpha = 0.35;
        if (e.flags & F_STEALTH) g.globalAlpha = self ? 0.45 : 0.15;
        g.translate(P(e.x), Q(e.y - 4 + bob));
        if (e.face < 0) g.scale(-1, 1);
        g.drawImage(img, (-size / 2) * z, (-size / 2) * z, size * z, size * z);
        g.restore();
        if (e.flags & F_BUFF) { g.strokeStyle = '#ffd23f80'; g.lineWidth = z; g.beginPath(); g.ellipse(P(e.x), Q(e.y + 5), 7 * z, 3 * z, 0, 0, 7); g.stroke(); }
        if (!isMinion) {
          g.font = `${4 * z}px Georgia, serif`;
          g.textAlign = 'center';
          g.fillStyle = '#000'; g.fillText(e.meta.n ?? '', P(e.x) + z / 2, Q(e.y - 14) + z / 2);
          g.fillStyle = self ? '#f0d48a' : '#cfe8ff'; g.fillText(e.meta.n ?? '', P(e.x), Q(e.y - 14));
          if (!self && e.hp < 100) this.hpBar(g, P(e.x), Q(e.y - 12), 12 * z, e.hp, '#5fbf6a', z);
        }
        break;
      }
      case K_MONSTER: case K_BOSS: {
        const def = MONSTER_DEF[e.meta.d] ?? { shape: 'slime', palette: ['#888', '#444', '#fff'] };
        const r = e.meta.r ?? 6;
        const size = r * 2.6;
        const elite = (e.flags & F_ELITE) !== 0;
        const img = sprite(def.shape, def.palette);
        g.fillStyle = '#0007';
        g.beginPath(); g.ellipse(P(e.x), Q(e.y + r * 0.7), r * 0.9 * z, r * 0.35 * z, 0, 0, 7); g.fill();
        if (e.kind === K_BOSS || elite) {
          g.fillStyle = e.kind === K_BOSS ? 'rgba(255,60,40,0.18)' : 'rgba(255,210,63,0.16)';
          g.beginPath(); g.arc(P(e.x), Q(e.y), (r + 4 + Math.sin(t * 4) * 1.5) * z, 0, 7); g.fill();
        }
        g.save();
        const wob = e.flags & F_WINDUP ? (Math.random() - 0.5) * 1.5 : 0;
        g.translate(P(e.x + wob), Q(e.y - r * 0.3 + Math.sin(e.bob) * 0.6));
        if (e.face < 0) g.scale(-1, 1);
        g.drawImage(img, (-size / 2) * z, (-size / 2) * z, size * z, size * z);
        if (e.flash > 0) { g.globalAlpha = Math.min(1, e.flash * 6); g.globalCompositeOperation = 'lighter'; g.drawImage(img, (-size / 2) * z, (-size / 2) * z, size * z, size * z); }
        g.restore();
        if (e.flags & F_POISON && Math.random() < 0.2) this.burst(e.x, e.y - r, '#7ad84a', 1, 10, 1, 0.6, -20);
        if (e.flags & F_SLOW) { g.fillStyle = '#7fd8ff40'; g.beginPath(); g.arc(P(e.x), Q(e.y), r * z, 0, 7); g.fill(); }
        if (e.flags & F_STUN) { g.fillStyle = '#ffe04a'; for (let i = 0; i < 3; i++) { const a = t * 5 + (i * Math.PI * 2) / 3; g.fillRect(P(e.x + Math.cos(a) * 5), Q(e.y - r - 4 + Math.sin(a) * 2), z, z); } }
        if (e.kind !== K_BOSS && (e.hp < 100 || hover)) this.hpBar(g, P(e.x), Q(e.y - r - 3), r * 2 * z, e.hp, elite ? '#ffd23f' : '#d84a3a', z);
        if (hover || elite) {
          const mods = (e.meta.m ?? []) as string[];
          const label = mods.length ? `${mods.map((x) => MOD_PT[x] ?? x).join(' ')} ${e.meta.n}` : e.meta.n;
          g.font = `${3.6 * z}px Georgia, serif`; g.textAlign = 'center';
          g.fillStyle = '#000'; g.fillText(label, P(e.x) + z / 2, Q(e.y - r - 6) + z / 2);
          g.fillStyle = elite ? '#ffd23f' : '#e8dcc2'; g.fillText(label, P(e.x), Q(e.y - r - 6));
        }
        break;
      }
      case K_PROJ: {
        const col = e.meta.h ? '#ff6a5a' : elemColor(e.meta.e ?? 0);
        if (e.meta.s === 'arrow') {
          g.save(); g.translate(P(e.x), Q(e.y)); g.rotate(e.meta.a ?? 0);
          g.fillStyle = '#d8c8a8'; g.fillRect(-5 * z, -0.5 * z, 8 * z, z);
          g.fillStyle = col; g.fillRect(3 * z, -1 * z, 2 * z, 2 * z);
          g.restore();
        } else {
          g.fillStyle = col;
          g.globalAlpha = 0.35; g.beginPath(); g.arc(P(e.x), Q(e.y), 4.5 * z, 0, 7); g.fill();
          g.globalAlpha = 1; g.beginPath(); g.arc(P(e.x), Q(e.y), 2.2 * z, 0, 7); g.fill();
          if (Math.random() < 0.5) this.burst(e.x, e.y, col, 1, 8, 1, 0.3);
        }
        break;
      }
      case K_LOOT: {
        const bob = Math.sin(t * 3 + e.id) * 1.5;
        if (e.meta.trap) { g.strokeStyle = '#ff9a2e'; g.lineWidth = z; g.strokeRect(P(e.x - 4), Q(e.y - 4), 8 * z, 8 * z); break; }
        if (e.meta.g) { g.fillStyle = '#ffd23f'; g.fillRect(P(e.x - 2), Q(e.y - 2 + bob), 4 * z, 4 * z); g.fillStyle = '#a87a1a'; g.fillRect(P(e.x - 1), Q(e.y - 1 + bob), 2 * z, 2 * z); break; }
        if (e.meta.gem) { g.fillStyle = '#7fe3ff'; g.beginPath(); g.moveTo(P(e.x), Q(e.y - 4 + bob)); g.lineTo(P(e.x + 3), Q(e.y + bob)); g.lineTo(P(e.x), Q(e.y + 4 + bob)); g.lineTo(P(e.x - 3), Q(e.y + bob)); g.fill(); break; }
        const rank = RANKS[e.meta.r ?? 0];
        const c = RANK_INFO[rank].color;
        const col = c === 'rainbow' ? `hsl(${(t * 180) % 360},90%,60%)` : c;
        g.fillStyle = col;
        g.globalAlpha = 0.3; g.beginPath(); g.arc(P(e.x), Q(e.y + bob), 6 * z, 0, 7); g.fill();
        g.globalAlpha = 1; g.fillRect(P(e.x - 2.5), Q(e.y - 2.5 + bob), 5 * z, 5 * z);
        if ((e.meta.r ?? 0) >= 5 && Math.random() < 0.3) this.burst(e.x, e.y, col, 1, 15, 1, 0.8, -25);
        if (hover || (e.meta.r ?? 0) >= 4) {
          g.font = `${3.4 * z}px Georgia, serif`; g.textAlign = 'center';
          g.fillStyle = '#000'; g.fillText(e.meta.n, P(e.x) + z / 2, Q(e.y - 7) + z / 2);
          g.fillStyle = col; g.fillText(e.meta.n, P(e.x), Q(e.y - 7));
        }
        break;
      }
    }
  }

  private hpBar(g: CanvasRenderingContext2D, x: number, y: number, w: number, pct: number, color: string, z: number) {
    g.fillStyle = '#000a'; g.fillRect(x - w / 2 - z / 2, y - z / 2, w + z, 2 * z);
    g.fillStyle = color; g.fillRect(x - w / 2, y, (w * pct) / 100, z);
  }

  /** Minimapa: tiles explorados + jogadores. */
  drawMinimap(ents: Iterable<Ent>, selfId: number, partyIds: Set<number>) {
    const m = this.map;
    if (!m) return;
    const c = this.minimap, g = c.getContext('2d')!;
    const scale = Math.max(1, Math.floor(Math.min(c.width / m.w, c.height / m.h)));
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    const ox = (c.width - m.w * scale) / 2, oy = (c.height - m.h * scale) / 2;
    const fl = m.world === 'town' ? '#5a5040' : BIOMES[m.biome].floor2;
    g.fillStyle = fl;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x;
      if (m.tiles[i] === T_FLOOR && (m.world === 'town' || m.explored[i])) g.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
    if (m.stairs && m.explored[m.stairs.y * m.w + m.stairs.x]) { g.fillStyle = m.stairs.open ? '#ffd23f' : '#a83232'; g.fillRect(ox + m.stairs.x * scale - 1, oy + m.stairs.y * scale - 1, scale + 2, scale + 2); }
    for (const e of ents) {
      if (e.kind !== K_PLAYER && e.kind !== K_BOSS) continue;
      g.fillStyle = e.id === selfId ? '#fff' : e.kind === K_BOSS ? '#ff3b3b' : partyIds.has(e.id) ? '#5fbf6a' : '#7fb0ff';
      g.fillRect(ox + (e.x / TILE) * scale - 1.5, oy + (e.y / TILE) * scale - 1.5, 3, 3);
    }
  }
}

export const MOD_PT: Record<string, string> = { elite: 'Elite', fast: 'Veloz', poison: 'Venenoso', armored: 'Blindado', vampiric: 'Vampírico', explosive: 'Explosivo' };
