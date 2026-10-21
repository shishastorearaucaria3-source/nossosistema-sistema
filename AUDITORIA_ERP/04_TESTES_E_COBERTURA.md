# 04 — Testes e Cobertura

Data: 20/10/2026. Nenhum teste foi executado nesta auditoria (regra de não gravar/rodar nada destrutivo; suíte considerada segura mas adiada — ver "Executados").

## 1. Verificações executadas nesta auditoria

| Verificação | Comando/método | Resultado |
|---|---|---|
| TypeScript (node + web) | `npm run typecheck` (`tsc --noEmit -p tsconfig.node.json` e `tsconfig.web.json`) | **PASS** (sem erros) |
| Estado do git | `git status --porcelain`, `git log`, `git rev-parse`, `git stash list` (somente leitura) | 109 alterados; 1 stash list vazio; local 1 commit à frente de origin |
| Leitura estática de código | inspeção manual + agentes de exploração | base dos relatórios 01-03 |
| Testes automatizados | **NÃO executados** | pendente (ver §5) |
| Build Electron/pacote | **NÃO executado** | pendente |
| Banco real de produção | **NÃO aberto** | pendente (só snapshots de homologação para inspeção futura) |

## 2. Inventário de testes (17 arquivos)

### Suítes ligadas ao `package.json`

| Script | Arquivos | Runner | Banco | Cobre |
|---|---|---|---|---|
| `test:estoque` | `tests/estoque-movimentacoes.test.ts` | `node --test` | `:memory:` | migrations 1..SCHEMA_VERSION, movimentação com estoque_anterior/posterior, compra+compra_id, estorno/dupla-reversão |
| `test:whatsapp` | `tests/whatsapp-integration.test.ts` | `node --test` (requer build) | `:memory:` (schema próprio 39/40) | normalize, product-cache, order (carrinho), service (dedup), settings |
| `test:fila` | `tests/fila-offline.test.mjs` | `node:test` | `initDb(mkdtemp)` | fila offline ERP→Supabase: retry/backoff, sem perda/duplicidade |
| `test:pedidos` | `tests/pedidos-online.test.mjs` | `node:test` | `initDb(mkdtemp)` | status/tracking/busca/filtros de pedidos-online |
| `test:relay` | `tests/relay-{permissao,supervisor,fluxo}.test.mjs` | `node:test` | temp | proteção de permissão, supervisor, fluxo Express+relay reais |

### Testes fora dos scripts (execução manual)

| Arquivo | Cobre | Banco | Observação |
|---|---|---|---|
| `tests/periodo.test.ts` | `relatorios/periodo.ts` (calcularPeriodo/clausulaSql/paraUtcSql) | nenhum | sem runner npm |
| `tests/integra-relatorios.test.ts` | cláusula SQL período × vendas UTC-local | `:memory:` | |
| `tests/auditoria-periodos.test.ts` | TODAS as queries de `data.ts` respeitam período | `:memory:` | |
| `tests/movimentacao-periodo.test.ts` | `carregarMovimentacaoEstoque` por período | `:memory:` | |
| `tests/e2e-pedido-online.cjs` | stand-in Worker+D1 → `puxarPedidosOnline()` idempotente + baixa estoque | temp isolado | manual |
| `tests/teste-catalogo-publico.cjs` | `/api/catalogo/publico`: filtros, regra de estoque, 401 remoto | temp (`TABACARIA_DB`) | manual, spawn servidor |
| `tests/teste-dashboard.cjs` | queries do dashboard Home | temp | `node:test` porta 3275 |
| `tests/teste-fluxo-obrigatorio.cjs` | ping→login→sessão→401/403 | **grava `C:/fase1-ui-teste/` fixo** | P3-10 |
| `tests/teste-login-final.cjs` | login sem API key | **`C:/fase1-ui-teste/` fixo** | P3-10 |
| `tests/teste-relay.cjs` | 18+2 cenários do relay | **`C:/fase5-teste-relay` fixo** | P3-10 |

