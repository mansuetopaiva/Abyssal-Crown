import { biomeIndexForFloor, floorScaling, isBossFloor } from './constants';
import { mulberry32, randInt, weightedPick, type Rng } from './rng';

export const T_WALL = 0;
export const T_FLOOR = 1;
export const T_SECRET = 2; // sólido até ser revelado; o cliente recebe como parede

export interface Room { x: number; y: number; w: number; h: number; secret?: boolean }
export interface Pt { x: number; y: number }
export interface FloorObj extends Pt { kind: 'chest' | 'secretChest' | 'trap' | 'shrine' }
export interface FloorMap {
  w: number; h: number; tiles: Uint8Array; rooms: Room[]; start: Pt; stairs: Pt;
  objects: FloorObj[]; spawns: (Pt & { elite?: boolean })[]; boss?: Pt; floor: number; biome: number;
  layout: Layout;
}
export type Layout = 'rooms' | 'caves' | 'halls' | 'maze' | 'arena';
export const LAYOUT_LABEL: Record<Layout, string> = { rooms: 'Salas e corredores', caves: 'Cavernas', halls: 'Salões de pilares', maze: 'Labirinto', arena: 'Arena' };

const center = (r: Room): Pt => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });
const inRoom = (r: Room, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

function carveRoom(t: Uint8Array, w: number, r: Room) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) t[y * w + x] = T_FLOOR;
}

/** Corredor em L entre dois pontos. Retorna os tiles do caminho (na ordem a → b). */
function corridor(t: Uint8Array, w: number, a: Pt, b: Pt, rng: Rng, wide: boolean): Pt[] {
  const path: Pt[] = [];
  const horizFirst = rng() < 0.5;
  let { x, y } = a;
  const stepX = () => { while (x !== b.x) { x += Math.sign(b.x - x); path.push({ x, y }); } };
  const stepY = () => { while (y !== b.y) { y += Math.sign(b.y - y); path.push({ x, y }); } };
  if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  for (const p of path) {
    t[p.y * w + p.x] = T_FLOOR;
    if (wide) t[(p.y + 1) * w + p.x] = T_FLOOR;
  }
  return path;
}

