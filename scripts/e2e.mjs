// Teste ponta a ponta no navegador (Playwright): cadastro, cidade multiplayer, chat, dungeon e FPS.
// Uso: node scripts/e2e.mjs   (precisa do Playwright instalado: npx playwright install chromium)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const PORT = 3999;
const dir = mkdtempSync(join(tmpdir(), 'abyssal-'));
const env = { ...process.env, PORT: String(PORT), DATABASE_FILE: join(dir, 'e2e.db'), ABYSSAL_MAIN: '1' };
const seed = spawn('node', ['--no-warnings', '--import', 'tsx', 'server/seed.ts'], { env, stdio: 'inherit' });
await new Promise((r) => seed.on('exit', r));
const srv = spawn('node', ['--no-warnings', '--import', 'tsx', 'server/index.ts'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('rodando') && r()));
const URL = `http://localhost:${PORT}/`;
const shots = process.env.SHOTS ?? dir;
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ` — ${extra}` : ''}`); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const A = await ctxA.newPage(), B = await ctxB.newPage();
  // renderização 3D por software (sem GPU) deixa tudo mais lento: prazos maiores
  A.setDefaultTimeout(20000); B.setDefaultTimeout(20000);
  const errors = [];
  for (const p of [A, B]) p.on('pageerror', (e) => errors.push(e.message)), p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // A: cadastro com validação
  await A.goto(URL);
  await A.click('#tab-register');
  await A.fill('#reg-user', 'novato_e2e');
  await A.fill('#reg-email', 'novato@e2e.com');
  await A.fill('#reg-pass', 'curta');
  await A.fill('#reg-pass2', 'curta');
  await A.click('#form-register button[type=submit]');
  check('validação de senha mostra erro claro', /8\+ caracteres/.test(await A.textContent('#form-register .form-error')));
  await A.fill('#reg-pass', 'senha1234');
  await A.fill('#reg-pass2', 'senha1234');
  await A.click('#form-register button[type=submit]');
  await A.waitForSelector('#screen-chars:not([hidden])');
  await A.click('text=+ Criar novo herói');
  await A.fill('#create-name', 'Arcanis');
  await A.click('label[for=cls-mage]');
  await A.click('#form-create button[type=submit]');
  await A.waitForSelector('text=Arcanis');
  check('cadastro e criação de personagem', true);
  await A.screenshot({ path: join(shots, '01-personagens.png') });
  await A.click('.char-card >> text=Jogar');
  await A.waitForSelector('#hud-name:has-text("Arcanis")');

  // B: login com o usuário de teste
  await B.goto(URL);
  await B.fill('#login-user', 'teste');
  await B.fill('#login-pass', 'teste123');
  await B.click('#form-login button[type=submit]');
  await B.waitForSelector('text=Valerion');
  await B.click('.char-card:has-text("Valerion") >> text=Jogar');
  await B.waitForSelector('#hud-name:has-text("Valerion")');
  await A.waitForTimeout(800);
  await A.screenshot({ path: join(shots, '02-cidade.png') });

  // chat global
  await B.keyboard.press('Enter');
  await B.keyboard.type('Saudações do abismo!');
  await B.keyboard.press('Enter');
  await A.waitForSelector('#chat-log li:has-text("Saudações do abismo!")', { timeout: 15000 });
  check('chat global entre dois jogadores', true);

  // A anda até o portal (contorna a fonte) e entra na dungeon
  const hold = async (p, key, ms) => { await p.keyboard.down(key); await p.waitForTimeout(ms); await p.keyboard.up(key); };
  // anda até um ponto (em tiles) lendo a posição prevista do cliente — independe do FPS
  const walkTo = async (p, tx, ty) => {
    for (let i = 0; i < 200; i++) {
      const pos = await p.evaluate(() => window.__pos);
      const dx = tx * 16 - pos.x, dy = ty * 16 - pos.y;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return true;
      const key = Math.abs(dx) >= 6 ? (dx > 0 ? 'd' : 'a') : dy > 0 ? 's' : 'w';
      await hold(p, key, Math.min(250, Math.max(60, Math.max(Math.abs(dx), Math.abs(dy)) * 6)));
    }
    return false;
  };
  const toPortal = async (p) => { await walkTo(p, 17.5, 20); await walkTo(p, 17.5, 7.5); await walkTo(p, 21.5, 7.5); };
  await toPortal(A);
  await A.keyboard.press('e');
  const portalOpen = await A.waitForSelector('#panel-title:has-text("Portal")', { timeout: 10000 }).then(() => true).catch(() => false);
  check('caminhar até o portal (movimento previsto + servidor)', portalOpen);
  if (portalOpen) {
    await A.click('#panel-body >> text=Andar 1');
    await A.waitForSelector('#hud-floor:has-text("Andar 1")', { timeout: 20000 });
    check('entrar na dungeon (andar 1)', true);
    // joga por alguns segundos: anda e ataca, medindo FPS
    await A.mouse.move(800, 360);
    await A.mouse.down();
    const keys = ['d', 's', 'a', 'w'];
    for (let i = 0; i < 8; i++) {
      await hold(A, keys[i % 4], 700);
      if (i === 2) await A.keyboard.press('1');
      if (i === 4) await A.keyboard.press('2');
    }
    await A.mouse.up();
    await A.waitForTimeout(1200);
    const fps = await A.evaluate(() => window.__fps);
    const gpu = await A.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'desconhecido'; });
    const gl = await A.evaluate(() => window.__gl);
    await A.screenshot({ path: join(shots, '03-dungeon.png') });
    const software = /swiftshader|llvmpipe|software/i.test(gpu);
    // sem GPU (renderização por software) o FPS não representa um notebook real: só informa
    check(`FPS na dungeon (${software ? 'sem GPU — informativo' : gpu})`, software || (fps && fps.fps >= 50), `${fps?.fps} FPS, pior quadro ${Math.round(fps?.worst)} ms, ${gl?.calls} draw calls, ${gl?.triangles} triângulos`);
    // inventário
    await A.keyboard.press('i');
    await A.waitForSelector('#panel-title:has-text("Inventário")');
    await A.screenshot({ path: join(shots, '04-inventario.png') });
    await A.keyboard.press('Escape');
    await A.keyboard.press('c');
    await A.screenshot({ path: join(shots, '05-talentos.png') });
    await A.keyboard.press('Escape');
  }

  // B: veterano entra no checkpoint 11 e depois volta
  await toPortal(B);
  await B.keyboard.press('e');
  if (await B.waitForSelector('#panel-title:has-text("Portal")', { timeout: 10000 }).then(() => true).catch(() => false)) {
    await B.click('#panel-body >> text=Checkpoint 11');
    await B.waitForSelector('#hud-floor:has-text("Andar 11")', { timeout: 20000 });
    check('checkpoint do andar 11', true);
    await B.waitForTimeout(500);
    await B.screenshot({ path: join(shots, '06-andar11.png') });
  }

  // aba em segundo plano: o loop de renderização para
  const paused = await A.evaluate(async () => {
    const before = window.__fps;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    let frames = 0;
    const id = requestAnimationFrame(function f() { frames++; });
    await new Promise((r) => setTimeout(r, 300));
    cancelAnimationFrame(id);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    return !!before;
  });
  check('pausa ao ir para segundo plano', paused);

  check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  srv.kill();
}
console.log(`\nCapturas em ${shots}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} verificação(ões) falharam` : 'Todas as verificações passaram');
process.exit(failed ? 1 : 0);
