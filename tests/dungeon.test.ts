import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor, encodeTiles, decodeTiles, reachable, T_FLOOR, T_SECRET } from '../shared/dungeon';

test('mesma seed gera o mesmo andar', () => {
  const a = generateFloor(1234, 7);
  const b = generateFloor(1234, 7);
  assert.equal(encodeTiles(a.tiles), encodeTiles(b.tiles));
  assert.deepEqual(a.stairs, b.stairs);
});

test('seeds diferentes geram andares diferentes', () => {
  assert.notEqual(encodeTiles(generateFloor(1, 3).tiles), encodeTiles(generateFloor(2, 3).tiles));
});

test('a escada é sempre alcançável a partir do início (200 andares)', () => {
  for (let f = 1; f <= 200; f++) {
    const m = generateFloor(f * 7919, f);
    const seen = reachable(m, m.start, false);
    assert.ok(seen.has(m.stairs.y * m.w + m.stairs.x), `andar ${f}`);
  }
});

test('codificação compacta faz ida e volta sem perdas e ocupa menos de 12 KB', () => {
  const m = generateFloor(99, 40);
  const enc = encodeTiles(m.tiles);
  assert.deepEqual(Array.from(decodeTiles(enc, m.w * m.h)), Array.from(m.tiles));
  assert.ok(enc.length < 12288, `tamanho ${enc.length}`);
});

test('sala secreta só é acessível pela parede secreta', () => {
  let found = 0;
  for (let s = 1; s <= 80 && found < 5; s++) {
    const m = generateFloor(s, 5);
    const room = m.rooms.find((r) => r.secret);
    if (!room) continue;
    found++;
    const c = { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) };
    assert.equal(m.tiles[c.y * m.w + c.x], T_FLOOR);
    assert.ok(!reachable(m, m.start, false).has(c.y * m.w + c.x), 'não deveria alcançar sem revelar');
    assert.ok(reachable(m, m.start, true).has(c.y * m.w + c.x), 'deveria alcançar revelando');
    assert.ok(m.tiles.includes(T_SECRET));
  }
  assert.ok(found > 0, 'nenhuma sala secreta gerada em 80 seeds');
});

test('andar de chefe tem arena e posição do chefe', () => {
  const m = generateFloor(5, 20);
  assert.ok(m.boss);
  assert.equal(m.spawns.length, 0);
});

test('andares comuns têm baús, armadilhas e monstros', () => {
  const m = generateFloor(42, 12);
  assert.ok(m.objects.some((o) => o.kind === 'chest'));
  assert.ok(m.objects.some((o) => o.kind === 'trap'));
  assert.ok(m.spawns.length > 5);
});