export function reachable(m: Pick<FloorMap, 'w' | 'h' | 'tiles'>, from: Pt, throughSecret: boolean): Set<number> {
  const seen = new Set<number>([from.y * m.w + from.x]);
  const q = [from.y * m.w + from.x];
  while (q.length) {
    const i = q.pop()!;
    const x = i % m.w, y = (i / m.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      const tile = m.tiles[j];
      if (seen.has(j) || !(tile === T_FLOOR || (throughSecret && tile === T_SECRET))) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return seen;
}

function bfsFarthestRoom(m: FloorMap, from: Pt, candidates: Room[]): Room {
  const dist = new Int32Array(m.w * m.h).fill(-1);
  const q = [from.y * m.w + from.x];
  dist[q[0]] = 0;
  for (let head = 0; head < q.length; head++) {
    const i = q[head], x = i % m.w, y = (i / m.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (y + dy) * m.w + (x + dx);
      if (dist[j] === -1 && m.tiles[j] === T_FLOOR) { dist[j] = dist[i] + 1; q.push(j); }
    }
  }
  let best = candidates[0], bd = -1;
  for (const r of candidates) {
    const c = center(r);
    const d = dist[c.y * m.w + c.x];
    if (d > bd) { bd = d; best = r; }
  }
  return best;
}

export function generateFloor(seed: number, floor: number): FloorMap {
  const rng = mulberry32(seed);
  return isBossFloor(floor) ? bossFloor(rng, floor) : normalFloor(rng, floor);
}

/** Escolhe o tipo de andar; cada bioma tem suas preferências. */
const LAYOUT_WEIGHTS: Record<number, [Layout, number][]> = {
  0: [['rooms', 4], ['maze', 2], ['halls', 2], ['caves', 1], ['arena', 1]], // Catacumbas
  1: [['caves', 4], ['rooms', 2], ['halls', 1], ['arena', 1], ['maze', 1]], // Cavernas de Cristal
  2: [['caves', 4], ['rooms', 2], ['maze', 1], ['arena', 1], ['halls', 1]], // Floresta Fúngica
  3: [['halls', 3], ['rooms', 3], ['arena', 2], ['caves', 2], ['maze', 1]], // Fortaleza de Lava
  4: [['maze', 3], ['halls', 2], ['arena', 2], ['rooms', 2], ['caves', 2]], // Vazio Abissal
};

function connectRooms(tiles: Uint8Array, w: number, rooms: Room[], rng: Rng, wide: number, loops: number) {
  for (let i = 1; i < rooms.length; i++) {
    const c = center(rooms[i]);
    let best = 0, bd = Infinity;
    for (let j = 0; j < i; j++) {
      const d = Math.abs(center(rooms[j]).x - c.x) + Math.abs(center(rooms[j]).y - c.y);
      if (d < bd) { bd = d; best = j; }
    }
    corridor(tiles, w, c, center(rooms[best]), rng, rng() < wide);
  }
  for (let k = 0; k < loops; k++) {
    const a = rooms[randInt(rng, 0, rooms.length - 1)], b = rooms[randInt(rng, 0, rooms.length - 1)];
    if (a !== b) corridor(tiles, w, center(a), center(b), rng, false);
  }
}

function placeRooms(rng: Rng, w: number, h: number, target: number, wr: [number, number], hr: [number, number], gap = 2, tries = 800): Room[] {
  const rooms: Room[] = [];
  const overlaps = (r: Room) => rooms.some((o) => r.x - gap < o.x + o.w && r.x + r.w + gap > o.x && r.y - gap < o.y + o.h && r.y + r.h + gap > o.y);
  for (let t = 0; t < tries && rooms.length < target; t++) {
    const r: Room = { w: randInt(rng, wr[0], wr[1]), h: randInt(rng, hr[0], hr[1]), x: 0, y: 0 };
    r.x = randInt(rng, 2, w - r.w - 3);
    r.y = randInt(rng, 2, h - r.h - 3);
    if (!overlaps(r)) rooms.push(r);
  }
  return rooms;
}

// ----- salas e corredores (clássico) -----
function layoutRooms(rng: Rng, size: number, floor: number) {
  const tiles = new Uint8Array(size * size);
  const rooms = placeRooms(rng, size, size, Math.min(28, 13 + Math.floor(floor / 6)), [6, 13], [5, 11]);
  for (const r of rooms) carveRoom(tiles, size, r);
  connectRooms(tiles, size, rooms, rng, 0.3, 2);
  return { tiles, rooms };
}

// ----- salões enormes com pilares -----
function layoutHalls(rng: Rng, size: number) {
  const tiles = new Uint8Array(size * size);
  const halls = placeRooms(rng, size, size, randInt(rng, 4, 7), [13, 22], [11, 17], 4);
  const small = placeRooms(rng, size, size, 6, [5, 8], [5, 7], 2).filter((r) => !halls.some((o) => r.x - 2 < o.x + o.w && r.x + r.w + 2 > o.x && r.y - 2 < o.y + o.h && r.y + r.h + 2 > o.y));
  const rooms = [...halls, ...small];
  for (const r of rooms) carveRoom(tiles, size, r);
  connectRooms(tiles, size, rooms, rng, 0.8, 3);
  // grade de pilares dentro dos salões (tiles sólidos isolados)
  for (const r of halls) for (let y = r.y + 3; y < r.y + r.h - 3; y += 4) for (let x = r.x + 3; x < r.x + r.w - 3; x += 4) {
    if (Math.abs(x - center(r).x) <= 1 && Math.abs(y - center(r).y) <= 1) continue;
    tiles[y * size + x] = T_WALL;
  }
  return { tiles, rooms };
}

// ----- cavernas orgânicas (autômato celular) -----
function layoutCaves(rng: Rng, size: number) {
  const w = size, h = size;
  let t = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const border = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
    t[y * w + x] = border ? T_WALL : rng() < 0.55 ? T_FLOOR : T_WALL;
  }
  for (let it = 0; it < 6; it++) {
    const n = new Uint8Array(w * h);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      let walls = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (t[(y + dy) * w + x + dx] !== T_FLOOR) walls++;
      n[y * w + x] = walls >= 5 ? T_WALL : T_FLOOR;
    }
    t = n;
  }
  // mantém só a maior região conectada
  const region = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0;
  for (let i = 0, id = 0; i < w * h; i++) {
    if (t[i] !== T_FLOOR || region[i] >= 0) continue;
    const q = [i]; region[i] = id; let n = 0;
    while (q.length) {
      const j = q.pop()!; n++;
      for (const k of [j + 1, j - 1, j + w, j - w]) if (t[k] === T_FLOOR && region[k] < 0) { region[k] = id; q.push(k); }
    }
    if (n > bestSize) { bestSize = n; best = id; }
    id++;
  }
  for (let i = 0; i < w * h; i++) if (t[i] === T_FLOOR && region[i] !== best) t[i] = T_WALL;
  // "salas" virtuais: pontos abertos espalhados (para escada, baús e monstros)
  const rooms: Room[] = [];
  const open = (x: number, y: number) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (t[(y + dy) * w + x + dx] !== T_FLOOR) return false; return true; };
  for (let tries = 0; tries < 4000 && rooms.length < 26; tries++) {
    const x = randInt(rng, 3, w - 4), y = randInt(rng, 3, h - 4);
    if (!open(x, y) || rooms.some((r) => Math.abs(center(r).x - x) < 9 && Math.abs(center(r).y - y) < 9)) continue;
    rooms.push({ x: x - 2, y: y - 2, w: 5, h: 5 });
  }
  return { tiles: t, rooms };
}

