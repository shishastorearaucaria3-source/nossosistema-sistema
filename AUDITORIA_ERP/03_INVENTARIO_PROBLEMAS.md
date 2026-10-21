# 03 — Inventário de Problemas

Data: 20/10/2026. Classificação P0 (perda/corrupção de dados ou exposição grave) · P1 (divergência financeira/estoque/falha de operação) · P2 (sincronização incompleta/informação inconsistente) · P3 (secundário/manutenção/UI). Ocorrências agrupadas por causa raiz. Status: **COMPROVADO** salvo marcação (HIPÓTESE / NÃO CONFIRMADO).

---

## P0

### P0-01 — Working tree sem proteção (109 arquivos não commitados)
- **Módulos:** todos (main, renderer, server, whatsapp, catálogo, testes, scripts)
- **Arquivos:** `src/main/` inteiro untracked (5); `src/server/{pedidos-online,fila-offline,catalogo-auto,catalogo-sync,config-catalogo,repair-catalogo,supabase-client}.ts` untracked; `src/server/auditoria/` untracked; 68 modificados; `tests/` 5 untracked
- **Evidência:** `git status --porcelain` = 109; `git diff --stat` = 69 files, +8846/−11059; HEAD `a0bf568` 1 commit à frente de `origin/main` não pushado
- **Causa raiz:** longos períodos sem commit durante desenvolvimento; checkpoint "cline" de 30/08 não cobre mudanças posteriores
- **Consequência:** perda irreversível de trabalho se falhar disco/máquina; impossível bisect/diff confiável
- **Reproduzir:** `git status --porcelain | Measure-Object -Line`
- **Correção recomendada:** commit de segurança revisado (excluir `.env`, `*.sqlite`, dumps grandes) + push. **Não executado — aguarda aprovação explícita.**
- **Riscos da correção:** commit incluir segredos se revisão for apressada — mitigar com revisão de staging linha a linha
- **Testes:** conferir `git ls-files .env` vazio após commit; app builda e roda igual (commit não altera comportamento)

### P0-02 — Cancelamento de pedido com premissa de estoque falsa (corrompe estoque nos dois sentidos)
- **Módulos:** pedidos, PDV, WhatsApp, Delivery, estoque
- **Arquivos:** `src/server/index.ts:1977` (`estoqueDebitado = pedido.status !== 'novo'`), `:1994-2002`; origens: `Pdv.tsx:758-770,866-889` (aceito sem baixa), `Vendas.tsx:308-325` (idem), `whatsapp/order.ts:190-194` (novo COM baixa)
- **Tabelas:** `pedidos`, `produtos.estoque`, `movimentacoes`
- **Causa raiz:** premissa única sobre comportamento heterogêneo de 4 criadores de pedido
- **Consequência:** cancelar pedido aceito do PDV **infla** estoque; cancelar WhatsApp novo **perde** estoque — divergência cumulativa com o físico
- **Reproduzir (ambiente seguro):** banco temp: criar pedido 'aceito' sem baixa → cancelar → estoque sobe; criar pedido 'novo' com baixa → cancelar → estoque não volta
- **Correção:** fonte única: registrar em `pedidos` se estoque foi debitado (coluna explícita) OU derivar de `movimentacoes` ligadas ao pedido; nunca presumir pelo status
- **Dependências:** P1-03 (baixa dupla) tem a mesma causa raiz parcial
- **Testes:** matriz 4 origens × aceitar/recusar/cancelar conferindo estoque; regressão PDV

### P0-03 — Baixa dupla de estoque em pedido WhatsApp aceito no Delivery
- **Módulos:** WhatsApp, Delivery, estoque
- **Arquivos:** `whatsapp/order.ts:192` (baixa ao criar) + `Delivery.tsx:107-121` (baixa de novo ao novo→aceito)
- **Causa raiz:** Delivery repete baixa sem checar origem do pedido; baixa do WhatsApp sem `movimentacoes` impede detecção
- **Consequência:** saldo −1 unidade permanente por pedido (cancelamento em 'aceito' devolve só 1×)
- **Reproduzir:** temp: pedido WhatsApp 1× item → Delivery avançar → estoque −2; cancelar → −1
- **Correção:** puxar para o servidor (transação) com guarda de idempotência; PDV/Delivery nunca baixam localmente
- **Testes:** mesmo do P0-02 + pedido WhatsApp nunca deve gerar 2 movimentações de saída

---

## P1

