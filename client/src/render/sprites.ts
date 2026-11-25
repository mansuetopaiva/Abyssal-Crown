// Pixel art procedural: modelos 12x12 coloridos pela paleta de cada monstro/classe.
// Tudo é gerado em canvas uma vez e reutilizado (atlas em cache).
import { BIOMES } from '../../../shared/constants';

const T: Record<string, string[]> = {
  skeleton: [
    '...kkkkkk...', '..k111111k..', '..k13113 1k.', '..k111111k..', '...k1kk1k...', '..kk2112kk..',
    '.k1.k11k.1k.', '...k1221k...', '....k11k....', '...k1kk1k...', '...k1..1k...', '..kk....kk..',
  ],
  slime: [
    '............', '............', '.....kk.....', '....k11k....', '...k1w111k..', '..k1ww1111k.',
    '..k1111111k.', '.k113113111k', '.k111111111k', '.k221111122k', '.k222222222k', '..kkkkkkkkk.',
  ],
  bat: [
    '............', 'k..........k', 'kk...kk...kk', 'k1k.k11k.k1k', 'k11k1111k11k', 'k1111311311k',
    '.k11111111k.', '..k2k11k2k..', '...k.kk.k...', '............', '............', '............',
  ],
  spider: [
    '............', '.k..kkkk..k.', '..kk1111kk..', 'k..k1111k..k', '.kk111111kk.', '...k3113k...',
    'kkk111111kkk', '...k2222k...', '.kk.k22k.kk.', 'k..k....k..k', '..k......k..', '............',
  ],
  golem: [
    '...kkkkkk...', '..k111111k..', '..k131131k..', '.kk111111kk.', 'k11k2222k11k', 'k11k2332k11k',
    'k11k2222k11k', 'k2kk1111kk2k', '.k.k1111k.k.', '...k11k11k..', '..k111k111k.', '..kkkk.kkkk.',
  ],
  mushroom: [
    '...kkkkkk...', '..k1w1111k..', '.k11111w11k.', 'k1w11111111k', 'k11111w1111k', '.kkkkkkkkkk.',
    '...k2222k...', '...k3223k...', '...k2222k...', '...k2222k...', '..k222222k..', '..kkkkkkkk..',
  ],
  imp: [
    '.k........k.', '.k1k....k1k.', '..k1kkkk1k..', '..k111111k..', '..k131131k..', '..k111111k..',
    '...k1221k...', '.kk111111kk.', 'k1.k1111k.1k', '...k1kk1k...', '...k1..1k...', '..kk....kk..',
  ],
  wraith: [
    '....kkkk....', '...k1111k...', '..k111111k..', '..k131131k..', '..k111111k..', '.k11122111k.',
    '.k11111111k.', 'k1111111111k', 'k1111111111k', '.k11k11k11k.', '..kk.kk.kk..', '............',
  ],
  beetle: [
    '............', '...k....k...', '....k..k....', '...kkkkkk...', '..k131131k..', '.k11111111k.',
    'k1111kk1111k', 'k1112kk2111k', 'k1112kk2111k', '.k112kk211k.', 'k.kkkkkkkk.k', '..k......k..',
  ],
  eye: [
    '...kkkkkk...', '..k111111k..', '.k11wwww11k.', 'k11ww33ww11k', 'k1ww3kk3ww1k', 'k1ww3kk3ww1k',
    'k11ww33ww11k', '.k11wwww11k.', '..k111111k..', '...kkkkkk...', '..k.k..k.k..', '.k...k..k...',
  ],
  worm: [
    '............', '............', '....kkkk....', '...k1111k...', '..k131131k..', '..k111111k..',
    '..k122221k..', '...k1111k...', '..kk1111k...', '.k111kk11k..', 'k1111k.k111k', '.kkkk...kkk.',
  ],
  hero: [
    '...kkkkkk...', '..khhhhhhk..', '..khsssshk..', '..kskssksk..', '..ksssssk...', '..kk2222kk..',
    '.k1k1111k1k.', '.ks112211sk.', '..k111111k..', '...k2kk2k...', '...k1kk1k...', '...kk..kk...',
  ],
  npc: [
    '...kkkkkk...', '..k111111k..', '..k1ssss1k..', '..kskssksk..', '..kssssssk..', '..k111111k..',
    '.k11111111k.', '.ks112211sk.', '.k11111111k.', '.k11111111k.', '.k11111111k.', '..kkkkkkkk..',
  ],
};
export const SHAPES = Object.keys(T);