Fora de `tests/`: `val-nex/*.cjs` (drills do importador com banco temp via `TABACARIA_DB` — seguros, fora do versionamento de suíte).

## 3. Regras de negócio cobertas vs descobertas

| Regra de negócio | Coberto por teste? |
|---|---|
| Migrações aplicam de 1 a SCHEMA_VERSION | SIM (`estoque-movimentacoes`) — cuidado: se bump para 50, teste cobre automaticamente |
| Movimentação de estoque com前后 snapshots | SIM |
| Compra grava movimentação + estoque | SIM parcial (total da compra NÃO testado — P1-02 passaria) |
| Estorno/dupla-reversão de movimentação | SIM |
| Venda PDV finalizar (transação, estoque insuficiente) | NÃO direto (parcial via e2e pedidos) |
| **Cancelamento de venda (caixa aberto/fechado/duplicado)** | **NÃO** — P1-01 não detectado por teste |
| **Cancelamento de pedido × baixa de estoque (4 origens)** | **NÃO** — P0-02/03 não detectados |
| Idempotência de pedidos online | SIM |
| Fila offline sem perda/duplicidade | SIM |
| Relay permissão/supervisor/fluxo | SIM |
| Login/sessão/permissões | PARCIAL (2 scripts manuais) |
| WhatsApp carrinho/dedup/settings | SIM; engine/intent/parser/menus/webhook/panel (~20 módulos + ~30 rotas) **sem teste** |
| Caixa abertura/fechamento/sangria | NÃO |
| Relatórios período | SIM (4 suítes fortes) |
| Relatório de lucro com custo histórico | NÃO (P1-05) |
| Financeiro reservas/baixa | NÃO (P2-08) |
| Alteração de preços em lote | NÃO |
| Inventário abrir/finalizar | NÃO |
| Importador Nex | E2E vive fora do repo (homologação); ground-truth 7/7 documentado no RELATORIO-IMPORTADOR |
| Auto-update / instalador / persistência pós-restart | NÃO no repo (pendência registrada em MEMORIA.md) |

## 4. Lacunas por módulo (sem qualquer teste)

Renderer: pdv (UI), vendas, clientes, produtos, financeiro, caixa, comissoes, precos, zonas, fornecedores, usuarios, delivery (UI), pedidasonline (UI), whatsapp (UI).
Server rotas sem teste HTTP: `/api/importar/*` (10), `/api/nex/*` (10, E2E fora do repo), `/api/imagem/*`, `/api/servidor/*`, `/api/estoque/inventario/*`, `/api/vendas/finalizar` (indireto), `/api/catalogo/*` (auto-sync/config/exibicao/sync/repair/supabase/worker-url), `/api/auth/*` (parcial), `/api/db/*` (parcial).

## 5. Suítes recomendadas ANTES das correções (reprodução dos bugs)

Todas com banco temp/`TABACARIA_DB` em diretório descartável — nenhuma toca produção:

1. `repro-estoque-pedidos.test.mjs` — matriz 4 origens × aceitar/recusar/cancelar (esperado: falha atual = P0-02/03).
2. `repro-cancel-pos-fechamento.test.mjs` — venda em caixa fechado (esperado: erro de tabela hoje; passa após mig 50).
3. `repro-compras-total.test.mjs` — compra 2 itens → `compras.total` (esperado: 0 hoje = P1-02).
4. `repro-pagamentos-caixa.test.mjs` — editar pagamento pós-venda → soma por-forma vs agregado (esperado: divergência = P1-04).
5. `repro-lucro-historico.test.mjs` — venda, alterar custo, consultar relatório (esperado: lucro muda = P1-05).

Esses testes devem falhar hoje e virar regressão permanente após as correções.

## 6. Notas de execução futura

- `npm test` global **não existe** — usar scripts `test:*` individuais.
- Vários exigem `npm run build:servidor` antes (dependem de `out/server`).
- Os 3 scripts que gravam em `C:\` fixo devem ser redirecionados para temp antes de rodar em CI.
- Typecheck PASS não implica funcionamento — separar sempre "compila" de "comportamento correto".