// ----- labirinto com algumas salas -----
function layoutMaze(rng: Rng, size: number, floor: number) {
  const w = size, h = size;
  const tiles = new Uint8Array(w * h);
  const C = 4; // cada célula: corredor 2×2 + parede 2
  const cw = Math.floor((w - 4) / C), ch = Math.floor((h - 4) / C);
  const seen = new Uint8Array(cw * ch);
  const carveCell = (cx: number, cy: number) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) tiles[(2 + cy * C + y) * w + 2 + cx * C + x] = T_FLOOR; };
  const carveBetween = (ax: number, ay: number, bx: number, by: number) => {
    const x0 = 2 + Math.min(ax, bx) * C, y0 = 2 + Math.min(ay, by) * C;
    const x1 = 2 + Math.max(ax, bx) * C + 1, y1 = 2 + Math.max(ay, by) * C + 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y * w + x] = T_FLOOR;
  };
  const stack = [[0, 0]];
  seen[0] = 1; carveCell(0, 0);
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [cx + dx, cy + dy]).filter(([x, y]) => x >= 0 && y >= 0 && x < cw && y < ch && !seen[y * cw + x]);
    if (!nb.length) { stack.pop(); continue; }
    const [nx, ny] = nb[(rng() * nb.length) | 0];
    seen[ny * cw + nx] = 1; carveCell(nx, ny); carveBetween(cx, cy, nx, ny);
    stack.push([nx, ny]);
  }
  // laços extras para não ser um labirinto perfeito (menos becos sem saída)
  for (let i = 0; i < cw * ch * 0.12; i++) {
    const cx = randInt(rng, 0, cw - 2), cy = randInt(rng, 0, ch - 2);
    if (rng() < 0.5) carveBetween(cx, cy, cx + 1, cy); else carveBetween(cx, cy, cx, cy + 1);
  }
  const rooms = placeRooms(rng, w, h, Math.min(12, 6 + Math.floor(floor / 15)), [6, 10], [6, 9], 3);
  for (const r of rooms) carveRoom(tiles, w, r);
  return { tiles, rooms };
}

// ----- arena circular central com câmaras ao redor -----
function layoutArena(rng: Rng, size: number) {
  const w = size, h = size;
  const tiles = new Uint8Array(w * h);
  const cx = w >> 1, cy = h >> 1, R = Math.floor(size * 0.22);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < R && !(d > R * 0.35 && d < R * 0.45 && ((Math.atan2(y - cy, x - cx) * 6 / Math.PI) | 0) % 2 === 0)) tiles[y * w + x] = T_FLOOR;
  }
  const arena: Room = { x: cx - 3, y: cy - 3, w: 7, h: 7 };
  const rooms = [...placeRooms(rng, w, h, 14, [6, 11], [5, 9], 3).filter((r) => Math.hypot(center(r).x - cx, center(r).y - cy) > R + 6), arena];
  for (const r of rooms) carveRoom(tiles, w, r);
  rooms.sort((a, b) => Math.hypot(center(b).x - cx, center(b).y - cy) - Math.hypot(center(a).x - cx, center(a).y - cy));
  for (const r of rooms) if (r !== arena) corridor(tiles, w, center(r), { x: cx, y: cy }, rng, rng() < 0.5);
  return { tiles, rooms };
}

