import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equip, unequip, sortInventory, addToInventory } from '../server/game/inventory';
import { newCharacterData } from '../server/game/character';
import { rollItem } from '../shared/loot';
import { mulberry32 } from '../shared/rng';
import { RANKS, SKILL_UNLOCK_LEVELS, skillUnlocked } from '../shared/constants';
import type { Character } from '../shared/types';

const mkChar = (): Character => ({ id: 1, userId: 1, name: 'T', classId: 'warrior', level: 1, xp: 0, gold: 0, gems: 0, maxFloor: 0, checkpoint: 1, data: newCharacterData('warrior') });

test('inventário fica ordenado do rank mais alto para o mais baixo, sem buracos', () => {
  const c = mkChar();
  const rng = mulberry32(5);
  for (const r of ['F', 'S', 'C', 'F', 'A', 'E'] as const) addToInventory(c, rollItem(rng, { ilvl: 5, rank: r }));
  c.data.inventory[1] = null; // cria um buraco
  sortInventory(c);
  const ranks = c.data.inventory.filter(Boolean).map((i) => RANKS.indexOf(i!.rank));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
  assert.ok(c.data.inventory.slice(0, ranks.length).every(Boolean));
});

test('equipar troca o item equipado de lugar com o do inventário', () => {
  const c = mkChar();
  const sword = rollItem(mulberry32(1), { ilvl: 5, rank: 'B', slotType: 'weapon' });
  addToInventory(c, sword);
  const old = c.data.equipment.weapon!;
  assert.ok(equip(c, 0).ok);
  assert.equal(c.data.equipment.weapon!.id, sword.id);
  assert.equal(c.data.inventory[0]!.id, old.id);
});

test('desequipar com inventário cheio é recusado e não perde o item', () => {
  const c = mkChar();
  const rng = mulberry32(2);
  for (let i = 0; i < c.data.invSlots; i++) addToInventory(c, rollItem(rng, { ilvl: 1, rank: 'F' }));
  const r = unequip(c, 'weapon');
  assert.equal(r.ok, false);
  assert.ok(c.data.equipment.weapon);
});

test('arma de duas mãos move o escudo para o inventário', () => {
  const c = mkChar();
  const shield = rollItem(mulberry32(3), { ilvl: 1, rank: 'F', slotType: 'offhand' });
  c.data.equipment.offhand = shield;
  const bow = rollItem(mulberry32(4), { ilvl: 1, rank: 'F', slotType: 'weapon' });
  bow.baseType = 'bow';
  addToInventory(c, bow);
  assert.ok(equip(c, 0).ok);
  assert.equal(c.data.equipment.offhand, undefined);
  assert.ok(c.data.inventory.some((i) => i?.id === shield.id));
});

test('habilidades são liberadas conforme o nível', () => {
  assert.equal(skillUnlocked(1, 0), true);
  assert.equal(skillUnlocked(1, 1), false);
  assert.equal(skillUnlocked(SKILL_UNLOCK_LEVELS[4] - 1, 4), false);
  assert.equal(skillUnlocked(SKILL_UNLOCK_LEVELS[4], 4), true);
});
