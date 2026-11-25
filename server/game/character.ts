import { BASE_INV_SLOTS, MAX_LEVEL, xpForLevel } from '../../shared/constants';
import { rollItem, WEAPONS, ARMORS } from '../../shared/loot';
import { mulberry32 } from '../../shared/rng';
import { CLASS_BY_ID } from '../../shared/stats';
import type { Character, CharacterData, Item } from '../../shared/types';

export const today = () => new Date().toISOString().slice(0, 10);

function starter(slotType: Item['slotType'], baseType: string): Item {
  const it = rollItem(mulberry32(Date.now() & 0xffff), { ilvl: 1, rank: 'F', slotType });
  const w = WEAPONS.find((x) => x.type === baseType);
  if (w) {
    it.baseType = w.type; it.name = w.names[0]; it.dmg = [w.dmg[0], w.dmg[1]];
  } else {
    const a = ARMORS.find((x) => x.type === baseType);
    if (a) { it.baseType = a.type; it.name = a.names[0]; it.armor = a.armor; it.hp = 'hp' in a ? a.hp : undefined; it.mana = 'mana' in a ? a.mana : undefined; }
  }
  it.affixes = [];
  it.value = 2;
  return it;
}

export function newCharacterData(classId: string): CharacterData {
  const cls = CLASS_BY_ID[classId];
  // roupa inicial combina com a classe: placas (guerreiro/clérigo), couro (arqueiro/ladino), manto (mago/necromante)
  const armorType = ['mage', 'necro'].includes(classId) ? 'robe' : ['archer', 'rogue'].includes(classId) ? 'leather' : 'armor';
  const equipment: CharacterData['equipment'] = { weapon: starter('weapon', cls.startWeapon), armor: starter('armor', armorType) };
  if (cls.startOffhand) equipment.offhand = starter('offhand', cls.startOffhand);
  return {
    inventory: Array(BASE_INV_SLOTS).fill(null),
    equipment,
    talents: {},
    consumables: { hpPotion: 5, manaPotion: 3 },
    socketGems: {},
    stats: { kills: 0, bossKills: 0, chestsOpened: 0, deaths: 0, bestRank: -1, bestItem: '' },
    achievements: [],
    daily: { date: today(), kills: 0, chests: 0, floors: 0, claimed: [] },
    cosmetics: [],
    cosmetic: '',
    invSlots: BASE_INV_SLOTS,
  };
}

export const talentPointsTotal = (level: number) => level - 1;
export const talentPointsSpent = (c: Character) => Object.values(c.data.talents).reduce((a, b) => a + b, 0);

/** Aplica XP; retorna quantos níveis subiu. */
export function grantXp(c: Character, amount: number): number {
  let ups = 0;
  if (c.level >= MAX_LEVEL) return 0;
  c.xp += Math.max(0, Math.round(amount));
  while (c.level < MAX_LEVEL && c.xp >= xpForLevel(c.level)) {
    c.xp -= xpForLevel(c.level);
    c.level++;
    ups++;
  }
  return ups;
}

// ---------- missões diárias ----------
export const DAILIES = [
  { id: 'kills', name: 'Abata 60 monstros', key: 'kills' as const, goal: 60, gems: 5 },
  { id: 'chests', name: 'Abra 4 baús', key: 'chests' as const, goal: 4, gems: 4 },
  { id: 'floors', name: 'Desça 8 andares', key: 'floors' as const, goal: 8, gems: 6 },
];
export function ensureDaily(c: Character) {
  if (c.data.daily.date !== today()) c.data.daily = { date: today(), kills: 0, chests: 0, floors: 0, claimed: [] };
}

// ---------- conquistas ----------
export const ACHIEVEMENTS = [
  { id: 'floor10', name: 'Desbravador', desc: 'Alcance o andar 10', gems: 10, check: (c: Character) => c.maxFloor >= 10 },
  { id: 'floor25', name: 'Mergulhador', desc: 'Alcance o andar 25', gems: 20, check: (c: Character) => c.maxFloor >= 25 },
  { id: 'floor50', name: 'Abissal', desc: 'Alcance o andar 50', gems: 40, check: (c: Character) => c.maxFloor >= 50 },
  { id: 'floor100', name: 'Coroado', desc: 'Alcance o andar 100', gems: 100, check: (c: Character) => c.maxFloor >= 100 },
  { id: 'boss1', name: 'Matador de Chefes', desc: 'Derrote um chefe', gems: 10, check: (c: Character) => c.data.stats.bossKills >= 1 },
  { id: 'boss10', name: 'Lenda', desc: 'Derrote 10 chefes', gems: 50, check: (c: Character) => c.data.stats.bossKills >= 10 },
  { id: 'kills500', name: 'Ceifador', desc: 'Abata 500 monstros', gems: 15, check: (c: Character) => c.data.stats.kills >= 500 },
  { id: 'rankS', name: 'Sortudo', desc: 'Encontre um item rank S', gems: 15, check: (c: Character) => c.data.stats.bestRank >= 6 },
  { id: 'rankSSS', name: 'Escolhido do Abismo', desc: 'Encontre um item SSS', gems: 100, check: (c: Character) => c.data.stats.bestRank >= 8 },
  { id: 'level20', name: 'Veterano', desc: 'Chegue ao nível 20', gems: 15, check: (c: Character) => c.level >= 20 },
];

/** Concede conquistas novas; retorna as concedidas. */
export function checkAchievements(c: Character) {
  const got = [];
  for (const a of ACHIEVEMENTS) {
    if (!c.data.achievements.includes(a.id) && a.check(c)) {
      c.data.achievements.push(a.id);
      c.gems += a.gems;
      got.push(a);
    }
  }
  return got;
}

/** Garante campos novos em personagens antigos (migração leve do JSON). */
export function migrateData(c: Character) {
  const d = c.data;
  d.invSlots ??= BASE_INV_SLOTS;
  while (d.inventory.length < d.invSlots) d.inventory.push(null);
  d.socketGems ??= {};
  d.cosmetics ??= [];
  d.cosmetic ??= '';
  d.achievements ??= [];
  d.loadout ??= [0, 1, 2, 3];
  ensureDaily(c);
}

/** Visão pública e segura do personagem enviada ao cliente. */
export function publicChar(c: Character) {
  return { id: c.id, name: c.name, classId: c.classId, level: c.level, xp: c.xp, gold: c.gold, gems: c.gems, maxFloor: c.maxFloor, checkpoint: c.checkpoint, data: c.data };
}
