import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { CHARNAME_RE, getDummyHash, hashPassword, signJwt, validateRegistration, verifyJwt, verifyPassword } from './auth';
import type { Repo } from './db';
import { MAX_CHARACTERS } from '../shared/constants';
import { CLASS_BY_ID } from '../shared/stats';
import { newCharacterData, publicChar } from './game/character';

export interface HttpConfig {
  secret: string;
  prod: boolean;
  crossSite: boolean; // cliente em outro domínio (ex.: Vercel) → SameSite=None
  allowedOrigins: string[];
  clientDir: string;
  sessionTtl: number;
}

export const COOKIE = 'ac_session';

// ---------- rate limit (janela deslizante, em memória) ----------
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {
    setInterval(() => this.sweep(), 60_000).unref();
  }
  /** true = permitido */
  take(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

export function clientIp(req: IncomingMessage): string {
  // Atrás de proxy confiável (Railway/Render/Fly), use TRUST_PROXY=1.
  if (process.env.TRUST_PROXY === '1') {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string') return xf.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '?';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function userFromRequest(req: IncomingMessage, secret: string): number | null {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  return verifyJwt(token, secret)?.sub ?? null;
}

export function originAllowed(req: IncomingMessage, cfg: HttpConfig): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // mesma origem (navegação) ou cliente não-navegador
  const host = req.headers.host;
  try {
    const u = new URL(origin);
    if (u.host === host) return true;
  } catch { return false; }
  return cfg.allowedOrigins.includes(origin);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.map': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function securityHeaders(res: ServerResponse, prod: boolean) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  if (prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<Record<string, unknown>> {
  const ct = req.headers['content-type'] ?? '';
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'Envie JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Requisição grande demais.');
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

export function createHttpHandler(repo: Repo, cfg: HttpConfig, hooks: { onCharacterDeleted?: (id: number) => boolean }) {
  const authLimiter = new RateLimiter(10, 5 * 60_000);
  const apiLimiter = new RateLimiter(120, 60_000);
  const clientRoot = resolve(cfg.clientDir);

  const cookie = (token: string, maxAge: number) => {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAge}`];
    if (cfg.crossSite) parts.push('SameSite=None', 'Secure');
    else { parts.push('SameSite=Lax'); if (cfg.prod) parts.push('Secure'); }
    return parts.join('; ');
  };

  const requireUser = (req: IncomingMessage) => {
    const uid = userFromRequest(req, cfg.secret);
    if (!uid || !repo.getUser(uid)) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
    return uid;
  };

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const ip = clientIp(req);
    const method = req.method ?? 'GET';
    if (method !== 'GET' && !originAllowed(req, cfg)) throw new HttpError(403, 'Origem não permitida.');
    if (!apiLimiter.take(ip)) throw new HttpError(429, 'Muitas requisições. Aguarde um pouco.');

    if (path === '/api/health') return send(res, 200, { ok: true });

    if (path === '/api/register' && method === 'POST') {
      if (!authLimiter.take(`auth:${ip}`)) throw new HttpError(429, 'Muitas tentativas. Tente de novo em alguns minutos.');
      const b = await readJson(req);
      const err = validateRegistration(b);
      if (err) throw new HttpError(400, err);
      const username = String(b.username), email = String(b.email).toLowerCase();
      const exists = repo.userExists(username, email);
      if (exists.username) throw new HttpError(409, 'Este nome de usuário já está em uso.');
      if (exists.email) throw new HttpError(409, 'Este e-mail já está cadastrado.');
      const id = repo.createUser(username, email, await hashPassword(String(b.password)));
      res.setHeader('Set-Cookie', cookie(signJwt({ sub: id, name: username }, cfg.secret, cfg.sessionTtl), cfg.sessionTtl));
      return send(res, 201, { user: { id, username } });
    }

    if (path === '/api/login' && method === 'POST') {
      const b = await readJson(req);
      const login = typeof b.login === 'string' ? b.login.trim().slice(0, 254) : '';
      const password = typeof b.password === 'string' ? b.password.slice(0, 128) : '';
      if (!authLimiter.take(`auth:${ip}`) || !authLimiter.take(`login:${login.toLowerCase()}`))
        throw new HttpError(429, 'Muitas tentativas. Tente de novo em alguns minutos.');
      if (!login || !password) throw new HttpError(400, 'Informe usuário/e-mail e senha.');
      const user = repo.findUserByLogin(login);
      const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
      if (!user || !ok) throw new HttpError(401, 'Usuário ou senha incorretos.');
      res.setHeader('Set-Cookie', cookie(signJwt({ sub: user.id, name: user.username }, cfg.secret, cfg.sessionTtl), cfg.sessionTtl));
      return send(res, 200, { user: { id: user.id, username: user.username } });
    }

    if (path === '/api/logout' && method === 'POST') {
      res.setHeader('Set-Cookie', cookie('', 0));
      return send(res, 200, { ok: true });
    }

    if (path === '/api/me' && method === 'GET') {
      const uid = requireUser(req);
      const u = repo.getUser(uid)!;
      return send(res, 200, { user: { id: u.id, username: u.username } });
    }

    if (path === '/api/characters' && method === 'GET') {
      const uid = requireUser(req);
      return send(res, 200, { characters: repo.listCharacters(uid).map(publicChar) });
    }

    if (path === '/api/characters' && method === 'POST') {
      const uid = requireUser(req);
      const b = await readJson(req);
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      const classId = typeof b.classId === 'string' ? b.classId : '';
      if (!CHARNAME_RE.test(name)) throw new HttpError(400, 'Nome do personagem: 3 a 16 letras, números ou _.');
      if (!CLASS_BY_ID[classId]) throw new HttpError(400, 'Classe inválida.');
      if (repo.countCharacters(uid) >= MAX_CHARACTERS) throw new HttpError(400, `Limite de ${MAX_CHARACTERS} personagens por conta.`);
      if (repo.charNameTaken(name)) throw new HttpError(409, 'Já existe um personagem com esse nome.');
      const c = repo.createCharacter(uid, name, classId, newCharacterData(classId), 50);
      return send(res, 201, { character: publicChar(c) });
    }

    const del = path.match(/^\/api\/characters\/(\d+)$/);
    if (del && method === 'DELETE') {
      const uid = requireUser(req);
      const id = Number(del[1]);
      if (hooks.onCharacterDeleted?.(id)) throw new HttpError(409, 'Saia do jogo com esse personagem antes de excluí-lo.');
      if (!repo.deleteCharacter(id, uid)) throw new HttpError(404, 'Personagem não encontrado.');
      return send(res, 200, { ok: true });
    }

    if (path === '/api/leaderboard' && method === 'GET') {
      return send(res, 200, {
        floor: repo.leaderboard('floor'), bosses: repo.leaderboard('bosses'), rarest: repo.leaderboard('rarest'),
      });
    }

    throw new HttpError(404, 'Rota não encontrada.');
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    let rel = path === '/' ? '/index.html' : path;
    const file = normalize(join(clientRoot, rel));
    if (!file.startsWith(clientRoot)) return send(res, 403, { error: 'Proibido' });
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error();
      const ext = extname(file);
      const immutable = rel.startsWith('/dist/') && !cfg.prod ? 'no-cache' : rel.startsWith('/dist/') ? 'public, max-age=3600' : 'no-cache';
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': immutable });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
    }
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    securityHeaders(res, cfg.prod);
    const origin = req.headers.origin;
    if (origin && cfg.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método não permitido' });
      return await serveStatic(req, res, decodeURIComponent(url.pathname));
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('[http]', e);
      return send(res, 500, { error: 'Erro interno.' });
    }
  };
}
