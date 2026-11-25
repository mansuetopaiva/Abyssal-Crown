import type { Element } from './constants';
import type { Rng } from './rng';

export interface AttackInput {
  min: number;
  max: number;
  critChance: number; // 0..1
  critMult: number; // ex.: 1.5
  element: Element;
  multiplier: number; // multiplicador da habilidade
  elementBonus: number; // bônus % do elemento (0.2 = +20%)
  level: number;
  executeBonus?: number; // bônus extra (ex.: Juramento do Carrasco)
}

export interface DefenseInput {
  armor: number;
  level: number;
  res: Partial<Record<Element, number>>; // 0..1
}

export interface DamageResult {
  amount: number;
  crit: boolean;
  element: Element;
}

export const MAX_MITIGATION = 0.75;

/** Fração do dano físico absorvida pela armadura. */
export function armorReduction(armor: number, attackerLevel: number): number {
  if (armor <= 0) return 0;
  return Math.min(MAX_MITIGATION, armor / (armor + 40 + 12 * attackerLevel));
}

export function computeDamage(atk: AttackInput, def: DefenseInput, rng: Rng): DamageResult {
  let dmg = atk.min + rng() * (atk.max - atk.min);
  dmg *= atk.multiplier * (1 + atk.elementBonus) * (1 + (atk.executeBonus ?? 0));
  const crit = rng() < atk.critChance;
  if (crit) dmg *= atk.critMult;
  if (atk.element === 'physical') {
    dmg *= 1 - armorReduction(def.armor, atk.level);
  } else {
    const res = Math.min(MAX_MITIGATION, Math.max(-1, def.res[atk.element] ?? 0));
    dmg *= 1 - res;
  }
  return { amount: Math.max(1, Math.round(dmg)), crit, element: atk.element };
}
