import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDamage, armorReduction, type AttackInput, type DefenseInput } from '../shared/combat';

const fixed = (v: number) => () => v;

const baseAtk = (o: Partial<AttackInput> = {}): AttackInput => ({
  min: 10, max: 20, critChance: 0, critMult: 1.5, element: 'physical', multiplier: 1, elementBonus: 0, level: 1, ...o,
});
const noDef = (o: Partial<DefenseInput> = {}): DefenseInput => ({ armor: 0, level: 1, res: {}, ...o });

test('dano sem crítico fica entre mínimo e máximo, interpolado pelo rng', () => {
  assert.equal(computeDamage(baseAtk(), noDef(), fixed(0)).amount, 10);
  assert.equal(computeDamage(baseAtk(), noDef(), fixed(0.5)).amount, 15);
});

test('crítico multiplica o dano e é sinalizado', () => {
  const r = computeDamage(baseAtk({ critChance: 1, critMult: 2 }), noDef(), fixed(0));
  assert.equal(r.crit, true);
  assert.equal(r.amount, 20);
});

test('multiplicador da habilidade e bônus elemental se somam corretamente', () => {
  const r = computeDamage(baseAtk({ multiplier: 2, element: 'fire', elementBonus: 0.5 }), noDef(), fixed(0));
  assert.equal(r.amount, 30); // 10 * 2 * 1.5
  assert.equal(r.element, 'fire');
});

test('armadura reduz apenas dano físico', () => {
  const def = noDef({ armor: 100 });
  const phys = computeDamage(baseAtk(), def, fixed(0)).amount;
  const fire = computeDamage(baseAtk({ element: 'fire' }), def, fixed(0)).amount;
  assert.ok(phys < 10);
  assert.equal(fire, 10);
});

test('redução por armadura nunca passa de 75%', () => {
  assert.ok(armorReduction(1e9, 1) <= 0.75);
  assert.equal(armorReduction(0, 1), 0);
});

test('resistência elemental reduz e é limitada a 75%', () => {
  const half = computeDamage(baseAtk({ min: 100, max: 100, element: 'ice' }), noDef({ res: { ice: 0.5 } }), fixed(0));
  assert.equal(half.amount, 50);
  const capped = computeDamage(baseAtk({ min: 100, max: 100, element: 'ice' }), noDef({ res: { ice: 2 } }), fixed(0));
  assert.equal(capped.amount, 25);
});

test('dano mínimo é sempre 1', () => {
  const r = computeDamage(baseAtk({ min: 0, max: 0 }), noDef(), fixed(0));
  assert.equal(r.amount, 1);
});

test('bônus de execução se aplica', () => {
  const r = computeDamage(baseAtk({ executeBonus: 1 }), noDef(), fixed(0));
  assert.equal(r.amount, 20);
});