### P1-01 — Migração 50 nunca executa: cancelamento de venda pós-fechamento retorna 500
- **Módulos:** vendas, caixa, schema
- **Arquivos:** `src/shared/schema.ts:1` (`SCHEMA_VERSION = 49`) vs `schema.ts:970-998` (`migrations[50]`); consumo: `index.ts:1900,1907-1910`; rollback `:1933-1936`
- **Evidência:** loop `migrate()` `index.ts:117-135` só aplica até 49; build `out/server` também 49
- **Causa raiz:** bump de versão esquecido ao adicionar a migração
- **Consequência:** operação legítima de negócio (estorno após fechamento de caixa) 100% bloqueada; fluxo tem trilha de auditoria pronta mas inalcançável
- **Correção:** `SCHEMA_VERSION = 50` (1 linha). Bancos existentes aplicam na próxima abertura
- **Riscos:** baixíssimo; mig 50 usa CREATE TABLE + índices IF NOT EXISTS — segura
- **Testes:** abrir banco temp vazio → tabela existe; abrir banco com user_version=49 → migra; cancelar venda de caixa fechado grava na tabela; cancelamento duplicado rejeitado (`:1900-1905`)

### P1-02 — `compras.total` nunca atualizado (R$ 0,00 em Fornecedores e Financeiro)
- **Módulos:** compras, fornecedores, financeiro
- **Arquivos:** INSERT com total=0 `index.ts:1437-1441`; loop acumula `total` `:1450-1455`; **UPDATE ausente** (o `UPDATE` em `:1563` é só do cancelamento); consumidores `Fornecedores.tsx:99,361`, `Financeiro.tsx:171`
- **Consequência:** "Comprado" por fornecedor e coluna do financeiro sempre 0; decisão de reposição baseada em zero
- **Correção:** `UPDATE compras SET total=? WHERE id=?` antes do COMMIT; considerar recalcular histórico em migração de dados
- **Testes:** compra de 2 itens → `compras.total` = soma; cancelamento preserva total histórico

### P1-03 — Recusa de pedido contorna o servidor (sem estoque, sem autorização)
- **Módulos:** vendas, pedidos
- **Arquivo:** `Vendas.tsx:289-294` — `UPDATE pedidos SET status='cancelado'` via `/api/db/run`
- **Causa raiz:** arquitetura de SQL cru do renderer; rota correta existe (`POST /api/pedidos/cancelar`) mas não é usada
- **Consequência:** pedido WhatsApp 'novo' recusado **nunca devolve estoque**; bypass de checagem de sessão do endpoint
- **Correção:** trocar chamada pela API de cancelamento; reforçar bloqueio de escrita em `pedidos` via `/api/db/run` (ver P2-11)
- **Testes:** recusar pedido WhatsApp novo → estoque devolvido 1×

### P1-04 — Edição de pagamentos fora de transação e sem recalcular caixa
- **Módulos:** vendas, caixa
- **Arquivo:** `PainelVenda.tsx:121-143` — INSERT/DELETE direto em `pagamentos`; relatórios `data.ts:197` e `Caixa.tsx:213` recalculam por-forma a partir de `pagamentos`
- **Consequência:** total por-forma do caixa diverge dos agregados `caixas` gravados na venda (`index.ts:1818`); falha no meio deixa pagamentos parciais
- **Correção:** endpoint transacional no servidor que ajusta `pagamentos` + `caixas` atomicamente
- **Testes:** trocar forma de pagamento pós-venda → soma `pagamentos` = `vendas.total` e bate com agregado do caixa

### P1-05 — Margem histórica reescrita (custo atual) + lucro fabricado no caixa
- **Módulos:** relatórios, caixa, financeiro
- **Arquivos:** `data.ts:47,87,167,239,314,392`, `Financeiro.tsx:222,244` (preco_custo ATUAL); `Caixa.tsx:475` (`lucroBruto = totalVendas * 0.52`); raiz: `venda_itens` sem snapshot de custo (`schema.ts:75-83`)
- **Consequência:** alterar custo de 1 produto reescreve lucro de vendas antigas; "Lucro Bruto" do caixa é número inventado (52%)
- **Correção:** adicionar `preco_custo_unitario` em `venda_itens` (mig 51), gravar na venda, recalcular relatórios; remover constante 52% (exibir margem real ou esconder)
- **Testes:** venda → alterar custo → relatório histórico deve permanecer; caixa sem número fabricado

### P1-06 — Cancelamento de venda não estorna `pagamentos`
- **Módulos:** vendas, caixa, financeiro
- **Arquivo:** `index.ts:1865-1938` — nenhum UPDATE/DELETE em `pagamentos`
- **Consequência:** pagamentos órfãos de venda cancelada; qualquer somatório futuro por `pagamentos` infla
- **Correção:** dentro da transação de cancelamento, marcar/estornar pagamentos (coluna `estornado` ou DELETE com log)
- **Testes:** cancelar venda → nenhum pagamento ativo restante; relatório por-forma bate