function normalFloor(rng: Rng, floor: number): FloorMap {
  const size = Math.min(120, 66 + Math.floor(floor / 5) * 2);
  const w = size, h = size;
  const biome = biomeIndexForFloor(floor);
  const weights = LAYOUT_WEIGHTS[biome];
  const layout = floor <= 2 ? 'rooms' : weightedPick(rng, weights.map((x) => x[0]), weights.map((x) => x[1]));
  const base = layout === 'caves' ? layoutCaves(rng, size) : layout === 'halls' ? layoutHalls(rng, size) : layout === 'maze' ? layoutMaze(rng, size, floor) : layout === 'arena' ? layoutArena(rng, size) : layoutRooms(rng, size, floor);
  const { tiles, rooms } = base;

  const m: FloorMap = { w, h, tiles, rooms, start: center(rooms[0]), stairs: center(rooms[0]), objects: [], spawns: [], floor, biome, layout };
  m.stairs = center(bfsFarthestRoom(m, m.start, rooms.slice(1)));

  // sala secreta (≈35%): conectada apenas por uma parede secreta
  if (rng() < 0.35) tryAddSecretRoom(m, rng);

  const free = (x: number, y: number) =>
    tiles[y * w + x] === T_FLOOR && !(x === m.stairs.x && y === m.stairs.y) && !inRoom(rooms[0], x, y) && !m.objects.some((o) => o.x === x && o.y === y);
  const randomIn = (r: Room): Pt => ({ x: randInt(rng, r.x + 1, r.x + r.w - 2), y: randInt(rng, r.y + 1, r.y + r.h - 2) });
  const stairsRoom = rooms.find((r) => inRoom(r, m.stairs.x, m.stairs.y));
  const normalRooms = rooms.slice(1).filter((r) => !r.secret);
  const special = normalRooms.filter((r) => r !== stairsRoom && r.w >= 5 && r.h >= 5);

  // salas especiais: tesouro, covil de elites e santuário
  const take = () => special.splice((rng() * special.length) | 0, 1)[0];
  if (special.length && rng() < 0.4) { // cofre: 3 baús juntos
    const r = take();
    for (let i = 0; i < 3; i++) { const p = randomIn(r); if (free(p.x, p.y)) m.objects.push({ ...p, kind: 'chest' }); }
  }
  const den = special.length && rng() < 0.45 ? take() : null; // covil: monstros de elite extras
  if (special.length && rng() < 0.5) { const r = take(); const c = center(r); if (free(c.x, c.y)) m.objects.push({ ...c, kind: 'shrine' }); }

  const chests = randInt(rng, 3, 6);
  for (let i = 0; i < chests && normalRooms.length; i++) {
    const p = randomIn(normalRooms[randInt(rng, 0, normalRooms.length - 1)]);
    if (free(p.x, p.y)) m.objects.push({ ...p, kind: 'chest' });
  }
  const traps = Math.min(18, 4 + Math.floor(floor / 4)) + (layout === 'maze' ? 6 : 0);
  for (let i = 0, tries = 0; i < traps && tries < 300; tries++) {
    const x = randInt(rng, 1, w - 2), y = randInt(rng, 1, h - 2);
    if (free(x, y)) { m.objects.push({ x, y, kind: 'trap' }); i++; }
  }
  const { count } = floorScaling(floor);
  for (let i = 0, tries = 0; i < count && tries < 1500 && normalRooms.length; tries++) {
    const p = randomIn(normalRooms[randInt(rng, 0, normalRooms.length - 1)]);
    if (free(p.x, p.y)) { m.spawns.push(p); i++; }
  }
  if (den) for (let i = 0, tries = 0; i < 4 && tries < 60; tries++) {
    const p = randomIn(den);
    if (free(p.x, p.y)) { m.spawns.push({ ...p, elite: i < 2 }); i++; }
  }
  return m;
}

