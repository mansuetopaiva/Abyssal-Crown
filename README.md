# Abyssal Crown

Dungeon crawler multiplayer para navegador, em pixel art dark fantasy. Cada jogador tem a sua conta (até 3 heróis).
Os jogadores se encontram na cidade, conversam no chat global, formam grupos de até 4 e descem andares infinitos
gerados proceduralmente, com chefes a cada 10 andares.

## O que tem no jogo

| Sistema | Conteúdo |
|---|---|
| Contas | Cadastro/login com validação, senha com hash `scrypt`, sessão JWT em cookie `httpOnly`, rate limit, até 3 personagens |
| Multiplayer | Servidor autoritativo a 20 ticks/s, predição + reconciliação do próprio movimento, interpolação dos outros, cidade compartilhada, chat global, grupos (até 4), instância própria por grupo |
| Dungeon | Andares infinitos com seed, salas + corredores, escada, baús, armadilhas, sala secreta (parede rachada), checkpoints a cada 10 andares, 5 biomas a cada 25 andares |
| Monstros | 30 tipos, 5 comportamentos (corpo a corpo, à distância, conjurador, investida, explosivo), modificadores Elite / Veloz / Venenoso / Blindado / Vampírico / Explosivo |
| Chefes | 10 chefes únicos com título, barra de vida, fases a 50% e 20%, ataques telegrafados, HP escala com o tamanho do grupo |
| Itens | Ranks F→SSS com as chances pedidas, 0 a 6 atributos aleatórios, 10 itens SSS lendários com efeito único e anúncio no chat, 11 tipos de arma, 9 slots |
| Classes | Guerreiro, Mago, Arqueiro, Ladino, Clérigo e Necromante — 4 habilidades + ultimate, 9 talentos cada, 5 atributos base |
| Economia | Gold e Gemas; Ferreiro (comprar, refinar +1..+15, reparar), Alquimista, Joalheira (gemas de engaste, combinar), Mercado entre jogadores com taxa de 5%, loja de gemas, missões diárias, conquistas, log de todas as transações |
| Interface | HUD (vida, mana, XP, habilidades com recarga, minimapa, andar), textos de dano coloridos (crítico maior e amarelo), partículas em drops raros, ranking global, controles de teclado/mouse e toque |

## Stack

O pedido original citava Fastify, Socket.IO, Prisma/PostgreSQL, Phaser 3 e bcrypt. O ambiente onde o projeto foi
construído não tinha acesso à internet para instalar pacotes. Para entregar algo **testado de ponta a ponta**, cada um
foi trocado por um equivalente sem dependências extras, isolado em um único arquivo:

| Pedido | Usado | Arquivo | Como trocar |
|---|---|---|---|
| Fastify/Express | `node:http` + roteador próprio | `server/http.ts` | Reescrever só as rotas; a lógica fica igual |
| Socket.IO | `ws` + mensagens JSON `{ t: ... }` | `server/game/hub.ts`, `client/src/game.ts` | `ws.send` → `socket.emit`, `onmessage` → `socket.on` |
| Prisma + PostgreSQL | `node:sqlite` (SQLite embutido no Node 22) | `server/db.ts` (classe `Repo`) | Implementar os mesmos métodos com Prisma; o esquema está no topo do arquivo |
| bcrypt | `crypto.scrypt` (N=16384) | `server/auth.ts` | `hashPassword`/`verifyPassword` |
| Phaser 3 | Canvas 2D próprio com atlas, culling por chunk e pools | `client/src/render/` | Reaproveitar `shared/` e a rede; refazer só o desenho |

Dependências de execução: só `ws`. De desenvolvimento: `typescript`, `tsx`, `esbuild`.

## Rodar localmente (WSL / Linux / macOS)

Requisitos: **Node.js 22.5 ou mais novo** (por causa do `node:sqlite`). No WSL, use o Node instalado dentro do Linux
(via `nvm`), não o do Windows, e mantenha o projeto em `~/projetos`, não em `/mnt/c`.

