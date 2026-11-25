// Preços e regras econômicas. O servidor aplica; o cliente só exibe.
import { MAX_REFINE } from './constants';
import { rollItem, SOCKET_GEMS } from './loot';
import { hashSeed, mulberry32 } from './rng';
import type { Item } from './types';

export const refineCost = (it: Item) => Math.round(40 * Math.pow(it.refine + 1, 2) * (1 + it.ilvl / 8));
export const refineChance = (it: Item) => (it.refine < 5 ? 1 : Math.max(0.3, 1 - (it.refine - 4) * 0.07));
export const canRefine = (it: Item) => it.refine < MAX_REFINE;
export const repairCost = (it: Item) => Math.ceil((100 - it.durability) * (1 + it.ilvl * 0.2) * 0.5);

export const potionPrice = (kind: 'hpPotion' | 'manaPotion', level: number) => (kind === 'hpPotion' ? 15 : 12) + level * 3;
export const POTION_HEAL = 0.4;

export const gemPrice = (tier: number) => ({ gold: [0, 200, 900, 3500][tier] ?? 0, gems: tier >= 3 ? 10 : 0 });
export const combineCost = (tier: number) => 300 * tier;
export const MAX_GEM_TIER = 5;
export const unsocketCost = 150;
export const gemKey = (id: string, tier: number) => `${id}:${tier}`;
export const parseGemKey = (k: string) => { const [id, t] = k.split(':'); return { id, tier: Number(t) }; };
export const isGemId = (id: unknown) => typeof id === 'string' && SOCKET_GEMS.some((g) => g.id === id);

export const GEM_SHOP = [
  { id: 'chest', name: 'Baú de Equipamento', desc: 'Um item de rank C ou superior, nível do seu andar mais profundo.', gems: 40 },
  { id: 'invExpand', name: 'Bolsa Extra', desc: '+8 espaços no inventário.', gems: 30 },
  { id: 'talentReset', name: 'Pergaminho do Esquecimento', desc: 'Devolve todos os pontos de talento.', gems: 25 },
  { id: 'aura_fire', name: 'Aura: Brasas', desc: 'Partículas de fogo ao seu redor.', gems: 25, cosmetic: true },
  { id: 'aura_void', name: 'Aura: Vazio', desc: 'Névoa abissal ao seu redor.', gems: 40, cosmetic: true },
  { id: 'aura_gold', name: 'Aura: Coroa Dourada', desc: 'Brilho dourado real.', gems: 60, cosmetic: true },
  { id: 'aura_rainbow', name: 'Aura: Prisma', desc: 'Brilho arco-íris (como os itens SSS).', gems: 80, cosmetic: true },
] as const;

/** Estoque diário do Ferreiro (determinístico por personagem e dia). */
export function smithStock(charId: number, date: string, ilvl: number): { item: Item; price: number }[] {
  const rng = mulberry32(hashSeed('smith', charId, date));
  const ranks = ['F', 'E', 'E', 'D', 'D', 'C'] as const;
  return ranks.map((rank, i) => {
    const item = rollItem(rng, { ilvl: Math.max(1, ilvl), rank, slotType: i === 0 ? 'weapon' : undefined });
    item.id = `shop${i}`;
    return { item, price: item.value * 5 + 20 };
  });
}

export const MARKET_MAX_LISTINGS = 10;
export const MARKET_MAX_PRICE = 1_000_000_000;