function tryAddSecretRoom(m: FloorMap, rng: Rng) {
  const { w, h, tiles, rooms } = m;
  for (let tries = 0; tries < 60; tries++) {
    const r: Room = { w: randInt(rng, 4, 6), h: randInt(rng, 4, 6), x: 0, y: 0, secret: true };
    r.x = randInt(rng, 2, w - r.w - 3);
    r.y = randInt(rng, 2, h - r.h - 3);
    // precisa estar cercada de parede (margem 2)
    let clear = true;
    for (let y = r.y - 2; y < r.y + r.h + 2 && clear; y++)
      for (let x = r.x - 2; x < r.x + r.w + 2; x++) if (tiles[y * w + x] !== 0) { clear = false; break; }
    if (!clear) continue;
    // corredor reto até um tile de chão próximo (horizontal ou vertical)
    const c = center(r);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => rng() - 0.5)) {
      let x = dx > 0 ? r.x + r.w : dx < 0 ? r.x - 1 : c.x;
      let y = dy > 0 ? r.y + r.h : dy < 0 ? r.y - 1 : c.y;
      const path: Pt[] = [];
      while (x > 0 && y > 0 && x < w - 1 && y < h - 1 && tiles[y * w + x] === T_WALL && path.length < 14) {
        path.push({ x, y });
        x += dx; y += dy;
      }
      if (!path.length || tiles[y * w + x] !== T_FLOOR || path.length >= 14) continue;
      // o corredor não pode encostar em outro chão lateralmente (vazaria)
      const leaks = path.some((p) => (dx ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]).some(([ox, oy]) => tiles[(p.y + oy) * w + p.x + ox] !== T_WALL));
      if (leaks) continue;
      carveRoom(tiles, w, r);
      for (const p of path) tiles[p.y * w + p.x] = T_FLOOR;
      const door = path[path.length - 1]; // tile vizinho ao chão existente
      tiles[door.y * w + door.x] = T_SECRET;
      rooms.push(r);
      m.objects.push({ ...c, kind: 'secretChest' });
      return;
    }
  }
}

function bossFloor(rng: Rng, floor: number): FloorMap {
  const w = 60, h = 34;
  const tiles = new Uint8Array(w * h);
  const startRoom: Room = { x: 3, y: 13, w: 8, h: 8 };
  const arena: Room = { x: 26, y: 5, w: 28, h: 24 };
  carveRoom(tiles, w, startRoom);
  carveRoom(tiles, w, arena);
  corridor(tiles, w, center(startRoom), center(arena), rng, true);
  // pilares na arena
  for (const [px, py] of [[33, 10], [46, 10], [33, 23], [46, 23]]) tiles[py * w + px] = T_WALL;
  const c = center(arena);
  return {
    w, h, tiles, rooms: [startRoom, arena], start: center(startRoom), stairs: { x: c.x, y: c.y + 6 },
    objects: [], spawns: [], boss: c, floor, biome: biomeIndexForFloor(floor), layout: 'arena',
  };
}

// ---------- Codificação compacta (RLE + base64) ----------
export function encodeTiles(t: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < t.length; ) {
    const v = t[i];
    let n = 1;
    while (i + n < t.length && t[i + n] === v && n < 255) n++;
    out.push(v, n);
    i += n;
  }
  let s = '';
  for (const b of out) s += String.fromCharCode(b);
  return btoa(s);
}

export function decodeTiles(enc: string, size: number): Uint8Array {
  const s = atob(enc);
  const t = new Uint8Array(size);
  let p = 0;
  for (let i = 0; i < s.length; i += 2) {
    const v = s.charCodeAt(i), n = s.charCodeAt(i + 1);
    t.fill(v, p, p + n);
    p += n;
  }
  return t;
}

/** Versão para o cliente: tiles secretos viram parede. */
export function publicTiles(t: Uint8Array): Uint8Array {
  return t.map((v) => (v === T_SECRET ? T_WALL : v));
}
