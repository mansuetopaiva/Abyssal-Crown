import { biomeIndexForFloor, floorScaling, isBossFloor } from './constants';
import { mulberry32, randInt, type Rng } from './rng';

export const T_WALL = 0;
export const T_FLOOR = 1;
export const T_SECRET = 2; // sólido até ser revelado; o cliente recebe como parede

export interface Room { x: number; y: number; w: number; h: number; secret?: boolean }
export interface Pt { x: number; y: number }
export interface FloorObj extends Pt { kind: 'chest' | 'secretChest' | 'trap' }
export interface FloorMap {
  w: number; h: number; tiles: Uint8Array; rooms: Room[]; start: Pt; stairs: Pt;
  objects: FloorObj[]; spawns: Pt[]; boss?: Pt; floor: number; biome: number;
}

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

function normalFloor(rng: Rng, floor: number): FloorMap {
  const size = Math.min(96, 48 + Math.floor(floor / 5) * 2);
  const w = size, h = size;
  const tiles = new Uint8Array(w * h);
  const rooms: Room[] = [];
  const target = Math.min(18, 8 + Math.floor(floor / 8));
  const overlaps = (r: Room) => rooms.some((o) => r.x - 2 < o.x + o.w && r.x + r.w + 2 > o.x && r.y - 2 < o.y + o.h && r.y + r.h + 2 > o.y);
  for (let tries = 0; tries < 400 && rooms.length < target; tries++) {
    const r: Room = { w: randInt(rng, 5, 11), h: randInt(rng, 5, 9), x: 0, y: 0 };
    r.x = randInt(rng, 2, w - r.w - 3);
    r.y = randInt(rng, 2, h - r.h - 3);
    if (!overlaps(r)) rooms.push(r);
  }
  for (const r of rooms) carveRoom(tiles, w, r);
  // conecta cada sala à sala mais próxima já conectada (árvore geradora gulosa)
  for (let i = 1; i < rooms.length; i++) {
    const c = center(rooms[i]);
    let best = 0, bd = Infinity;
    for (let j = 0; j < i; j++) {
      const d = Math.abs(center(rooms[j]).x - c.x) + Math.abs(center(rooms[j]).y - c.y);
      if (d < bd) { bd = d; best = j; }
    }
    corridor(tiles, w, c, center(rooms[best]), rng, rng() < 0.3);
  }
  // alguns laços extras para não ser só uma árvore
  for (let k = 0; k < 2; k++) {
    const a = rooms[randInt(rng, 0, rooms.length - 1)], b = rooms[randInt(rng, 0, rooms.length - 1)];
    if (a !== b) corridor(tiles, w, center(a), center(b), rng, false);
  }

  const m: FloorMap = { w, h, tiles, rooms, start: center(rooms[0]), stairs: center(rooms[0]), objects: [], spawns: [], floor, biome: biomeIndexForFloor(floor) };
  m.stairs = center(bfsFarthestRoom(m, m.start, rooms.slice(1)));

  // sala secreta (≈35%): conectada apenas por uma parede secreta
  if (rng() < 0.35) tryAddSecretRoom(m, rng);

  const free = (x: number, y: number) =>
    tiles[y * w + x] === T_FLOOR && !(x === m.stairs.x && y === m.stairs.y) && !inRoom(rooms[0], x, y) && !m.objects.some((o) => o.x === x && o.y === y);
  const randomIn = (r: Room): Pt => ({ x: randInt(rng, r.x + 1, r.x + r.w - 2), y: randInt(rng, r.y + 1, r.y + r.h - 2) });
  const normalRooms = rooms.slice(1).filter((r) => !r.secret);

  const chests = randInt(rng, 1, 3);
  for (let i = 0; i < chests && normalRooms.length; i++) {
    const p = randomIn(normalRooms[randInt(rng, 0, normalRooms.length - 1)]);
    if (free(p.x, p.y)) m.objects.push({ ...p, kind: 'chest' });
  }
  const traps = Math.min(14, 3 + Math.floor(floor / 4));
  for (let i = 0, tries = 0; i < traps && tries < 200; tries++) {
    const x = randInt(rng, 1, w - 2), y = randInt(rng, 1, h - 2);
    if (free(x, y)) { m.objects.push({ x, y, kind: 'trap' }); i++; }
  }
  const { count } = floorScaling(floor);
  for (let i = 0, tries = 0; i < count && tries < 500 && normalRooms.length; tries++) {
    const p = randomIn(normalRooms[randInt(rng, 0, normalRooms.length - 1)]);
    if (free(p.x, p.y)) { m.spawns.push(p); i++; }
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
    objects: [], spawns: [], boss: c, floor, biome: biomeIndexForFloor(floor),
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
