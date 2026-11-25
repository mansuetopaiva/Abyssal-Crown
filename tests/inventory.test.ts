import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equip, unequip, sortInventory, addToInventory } from '../server/game/inventory';
import { newCharacterData } from '../server/game/character';
import { rollItem } from '../shared/loot';
import { mulberry32 } from '../shared/rng';
import { RANKS } from '../shared/constants';
import { CLASS_BY_ID, barSkills, skillUnlockLevel, validLoadout } from '../shared/stats';
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

test('cada classe tem 8 habilidades + ultimate, liberadas em níveis crescentes', () => {
  for (const cls of Object.values(CLASS_BY_ID)) {
    assert.equal(cls.skills.length, 8, cls.id);
    assert.equal(skillUnlockLevel(cls.skills[0]), 1);
    const levels = cls.skills.map(skillUnlockLevel);
    assert.deepEqual(levels, [...levels].sort((a, b) => a - b), cls.id);
    assert.equal(skillUnlockLevel(cls.ultimate), 15);
  }
});

test('barra de habilidades: aceita 4 diferentes, recusa repetidas ou fora da lista', () => {
  const cls = CLASS_BY_ID.mage;
  assert.deepEqual(validLoadout(cls, [4, 5, 6, 7]), [4, 5, 6, 7]);
  assert.deepEqual(validLoadout(cls, [0, 0, 1, 2]), [0, 1, 2, 3]);
  assert.deepEqual(validLoadout(cls, [0, 1, 2, 99]), [0, 1, 2, 3]);
  assert.equal(barSkills(cls, [7, 6, 5, 4])[0].id, cls.skills[7].id);
  assert.equal(barSkills(cls)[4].id, cls.ultimate.id);
});
