# Spec: Abyssal Crown

Jogo web multiplayer de exploração de dungeons, pixel art dark fantasy, em português.
Fonte dos requisitos: especificação original enviada pelo usuário (seções 1–11).

## Premissas (corrija se alguma estiver errada)
1. **Stack trocada por falta de rede no ambiente de construção.** Fastify/Socket.IO/Prisma/Postgres/Phaser/bcrypt não
   puderam ser instalados aqui. Usamos equivalentes já disponíveis, atrás de interfaces para trocar depois:
   | Pedido | Usado agora | Onde trocar |
   |---|---|---|
   | Fastify/Express | `node:http` + roteador próprio (~100 linhas) | `server/http.ts` |
   | Socket.IO | `ws` + protocolo de eventos `{t, ...}` | `server/realtime.ts`, `client/src/net.ts` |
   | Prisma + PostgreSQL | `node:sqlite` atrás de `Repo` | `server/db.ts` (interface `Repo`) |
   | bcrypt | `crypto.scrypt` (N=16384), comparação em tempo constante | `server/auth.ts` |
   | Phaser 3 | Canvas 2D próprio: atlas, culling por chunk, pooling | `client/src/render/*` |
2. **Deploy:** cliente estático pode ir para a Vercel; servidor (WebSocket + loop 20 Hz + banco) precisa de host
   sempre ligado (Railway/Render/Fly/VPS). Modo recomendado: um único serviço servindo tudo.
3. **Ambiente do usuário:** Windows + WSL2 + VS Code. Node ≥ 22.5 (para `node:sqlite`).
4. Arte é gerada proceduralmente em código (sem assets externos com direitos autorais).
5. Escopo é "fatia vertical completa": todos os sistemas existem e funcionam, com conteúdo mínimo pedido
   (30 monstros, 10 chefes, 6 classes, ranks F–SSS); polimento visual é funcional, não final.

## Mapa de capacidades

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| shared-core | Constantes, RNG com seed, fórmulas de dano, drops, itens, stats, gerador de andares, codificação compacta | — |
| identity | Cadastro/login, scrypt, JWT em cookie httpOnly, rate limit, personagens (máx. 3) | shared-core |
| realtime-town | WebSocket, tick 20 Hz, predição + reconciliação, interpolação, cidade, chat global, grupos (máx. 4) | identity |
| dungeon-combat | Instâncias por grupo, andares infinitos, escadas, baús, armadilhas, sala secreta, checkpoints, biomas, IA de monstros, modificadores | realtime-town |
| items-inventory | Ranks F–SSS, afixos, únicos SSS + anúncio, inventário em grade, equipar, comparação, ordenação | dungeon-combat |
| classes-skills | 6 classes, 4 habilidades + ultimate, árvore de talentos, atributos base | items-inventory |
| bosses | 10 chefes, fases 50%/20%, ataques telegrafados, HP por tamanho do grupo | classes-skills |
| economy | Gold/Gemas, Ferreiro (comprar/refinar +1..+15/reparar), Alquimista, Joalheiro (engaste), Mercado com taxa, log de transações, missões diárias, conquistas | items-inventory |
| leaderboard-polish | Ranking global, HUD, minimapa, textos de dano, partículas, mobile básico | todos |
| deploy | Dockerfile, docker-compose, vercel.json, README, seed | todos |

Ordem de construção = as 8 etapas pedidas: identity → realtime-town → dungeon-combat → items-inventory →
classes-skills → bosses → economy → leaderboard-polish → deploy.

## Comandos
```
npm install          # instala ws, esbuild, tsx, typescript
npm run seed         # cria o banco e o usuário de teste (teste / teste123)
npm run dev          # compila o cliente e sobe o servidor com recarga (http://localhost:3000)
npm test             # testes unitários (node:test): drops, dano, autenticação, gerador de andares
npm run typecheck    # tsc --noEmit
npm run build && npm start   # produção
docker compose up --build    # tudo com um comando
```

