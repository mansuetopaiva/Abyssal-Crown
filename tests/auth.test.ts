import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signJwt, verifyJwt, validateRegistration } from '../server/auth';

const SECRET = 'segredo-de-teste-com-tamanho-suficiente';

test('hash de senha verifica a senha correta', async () => {
  const h = await hashPassword('Senha#Forte1');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await verifyPassword('Senha#Forte1', h), true);
});

test('hash de senha rejeita senha errada', async () => {
  const h = await hashPassword('Senha#Forte1');
  assert.equal(await verifyPassword('senha#forte1', h), false);
});

test('dois hashes da mesma senha são diferentes (sal aleatório)', async () => {
  assert.notEqual(await hashPassword('abc12345'), await hashPassword('abc12345'));
});

test('hash malformado não quebra, apenas falha', async () => {
  assert.equal(await verifyPassword('x', 'lixo'), false);
});

test('JWT válido é aceito e devolve o payload', () => {
  const t = signJwt({ sub: 7, name: 'ana' }, SECRET, 60);
  const p = verifyJwt(t, SECRET);
  assert.equal(p?.sub, 7);
});

test('JWT adulterado é rejeitado', () => {
  const t = signJwt({ sub: 7 }, SECRET, 60);
  const [h, , s] = t.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 1, exp: 9e12 })).toString('base64url')}.${s}`;
  assert.equal(verifyJwt(forged, SECRET), null);
});

test('JWT com outro segredo é rejeitado', () => {
  assert.equal(verifyJwt(signJwt({ sub: 7 }, SECRET, 60), 'outro-segredo-qualquer-123456'), null);
});

test('JWT expirado é rejeitado', () => {
  assert.equal(verifyJwt(signJwt({ sub: 7 }, SECRET, -1), SECRET), null);
});

test('validação de cadastro aponta erros claros', () => {
  assert.match(validateRegistration({ username: 'a', email: 'x@y.com', password: '12345678' }) ?? '', /usuário/i);
  assert.match(validateRegistration({ username: 'jogador', email: 'invalido', password: '12345678' }) ?? '', /e-mail/i);
  assert.match(validateRegistration({ username: 'jogador', email: 'x@y.com', password: '123' }) ?? '', /senha/i);
  assert.equal(validateRegistration({ username: 'jogador_1', email: 'x@y.com', password: 'abcd1234' }), null);
});
