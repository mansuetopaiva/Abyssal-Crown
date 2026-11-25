// Constantes compartilhadas entre cliente e servidor.
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const TILE = 16; // unidades de mundo por tile
export const PLAYER_RADIUS = 5;
export const BASE_MOVE_SPEED = 72; // unidades/s
export const MAX_CHARACTERS = 3;
export const MAX_PARTY = 4;
export const BASE_INV_SLOTS = 40;
export const INV_EXPANSION_SLOTS = 8;
export const MAX_INV_SLOTS = 96;
export const MAX_REFINE = 15;
export const CHECKPOINT_EVERY = 10;
export const BOSS_EVERY = 10;
export const BIOME_EVERY = 25;
export const MARKET_TAX = 0.05;

export const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'] as const;
export type Rank = (typeof RANKS)[number];

export const RANK_INFO: Record<Rank, { color: string; name: string; baseChance: number; affixes: [number, number]; statMult: number; sockets: number }> = {
  F: { color: '#8a8a8a', name: 'cinza', baseChance: 0.4, affixes: [0, 1], statMult: 1.0, sockets: 0 },
  E: { color: '#e8e8e8', name: 'branco', baseChance: 0.25, affixes: [1, 1], statMult: 1.1, sockets: 0 },
  D: { color: '#4ccf55', name: 'verde', baseChance: 0.15, affixes: [1, 2], statMult: 1.22, sockets: 1 },
  C: { color: '#4a8cff', name: 'azul', baseChance: 0.1, affixes: [2, 2], statMult: 1.36, sockets: 1 },
  B: { color: '#b45cff', name: 'roxo', baseChance: 0.05, affixes: [2, 3], statMult: 1.52, sockets: 2 },
  A: { color: '#ff9a2e', name: 'laranja', baseChance: 0.03, affixes: [3, 4], statMult: 1.75, sockets: 2 },
  S: { color: '#ff3b3b', name: 'vermelho', baseChance: 0.015, affixes: [4, 5], statMult: 2.05, sockets: 3 },
  SS: { color: '#ffd23f', name: 'dourado', baseChance: 0.0045, affixes: [5, 5], statMult: 2.45, sockets: 3 },
  SSS: { color: 'rainbow', name: 'arco-íris', baseChance: 0.0005, affixes: [6, 6], statMult: 3.0, sockets: 3 },
};

export const SLOTS = ['weapon', 'offhand', 'helm', 'armor', 'gloves', 'boots', 'amulet', 'ring1', 'ring2'] as const;
export type Slot = (typeof SLOTS)[number];
export type ItemSlotType = 'weapon' | 'offhand' | 'helm' | 'armor' | 'gloves' | 'boots' | 'amulet' | 'ring';
export const SLOT_LABEL: Record<Slot, string> = {
  weapon: 'Arma', offhand: 'Secundária/Escudo', helm: 'Elmo', armor: 'Armadura', gloves: 'Luvas',
  boots: 'Botas', amulet: 'Amuleto', ring1: 'Anel 1', ring2: 'Anel 2',
};

export const ELEMENTS = ['physical', 'fire', 'ice', 'lightning', 'shadow', 'holy'] as const;
export type Element = (typeof ELEMENTS)[number];
export const ELEMENT_LABEL: Record<Element, string> = {
  physical: 'Físico', fire: 'Fogo', ice: 'Gelo', lightning: 'Raio', shadow: 'Sombra', holy: 'Sagrado',
};
export const ELEMENT_COLOR: Record<Element, string> = {
  physical: '#ffffff', fire: '#ff7a2e', ice: '#7fd8ff', lightning: '#fff35c', shadow: '#b07cff', holy: '#ffe9a8',
};

export const ATTRS = ['str', 'agi', 'int', 'vit', 'luk'] as const;
export type Attr = (typeof ATTRS)[number];
export const ATTR_LABEL: Record<Attr, string> = { str: 'Força', agi: 'Agilidade', int: 'Inteligência', vit: 'Vitalidade', luk: 'Sorte' };

export const BIOMES = [
  { id: 'catacombs', name: 'Catacumbas', floor: '#2b2733', floor2: '#332e3d', wall: '#141119', wallTop: '#4a4258', accent: '#9a8fb0', fog: '#0b0a0f' },
  { id: 'crystal', name: 'Cavernas de Cristal', floor: '#1d2a3a', floor2: '#22344a', wall: '#0c1420', wallTop: '#3a6c9a', accent: '#7fe3ff', fog: '#060b12' },
  { id: 'fungal', name: 'Floresta Fúngica', floor: '#24301f', floor2: '#2c3a25', wall: '#10170d', wallTop: '#5c7a3a', accent: '#c06cff', fog: '#080c06' },
  { id: 'lava', name: 'Fortaleza de Lava', floor: '#3a2220', floor2: '#452825', wall: '#1a0d0b', wallTop: '#8a3a20', accent: '#ff8a2e', fog: '#100605' },
  { id: 'void', name: 'Vazio Abissal', floor: '#191426', floor2: '#201a31', wall: '#07050c', wallTop: '#3d2a6e', accent: '#ff4fd8', fog: '#030207' },
] as const;
export type BiomeId = (typeof BIOMES)[number]['id'];

export function biomeIndexForFloor(floor: number): number {
  return Math.floor((floor - 1) / BIOME_EVERY) % BIOMES.length;
}
export const isBossFloor = (floor: number) => floor > 0 && floor % BOSS_EVERY === 0;

/** Multiplicadores de dificuldade por andar (HP, dano, quantidade). */
export function floorScaling(floor: number) {
  const f = Math.max(1, floor) - 1;
  const cycle = Math.floor(f / (BIOME_EVERY * BIOMES.length)); // volta ao primeiro bioma mais forte
  const hp = (1 + 0.16 * f) * Math.pow(1.035, f) * (1 + cycle);
  const dmg = (1 + 0.1 * f) * Math.pow(1.025, f) * (1 + cycle * 0.5);
  const count = Math.min(70, 16 + Math.floor(f * 0.6));
  return { hp, dmg, count };
}

export function xpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.65));
}
export const MAX_LEVEL = 100;