## Estrutura
```
shared/        tipos, constantes e lógica pura (roda no cliente e no servidor)
shared/data/   monsters.json, bosses.json, items.json, classes.json (balanceamento)
server/        http, auth, db, realtime, world/ (cidade, instâncias, IA), game/ (economia, inventário)
client/        index.html, styles.css, src/ (net, render/, ui/), dist/ (bundle gerado)
tests/         *.test.ts
```

## Estilo de código
TypeScript estrito, funções puras em `shared/`, sem classes onde uma função basta, nomes em inglês no código e
textos em português na interface.
```ts
export function computeDamage(atk: AttackInput, def: DefenseInput, rng: Rng): DamageResult {
  const base = atk.min + rng() * (atk.max - atk.min);
  const crit = rng() < atk.critChance;
  // ...
}
```

## Desempenho (critérios mensuráveis)
- Cliente: ≥ 55 FPS médios com 40 monstros + 4 jogadores em tela, em Chromium headless sem GPU.
- Nenhum quadro > 50 ms durante combate normal (sem "travamento" de aba).
- Payload de andar compacto: mapa codificado em RLE+base64, < 4 KB para um andar 72×72.
- Servidor: tick de 20 Hz com duração média < 5 ms com 4 instâncias ativas.
- `requestAnimationFrame` + parada explícita quando `document.hidden`.

## Segurança
- Senhas: scrypt com sal por usuário; nunca registradas em log.
- JWT HS256, `JWT_SECRET` obrigatório em produção; cookie `HttpOnly; SameSite=Lax; Secure` (produção).
- Rate limit: login/cadastro 10 req / 5 min por IP; chat 1 msg / 700 ms.
- Toda ação de jogo validada no servidor; cliente só envia intenção (direção, mira, slot de habilidade).
- Dano, drops, gold, gemas e preços calculados só no servidor; transações em tabela de log.
- Origem do WebSocket verificada; payloads limitados (16 KB).

## Testes
- Unitários (`node:test` + `tsx`): gerador de drops (distribuição base e efeito do andar), cálculo de dano
  (crítico, resistências, armadura), autenticação (hash/verificação, JWT válido/expirado/adulterado),
  gerador de andares (conectividade, escada alcançável, determinismo por seed).
- Integração: servidor real em porta aleatória — cadastro, login, criação de personagem, entrar via WebSocket.
- E2E: Playwright headless — login, entrar na cidade, dois jogadores se veem, entrar na dungeon, medir FPS.
- Revisão final por agentes: code-reviewer, security-auditor, test-engineer, web-performance-auditor.

## Limites
- Sempre: rodar testes antes de considerar uma etapa concluída; validar entradas no servidor.
- Perguntar antes: adicionar dependências; mudar o esquema do banco depois de entregue; enviar para o GitHub.
- Nunca: commitar segredos (.env); confiar em valores vindos do cliente; reproduzir arte/personagens protegidos.

## Critérios de sucesso
1. `npm install && npm run seed && npm run dev` funciona no WSL com Node 22+.
2. Dois navegadores logados em contas diferentes se veem andando na cidade e conversam no chat.
3. Grupo de até 4 entra numa instância própria; andares descem infinitamente; chefe a cada 10 andares com fases.
4. Drops seguem a tabela de ranks; SSS anuncia no chat global.
5. 6 classes jogáveis com 4 habilidades + ultimate + talentos.
6. Lojas, refinamento, engaste, mercado e ranking funcionam, com log de transações.
7. `npm test` passa; E2E passa; metas de desempenho acima atingidas.

## Perguntas em aberto
1. Aceita a troca de stack da tabela acima, ou prefere que eu escreva o código para Fastify/Socket.IO/Prisma/Phaser
   **sem poder testar aqui** (você testaria no WSL)?
2. Deploy: tudo num serviço só (Railway/Render), ou cliente na Vercel + servidor separado?
3. Nome do repositório no GitHub para eu enviar no final (ex.: `usuario/abyssal-crown`).
