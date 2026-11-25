import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankWeights, rollRank, rollItem, rollMonsterLoot } from '../shared/loot';
import { RANKS, RANK_INFO } from '../shared/constants';
import { mulberry32 } from '../shared/rng';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const highShare = (w: number[]) => sum(w.slice(RANKS.indexOf('A'))) / sum(w);

test('no andar 1 sem bônus, as chances são exatamente a tabela base', () => {
  const w = rankWeights(1, {});
  RANKS.forEach((r, i) => assert.ok(Math.abs(w[i] - RANK_INFO[r].baseChance) < 1e-9, r));
  assert.ok(Math.abs(sum(w) - 1) < 1e-9);
});

test('a tabela base soma 100%', () => {
  assert.ok(Math.abs(sum(RANKS.map((r) => RANK_INFO[r].baseChance)) - 1) < 1e-9);
});

test('andares mais profundos aumentam a chance de ranks altos', () => {
  assert.ok(highShare(rankWeights(50, {})) > highShare(rankWeights(1, {})));
  assert.ok(highShare(rankWeights(200, {})) > highShare(rankWeights(50, {})));
});

test('chefes aumentam a chance de ranks altos no mesmo andar', () => {
  assert.ok(highShare(rankWeights(10, { boss: true })) > highShare(rankWeights(10, {})));
});

test('distribuição sorteada bate com a tabela (Monte Carlo, andar 1)', () => {
  const rng = mulberry32(42);
  const counts: Record<string, number> = {};
  const N = 200_000;
  for (let i = 0; i < N; i++) {
    const r = rollRank(rng, 1, {});
    counts[r] = (counts[r] ?? 0) + 1;
  }
  for (const r of ['F', 'E', 'D', 'C', 'B'] as const) {
    const p = counts[r] / N;
    assert.ok(Math.abs(p - RANK_INFO[r].baseChance) < 0.006, `${r}: ${p}`);
  }
});

test('quantidade de atributos aleatórios respeita o rank', () => {
  const rng = mulberry32(7);
  for (const rank of RANKS) {
    for (let i = 0; i < 30; i++) {
      const item = rollItem(rng, { ilvl: 20, rank });
      const [min, max] = RANK_INFO[rank].affixes;
      assert.ok(item.affixes.length >= min && item.affixes.length <= max, `${rank}: ${item.affixes.length}`);
    }
  }
});

test('itens SSS têm nome único, 6 atributos e efeito lendário', () => {
  const item = rollItem(mulberry32(3), { ilvl: 50, rank: 'SSS' });
  assert.equal(item.affixes.length, 6);
  assert.ok(item.unique, 'deve ter efeito único');
  assert.ok(item.name.length > 0);
});

test('atributos de um mesmo item não se repetem', () => {
  const item = rollItem(mulberry32(9), { ilvl: 30, rank: 'SS' });
  const stats = item.affixes.map((a) => a.stat);
  assert.equal(new Set(stats).size, stats.length);
});

test('drops de monstro são determinísticos para a mesma seed', () => {
  const a = rollMonsterLoot(mulberry32(99), { floor: 12, boss: false, elite: true, magicFind: 0, goldFind: 0 });
  const b = rollMonsterLoot(mulberry32(99), { floor: 12, boss: false, elite: true, magicFind: 0, goldFind: 0 });
  assert.deepEqual(
    a.items.map((i) => [i.rank, i.baseType]),
    b.items.map((i) => [i.rank, i.baseType]),
  );
  assert.equal(a.gold, b.gold);
});

test('chefes sempre dão gemas e pelo menos 2 itens', () => {
  const l = rollMonsterLoot(mulberry32(1), { floor: 10, boss: true, elite: false, magicFind: 0, goldFind: 0 });
  assert.ok(l.gems > 0);
  assert.ok(l.items.length >= 2);
});
