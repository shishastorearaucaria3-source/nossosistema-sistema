# 05 — Plano de Correções

Data: 20/10/2026. Nenhuma correção foi aplicada. Este plano entra em execução somente após aprovação explícita, em etapas pequenas e verificáveis. **Regras fixas: preservar dados, não reformular o PDV, não fazer mudanças visuais, descobrir causa raiz antes de mudar.**

Ordem por dependência real descoberta na auditoria (proteção → migrações → estoque → operações → financeiro → catálogo → integrações → homologação).

---

## Etapa 0 — Proteção do trabalho (antes de qualquer código)

**Ações**
1. Revisar `git status --porcelain` e montar staging seletivo: incluir todo `src/`, `tests/`, `scripts/`, `docs/`, configs; **excluir** `.env`, `*.sqlite*`, `homologacao/`, `nexbackuptotal/`, `backups/`, dumps, `node_modules`, artefatos de build (`out/`, `dist-*`, `release/`).
2. Commit único: `wip(auditoria): snapshot 109 arquivos antes das correcoes P0/P1`.
3. Push para `origin/main` (também publica o commit local atrasado `a0bf568`).
4. Confirmar `git ls-files .env` vazio e nenhum `.sqlite` tracked.
5. Backup novo do banco de produção (rotina própria do app: `VACUUM INTO` já automático a cada 4h — conferir que `<data-dir>/backups` tem arquivo do dia).

**Critério de conclusão:** working tree limpa (ou quase), push confirmado, backup do banco do dia verificado.
**Risco:** staging com segredo — mitigado por revisão linha a linha do `git diff --cached --stat` e grep por `SENHA|TOKEN|KEY` em arquivos novos pequenos.
**NÃO executar:** `git reset --hard`, `git clean`, checkout destrutivo.

## Etapa 1 — Reprodução dos bugs (testes que falham hoje)

1. Criar as 5 suítes de reprodução descritas em `04_TESTES_E_COBERTURA.md` §5 (banco temp obrigatório).
2. Registrar falhas esperadas (evidência objetiva para cada P0/P1).
3. Confirmar que `test:estoque`, `test:pedidos`, `test:fila`, `test:whatsapp`, `test:relay` continuam PASS antes das mudanças (baseline).

**Critério:** 5 testes novos falham documentando P0-02/03, P1-01/02/04/05; suíte baseline verde.

## Etapa 2 — Migração 50 + integridade de schema

1. `SCHEMA_VERSION = 50` (`src/shared/schema.ts:1`). **Nada mais.**
2. Teste: banco 49→50 automático; cancelamento de venda em caixa fechado grava em `vendas_canceladas_pos_fechamento`; duplicado rejeitado.
3. (Opcional, decidir) mig 51: `pedidos.estoque_debitado INTEGER DEFAULT 0` — prepara Etapa 3.

**Critério:** suíte de migração PASS; repro-cancel-pos-fechamento PASS.
**Preserva PDV:** sim — zero mudança em tela.

## Etapa 3 — Integridade de estoque de pedidos (P0-02, P0-03, P1-03)

**Decisão de design (requer aprovação):** fonte única da verdade "estoque debitado?" vive no servidor, registrada em `movimentacoes` ligadas ao pedido (novo campo `pedido_id`) OU em coluna explícita em `pedidos`. Preferência: coluna + movimentação (auditoria visível).

1. Mover baixa/devolução de estoque de pedidos para endpoints do servidor (transação): `POST /api/pedidos/aceitar` (baixa idempotente se `estoque_debitado=0`), `POST /api/pedidos/cancelar` (devolve só se `estoque_debitado=1`; zera a flag).
2. WhatsApp `finalizeOrder`: gravar `estoque_debitado=1` + movimentação (preencher também `categoria`/`usuario_id`).
3. PDV modo pedido/orçamento/aprovação: **não baixa** — marca `estoque_debitado=0`; remover baixa local do `Delivery.tsx:105-121` (chamar API).
4. `Vendas.tsx:289-294` (recusa): trocar UPDATE direto pela API de cancelamento.
5. Backfill de dados: para pedidos históricos `'novo'` do WhatsApp sem flag, inferir por existência de movimentação; para `'aceito'` do PDV, assumir 0. **Backfill só em backup/homologação primeiro; produção após conferência.**
6. Rodar matriz de teste 4 origens × 3 ações.

**Critério:** estoque final = inicial em qualquer sequência de ciclo de vida de pedido; repro-estoque-pedidos PASS; regressão PDV de venda (Etapa 1) verde.
**Risco principal:** backfill errado em produção — exigir snapshot homologação + conferência de amostra antes.

## Etapa 4 — Vendas e caixa (P1-01 residual, P1-04, P1-06, P1-08, P2-04/05)

1. Estorno de `pagamentos` no cancelamento de venda (transação existente `index.ts:1865`).
2. Endpoint transacional de edição de pagamento pós-venda (substituir `PainelVenda.tsx:121-143`) recalculando agregados `caixas`.
3. Mover geração de `numero` da venda para dentro do `BEGIN IMMEDIATE`.
4. Gravar `categoria='venda'`, `usuario_id`, motivo no cancelamento de movimentações.
5. Definir e documentar se `caixas.total_vendas` inclui `taxa_entrega` (hoje inclui) — alinhar exibição do caixa.

**Critério:** repro-pagamentos-caixa PASS; soma `pagamentos` por venda = `vendas.total`; nenhuma mudança visual além de dados corretos.

