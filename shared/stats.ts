import classesData from './data/classes.json';
import { ATTRS, BASE_MOVE_SPEED, ELEMENTS, SLOTS, type Attr, type Element } from './constants';
import type { Character, Item, Stats } from './types';
import { SOCKET_GEMS, WEAPONS } from './loot';

export type SkillDef = {
  id: string; name: string; desc: string; type: string; mana: number; cd: number; mult?: number; element?: Element;
  radius?: number; range?: number; dist?: number; speed?: number; count?: number; spread?: number; pierce?: number;
  delay?: number; duration?: number; stun?: number; slow?: number; slowDur?: number; poison?: number; poisonDur?: number;
  taunt?: boolean; buff?: Record<string, number>; heal?: number; party?: boolean; drain?: number; guaranteedCrit?: boolean; arc?: number;
  unlock?: number; // nível em que a habilidade é liberada
};
export type TalentDef = { id: string; name: string; desc: string; max: number; stat?: string; skill?: string; per: number };
export type ClassDef = {
  id: string; name: string; desc: string; palette: string[]; primary: Attr; startWeapon: string; startOffhand?: string;
  base: Record<Attr, number>; growth: Record<Attr, number>; skills: SkillDef[]; ultimate: SkillDef; talents: TalentDef[];
};

export const CLASSES = classesData as unknown as ClassDef[];
export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
export const allSkills = (c: ClassDef) => [...c.skills, c.ultimate];
export const skillUnlockLevel = (s: SkillDef) => s.unlock ?? 1;

/** Barra de habilidades: 4 escolhidas pelo jogador (entre as 8 da classe) + ultimate. */
export const DEFAULT_LOADOUT = [0, 1, 2, 3];
export function validLoadout(cls: ClassDef, lo?: unknown): number[] {
  if (!Array.isArray(lo) || lo.length !== 4) return DEFAULT_LOADOUT;
  const ok = lo.every((i) => Number.isInteger(i) && i >= 0 && i < cls.skills.length) && new Set(lo).size === 4;
  return ok ? (lo as number[]) : DEFAULT_LOADOUT;
}
export function barSkills(cls: ClassDef, loadout?: unknown): SkillDef[] {
  return [...validLoadout(cls, loadout).map((i) => cls.skills[i]), cls.ultimate];
}

/** Efeitos de itens SSS que são só modificadores de atributos. */
const UNIQUE_STATS: Record<string, { add?: Record<string, number>; hpMult?: number; manaMult?: number; armorMult?: number; dr?: number; bossDmg?: number }> = {
  bloodPact: { add: { lifesteal: 12 }, hpMult: 0.9 },
  glassCannon: { add: { dmgPct: 45 }, armorMult: 0.7 },
  quickening: { add: { atkSpd: 25, moveSpd: 10 } },
  arcanist: { add: { cdr: 20 }, manaMult: 1.3 },
  colossus: { add: { moveSpd: -10 }, hpMult: 1.4 },
  fortune: { add: { goldFind: 150, magicFind: 40 } },
  bulwark: { dr: 0.15 },
  giantSlayer: { bossDmg: 0.6 },
};

const RES_KEY: Record<Element, string> = {
  physical: '', fire: 'resFire', ice: 'resIce', lightning: 'resLightning', shadow: 'resShadow', holy: 'resHoly',
};
const DMG_KEY: Record<Element, string> = {
  physical: '', fire: 'fireDmg', ice: 'iceDmg', lightning: 'lightningDmg', shadow: 'shadowDmg', holy: 'holyDmg',
};

/** Multiplicador de qualidade do item (refino e durabilidade). */
export const itemQuality = (it: Item) => (1 + it.refine * 0.06) * (it.durability <= 0 ? 0.5 : 1);

/** Soma todos os bônus de um item (base refinada, afixos e gemas engastadas). */
export function itemBonuses(it: Item): Record<string, number> {
  const q = itemQuality(it);
  const out: Record<string, number> = {};
  const add = (k: string, v: number) => (out[k] = (out[k] ?? 0) + v);
  if (it.armor) add('armor', it.armor * q);
  if (it.hp) add('hp', it.hp * q);
  if (it.mana) add('mana', it.mana * q);
  if (it.moveSpd) add('moveSpd', it.moveSpd * 100);
  if (it.thorns) add('thorns', it.thorns * q);
  for (const a of it.affixes) add(a.stat, a.value * (it.durability <= 0 ? 0.5 : 1));
  for (const g of it.gems) {
    const def = SOCKET_GEMS.find((s) => s.id === g.id);
    if (def) add(def.stat, def.perTier * g.tier);
  }
  return out;
}

export function talentBonuses(cls: ClassDef, talents: Record<string, number>) {
  const stats: Record<string, number> = {};
  const skillDmg: Record<string, number> = {};
  for (const t of cls.talents) {
    const r = Math.min(t.max, talents[t.id] ?? 0);
    if (!r) continue;
    if (t.skill) skillDmg[t.skill] = (skillDmg[t.skill] ?? 0) + t.per * r;
    else if (t.stat) stats[t.stat] = (stats[t.stat] ?? 0) + t.per * r;
  }
  return { stats, skillDmg };
}