### P1-07 — `pedido_online_tracking` inexistente (falha silenciosa)
- **Módulos:** pedidos online
- **Arquivo:** `pedidos-online.ts:217,225` — INSERT/SELECT em tabela sem migração
- **Consequência:** rastreio de status nunca persiste; erros engolidos em try/catch
- **Correção:** migração de criação (ou remover código morto se feature abandonada)
- **Testes:** registrar+listar tracking após migração

### P1-08 — Número da venda gerado fora da transação
- **Módulos:** PDV
- **Arquivo:** `index.ts:1752-1762` (sequência fora do BEGIN em `:1764`)
- **Consequência:** duas vendas concorrentes podem gerar o mesmo `numero` (UNIQUE) → uma falha após consumir sequência, ou pior em cenário multi-terminal (HIPÓTESE de ocorrência — janela comprovada, frequência não medida)
- **Correção:** mover geração para dentro do BEGIN IMMEDIATE (o UPDATE…RETURNING atômico já foi citado em auditoria anterior como existente — verificar implementação)
- **Testes:** 2 conexões gravando venda simultaneamente em banco temp

---

## P2

### P2-01 — Listas de vendas/caixa sem filtro de status vs totais filtrados
- `Vendas.tsx:210-231`, `Caixa.tsx:495-499`, `CaixaTransacoes.tsx:51`, `Distribuicao.tsx:376-380,117-128`
- Consequência: usuário vê canceladas na lista e soma diferente; opção "Todas" infla faturamento
- Correção: padronizar filtro + rótulo explícito de "inclui canceladas"

### P2-02 — Três fontes de entrada/saída de dinheiro nunca conciliadas
- `Caixa.tsx:450,470` (agregados) vs `Financeiro.tsx:144`/`data.ts:43` (vendas) vs `Financeiro.tsx:145` (contas)
- Correção: definir fonte oficial por métrica (caixa = movimento real; vendas = faturamento; contas = regime de caixa) e rotular telas

### P2-03 — Fallback de relatório troca definição de faturamento
- `data.ts:63-67,105-110` — sem vendas, soma `caixas` fechadas
- Correção: remover fallback ou separar métricas

### P2-04 — Movimentações de venda sem `categoria` e sem `usuario_id`
- `index.ts:1788` vs entrada de compra `:1471-1475` e cancelamento de pedido `:1990`
- Consequência: ficha de produto e filtros por categoria/usuário incompletos para saídas de venda
- Correção: gravar campos na origem + backfill opcional

### P2-05 — Cancelamento de venda não registra usuário/motivo na movimentação
- `index.ts:1875-1885` — só muda tipo; `vendas_canceladas_pos_fechamento.motivo` sempre NULL (`:1910`)

### P2-06 — Fidelidade/fiado mortos
- `clientes.pontos` (`schema.ts:56`), `fid_total` (`:497`), `fiado_limite` (`:57`) nunca usados pelo fluxo de venda; `fiado_limite` nunca validado; venda fiado não gera `contas` nem incrementa `debito`
- Decidir: implementar ou remover da UI

### P2-07 — Tabela `comissoes` sem nenhuma escrita
- `schema.ts:601`; relatório calcula on-the-fly (`data.ts:134-146`) — decisão de arquitetura pendente (snapshot vs cálculo)

### P2-08 — Financeiro: baixa contada como reserva + órfãs
- `Financeiro.tsx:129,143,368-376,387` — SUM não filtra `destinacao`; DELETE de conta não limpa reservas

### P2-09 — Fluxos sem transação (atomicidade)
- `Pdv.tsx:734-751,846-913` (pedido/orçamento N `db.run`); `Delivery.tsx:105-121`; `AlterarPrecos.tsx:207-220`; `Caixa.tsx:304-341` (sangria por forma); `whatsapp/order.ts:167-174` (sequência pedido)
- Correção: migrar para `/api/db/transacao` ou endpoints dedicados

### P2-10 — Cancelamento de compra não reverte `preco_custo`
- `index.ts:1495-1575` — estoque volta, custo fica

### P2-11 — `/api/db/run` aceita qualquer SQL de escrita (fora usuarios/permissoes)
- `index.ts:552-579` — arquitetura intencional de proxy SQL, mas impede todas as regras de negócio centralizadas e permitiu o bypass do P1-03
- Correção gradual: lista branca de tabelas/operações ou endpoints por domínio

### P2-12 — Datas misturadas: `datetime('now')` (UTC sem tz) vs `toISOString()` (ISO com Z)
- Defaults de schema (UTC) vs `whatsapp/order.ts:160,179,196`, `fila-offline.ts:34,51,98`, `auditoria/importador.ts:110`
- Filtro de período local corrigido em `relatorios/periodo.ts` (testado), mas comparações string entre formatos seguem perigosas

### P2-13 — Dinheiro em REAL (float IEEE754)
- Todos os campos monetários; arredondamento só na camada JS. Risco de erro de centavos em somatórios longos (conhecimento padrão; magnitude não medida no banco real)
- Decisão MEMORIA.md registra "dinheiro sempre number em REAL" como decisão consciente — manter ou migrar para INTEGER centavos deve ser decisão explícita