const cache = new Map<string, HTMLCanvasElement>();

// ---------- cores ----------
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
/** f > 0 clareia, f < 0 escurece. */
export function shade(hex: string, f: number): string {
  const [r, g, b] = rgb(hex);
  const t = f >= 0 ? 255 : 0, k = Math.abs(f);
  const m = (c: number) => Math.round(c + (t - c) * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

const OUTLINE = '#07050b';

/**
 * Sprite 24×24 gerado a partir de um modelo 12×12 com sombreamento automático:
 * luz vinda de cima/esquerda, bordas inferiores mais escuras e bisel em cada pixel.
 */
export function sprite(shape: string, palette: readonly string[]): HTMLCanvasElement {
  const key = `${shape}|${palette.join(',')}`;
  let c = cache.get(key);
  if (c) return c;
  const rows = T[shape] ?? T.slime;
  const S = 2;
  c = document.createElement('canvas');
  c.width = 12 * S; c.height = 12 * S;
  const g = c.getContext('2d')!;
  const col: Record<string, string> = { w: '#f4f0ff', s: '#e0b48a', h: '#3a2a1a', '1': palette[0], '2': palette[1], '3': palette[2] };
  const at = (x: number, y: number) => (x < 0 || y < 0 || x > 11 || y > 11 ? '.' : (rows[y][x] ?? '.'));
  const edge = (x: number, y: number) => { const ch = at(x, y); return ch === '.' || ch === ' ' || ch === 'k'; };
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const ch = at(x, y);
    if (ch === '.' || ch === ' ') continue;
    if (ch === 'k') { g.fillStyle = OUTLINE; g.fillRect(x * S, y * S, S, S); continue; }
    const base = col[ch] ?? palette[0];
    if (ch === '3' || ch === 'w') { // olhos/brilhos: sem sombra, levemente mais claros
      g.fillStyle = shade(base, 0.15); g.fillRect(x * S, y * S, S, S);
      g.fillStyle = '#ffffffaa'; g.fillRect(x * S, y * S, 1, 1);
      continue;
    }
    let f = (5 - y) * 0.018;
    if (edge(x, y - 1)) f += 0.2;
    if (edge(x - 1, y)) f += 0.07;
    if (edge(x, y + 1)) f -= 0.26;
    if (edge(x + 1, y)) f -= 0.1;
    const mid = shade(base, Math.max(-0.6, Math.min(0.5, f)));
    g.fillStyle = mid; g.fillRect(x * S, y * S, S, S);
    g.fillStyle = shade(base, Math.min(0.6, f + 0.1)); g.fillRect(x * S, y * S, 1, 1);
    g.fillStyle = shade(base, Math.max(-0.7, f - 0.14)); g.fillRect(x * S + 1, y * S + 1, 1, 1);
  }
  cache.set(key, c);
  return c;
}

// ---------- tiles por bioma (carregados sob demanda) ----------
export interface TileSet { floor: HTMLCanvasElement[]; wallTop: HTMLCanvasElement; wallFace: HTMLCanvasElement; cracked: HTMLCanvasElement; objects: Record<string, HTMLCanvasElement> }
const tileCache = new Map<number, TileSet>();

function tileCanvas(draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  draw(c.getContext('2d')!);
  return c;
}

function lcg(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export const TOWN_BIOME = {
  id: 'town', name: 'Cidade', floor: '#4a4338', floor2: '#544b3e', wall: '#2a231a', wallTop: '#6a5a40', accent: '#c9a24a', fog: '#0d0b08',
};

/** Laje de pedra com bisel (luz de cima/esquerda). */
function slab(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, r: () => number) {
  const tone = shade(base, (r() - 0.5) * 0.14);
  g.fillStyle = tone; g.fillRect(x, y, w, h);
  g.fillStyle = shade(base, 0.14); g.fillRect(x, y, w - 1, 1); g.fillRect(x, y, 1, h - 1);
  g.fillStyle = shade(base, -0.32); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h);
  for (let i = 0; i < 3; i++) { g.fillStyle = r() < 0.5 ? '#ffffff0c' : '#0000001c'; g.fillRect(x + 1 + ((r() * (w - 2)) | 0), y + 1 + ((r() * (h - 2)) | 0), 1, 1); }
}

function biomeDetail(g: CanvasRenderingContext2D, id: string, accent: string, r: () => number) {
  const px = (x: number, y: number, c: string, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const x = 3 + ((r() * 9) | 0), y = 3 + ((r() * 9) | 0);
  switch (id) {
    case 'catacombs': px(x, y, '#d8d0bc', 3, 1); px(x, y - 1, '#d8d0bc'); px(x + 2, y + 1, '#d8d0bc'); px(x + 1, y + 1, '#00000040', 3, 1); break;
    case 'crystal': px(x, y, accent, 1, 3); px(x + 1, y + 1, shade(accent, 0.4), 1, 2); px(x - 1, y + 2, shade(accent, -0.3)); break;
    case 'fungal': px(x, y + 1, '#e8d8c0', 1, 2); px(x - 1, y, accent, 3, 1); px(x + 3, y + 2, '#4a6a2a', 2, 1); px(x - 3, y + 3, '#4a6a2a'); break;
    case 'lava': px(x - 2, y, '#ff7a2e', 2, 1); px(x, y + 1, '#ffb04a', 2, 1); px(x + 2, y + 2, '#ff5a1e'); break;
    case 'void': px(x, y, '#ff9af0'); px(x + 4, y + 3, '#ffffff'); px(x - 2, y + 4, accent); break;
    case 'town': px(x, y, '#5a7a3a'); px(x + 1, y - 1, '#6a8a4a'); px(x - 1, y - 1, '#4a6a2a'); break;
  }
}

/** Gera (uma vez) o conjunto de tiles de um bioma. -1 = cidade. */
export function tileset(biome: number): TileSet {
  const cached = tileCache.get(biome);
  if (cached) return cached;
  const b = biome < 0 ? TOWN_BIOME : BIOMES[biome];
  const floor = [0, 1, 2, 3].map((v) =>
    tileCanvas((g) => {
      const r = lcg(97 + v * 131 + biome * 17);
      const base = v === 1 ? b.floor2 : b.floor;
      g.fillStyle = shade(base, -0.45); g.fillRect(0, 0, 16, 16); // argamassa
      if (biome < 0) { // paralelepípedos
        for (let yy = 0; yy < 16; yy += 4) for (let xx = (yy % 8 ? -2 : 0); xx < 16; xx += 4) slab(g, xx, yy, 4, 4, base, r);
      } else if (v === 3) {
        slab(g, 0, 0, 16, 16, base, r);
      } else {
        const o = v === 1 ? 4 : 8;
        slab(g, 0, 0, o, 8, base, r); slab(g, o, 0, 16 - o, 8, base, r);
        slab(g, 0, 8, 16 - o, 8, base, r); slab(g, 16 - o, 8, o, 8, base, r);
      }
      if (v === 2) biomeDetail(g, b.id, b.accent, r);
    }),
  );
  const wallFace = tileCanvas((g) => {
    const r = lcg(41 + biome * 7);
    g.fillStyle = shade(b.wall, -0.4); g.fillRect(0, 0, 16, 16);
    for (let row = 0; row < 4; row++) {
      const y = 3 + row * 3.25 | 0;
      for (let x = row % 2 ? -4 : 0; x < 16; x += 8) {
        const tone = shade(b.wall, 0.05 + (r() - 0.5) * 0.18);
        g.fillStyle = tone; g.fillRect(x + 1, y, 7, 2);
        g.fillStyle = shade(b.wall, 0.25); g.fillRect(x + 1, y, 7, 1);
      }
    }
    g.fillStyle = b.wallTop; g.fillRect(0, 0, 16, 3);
    g.fillStyle = shade(b.wallTop, 0.25); g.fillRect(0, 0, 16, 1);
    g.fillStyle = shade(b.wallTop, -0.35); g.fillRect(0, 2, 16, 1);
    g.fillStyle = '#00000066'; g.fillRect(0, 14, 16, 2);
  });
  const wallTop = tileCanvas((g) => {
    if (biome < 0) { // telhado das casas da cidade
      g.fillStyle = '#4a221c'; g.fillRect(0, 0, 16, 16);
      for (let y = 0; y < 16; y += 4) for (let x = (y % 8 ? -2 : 0); x < 16; x += 4) {
        g.fillStyle = '#7a3a2c'; g.fillRect(x, y, 3, 3);
        g.fillStyle = '#93503a'; g.fillRect(x, y, 3, 1);
      }
      return;
    }
    g.fillStyle = b.fog; g.fillRect(0, 0, 16, 16);
    const r = lcg(17 + biome);
    for (let i = 0; i < 5; i++) { g.fillStyle = '#ffffff07'; g.fillRect((r() * 16) | 0, (r() * 16) | 0, 2, 1); }
  });
  const cracked = tileCanvas((g) => {
    g.drawImage(wallFace, 0, 0);
    g.strokeStyle = '#000000cc'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(4.5, 3.5); g.lineTo(8.5, 8.5); g.lineTo(6.5, 13.5); g.moveTo(8.5, 8.5); g.lineTo(12.5, 7.5); g.stroke();
    g.strokeStyle = '#ffffff22'; g.beginPath(); g.moveTo(5.5, 3.5); g.lineTo(9.5, 8.5); g.stroke();
  });
  const objects: Record<string, HTMLCanvasElement> = {
    stairs: tileCanvas((g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, 16, 16);
      for (let i = 0; i < 6; i++) {
        const c = shade(b.floor, 0.25 - i * 0.15);
        g.fillStyle = c; g.fillRect(1 + i, 1 + i * 2.4, 14 - i * 2, 2);
        g.fillStyle = '#00000088'; g.fillRect(1 + i, 3 + i * 2.4, 14 - i * 2, 1);
      }
      g.strokeStyle = b.accent; g.strokeRect(0.5, 0.5, 15, 15);
    }),
    stairsClosed: tileCanvas((g) => {
      g.fillStyle = '#000'; g.fillRect(1, 1, 14, 14);
      g.fillStyle = '#3a3a44';
      for (let x = 2; x < 15; x += 3) g.fillRect(x, 1, 1, 14);
      g.fillStyle = '#5a1a1a'; g.fillRect(1, 7, 14, 2);
    }),
    chest: chest('#6a3a14', '#c9a24a', false),
    chestOpen: chest('#6a3a14', '#c9a24a', true),
    secretChest: chest('#3d2a6e', '#ff4fd8', false),
    secretChestOpen: chest('#3d2a6e', '#ff4fd8', true),
    trap: tileCanvas((g) => {
      g.fillStyle = '#00000050'; g.fillRect(2, 2, 12, 12);
      g.strokeStyle = '#00000080'; g.strokeRect(2.5, 2.5, 11, 11);
      for (const [x, y] of [[4, 4], [8, 4], [12, 4], [6, 8], [10, 8], [4, 12], [8, 12], [12, 12]]) {
        g.fillStyle = '#b8b8c8'; g.fillRect(x - 1, y - 2, 1, 2);
        g.fillStyle = '#5a5a6a'; g.fillRect(x, y - 1, 1, 1);
      }
    }),
  };
  const ts = { floor, wallTop, wallFace, cracked, objects };
  tileCache.set(biome, ts);
  return ts;
}

function chest(wood: string, metal: string, open: boolean) {
  return tileCanvas((g) => {
    const top = open ? 3 : 5;
    g.fillStyle = '#00000066'; g.fillRect(2, 14, 13, 2);
    g.fillStyle = OUTLINE; g.fillRect(1, top, 14, 15 - top);
    g.fillStyle = wood; g.fillRect(2, top + 1, 12, 13 - top);
    g.fillStyle = shade(wood, 0.25); g.fillRect(2, top + 1, 12, 1);
    for (let x = 4; x < 14; x += 3) { g.fillStyle = shade(wood, -0.25); g.fillRect(x, top + 2, 1, 12 - top); }
    g.fillStyle = metal; g.fillRect(2, 9, 12, 1); g.fillRect(2, top + 1, 1, 13 - top); g.fillRect(13, top + 1, 1, 13 - top);
    g.fillStyle = shade(metal, 0.4); g.fillRect(7, 8, 2, 3);
    if (open) { g.fillStyle = '#ffe9a8'; g.fillRect(3, 4, 10, 3); g.fillStyle = '#ffffff'; g.fillRect(6, 5, 2, 1); }
  });
}

/** Ícone de item 32×32 sombreado. Devolve um canvas compartilhado: NÃO insira no DOM (use itemIconUrl). */
export function itemIcon(slotType: string, baseType: string, color: string): HTMLCanvasElement {
  const key = `icon|${slotType}|${baseType}|${color}`;
  let c = cache.get(key);
  if (c) return c;
  // desenha a silhueta 16×16 e depois aplica o mesmo sombreamento dos sprites
  const m = document.createElement('canvas');
  m.width = 16; m.height = 16;
  const g = m.getContext('2d')!;
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  const px = (pts: number[][]) => pts.forEach(([x, y, w = 1, h = 1]) => g.fillRect(x, y, w, h));
  switch (baseType) {
    case 'sword': px([[12, 1, 2, 2], [11, 3, 2, 2], [10, 4, 2, 2], [9, 5, 2, 2], [8, 6, 2, 2], [7, 7, 2, 2], [6, 8, 2, 2], [3, 9, 6, 2], [5, 11, 2, 2], [3, 13, 2, 2]]); break;
    case 'dagger': px([[11, 3, 2, 2], [10, 4, 2, 2], [9, 5, 2, 2], [8, 6, 2, 2], [5, 8, 5, 2], [6, 10, 2, 2], [4, 12, 2, 2]]); break;
    case 'axe': px([[5, 2, 2, 13], [7, 2, 4, 2], [7, 4, 6, 3], [7, 7, 4, 2]]); break;
    case 'scythe': px([[4, 2, 2, 13], [6, 2, 6, 2], [10, 4, 3, 2], [12, 6, 2, 2]]); break;
    case 'spear': px([[2, 13, 2, 2], [4, 11, 2, 2], [6, 9, 2, 2], [8, 7, 2, 2], [10, 3, 4, 4], [12, 1, 2, 2]]); break;
    case 'bow': px([[4, 1, 2, 14], [6, 1, 3, 2], [9, 3, 2, 2], [10, 5, 2, 6], [9, 11, 2, 2], [6, 13, 3, 2]]); g.fillRect(6, 7, 8, 1); break;
    case 'crossbow': px([[2, 6, 12, 3], [7, 2, 2, 12], [4, 4, 3, 1], [9, 4, 3, 1], [4, 11, 3, 1], [9, 11, 3, 1]]); break;
    case 'staff': px([[7, 5, 2, 10], [5, 1, 6, 5], [4, 2, 1, 3], [11, 2, 1, 3]]); break;
    case 'wand': px([[7, 6, 2, 9], [6, 2, 4, 4]]); break;
    case 'hammer': px([[7, 6, 2, 9], [2, 2, 12, 5]]); break;
    case 'grimoire': px([[3, 2, 10, 12], [2, 3, 1, 10]]); break;
    case 'shield': px([[3, 2, 10, 7], [4, 9, 8, 2], [5, 11, 6, 2], [7, 13, 2, 2]]); break;
    case 'orb': g.beginPath(); g.arc(8, 8, 6, 0, 7); g.fill(); break;
    case 'helm': px([[4, 2, 8, 2], [3, 4, 10, 4], [2, 8, 12, 5], [6, 13, 4, 1]]); break;
    case 'armor': px([[2, 2, 4, 6], [10, 2, 4, 6], [5, 3, 6, 11], [4, 8, 8, 6]]); break;
    case 'gloves': px([[3, 6, 8, 8], [11, 8, 3, 3], [3, 2, 2, 4], [6, 1, 2, 5], [9, 2, 2, 4]]); break;
    case 'boots': px([[3, 1, 6, 10], [3, 11, 11, 4]]); break;
    case 'amulet': g.lineWidth = 1.5; g.beginPath(); g.arc(8, 5, 5, 0.2, Math.PI - 0.2); g.stroke(); px([[5, 9, 6, 6]]); break;
    case 'ring': g.lineWidth = 2.5; g.beginPath(); g.arc(8, 10, 4.5, 0, 7); g.stroke(); px([[6, 2, 4, 4]]); break;
    default: px([[4, 4, 8, 8]]);
  }
  const data = g.getImageData(0, 0, 16, 16).data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && data[(y * 16 + x) * 4 + 3] > 100;
  const base = color === 'rainbow' ? '#ffd23f' : color;
  const metal = '#b8bcc8', wood = '#7a5a3a';
  const tint = (x: number, y: number) => {
    // cabos de madeira/metal para armas, cor do rank no restante
    if (['sword', 'dagger'].includes(baseType)) return y >= 9 ? wood : x + y < 17 ? metal : base;
    if (['axe', 'scythe', 'hammer', 'staff', 'wand', 'spear'].includes(baseType)) return (baseType === 'spear' ? x < 10 : y >= 6 && x >= 4 && x <= 8) ? wood : base;
    return base;
  };
  c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const o = c.getContext('2d')!;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!solid(x, y)) {
      if (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1)) { o.fillStyle = OUTLINE; o.fillRect(x * 2, y * 2, 2, 2); }
      continue;
    }
    const b = tint(x, y);
    let f = (8 - y) * 0.02;
    if (!solid(x, y - 1)) f += 0.25;
    if (!solid(x - 1, y)) f += 0.1;
    if (!solid(x, y + 1)) f -= 0.3;
    if (!solid(x + 1, y)) f -= 0.12;
    o.fillStyle = shade(b, f); o.fillRect(x * 2, y * 2, 2, 2);
    o.fillStyle = shade(b, f + 0.15); o.fillRect(x * 2, y * 2, 1, 1);
  }
  cache.set(key, c);
  return c;
}

const urlCache = new Map<string, string>();
/** URL (data:) do ícone — pode ser usada em quantos <img> quiser. */
export function itemIconUrl(slotType: string, baseType: string, color: string): string {
  const key = `${slotType}|${baseType}|${color}`;
  let u = urlCache.get(key);
  if (!u) { u = itemIcon(slotType, baseType, color).toDataURL(); urlCache.set(key, u); }
  return u;
}
