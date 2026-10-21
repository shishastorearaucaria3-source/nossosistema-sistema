# Resumo Executivo — Auditoria Integral do ERP Shisha Store / Sistema Loja Tabacaria

- **Data da auditoria:** 20/10/2026
- **Alvo:** `D:\sistema loja tabacaria` (v1.0.12, HEAD local `a0bf568`)
- **Natureza:** diagnóstico somente leitura. Nenhum arquivo de código, banco, configuração ou integração foi alterado. Nenhum commit foi feito.
- **Base:** leitura estática de ~100% do backend (`src/server/`, `src/whatsapp/`, `src/main/`), schema (`src/shared/schema.ts`), renderer principal, scripts, docs de auditorias anteriores, e verificação `tsc --noEmit` (typecheck PASS).

## Situação atual

O ERP é um app Electron + React + Express com SQLite local (`node:sqlite` DatabaseSync, WAL, foreign_keys ON) como banco transacional único. O catálogo online é espelho no Supabase (com caminho legado Cloudflare Worker/D1 ainda presente). O atendimento WhatsApp é um bot completo com pedidos próprios. Existe importador do sistema legado Nex em режим de homologação (snapshots `VACUUM INTO`, nunca grava produção).

Cobertura funcional ampla (27 módulos) e arquitetura reconhecível, porém com **três falhas estruturais** que impedem confiar nos números e no estoque:

1. **Estoque de pedidos sem fonte única de verdade.** Quatro origens de pedido (PDV, WhatsApp, Delivery, orçamento) usam políticas de baixa incompatíveis. Cancelar pedido `'aceito'` criado no PDV **infla** estoque; cancelar pedido WhatsApp `'novo'` **não devolve** estoque; pedido WhatsApp aceito no Delivery **baixa duas vezes**.
2. **Migração 50 existe mas nunca executa** (`SCHEMA_VERSION = 49` em `src/shared/schema.ts:1`). A tabela `vendas_canceladas_pos_fechamento` não existe em bancos reais, então **cancelar venda vinculada a caixa fechado retorna erro 500** (`src/server/index.ts:1900-1934`).
3. **Três fontes financeiras divergentes nunca conciliadas** (agregados de `caixas`, soma de `vendas concluídas`, soma de `pagamentos`/`contas`), além de relatório de caixa com lucro fabricado (`totalVendas * 0.52`, `Caixa.tsx:475`) e margem histórica recalculada com `preco_custo` atual.

Somam-se: `compras.total` que nunca é atualizado (mostra R$ 0,00 em Fornecedores/Financeiro), cancelamento de venda que não estorna `pagamentos`, edição de pagamentos fora de transação, e ~140 achados da AUDITORIA-FUNCIONAL de 24/08/2026 ainda abertos (12 de 179 já corrigidos).

## Riscos mais importantes

| # | Risco | Evidência | Consequência |
|---|-------|-----------|--------------|
| 1 | 109 arquivos não commitados (68 modificados, 40 untracked, 1 deletado), incluindo `src/main/` inteiro untracked e módulos novos inteiros (`pedidos-online.ts`, `catalogo-sync.ts`, `fila-offline.ts`, `auditoria/`) | `git status --porcelain` | Perda de ~8.8k linhas de trabalho se o disco falhar. Não há commit de segurança. |
| 2 | Corrupção de estoque por cancelamento/baixa dupla de pedidos | `index.ts:1977`, `order.ts:192`, `Delivery.tsx:114`, `Vendas.tsx:289` | Estoque físico diverge do sistema de forma cumulativa e silenciosa. |
| 3 | Cancelamento de venda em caixa fechado 100% quebrado | `schema.ts:1` + `schema.ts:970` + `index.ts:1900` | Impossível estornar venda após fechamento de caixa; operação bloqueada com 500. |
| 4 | Números de relatório/caixa não confiáveis | `Caixa.tsx:475` (52% fixo), `data.ts:47` (custo atual), 3 fontes concorrentes | Gestão tomando decisões sobre valores fabricados/divergentes. |
| 5 | Renderer envia SQL cru por `/api/db/run` | `index.ts:552-579` | Qualquer sessão não-admin ainda escreve fora de qualquer regra de negócio; servidor não valida operações. |

## O que está sólido

- Banco único centralizado no servidor, WAL + `foreign_keys=ON` + `busy_timeout=5000` (`index.ts:96-99`).
- Venda PDV transacional com `BEGIN IMMEDIATE` e retorno de `ESTQ_INSUFICIENTE` (`index.ts:1704-1828`).
- Autenticação por sessão com bcrypt + upgrade de hash legado, middleware global, `requerAdmin`/`requerAdminOuGerente`, proteção anti-escalada (`index.ts:142-181, 393-455`).
- Backup automático (`VACUUM INTO`, retenção 30, 1º ~2min depois 4h) e restore com checkpoint (`index.ts:195-223`, `servidor.ts:432-464`).
- Importador Nex com circuit-breaker de homologação (SHA-256 do banco de produção), idempotência comprovada em E2E (4.142 re-import = 0 novas).
- Idempotência de pedidos online por UUID TEXT PK + `INSERT OR IGNORE` (`pedidos-online.ts:167-184`).
- Typecheck limpo; suíte de testes com bancos `:memory:`/temp — nenhum toca produção.

## Conclusão sobre prontidão

**O ERP não está pronto para confiança financeira/estocística em produção sem as correções P0/P1.** O PDV de venda (caminho novo transacional) é o fluxo mais confiável. Cancelamentos, pedidos (qualquer origem), caixa pós-estorno e relatórios de lucro devem ser considerados não confiáveis até a Fase 2-4 do plano de correções (`05_PLANO_CORRECOES.md`).

**Primeira ação recomendada:** proteger o trabalho (commit de segurança dos 109 arquivos, após revisão para não incluir `.env`/bancos) — antecede qualquer correção de código.