### P2-14 — Índices ausentes em consultas quentes
- Sem índice em `vendas.created_at`, `venda_itens.venda_id`, `movimentacoes.produto_id` (só 17 índices no schema; existentes: `idx_produtos_nome`, `idx_clientes_telefone`, `idx_mov_documento/categoria/compra`, `idx_pedidos_telefone/origem`, `idx_wa_*`, `idx_clientes_enderecos_cliente`)
- Performance degrada com o crescimento do histórico Nex importado (54k vendas)

### P2-15 — `/api/servidor/whatsapp` chamada inexistente
- `src/main/servidor.ts:372` → 404 silencioso

### P2-16 — Fila de catálogo duplicável e inútil como fila
- `catalogo.ts:54` sem OR IGNORE; sync é full push e limpa tudo (`catalogo-sync.ts:301`) — fila nunca filtra envio; `criarFilaPendente` morto (`:95-102`)

### P2-17 — Zonas de entrega: código duplicado
- `catalogo.ts:108-123` vs `catalogo-sync.ts:53-68`

### P2-18 — Pedidos online fora dos relatórios de vendas/caixa
- Decisão de produto necessária: pedido online importado deve virar venda? Hoje some dos totais gerenciais

---

## P3

| ID | Problema | Evidência |
|---|---|---|
| P3-01 | NFe = placeholder "em breve" | `App.tsx` menu `emBreve` |
| P3-02 | `compras.status` sempre `'paga'` | `index.ts:1439` |
| P3-03 | `contas.compra_id`/`origem` nunca preenchidos | `schema.ts:469-470`, `Financeiro.tsx:420` |
| P3-04 | `venda_itens.desconto/observacao` gravados mas não exibidos no PainelVenda | `PainelVenda.tsx:73` |
| P3-05 | `preco_automatico` — UI sem lógica | `Produtos.tsx:1281` |
| P3-06 | Coluna "Última compra" sempre `'—'` | `Clientes.tsx:446` |
| P3-07 | `vendas.cliente_id` pode não ser preenchido em fluxos antigos (coluna citada como órfã em auditoria anterior — NÃO CONFIRMADO em vendas novas) | AUDITORIA-FUNCIONAL |
| P3-08 | Endpoints órfãos: `/api/catalogo/sync` (manual), `/api/catalogo/worker-url`, `/api/versao`, `/api/nex/{analisar,preparar,importar}` | `index.ts:1105,1180,974,1261-1282` |
| P3-09 | MEMORIA.md desatualizado (schema 17 vs 49; não cita whatsapp/pedidos-online/supabase) | `MEMORIA.md:326` |
| P3-10 | 3 scripts de teste gravam em `C:\` hardcoded | `teste-fluxo-obrigatorio.cjs`, `teste-login-final.cjs`, `teste-relay.cjs` |
| P3-11 | SSRF em `resultado-pages.txt` — provável falso positivo; script gerador inexiste no repo | `resultado-pages.txt:22` |
| P3-12 | Estado `preparado` do importador Nex em memória (~660MB); reinício obriga re-preparar | CHECKPOINT-NEX §limitações |
| P3-13 | `sequencias` seed 'venda'=56780 hardcoded | `schema.ts` mig 18 |
| P3-14 | `.gitignore` ignora `docs/` e `MEMORIA.md` — documentação fora do versionamento | `.gitignore` |
| P3-15 | Loopback aceito como admin por design — qualquer processo local tem poder admin | `index.ts:407-410,426-433` |

---

## Cruzamento com AUDITORIA-FUNCIONAL (24/08/2026, 179 achados)

**Corrigidos desde então (~12):** CRIT-14 (auth SQL — mitigado), CRIT-15 (seed), USU-02 (bcrypt), CRIT-16 (rotas destrutivas), CRIT-17 (senha localStorage), CRIT-09/11 (período UTC — módulo `periodo.ts` + 4 testes), CRIT-04 (venda transacional novo caminho), CRIT-05/FIN-05/REL-05 (cancelamento estorna caixa em caixa aberto), CRIT-08 parcial (delivery usa API), BK-01 (backup automático), USU-08 (invalidação de sessão).

**Ainda abertos e confirmados nesta auditoria:** CRIT-13 (52%), CRIT-06 (quebra de caixa com fallback), CRIT-01/02/03 (fiado/fidelidade), CRIT-07 (entrega não vira venda), CRIT-10 (snapshot de custo), CRIT-19 (comissão), CRIT-20..22 (financeiro), arquitetura de SQL cru.

**Não reconfirmados (marcar como pendentes):** detalhes do importador legado IMP-02..06, DL-05, REL fan-out.
