import itemsData from './data/items.json';
import { RANKS, RANK_INFO, type ItemSlotType, type Rank } from './constants';
import type { Affix, Item, StatKey } from './types';
import { pick, randInt, weightedPick, type Rng } from './rng';

export const WEAPONS = itemsData.weapons;
export const ARMORS = itemsData.armors;
export const AFFIXES = itemsData.affixes as { stat: StatKey; label: string; min: number; max: number; scale: number; pct?: boolean }[];
export const UNIQUES = itemsData.uniques;
export const SOCKET_GEMS = itemsData.socketGems;
export const AFFIX_BY_STAT = Object.fromEntries(AFFIXES.map((a) => [a.stat, a]));

export interface LootBonus { boss?: boolean; magicFind?: number }

/** Pesos (normalizados) de cada rank, F..SSS. Andar, chefes e sorte deslocam para ranks altos. */
export function rankWeights(floor: number, bonus: LootBonus): number[] {
  const b = Math.min(1.2, Math.max(0, floor - 1) * 0.005) + (bonus.boss ? 0.6 : 0) + Math.min(1, bonus.magicFind ?? 0);
  const raw = RANKS.map((r, i) => RANK_INFO[r].baseChance * Math.pow(1 + b, i * 0.75));
  const total = raw.reduce((a, c) => a + c, 0);
  return raw.map((w) => w / total);
}

export function rollRank(rng: Rng, floor: number, bonus: LootBonus, minRank: Rank = 'F'): Rank {
  const w = rankWeights(floor, bonus);
  const start = RANKS.indexOf(minRank);
  return weightedPick(rng, RANKS.slice(start), w.slice(start));
}

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 16);

const tierName = (names: string[], ilvl: number) => names[ilvl < 15 ? 0 : ilvl < 40 ? 1 : 2];

function rollAffixes(rng: Rng, count: number, ilvl: number, rankIdx: number, exclude: StatKey[] = []): Affix[] {
  const pool = AFFIXES.filter((a) => !exclude.includes(a.stat));
  const out: Affix[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const a = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const raw = (a.min + rng() * (a.max - a.min) + a.scale * ilvl) * (1 + rankIdx * 0.08);
    out.push({ stat: a.stat, value: a.pct ? Math.round(raw * 10) / 10 : Math.max(1, Math.round(raw)) });
  }
  return out;
}

export interface RollItemOpts { ilvl: number; rank?: Rank; floor?: number; bonus?: LootBonus; slotType?: ItemSlotType }

export function rollItem(rng: Rng, opts: RollItemOpts): Item {
  const ilvl = Math.max(1, opts.ilvl);
  const rank = opts.rank ?? rollRank(rng, opts.floor ?? ilvl, opts.bonus ?? {});
  const rankIdx = RANKS.indexOf(rank);
  const info = RANK_INFO[rank];
  const mult = info.statMult;
  let unique: (typeof UNIQUES)[number] | undefined;
  if (rank === 'SSS') unique = pick(rng, opts.slotType ? UNIQUES.filter((u) => slotTypeOf(u.slot) === opts.slotType) : UNIQUES) ?? pick(rng, UNIQUES);

  const wantWeapon = unique ? unique.slot === 'weapon' : opts.slotType ? opts.slotType === 'weapon' : rng() < 0.4;
  const item: Item = {
    id: newId(), baseType: '', slotType: 'weapon', name: '', rank, ilvl, refine: 0,
    sockets: info.sockets === 0 ? 0 : randInt(rng, Math.max(0, info.sockets - 1), info.sockets),
    gems: [], affixes: [], durability: 100, value: 0,
  };

  if (wantWeapon) {
    const base = unique?.type ? WEAPONS.find((w) => w.type === unique!.type)! : pick(rng, WEAPONS);
    const scale = (1 + ilvl * 0.12) * mult;
    item.baseType = base.type;
    item.slotType = 'weapon';
    item.dmg = [Math.max(1, Math.round(base.dmg[0] * scale)), Math.max(2, Math.round(base.dmg[1] * scale))];
    item.name = tierName(base.names, ilvl);
  } else {
    const candidates = unique
      ? ARMORS.filter((a) => a.slot === unique!.slot)
      : opts.slotType ? ARMORS.filter((a) => a.slot === opts.slotType) : ARMORS;
    const base = pick(rng, candidates.length ? candidates : ARMORS);
    item.baseType = base.type;
    item.slotType = base.slot as ItemSlotType;
    item.name = tierName(base.names, ilvl);
    const s = (1 + ilvl * 0.11) * mult;
    if (base.armor) item.armor = Math.round(base.armor * s);
    if ('hp' in base && base.hp) item.hp = Math.round(base.hp * s);
    if ('mana' in base && base.mana) item.mana = Math.round(base.mana * s);
    if ('moveSpd' in base && base.moveSpd) item.moveSpd = base.moveSpd;
  }

  item.affixes = rollAffixes(rng, randInt(rng, info.affixes[0], info.affixes[1]), ilvl, rankIdx);
  if (unique) {
    item.unique = unique.effect;
    item.name = unique.name;
  } else if (rankIdx >= 2) {
    item.name = `${item.name} ${pick(rng, itemsData.suffixes)}`;
  }
  item.value = Math.floor((5 + ilvl * 2) * Math.pow(1 + rankIdx, 1.6));
  return item;
}

export const slotTypeOf = (s: string): ItemSlotType => (s === 'ring1' || s === 'ring2' ? 'ring' : (s as ItemSlotType));

export interface LootContext { floor: number; boss: boolean; elite: boolean; magicFind: number; goldFind: number }
export interface LootResult { gold: number; items: Item[]; gems: number }

export function rollMonsterLoot(rng: Rng, ctx: LootContext): LootResult {
  const gold = Math.round((4 + ctx.floor * 2) * (0.6 + rng() * 0.8) * (ctx.elite ? 3 : 1) * (ctx.boss ? 15 : 1) * (1 + ctx.goldFind));
  const bonus: LootBonus = { boss: ctx.boss, magicFind: ctx.magicFind + (ctx.elite ? 0.15 : 0) };
  let n = 0;
  if (ctx.boss) n = 2 + randInt(rng, 0, 2);
  else if (ctx.elite) n = rng() < 0.85 ? 1 + (rng() < 0.3 ? 1 : 0) : 0;
  else n = rng() < 0.24 ? 1 : 0;
  const items: Item[] = [];
  for (let i = 0; i < n; i++) items.push(rollItem(rng, { ilvl: ctx.floor, floor: ctx.floor, bonus }));
  const gems = ctx.boss ? 6 + Math.floor(ctx.floor / 10) * 2 : ctx.elite && rng() < 0.06 ? 1 : 0;
  return { gold, items, gems };
}

/** Baús: mais gold e bônus de raridade; baús secretos garantem gemas. */
export function rollChestLoot(rng: Rng, floor: number, secret: boolean, magicFind: number, goldFind: number): LootResult {
  const gold = Math.round((20 + floor * 6) * (0.7 + rng() * 0.6) * (secret ? 3 : 1) * (1 + goldFind));
  const n = secret ? 3 : 1 + (rng() < 0.4 ? 1 : 0);
  const items: Item[] = [];
  for (let i = 0; i < n; i++) items.push(rollItem(rng, { ilvl: floor, floor, bonus: { magicFind: magicFind + (secret ? 0.5 : 0.15) } }));
  return { gold, items, gems: secret ? randInt(rng, 2, 5) : rng() < 0.1 ? 1 : 0 };
}
