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

export function sprite(shape: string, palette: readonly string[], scale = 1): HTMLCanvasElement {
  const key = `${shape}|${palette.join(',')}|${scale}`;
  let c = cache.get(key);
  if (c) return c;
  const rows = T[shape] ?? T.slime;
  c = document.createElement('canvas');
  c.width = 12 * scale; c.height = 12 * scale;
  const g = c.getContext('2d')!;
  const col: Record<string, string> = { k: '#0a0810', w: '#f4f0ff', s: '#e0b48a', h: '#3a2a1a', '1': palette[0], '2': palette[1], '3': palette[2] };
  rows.forEach((row, y) => {
    for (let x = 0; x < 12; x++) {
      const ch = row[x] ?? '.';
      if (ch === '.' || ch === ' ') continue;
      g.fillStyle = col[ch] ?? palette[0];
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  cache.set(key, c);
  return c;
}

/** Versão "acesa" (branca) para o flash de dano. */
export function flashSprite(src: HTMLCanvasElement): HTMLCanvasElement {
  const key = `flash|${cache.size}|${src.width}`;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  void key;
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

function noise(g: CanvasRenderingContext2D, color: string, n: number, seed: number) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = color;
  for (let i = 0; i < n; i++) g.fillRect((r() * 16) | 0, (r() * 16) | 0, 1, 1);
}

export const TOWN_BIOME = {
  id: 'town', name: 'Cidade', floor: '#3a3428', floor2: '#433c2e', wall: '#1c1812', wallTop: '#6a5a40', accent: '#c9a24a', fog: '#0d0b08',
};

/** Gera (uma vez) o conjunto de tiles de um bioma. -1 = cidade. */
export function tileset(biome: number): TileSet {
  const cached = tileCache.get(biome);
  if (cached) return cached;
  const b = biome < 0 ? TOWN_BIOME : BIOMES[biome];
  const floor = [0, 1, 2].map((v) =>
    tileCanvas((g) => {
      g.fillStyle = v === 1 ? b.floor2 : b.floor;
      g.fillRect(0, 0, 16, 16);
      noise(g, '#ffffff10', 10, 7 + v * 13);
      noise(g, '#00000030', 14, 3 + v * 29);
      if (biome < 0) { g.fillStyle = '#00000025'; g.fillRect(0, 15, 16, 1); g.fillRect(15, 0, 1, 16); }
      if (v === 2) { g.fillStyle = b.accent + '30'; g.fillRect(5, 6, 2, 2); g.fillRect(10, 11, 1, 1); }
    }),
  );
  const wallFace = tileCanvas((g) => {
    g.fillStyle = b.wall; g.fillRect(0, 0, 16, 16);
    g.fillStyle = b.wallTop; g.fillRect(0, 0, 16, 3);
    g.fillStyle = '#00000050';
    for (let y = 5; y < 16; y += 4) { g.fillRect(0, y, 16, 1); for (let x = (y % 8 ? 0 : 4); x < 16; x += 8) g.fillRect(x, y - 3, 1, 3); }
    noise(g, '#ffffff12', 6, 41);
  });
  const wallTop = tileCanvas((g) => {
    if (biome < 0) {
      // telhado das casas da cidade
      g.fillStyle = '#5a2a22'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#6e3428';
      for (let y = 0; y < 16; y += 4) for (let x = (y % 8 ? 2 : 0); x < 16; x += 4) g.fillRect(x, y, 3, 3);
      g.fillStyle = '#00000030'; for (let y = 3; y < 16; y += 4) g.fillRect(0, y, 16, 1);
      return;
    }
    g.fillStyle = b.fog; g.fillRect(0, 0, 16, 16);
    noise(g, '#ffffff08', 5, 17);
  });
  const cracked = tileCanvas((g) => {
    g.drawImage(wallFace, 0, 0);
    g.strokeStyle = '#000000aa';
    g.beginPath(); g.moveTo(4, 4); g.lineTo(8, 8); g.lineTo(6, 12); g.moveTo(8, 8); g.lineTo(12, 7); g.stroke();
  });
  const objects: Record<string, HTMLCanvasElement> = {
    stairs: tileCanvas((g) => {
      g.fillStyle = '#000'; g.fillRect(1, 1, 14, 14);
      for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(160,150,170,${0.75 - i * 0.14})`; g.fillRect(2 + i, 2 + i * 3, 12 - i * 2, 2); }
      g.strokeStyle = b.accent; g.strokeRect(0.5, 0.5, 15, 15);
    }),
    stairsClosed: tileCanvas((g) => {
      g.fillStyle = '#000'; g.fillRect(1, 1, 14, 14);
      g.strokeStyle = '#5a1a1a'; g.lineWidth = 2; g.beginPath(); g.moveTo(3, 3); g.lineTo(13, 13); g.moveTo(13, 3); g.lineTo(3, 13); g.stroke();
    }),
    chest: chest('#7a4a1a', '#c9a24a', false),
    chestOpen: chest('#7a4a1a', '#c9a24a', true),
    secretChest: chest('#3d2a6e', '#ff4fd8', false),
    secretChestOpen: chest('#3d2a6e', '#ff4fd8', true),
    trap: tileCanvas((g) => {
      g.fillStyle = '#00000040'; g.fillRect(3, 3, 10, 10);
      g.fillStyle = '#8a8a9a';
      for (const [x, y] of [[4, 4], [8, 4], [12, 4], [6, 8], [10, 8], [4, 12], [8, 12], [12, 12]]) g.fillRect(x - 1, y - 1, 1, 2);
    }),
  };
  const ts = { floor, wallTop, wallFace, cracked, objects };
  tileCache.set(biome, ts);
  return ts;
}

function chest(wood: string, metal: string, open: boolean) {
  return tileCanvas((g) => {
    g.fillStyle = '#0a0810'; g.fillRect(2, open ? 3 : 5, 12, open ? 11 : 9);
    g.fillStyle = wood; g.fillRect(3, open ? 4 : 6, 10, open ? 9 : 7);
    g.fillStyle = metal; g.fillRect(3, 9, 10, 1); g.fillRect(7, 8, 2, 3);
    if (open) { g.fillStyle = '#ffe9a8'; g.fillRect(4, 5, 8, 2); }
  });
}

/** Ícone de item (para inventário). */
export function itemIcon(slotType: string, baseType: string, color: string): HTMLCanvasElement {
  const key = `icon|${slotType}|${baseType}|${color}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d')!;
  const col = color === 'rainbow' ? '#ffd23f' : color;
  g.fillStyle = col;
  g.strokeStyle = '#0a0810';
  const px = (pts: number[][]) => pts.forEach(([x, y, w = 1, h = 1]) => g.fillRect(x, y, w, h));
  switch (baseType) {
    case 'sword': case 'dagger': px([[11, 2, 2, 2], [10, 4, 2, 2], [8, 6, 2, 2], [6, 8, 2, 2], [3, 9, 5, 1], [5, 11, 1, 2], [3, 12, 2, 2]]); break;
    case 'axe': case 'scythe': px([[4, 3, 1, 11], [5, 3, 5, 2], [7, 5, 4, 2], [9, 7, 2, 1]]); break;
    case 'spear': px([[3, 12, 1, 1], [4, 11, 1, 1], [5, 10, 1, 1], [6, 9, 1, 1], [7, 8, 1, 1], [8, 7, 1, 1], [9, 6, 1, 1], [10, 3, 3, 3]]); break;
    case 'bow': case 'crossbow': px([[4, 2, 1, 12], [5, 2, 3, 1], [8, 3, 2, 2], [10, 5, 1, 6], [8, 11, 2, 2], [5, 13, 3, 1]]); break;
    case 'staff': case 'wand': px([[7, 4, 1, 10], [5, 1, 5, 4]]); g.fillStyle = '#fff'; g.fillRect(7, 2, 1, 1); break;
    case 'hammer': px([[7, 6, 2, 8], [3, 2, 10, 4]]); break;
    case 'grimoire': px([[3, 3, 10, 10]]); g.fillStyle = '#0a0810'; g.fillRect(7, 3, 1, 10); break;
    case 'shield': px([[3, 2, 10, 7], [4, 9, 8, 2], [6, 11, 4, 2], [7, 13, 2, 1]]); break;
    case 'orb': g.beginPath(); g.arc(8, 8, 5, 0, 7); g.fill(); break;
    case 'helm': px([[4, 3, 8, 6], [3, 6, 10, 5]]); g.fillStyle = '#0a0810'; g.fillRect(5, 8, 6, 1); break;
    case 'armor': px([[3, 3, 10, 2], [4, 5, 8, 8], [2, 3, 2, 5], [12, 3, 2, 5]]); break;
    case 'gloves': px([[4, 5, 6, 7], [10, 7, 2, 3], [4, 3, 1, 2], [6, 2, 1, 3], [8, 3, 1, 2]]); break;
    case 'boots': px([[4, 2, 4, 9], [4, 11, 8, 3]]); break;
    case 'amulet': g.strokeStyle = col; g.beginPath(); g.arc(8, 6, 4, 0.2, Math.PI - 0.2); g.stroke(); px([[6, 9, 4, 4]]); break;
    case 'ring': g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(8, 9, 4, 0, 7); g.stroke(); px([[7, 3, 2, 2]]); break;
    default: px([[4, 4, 8, 8]]);
  }
  cache.set(key, c);
  return c;
}
