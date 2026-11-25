import { RANKS, SLOTS, type Slot } from '../../shared/constants';
import { WEAPONS, slotTypeOf } from '../../shared/loot';
import { itemPower } from '../../shared/stats';
import type { Character, Item } from '../../shared/types';

export type Result = { ok: true; msg?: string } | { ok: false; msg: string };
const fail = (msg: string): Result => ({ ok: false, msg });
const ok = (msg?: string): Result => ({ ok: true, msg });

export function freeSlot(c: Character): number {
  for (let i = 0; i < c.data.invSlots; i++) if (!c.data.inventory[i]) return i;
  return -1;
}

export function addToInventory(c: Character, it: Item): boolean {
  const i = freeSlot(c);
  if (i < 0) return false;
  c.data.inventory[i] = it;
  return true;
}

export const validIndex = (c: Character, i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < c.data.invSlots;
export const isSlot = (s: unknown): s is Slot => typeof s === 'string' && (SLOTS as readonly string[]).includes(s);
const isTwoHanded = (it?: Item) => !!it && it.slotType === 'weapon' && !!WEAPONS.find((w) => w.type === it.baseType)?.twoHanded;

export function equip(c: Character, idx: number, prefer?: Slot): Result {
  if (!validIndex(c, idx)) return fail('Item inválido.');
  const it = c.data.inventory[idx];
  if (!it) return fail('Item inválido.');
  const eq = c.data.equipment;
  let slot: Slot;
  if (it.slotType === 'ring') slot = prefer === 'ring1' || prefer === 'ring2' ? prefer : !eq.ring1 ? 'ring1' : !eq.ring2 ? 'ring2' : 'ring1';
  else slot = it.slotType as Slot;
  if (slot === 'offhand' && isTwoHanded(eq.weapon)) return fail('Sua arma é de duas mãos.');
  if (slot === 'weapon' && isTwoHanded(it) && eq.offhand) {
    const f = freeSlot(c);
    if (f < 0 || f === idx) {
      // a própria posição do item vai receber a arma antiga; precisamos de outra vaga para a secundária
      const others = c.data.inventory.findIndex((x, i) => !x && i !== idx && i < c.data.invSlots);
      if (others < 0) return fail('Libere espaço no inventário para a arma secundária.');
      c.data.inventory[others] = eq.offhand;
    } else c.data.inventory[f] = eq.offhand;
    delete eq.offhand;
  }
  const old = eq[slot];
  eq[slot] = it;
  c.data.inventory[idx] = old ?? null;
  return ok();
}

export function unequip(c: Character, slot: Slot): Result {
  const it = c.data.equipment[slot];
  if (!it) return fail('Nada equipado.');
  if (!addToInventory(c, it)) return fail('Inventário cheio.');
  delete c.data.equipment[slot];
  return ok();
}

export function sortInventory(c: Character) {
  const items = c.data.inventory.slice(0, c.data.invSlots).filter(Boolean) as Item[];
  items.sort((a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank) || itemPower(b) - itemPower(a));
  c.data.inventory = Array.from({ length: c.data.invSlots }, (_, i) => items[i] ?? null);
}

export const sellPrice = (it: Item) => Math.floor(it.value * (1 + it.refine * 0.15));

/** Localiza um item no inventário (inv:N) ou equipado (eq:slot). */
export function locate(c: Character, ref: unknown): Item | null {
  if (typeof ref !== 'string') return null;
  const [kind, v] = ref.split(':');
  if (kind === 'inv') { const i = Number(v); return validIndex(c, i) ? c.data.inventory[i] ?? null : null; }
  if (kind === 'eq' && isSlot(v)) return c.data.equipment[v] ?? null;
  return null;
}

export { slotTypeOf };
