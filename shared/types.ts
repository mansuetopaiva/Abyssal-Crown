import type { Attr, Element, ItemSlotType, Rank, Slot } from './constants';

export type StatKey =
  | 'dmgPct' | 'flatDmg' | 'crit' | 'critDmg' | 'atkSpd' | 'lifesteal' | 'hp' | 'mana' | 'armor' | 'moveSpd'
  | 'resFire' | 'resIce' | 'resLightning' | 'resShadow' | 'resHoly'
  | 'fireDmg' | 'iceDmg' | 'lightningDmg' | 'shadowDmg' | 'holyDmg'
  | Attr | 'goldFind' | 'magicFind' | 'cdr' | 'hpRegen' | 'manaRegen' | 'dodge' | 'thorns' | 'xpBonus';

export interface Affix { stat: StatKey; value: number }
export interface SocketGem { id: string; tier: number }

export interface Item {
  id: string;
  baseType: string; // sword, helm, ring...
  slotType: ItemSlotType;
  name: string;
  rank: Rank;
  ilvl: number;
  refine: number;
  sockets: number;
  gems: SocketGem[];
  affixes: Affix[];
  unique?: string; // efeito lendário
  durability: number; // 0..100
  dmg?: [number, number];
  armor?: number;
  hp?: number;
  mana?: number;
  moveSpd?: number;
  thorns?: number; // espinhos base (escudo cravado), em %
  value: number; // preço de venda em gold
}

export interface Consumables { hpPotion: number; manaPotion: number }

export interface CharacterData {
  inventory: (Item | null)[];
  equipment: Partial<Record<Slot, Item>>;
  talents: Record<string, number>;
  consumables: Consumables;
  socketGems: Record<string, number>; // "ruby:1" -> quantidade
  stats: { kills: number; bossKills: number; chestsOpened: number; deaths: number; bestRank: number; bestItem: string };
  achievements: string[];
  daily: { date: string; kills: number; chests: number; floors: number; claimed: string[] };
  cosmetics: string[];
  cosmetic: string;
  invSlots: number;
  phoenixUsed?: boolean;
  shop?: { date: string; bought: number[] };
  loadout?: number[]; // índices das 4 habilidades na barra
}

export interface Character {
  id: number;
  userId: number;
  name: string;
  classId: string;
  level: number;
  xp: number;
  gold: number;
  gems: number;
  maxFloor: number;
  checkpoint: number;
  data: CharacterData;
}

export interface Stats {
  maxHp: number;
  maxMana: number;
  armor: number;
  minDmg: number;
  maxDmg: number;
  dmgPct: number;
  crit: number;
  critMult: number;
  atkSpd: number; // ataques/s
  moveSpeed: number;
  lifesteal: number;
  res: Record<Element, number>;
  elemBonus: Record<Element, number>;
  goldFind: number;
  magicFind: number;
  cdr: number;
  hpRegen: number;
  manaRegen: number;
  dodge: number;
  thorns: number;
  xpBonus: number;
  dr: number;
  bossDmg: number;
  attrs: Record<Attr, number>;
  uniques: string[];
  weapon: { type: string; attack: 'melee' | 'ranged' | 'magic'; range: number; arc: number; projSpeed: number; element: Element };
}