```bash
git clone https://github.com/mansuetopaiva/Abyssal-Crown.git
cd Abyssal-Crown
npm install
npm run seed        # cria o banco e o usuário de teste
npm run dev         # http://localhost:3000
```

**Usuário de teste:** `teste` / `teste123`. Ele tem três heróis. O **Valerion** (Guerreiro nível 15) já tem o
checkpoint do andar 11, gold, gemas e itens, então dá para chegar direto no chefe do andar 20.

Para testar o multiplayer, abra uma segunda janela anônima e crie outra conta.

### Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Compila o cliente e sobe o servidor com recarga automática |
| `npm test` | Testes unitários e de integração (drops, dano, autenticação, gerador de andares, HTTP + WebSocket) |
| `node scripts/e2e.mjs` | Teste no navegador com Playwright: cadastro, dois jogadores, chat, dungeon, FPS (precisa de `npx playwright install chromium`) |
| `npm run typecheck` | Verificação de tipos |
| `npm run build && npm start` | Build e execução de produção |
| `docker compose up --build` | Sobe tudo com um comando (defina `JWT_SECRET` no `.env`) |

## Controles

| Tecla | Ação |
|---|---|
| WASD / setas | Mover |
| Clique (segurar) / Espaço | Ataque básico na direção do mouse |
| 1 2 3 4 / R | Habilidades / Ultimate |
| E | Interagir (escada, baú, lojas, portal) |
| Q / F | Poção de vida / mana |
| I · C · J · L | Inventário · Talentos · Missões · Ranking |
| T | Voltar à cidade |
| Enter | Chat (comandos: `/convidar nome`, `/aceitar nome`, `/sair`, `/expulsar nome`) |

No celular aparecem um joystick virtual e botões de ataque e interação. A mira é automática no monstro mais próximo.

## Estrutura

```
shared/            lógica pura usada no cliente e no servidor
  constants.ts     ranks, slots, biomas, escala de dificuldade
  combat.ts        fórmula de dano (crítico, armadura, resistências)
  loot.ts          gerador de drops e itens
  dungeon.ts       gerador de andares + codificação compacta (RLE + base64)
  stats.ts         atributos derivados (equipamento, talentos)
  economy.ts       preços e regras de refino/engaste
  data/*.json      monstros, chefes, itens e classes — edite aqui para balancear
server/
  index.ts         inicialização (HTTP + WebSocket)
  http.ts          rotas /api, cookies, CORS, cabeçalhos de segurança, arquivos estáticos
  auth.ts          scrypt, JWT, validação
  db.ts            persistência (Repo)
  seed.ts          banco + usuário de teste
  game/hub.ts      sessões, chat, grupos, lojas, mercado, loop de 20 Hz
  game/dungeon.ts  instância: IA, combate, chefes, loot, armadilhas
  game/world.ts    mundo base, cidade, snapshots
client/
  index.html, styles.css, config.js
  src/game.ts      rede, predição, interpolação, entrada, HUD
  src/render/      renderizador Canvas 2D, sprites procedurais, pools
  src/ui/          telas de login/personagens e painéis
tests/             node:test
scripts/e2e.mjs    teste no navegador
```

## Balanceamento

Tudo que é número de jogo está em JSON ou em `shared/constants.ts`:

- `shared/data/monsters.json`: HP, dano, velocidade, IA, bioma e cores de cada monstro
- `shared/data/bosses.json`: chefes, título e lista de ataques por fase
- `shared/data/items.json`: armas, armaduras, atributos aleatórios, itens SSS e gemas
- `shared/data/classes.json`: atributos, habilidades e talentos
- `shared/constants.ts`: chances de rank, `floorScaling` (dificuldade por andar), XP por nível

Depois de mudar, rode `npm test` (os testes de drops conferem a tabela de chances).

## Desempenho

- O mapa é desenhado em blocos de 16×16 tiles pré-renderizados, e só os blocos visíveis são desenhados.
- Sprites e tiles são gerados uma vez em canvas e reaproveitados. Os tiles de cada bioma só são gerados quando o
  jogador chega nele.