## Etapa 5 — Números financeiros confiáveis (P1-02, P1-05, P2-01/02/03/08)

1. `UPDATE compras SET total=?` na criação; decisão sobre backfill histórico (recalcular de `compra_itens`).
2. Mig 51+: `venda_itens.preco_custo_unitario`; gravar na venda; relatórios usam o snapshot; remover `lucroBruto = totalVendas * 0.52` (`Caixa.tsx:475`) — exibir margem real ou ocultar.
3. Padronizar filtros de status em listas vs totais (Vendas, Caixa, Distribuição) com rótulo explícito; remover fallback `data.ts:63-67`.
4. Financeiro: filtrar `destinacao` no SUM de reservas; DELETE de conta remove/estorna reservas.
5. Rotular as três fontes de dinheiro nas telas (caixa vs faturamento vs contas).

**Critério:** repro-compras-total e repro-lucro-historico PASS; Fornecedores mostra total real; caixa sem número fabricado; conciliação manual de 1 dia bate entre as três fontes (cenário de homologação).

## Etapa 6 — Relatórios e movimentações (P2-01/04/12/14)

1. Movimentações de cancelamento contam como entrada nos relatórios de estoque (`data.ts:417-433`) ou separam coluna "devolvido".
2. Consolidar formato de datas (preferência: manter `datetime('now')` UTC e conversão só na UI via `periodo.ts` — já testado; eliminar `toISOString()` nos gravadores novos).
3. Adicionar índices: `vendas(created_at)`, `venda_itens(venda_id)`, `movimentacoes(produto_id)` — teste de plano de consulta antes/depois.

## Etapa 7 — Módulos desconectados e decisão de produto (P2-06/07/10/18, P3)

1. Fidelidade/fiado: **decidir implementar ou remover da UI** (não pode ficar meio morto).
2. `comissoes`: decidir snapshot vs cálculo on-the-fly; se manter cálculo, remover tabela órfã ou populá-la.
3. Cancelamento de compra: reverter `preco_custo` (guardando custo anterior em movimentação) ou documentar "custo não revertido" como regra.
4. Pedido online: decidir se vira venda/caixa ou permanece fluxo separado rotulado.
5. P3-02/03/04/05/06: limpeza de colunas/UI morta (apenas depois das decisões acima).
6. `SCHEMA_VERSION` continua único ponto de versionamento; `catalogo_fila_offline` entra no schema versionado.

## Etapa 8 — Catálogo, WhatsApp e integrações (P2-15/16/17, P1-07)

1. Criar `pedido_online_tracking` (migração) ou remover código.
2. Corrigir `/api/servidor/whatsapp` (rota ausente) ou remover chamada do painel.
3. Deduplicar zonas (catálogo.ts vs catalogo-sync.ts).
4. Fila de catálogo: UNIQUE em `produto_id` + OR IGNORE, ou remover fila e confiar no full push (decisão documentada).
5. Reavaliar duplo caminho D1/Supabase — marcar D1 como legado e isolar scripts.

## Etapa 9 — Segurança, testes e homologação final

1. Revisar P2-11 (`/api/db/run`): lista branca mínima de tabelas sensíveis além de usuarios/permissoes (vendas, caixas, produtos, pagamentos).
2. Redirecionar scripts de teste de `C:\` para temp (P3-10).
3. `npm test` global agregando as suítes seguras.
4. Atualizar MEMORIA.md (schema 49/50+, decisões novas) e README.
5. Homologação em snapshot: cenários A-G do pedido original (ver abaixo) + regressão PDV completa.
6. Só então nova versão (1.0.13) e release.

**Critério global de encerramento:** todos os testes de reprodução PASS como regressão; cenários A-G aprovados em homologação; typecheck/build verdes; zero P0/P1 abertos.

---

## Cenários de homologação obrigatórios (Etapa 9)

| Cenário | Fluxo | Confirma |
|---|---|---|
| A | cadastrar/editar produto → preço, custo, estoque, catálogo (sync) | preços/custo/catálogo |
| B | venda PDV com desconto item + desconto global + 2 formas + taxa entrega | vendas/estoque/caixa/pagamentos/relatórios |
| C | cancelar venda em caixa ABERTO e em caixa FECHADO (2× cada) | estorno completo, sem duplicar, tabela pós-fechamento |
| D | receber mercadoria (compra) → cancelar compra | custo, estoque, `compras.total` |
| E | pedido online (Supabase stand-in) + pedido WhatsApp + Delivery (aceitar, recusar, cancelar) | estoque idempotente, status nuvem |
| F | reiniciar app/servidor | persistência, caminho do banco, backups, timers |
| G | reimport Nex no snapshot | idempotência, totais, dados existentes preservados |

## Ordem definitiva vs pedido original (Etapa 9 do briefing)

O briefing pedia começar por proteção de dados e fontes de verdade — o plano acima obedece: Etapa 0 (proteção) → 1 (reprodução) → 2 (schema) → 3 (fonte de verdade de estoque) → 4-5 (operações e financeiro) → 6-8 (demais) → 9 (homologação). Nenhuma etapa reformula UI.

## Por que a primeira correção é a Etapa 0

Sem commit do working tree, qualquer correção futura se soma a 109 arquivos sem checkpoint — impossível isolar regressão, impossível reverter a correção sem arrastar trabalho não relacionado, risco real de perda total de tudo que mudou desde 30/08. Proteger o trabalho é o único passo que reduz risco de todos os outros.
