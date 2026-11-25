# Tarefas — Abyssal Crown

## Etapa 1 — Autenticação + banco
- [ ] T1 Lógica pura: rng, constantes, dano, drops, itens, stats (`shared/`)
  - Aceite: testes de drops e dano passam. Verificar: `npm test`
- [ ] T2 Banco + auth: Repo SQLite, scrypt, JWT cookie, rate limit, rotas `/api/*`, personagens (máx. 3)
  - Aceite: teste de auth + integração HTTP passam. Verificar: `npm test`
- [ ] T3 Tela de login/cadastro + seleção/criação de personagem
  - Aceite: Playwright cadastra, loga, cria personagem.

## Checkpoint 1: testes passam, build limpo

## Etapa 2 — Cidade multiplayer
- [ ] T4 WebSocket + mundo da cidade em 20 Hz, snapshots, chat global, grupos
- [ ] T5 Cliente: renderer (atlas, chunks, culling), predição/interpolação, HUD básico, chat
  - Aceite: dois navegadores se veem e conversam (Playwright).

## Etapa 3 — Dungeon + combate
- [ ] T6 Gerador de andares (salas, corredores, escada, baús, armadilhas, sala secreta), codificação compacta + testes
- [ ] T7 Instâncias, IA de monstros (melee/ranged/charger/caster/exploder), modificadores, combate básico, checkpoints
  - Aceite: grupo entra, mata monstros, desce a escada.

## Etapa 4 — Itens
- [ ] T8 Drops por jogador, inventário em grade, equipar, comparação, ordenação, anúncio SSS

## Etapa 5 — Classes
- [ ] T9 6 classes, 4 habilidades + ultimate, talentos, atributos

## Etapa 6 — Chefes
- [ ] T10 10 chefes com fases 50%/20%, telegrafia, HP por tamanho do grupo

## Checkpoint 2: E2E da dungeon passa

## Etapa 7 — Economia
- [ ] T11 Lojas (Ferreiro, Alquimista, Joalheiro, Mercado), refino, engaste, reparo, gemas, missões diárias, conquistas, log

## Etapa 8 — Ranking + polimento
- [ ] T12 Ranking global, minimapa, partículas, mobile básico, pausa em segundo plano
- [ ] T13 Docker, vercel.json, README, seed
- [ ] T14 Medição de desempenho + revisão pelos agentes (code-reviewer, security-auditor, test-engineer, web-performance-auditor)

## Checkpoint final: todos os critérios de sucesso do SPEC.md
