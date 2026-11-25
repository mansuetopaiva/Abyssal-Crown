# Plano de Implementação: Abyssal Crown

## Visão geral
Fatia vertical completa do jogo descrito em `SPEC.md`, construída nas 8 etapas pedidas, cada uma testada antes da próxima.

## Decisões de arquitetura
- **Lógica pura em `shared/`** (dano, drops, itens, stats, gerador de andares, movimento): o servidor usa para decidir,
  o cliente usa só para prever movimento e exibir tooltips. Testável sem rede nem banco.
- **Servidor autoritativo**: o cliente envia apenas intenções (`input` com direção+seq, `attack` com ângulo, `skill` com
  slot+alvo, `interact`). Dano, drops, gold e gemas são decididos no servidor.
- **Loop fixo de 20 Hz** por mundo (cidade + cada instância). Snapshots só com entidades próximas ao jogador (área de
  interesse), números arredondados para reduzir payload.
- **Predição + reconciliação** para o próprio jogador (replay dos inputs não confirmados) e **interpolação** de 100 ms
  para os demais.
- **Andares**: gerados no servidor a partir de `seed = hash(instância, andar)`; enviados como RLE+base64 + lista de objetos.
- **Persistência**: `Repo` (SQLite) com personagens em JSON (inventário/equipamento/talentos) + tabelas relacionais
  para usuários, mercado, log de transações e ranking. Autosave a cada 30 s e em eventos importantes.
- **Renderização**: Canvas 2D, tiles pré-renderizados em chunks de 16×16 (culling por chunk visível), atlas de sprites
  gerado por bioma sob demanda (lazy loading), pools para monstros/projéteis/textos de dano.

## Lista de tarefas → `tasks/todo.md`

## Riscos e mitigação
| Risco | Impacto | Mitigação |
|---|---|---|
| Escopo enorme para uma sessão | Alto | Conteúdo dirigido por JSON; primitivas genéricas de habilidade/ataque reaproveitadas por classes e chefes |
| Desincronia na predição | Médio | Mesma função `moveWithCollision` em cliente e servidor; teste de determinismo |
| Desempenho no navegador | Alto | Medição com Playwright (FPS, quadros longos) antes de entregar |
| `node:sqlite` experimental | Médio | Encapsulado em `Repo`; trocar por Postgres sem mexer no jogo |
| Escalonamento infinito estoura números | Baixo | Curvas polinomiais × exponencial suave; formatação abreviada (1.2k, 3.4M) |