- Entidades, textos de dano, partículas e efeitos usam pools, sem alocar memória a cada quadro.
- O servidor só envia entidades próximas de cada jogador, e o nome/tipo de cada uma só na primeira vez que aparece.
- O loop para quando a aba vai para segundo plano.
- Medição (Chromium headless, sem GPU, 1280×720): **60 FPS, pior quadro de 17 ms** na dungeon. Um andar 72×72
  ocupa menos de 4 KB codificado. O tempo de tick do servidor aparece em `/api/status`.

## Deploy

O servidor precisa ficar **sempre ligado**, porque mantém WebSockets abertos e o loop de 20 Hz. Por isso, ele não roda
em funções serverless.

### Opção recomendada: um único serviço (Railway, Render, Fly.io ou VPS)

1. Crie o serviço a partir do repositório. Ele detecta o `Dockerfile`.
2. Variáveis: `JWT_SECRET` (gere com `openssl rand -hex 32`) e `TRUST_PROXY=1`.
3. Monte um **volume persistente** em `/data`, onde fica o banco `abyssal.db`.
4. Pronto. O mesmo serviço entrega o jogo e a API.

No Railway: *New Project → Deploy from GitHub repo → Variables → Volumes (mount path `/data`)*.
No Render: *New → Web Service → Docker → Disks (mount path `/data`)*.
Em uma VPS: `docker compose up -d --build` atrás de um Nginx com HTTPS, repassando `Upgrade`/`Connection` para o WebSocket.

### Opção alternativa: cliente na Vercel + servidor separado

1. Suba o servidor como na opção acima.
2. Na Vercel, importe o repositório. O `vercel.json` já compila só o cliente.
3. Em `client/config.js`, defina `window.ABYSSAL_SERVER = 'https://api.seudominio.com'`.
4. No servidor, defina `ALLOWED_ORIGINS=https://jogo.seudominio.com` e `CROSS_SITE_COOKIES=1`.
5. **Use subdomínios do mesmo domínio** (`jogo.` e `api.`). Com domínios totalmente diferentes (ex.: `*.vercel.app` e
   `*.railway.app`), os navegadores bloqueiam o cookie de login.

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `JWT_SECRET` | aleatório (dev) | Obrigatória em produção, mínimo 32 caracteres |
| `PORT` | `3000` | Porta HTTP |
| `DATABASE_FILE` | `./data/abyssal.db` | Caminho do banco SQLite |
| `TRUST_PROXY` | `0` | `1` para usar o IP do `X-Forwarded-For` no rate limit |
| `ALLOWED_ORIGINS` | vazio | Origens extras aceitas (cliente em outro domínio) |
| `CROSS_SITE_COOKIES` | `0` | `1` para cookie `SameSite=None; Secure` |
| `NODE_ENV` | — | `production` ativa cookie `Secure` e HSTS |

## Segurança

- O cliente só envia **intenções** (direção, mira, habilidade). Dano, drops, gold, gemas e preços são decididos no servidor.
- O movimento é limitado por um "balde de tokens" (sem speed hack), e a direção é normalizada.
- Toda compra, venda, refino, engaste, transação do mercado, missão e conquista fica registrada na tabela `transactions`.
- O chat é exibido sempre como texto puro (sem HTML). Também há CSP, `X-Frame-Options`, verificação de origem no
  WebSocket e limite de 16 KB por mensagem.
- Login e cadastro: 10 tentativas a cada 5 min por IP e por usuário. O tempo de resposta é igual para usuário
  inexistente e senha errada.

## Limitações conhecidas

- SQLite atende bem um único servidor. Para vários servidores, migre o `Repo` para PostgreSQL.
- Os grupos, a cidade e o rate limit vivem na memória de um processo. Escalar horizontalmente exigiria Redis.
- A arte é 100% procedural (sem assets externos). Para trocar por spritesheets, substitua `client/src/render/sprites.ts`.