export function computeStats(ch: Pick<Character, 'classId' | 'level'> & { data: Pick<Character['data'], 'equipment' | 'talents'> }): Stats {
  const cls = CLASS_BY_ID[ch.classId] ?? CLASSES[0];
  const b: Record<string, number> = {};
  const add = (k: string, v: number) => (b[k] = (b[k] ?? 0) + v);
  const uniques: string[] = [];
  for (const slot of SLOTS) {
    const it = ch.data.equipment[slot];
    if (!it) continue;
    for (const [k, v] of Object.entries(itemBonuses(it))) add(k, v);
    if (it.unique) uniques.push(it.unique);
  }
  const tal = talentBonuses(cls, ch.data.talents);
  for (const [k, v] of Object.entries(tal.stats)) add(k, v);
  if (b.allRes) for (const e of ELEMENTS) if (RES_KEY[e]) add(RES_KEY[e], b.allRes);
  let hpMult = 1, manaMult = 1, armorMult = 1, dr = 0, bossDmg = 0;
  for (const u of uniques) {
    const fx = UNIQUE_STATS[u];
    if (!fx) continue;
    for (const [k, v] of Object.entries(fx.add ?? {})) add(k, v);
    hpMult *= fx.hpMult ?? 1; manaMult *= fx.manaMult ?? 1; armorMult *= fx.armorMult ?? 1;
    dr += fx.dr ?? 0; bossDmg += fx.bossDmg ?? 0;
  }

  const attrs = {} as Record<Attr, number>;
  for (const a of ATTRS) attrs[a] = Math.round(cls.base[a] + cls.growth[a] * (ch.level - 1) + (b[a] ?? 0));

  const weaponItem = ch.data.equipment.weapon;
  const wdef = WEAPONS.find((w) => w.type === (weaponItem?.baseType ?? '')) ;
  const q = weaponItem ? itemQuality(weaponItem) : 1;
  const flat = b.flatDmg ?? 0;
  const [wmin, wmax] = weaponItem?.dmg ?? [2, 4];
  const primary = attrs[cls.primary];
  const dmgPct = primary * 0.012 + (b.dmgPct ?? 0) / 100;

  const maxHp = Math.round((60 + attrs.vit * 9 + ch.level * 6 + (b.hp ?? 0)) * hpMult);
  const maxMana = Math.round((30 + attrs.int * 5 + ch.level * 2 + (b.mana ?? 0)) * manaMult);
  const res = {} as Record<Element, number>;
  const elemBonus = {} as Record<Element, number>;
  for (const e of ELEMENTS) {
    res[e] = RES_KEY[e] ? Math.min(0.75, (b[RES_KEY[e]] ?? 0) / 100) : 0;
    elemBonus[e] = DMG_KEY[e] ? (b[DMG_KEY[e]] ?? 0) / 100 : 0;
  }
  if (uniques.includes('windwalk')) add('moveSpd', 30);

  return {
    maxHp, maxMana,
    armor: Math.round(((b.armor ?? 0) + attrs.str * 0.5) * armorMult),
    minDmg: Math.max(1, Math.round(wmin * q + flat)),
    maxDmg: Math.max(2, Math.round(wmax * q + flat)),
    dmgPct,
    crit: Math.min(0.75, 0.05 + attrs.agi * 0.0015 + attrs.luk * 0.001 + (b.crit ?? 0) / 100),
    critMult: 1.5 + (b.critDmg ?? 0) / 100,
    atkSpd: (wdef?.atkSpd ?? 1.4) * (1 + (b.atkSpd ?? 0) / 100 + attrs.agi * 0.002),
    moveSpeed: BASE_MOVE_SPEED * Math.min(1.8, 1 + (b.moveSpd ?? 0) / 100),
    lifesteal: Math.min(0.3, (b.lifesteal ?? 0) / 100),
    res, elemBonus,
    goldFind: (b.goldFind ?? 0) / 100 + attrs.luk * 0.005 + (uniques.includes('goldenTouch') ? 1 : 0),
    magicFind: (b.magicFind ?? 0) / 100 + attrs.luk * 0.002,
    cdr: Math.min(0.4, (b.cdr ?? 0) / 100),
    hpRegen: maxHp * 0.008 + attrs.vit * 0.05 + (b.hpRegen ?? 0),
    manaRegen: maxMana * 0.025 + (b.manaRegen ?? 0),
    dodge: Math.min(0.5, (b.dodge ?? 0) / 100 + (uniques.includes('windwalk') ? 0.15 : 0)),
    thorns: (b.thorns ?? 0) / 100 + (uniques.includes('thorns') ? 0.6 : 0),
    xpBonus: (b.xpBonus ?? 0) / 100,
    dr, bossDmg,
    attrs, uniques,
    weapon: {
      type: wdef?.type ?? 'fist',
      attack: (wdef?.attack ?? 'melee') as Stats['weapon']['attack'],
      range: wdef?.range ?? 16,
      arc: (wdef as { arc?: number } | undefined)?.arc ?? 1.4,
      projSpeed: (wdef as { projSpeed?: number } | undefined)?.projSpeed ?? 220,
      element: (wdef?.element ?? 'physical') as Element,
    },
  };
}

/** Valor "de poder" aproximado de um item, usado para comparação rápida. */
export function itemPower(it: Item): number {
  const q = itemQuality(it);
  let p = 0;
  if (it.dmg) p += ((it.dmg[0] + it.dmg[1]) / 2) * q * 3;
  p += (it.armor ?? 0) * q + (it.hp ?? 0) * q * 0.4 + (it.mana ?? 0) * q * 0.3;
  p += it.affixes.length * (6 + it.ilvl * 0.5);
  if (it.unique) p += 50 + it.ilvl * 2;
  return Math.round(p);
}
