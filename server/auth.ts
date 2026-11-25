import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Formato: scrypt$N$r$p$salt(b64)$hash(b64) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const key = await scrypt(password, salt, N, r, p, keylen);
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, N, r, p, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt' || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64');
    const key = await scrypt(password, Buffer.from(saltB64, 'base64'), +N, +r, +p, expected.length);
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Hash "fantasma" para equalizar o tempo de resposta quando o usuário não existe. */
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= hashPassword('dummy-password-para-tempo-constante'));

// ---------- JWT HS256 ----------
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface JwtPayload { sub: number; name?: string; rem?: boolean; exp?: number; iat?: number }

export function signJwt(payload: Omit<JwtPayload, 'exp' | 'iat'>, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (h.alg !== 'HS256') return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtPayload;
    if (typeof p.sub !== 'number' || !p.exp || p.exp <= Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

// ---------- Validação ----------
export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const CHARNAME_RE = /^[A-Za-zÀ-ÿ0-9_]{3,16}$/;

export function validateRegistration(b: { username?: unknown; email?: unknown; password?: unknown }): string | null {
  if (typeof b.username !== 'string' || !USERNAME_RE.test(b.username))
    return 'Nome de usuário deve ter 3 a 20 caracteres (letras, números ou _).';
  if (typeof b.email !== 'string' || b.email.length > 254 || !EMAIL_RE.test(b.email)) return 'Informe um e-mail válido.';
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 128)
    return 'A senha deve ter entre 8 e 128 caracteres.';
  if (!/[a-zA-Z]/.test(b.password) || !/[0-9]/.test(b.password)) return 'A senha deve conter letras e números.';
  return null;
}
