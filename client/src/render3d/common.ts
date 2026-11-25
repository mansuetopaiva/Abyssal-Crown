export interface Ent {
  id: number; kind: number; x: number; y: number; hp: number; flags: number; meta: Record<string, any>;
  buf: { t: number; x: number; y: number }[]; seen: number; flash: number; face: number; prevX: number; bob: number;
  active: boolean;
}

export const K_PLAYER = 0, K_MONSTER = 1, K_PROJ = 2, K_MINION = 3, K_LOOT = 4, K_BOSS = 5;
export const F_DEAD = 1, F_STEALTH = 2, F_STUN = 4, F_SLOW = 8, F_POISON = 16, F_ELITE = 32, F_BUFF = 64, F_WINDUP = 128;
/** Ângulo da mira (radianos, convenção do servidor) codificado nos bits 8..13 das flags do jogador. */
export const aimFromFlags = (f: number) => (((f >> 8) & 63) / 64) * Math.PI * 2;

export interface MapState {
  w: number; h: number; tiles: Uint8Array; biome: number; world: 'town' | 'dungeon';
  objects: { k: string; x: number; y: number; open: boolean }[]; stairs?: { x: number; y: number; open: boolean };
  explored: Uint8Array;
}

export const MOD_PT: Record<string, string> = { elite: 'Elite', fast: 'Veloz', poison: 'Venenoso', armored: 'Blindado', vampiric: 'Vampírico', explosive: 'Explosivo' };
