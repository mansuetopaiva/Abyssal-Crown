import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { Repo } from './db';
import { createHttpHandler, originAllowed, userFromRequest, type HttpConfig } from './http';
import { Hub } from './game/hub';

export interface StartOptions { port?: number; dbFile?: string; quiet?: boolean }

const here = dirname(fileURLToPath(import.meta.url));
// funciona tanto rodando o .ts (server/) quanto o bundle (dist/)
const root = resolve(here, '..');

export function startServer(opts: StartOptions = {}) {
  const prod = process.env.NODE_ENV === 'production';
  let secret = process.env.JWT_SECRET ?? '';
  if (secret.length < 32) {
    if (prod) throw new Error('Defina JWT_SECRET (mínimo 32 caracteres) em produção.');
    secret = randomBytes(32).toString('hex');
    if (!opts.quiet) console.warn('[aviso] JWT_SECRET não definido — usando um segredo temporário (sessões caem ao reiniciar).');
  }
  const cfg: HttpConfig = {
    secret, prod,
    crossSite: process.env.CROSS_SITE_COOKIES === '1',
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    clientDir: process.env.CLIENT_DIR ?? join(root, 'client'),
    sessionTtl: 7 * 24 * 3600,
  };
  const repo = new Repo(opts.dbFile ?? process.env.DATABASE_FILE ?? join(root, 'data', 'abyssal.db'));
  const hub = new Hub(repo);
  const handler = createHttpHandler(repo, cfg, { onCharacterDeleted: (id) => hub.isOnline(id) });

  const server = createServer((req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(hub.stats()));
    }
    void handler(req, res);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws') || !originAllowed(req, cfg)) return socket.destroy();
    const uid = userFromRequest(req, cfg.secret);
    if (!uid || !repo.getUser(uid)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => hub.connect(ws, uid));
  });

  hub.start();
  const port = opts.port ?? Number(process.env.PORT ?? 3000);
  const ready = new Promise<number>((res) =>
    server.listen(port, () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      if (!opts.quiet) console.log(`Abyssal Crown rodando em http://localhost:${p}`);
      res(p);
    }),
  );
  const close = () => new Promise<void>((res) => { hub.stop(); wss.close(); server.close(() => res()); server.closeAllConnections?.(); });
  return { server, hub, repo, ready, close };
}

const isMain = process.argv[1] && resolve(process.argv[1]).replace(/\.(ts|js)$/, '') === resolve(fileURLToPath(import.meta.url)).replace(/\.(ts|js)$/, '');
if (isMain || process.env.ABYSSAL_MAIN === '1') {
  const s = startServer();
  const shutdown = () => { console.log('Salvando e encerrando...'); void s.close().then(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
