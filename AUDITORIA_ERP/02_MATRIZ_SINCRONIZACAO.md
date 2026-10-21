# 02 — Matriz de Sincronização

Data: 20/10/2026. Rastreamento INTERFACE → API → SERVIÇO → SQL → BANCO → DESTINOS. Evidência = arquivo:linha verificado. Situação: COMPROVADO salvo indicação.

Legenda de situação: OK = fluxo íntegro · QUEBRADO = falha comprovada · DIVERGENTE = números não batem · PARCIAL = funciona com ressalvas · NÃO INVESTIGADO = cobertura insuficiente nesta auditoria.

---

## Fluxo 1 — Venda no PDV (fonte de verdade: `POST /api/vendas/finalizar`)

| Campo | Valor |
|---|---|
| Origem oficial | `Pdv.tsx:917-937` → `POST /api/vendas/finalizar` (`index.ts:1704-1828`) |
| Transação | `BEGIN IMMEDIATE` (`:1764`) → COMMIT (`:1820`); retorno `ESTQ_INSUFICIENTE` |
| Tabelas escritas | `vendas` (`:1766-1781`), `venda_itens` (`:1782-1796`), `movimentacoes` tipo `saida` + `estoque_anterior/posterior` (`:1788-1807`, só se `controla_estoque=1`), `pagamentos` (`:1809-1816`), `produtos.estoque` (`:1797-1807`), `caixas` agregados (`:1817-1819`) |
| Destinos | Caixa (`caixas.total_vendas += total` — total **inclui** taxa_entrega; `qtd_vendas += 1`; `descontos += desconto` **só global**), relatórios (`data.ts` WHERE status='concluida'), notificador catálogo |
| Regras | número da venda vem de `sequencias` **fora da transação** (`:1752-1762`, comentário explícito); desconto por item gravado em `venda_itens.desconto` (`schema.ts:401`) mas **não** somado em `caixas.descontos`; `subtotal` bruto, `total = subtotal − descontos + taxa` |
| Não escrito | `comissoes` (tabela nunca recebe INSERT em todo `src/`), `clientes.debito`, `contas` |
| Proteção duplicidade | transação + status check no cancelamento |
| Erros | `catch` → ROLLBACK + 500 (`:1821-1827`) |
| **Situação** | **OK no caminho novo** (venda concluída) · DIVERGENTE nos agregados de caixa (desconto por item ignorado) |
| Testes necessários | E2E: venda com desconto por item + múltiplas formas → conferir `caixas.descontos`, soma de `pagamentos`, estoque; venda com taxa_entrega → conferir se total_vendas deve incluir taxa |

## Fluxo 2 — Cancelamento de venda (fonte: `POST /api/vendas/cancelar`)

| Campo | Valor |
|---|---|
| Origem | `index.ts:1832-1938`, chamado por Vendas/PDV |
| Transação | `BEGIN IMMEDIATE` (`:1865`) → COMMIT (`:1930`) |
| Efeitos | devolve estoque só itens com `controla_estoque=1` (`:1867-1883`); `movimentacoes.tipo='cancelamento'` (`:1875-1885`) **sem usuário/motivo**; caixa ABERTO: reverte agregados com `MAX(0,...)` e soma `cancelamentos` (`:1914-1918`); caixa FECHADO: INSERT em `vendas_canceladas_pos_fechamento` (`:1907-1910`); venda sem `caixa_id` → bloqueio total (`:1922-1927`) |
| **Falha comprovada** | **Migração 50 nunca roda** (`SCHEMA_VERSION=49`, `schema.ts:1`; `migrations[50]` em `schema.ts:970-998`) → tabela inexistente → exceção → ROLLBACK → 500 (`:1933-1936`). **Cancelar venda de caixa fechado 100% quebrado.** |
| Não estornado | `pagamentos` permanecem vinculados a venda cancelada (órfãos lógicos) |
| Divergência | não devolve desconto por item em `caixas.descontos` (nunca somado — ver Fluxo 1) |
| **Situação** | **QUEBRADO** (pós-fechamento) · PARCIAL (caixa aberto: funciona mas ignora desconto-por-item e pagamentos) |
| Testes necessários | 1) cancelar venda caixa fechado em banco com mig 50 aplicada; 2) cancelar 2× mesma venda (idempotência); 3) conferir que soma de `pagamentos` de vendas canceladas não entra em relatórios |

## Fluxo 3 — Relatórios e caixa (leituras)

| Campo | Valor |
|---|---|
| Fonte | `src/renderer/src/features/relatorios/data.ts` (importado por `Relatorios.tsx:13-30`) |
| Filtro status | queries de vendas filtram `v.status='concluida'` em `data.ts:43,51,81,91,127,142,155,171,243,280,298,319,340,359,379,394,410` |
| Divergências | 1) `Vendas.tsx:210-224` lista sem filtro de status, total (`:227-231`) só `concluida`; 2) `Caixa.tsx:495-499` lista vendas do caixa sem filtro; 3) `Distribuicao.tsx:376-380` opção "Todas" inclui canceladas no faturamento; 4) fallback: sem vendas, faturamento passa a somar `caixas` fechadas (`data.ts:63-67,105-110`) — muda definição no meio do relatório; 5) movimentações `cancelamento` não contam como entrada (`data.ts:417-433`); 6) **lucro usa `preco_custo` ATUAL** (`data.ts:47,87,167,239,314,392`; `Financeiro.tsx:222,244`) — `venda_itens` não guarda custo (`schema.ts:75-83`); 7) `Caixa.tsx:475` **`lucroBruto = totalVendas * 0.52`** (constante fabricada); 8) timeline "Desconto" = `subtotal−total` (`Caixa.tsx:186`) ≠ `caixas.descontos`; 9) três fontes de entrada/saída nunca conciliadas: `caixas` (`Caixa.tsx:450,470`) vs `SUM(vendas)` (`Financeiro.tsx:144`, `data.ts:43`) vs `contas.valor_pago` (`Financeiro.tsx:145`) |
| Home | `dashboardData.ts` — faturamento só concluída; `pedidosNovos` conta só status='novo' (só WhatsApp cria 'novo'; pedidos PDV em 'aceito' não contam) |
| **Situação** | **DIVERGENTE** |
| Testes necessários | cenário de ouro: 1 venda com desconto-por-item + 1 cancelada + caixa fechado → reconciliar exibição × banco; teste de lucro histórico após alterar `preco_custo` |

## Fluxo 4 — Pedidos locais (tabela `pedidos`) — matriz de origens × estoque

| Origem | Status inicial | Baixa estoque? | Movimentação? | Transação? | Evidência |
|---|---|---|---|---|---|
| WhatsApp `finalizeOrder` | `novo` | **Sim** | **Não** | Sim | `whatsapp/order.ts:164-203` (baixa `:190-194`) |
| PDV `finalizarComoPedido` | `aceito` | **Não** | — | **Não** (N `db.run`) | `Pdv.tsx:758-770, 846-888` |
| PDV modo pedido | `aceito` | **Não** | — | **Não** | `Pdv.tsx:866-889` |
| Aprovar orçamento | `aceito` | **Não** | — | Não | `Vendas.tsx:308-325` |
| Delivery `avancarStatus` (novo→aceito) | `aceito` | **Sim (de novo!)** | Sim (sem categoria) | **Não** (2 `db.run`) | `Delivery.tsx:101-125` |

**Cancelamento de pedido (`POST /api/pedidos/cancelar`, `index.ts:1940-2014`):**

- Premissa `estoqueDebitado = pedido.status !== 'novo'` (`:1977`) — **falsa nas duas pontas**:
  - pedido `'aceito'` do PDV (nunca debitou) → cancelamento **INFLA** estoque (`:1994-2002`);
  - pedido WhatsApp `'novo'` (já debitou em `order.ts:192`) → cancelamento **NÃO devolve** — estoque perdido.
- **Baixa dupla:** pedido WhatsApp `'novo'` aceito no Delivery baixa 2× (`order.ts:192` + `Delivery.tsx:114`); cancelar depois em `'aceito'` devolve 1× → saldo permanentemente −1.
- **Bypass:** `Vendas.tsx:289-294` recusa pedido com `UPDATE pedidos SET status='cancelado'` **direto via SQL** — sem devolver estoque e sem autorização de sessão (contorna `index.ts:1940`).

| Situação | **QUEBRADO — corrompe estoque** |
|---|---|
| Testes necessários | matriz 4 origens × (aceitar, recusar, cancelar) conferindo estoque; teste de regressão do PDV preservado |

## Fluxo 5 — Pedidos online (nuvem → local)

| Campo | Valor |
|---|---|
| Fonte | `pedidos-online.ts:puxarPedidosOnline` (`:87-392`); pull manual (`index.ts:1113`) ou timer 60s (`catalogo-auto.ts:45-58`) |
| Idempotência | `pedidos_online.id TEXT PK` (UUID D1/Supabase) + `INSERT OR IGNORE` + set `jaVistos` (`:167-184`) — **OK** |
| Estoque | baixa direta `UPDATE produtos SET estoque = estoque - ?` (`:193`) — **sem `movimentacoes` e sem checar `controla_estoque`** |
| Tracking | `registrarTracking` grava em `pedido_online_tracking` (`:217,225`) — **tabela nunca criada** (sem migração) → falha silenciosa em try/catch |
| Status de volta | `sincronizarStatusSupabase` (`:326-340`) |
| Cancelamento | devolve estoque só se `controla_estoque=1`, movimentação `outras_entradas` doc `PO-{id}` (`:371-373`), protegido por `jaRestaurado` — **dessincroniza** com a baixa inicial indiscriminada (`:193`) |
| Vira venda local? | **Não** — nunca entra em relatórios de vendas/caixa |
| **Situação** | **PARCIAL/QUEBRADO** (estoque sem rastreio; tracking inexistente; baixa×devolução assimétricas) |
| Testes necessários | E2E já existe parcial (`tests/e2e-pedido-online.cjs`, `pedidos-online.test.mjs`); adicionar: item `controla_estoque=0` no pedido online; cancelamento online refletido na nuvem |

## Fluxo 6 — WhatsApp (bot → pedidos)

| Campo | Valor |
|---|---|
| Fonte | `whatsapp/order.ts:finalizeOrder` (`:164-203`) — transacional: sequência `'pedido'` (SELECT+UPDATE **não atômicos**, `:167-174`), INSERT `pedidos` (`:176-179`), itens (`:182-187`), baixa estoque **sem movimentação** (`:190-194`), carrinho → `ORDERED` (`:196`) |
| Cliente | criado em `service.ts:37` no primeiro contato; pedido guarda só `cliente_nome/telefone` — **sem `cliente_id`** |
| Carrinho | `whatsapp_carts`/`items` → vira `pedidos` (não `pedidos_online`) |
| Concorrência | baixa de estoque em transação própria; PDV usa `BEGIN IMMEDIATE` — janela pequena mas sem lock de produto entre os dois fluxos (hipótese: race possível, não medida) |
| **Situação** | **QUEBRADO** em conjunto com Fluxo 4 (baixa sem movimentação + cancelamento com premissa falsa + baixa dupla no Delivery) |

## Fluxo 7 — Catálogo / Supabase

| Campo | Valor |
|---|---|
| Fonte oficial | local (SQLite) → push Supabase |
| Notificação | UPDATE/INSERT em produtos via `/api/db/run` dispara `notificarAlteracaoProduto` (`index.ts:54-69`) → `alterado_em` + `INSERT catalogo_fila` (`catalogo.ts:51-55`) — sem `OR IGNORE`/UNIQUE → **duplicatas na fila** (inócuas, ver abaixo) |
| Sync | `sincronizarCatalogo` (`catalogo-sync.ts:104-317`): **full push** de todos `ativo=1` (lotes de 50), desativa ausentes no Supabase, zonas locais, `limparFilaCatalogo()` no sucesso (`:301`) — fila é só "dirty flag", nunca lida para filtrar |
| Código morto | `criarFilaPendente` (`catalogo-sync.ts:95-102`) — zero chamadas |
| Fila offline | `fila-offline.ts` — retry/backoff, máx. 5 tentativas; tabela runtime sem índice |
| Timer | 60s: sync completo + puxar pedidos (`catalogo-auto.ts:24-58`), iniciado no boot (`index.ts:2201-2213`) |
| Zonas | duplicação: `catalogo.ts:108-123` e `catalogo-sync.ts:53-68` |
| Legado D1 | worker + `scripts/sync-catalogo.mjs` + `migrar-d1-para-supabase.mjs` coexistem — **duas implementações de catálogo** |
| **Situação** | PARCIAL (funciona; full push a cada 60s é caro; fila sem uso real; duplo caminho Supabase/D1) |

## Fluxo 8 — Compras / estoque (fonte: `POST /api/estoque/movimentar`)

| Campo | Valor |
|---|---|
| Origem | `Compra.tsx:152-162` → `index.ts:1334-1490` |
| Transação | `BEGIN` (`:1432`) → COMMIT (`:1482`) |
| Efeitos | valida saída sem saldo (`:1420-1431`); INSERT `compras` com `total=0` (`:1437-1441`); estoque ± (`:1456-1464`); **`preco_custo` atualizado na entrada** (`:1457-1458`); `movimentacoes` com categoria/documento/usuario_id/compra_id (`:1471-1475`); `compra_itens` (`:1476-1478`); notifica catálogo |
| **BUG** | **`UPDATE compras SET total` nunca acontece** — `compras.total` fica eternamente 0. HTTP devolve total calculado (`:1489`) mascarando o erro. Consumidores: `Fornecedores.tsx:99,361` e `Financeiro.tsx:171` mostram R$ 0,00; nenhum filtra `cancelada` |
| Cancelamento | `:1495-1575` — devolve estoque (`controla_estoque=1`), movimentação `devolucao_fornecedor`, `cancelada=1`; **não reverte `preco_custo`**; `compras.status` fixo `'paga'` (`:1439`) — coluna sem significado |
| Inventário | `/api/estoque/inventario/abrir|finalizar|cancelar` (`:1576,:1620,:1693`) — transacional, ajusta estoque |
| **Situação** | **QUEBRADO** (total) · PARCIAL (custo não revertido no cancelamento) |

## Fluxo 9 — Financeiro (contas, reservas, separações)

| Campo | Valor |
|---|---|
| Escritas | só manuais em `Financeiro.tsx` (INSERT `:320-325`, UPDATE `:313-317`, baixa `:368-371`, DELETE `:385-390`) |
| Automação | **Nenhuma.** Compra não gera conta a pagar; venda fiado não gera conta a receber; `clientes.debito` só manual (`Clientes.tsx:388`) |
| Órfãos | `contas.compra_id`/`origem` (schema `:469-470`) nunca preenchidos — UI exige "manual" sempre (`Financeiro.tsx:420`) |
| **BUG** | reservas: `SUM(reservas_contas)` não filtra `destinacao` (`Financeiro.tsx:129,143,161,175`) e baixa **insere outra linha na mesma tabela** com `destinacao='Baixa de pagamento'` (`:368-376`) → conta parcialmente paga soma reserva+baixa, status "Reservado" indevido; DELETE de conta deixa reservas órfãs (`:387`) |
| Fidelidade/fiado | `clientes.pontos`, `fid_total`, `fiado_limite` **nunca** alterados por venda — 100% manual; `fiado_limite` nunca validado |
| **Situação** | PARCIAL (funciona como cadastro manual; totais inflados por bug de reservas) |

## Fluxo 10 — Preços

| Campo | Valor |
|---|---|
| Origem | `AlterarPrecos.tsx:aplicar()` (`:202-227`) — INSERT `alteracoes_preco` + loop itens + UPDATE `produtos` via `/api/db/run` — **sem transação** (falha no meio = histórico incompleto + preços meio-aplicados) |
| Destino catálogo | notificador dispara por UPDATE (`index.ts:54-62`) → vai à nuvem no próximo sync (60s) — **OK** |
| `preco_automatico` | flag em schema (`:300`) e formulário (`Produtos.tsx:1281-1282`) — **nenhuma lógica de cálculo existe no repo** |
| Promoção | `preco_promo` não editável em lote; `promocional`/`preco_promo` chegam ao catálogo pelo push completo |
| **Situação** | PARCIAL (funciona sem atomicidade; preco_automatico é UI morta) |

## Fluxo 11 — Clientes

| Campo | Valor |
|---|---|
| Histórico | `Clientes.tsx:254-255` — `vendas WHERE cliente_id=? AND status!='cancelada'` — **OK** |
| Última compra | carregado (`:259`) mas coluna da lista mostra sempre `'—'` (`:446`) — bug de UI |
| Fiado | débito manual; venda PDV não incrementa |
| WhatsApp/importação | criam clientes sem vínculo posterior a pedidos |
| **Situação** | PARCIAL |

## Fluxo 12 — Inventário (contagem física)

`index.ts:1576-1695` — abrir/finalizar/cancelar transacionais; finalização grava movimentações de ajuste com estoque_anterior/posterior. **OK** (sem teste E2E no repo — cobertura pendente).

---

## Fluxos NÃO suficientemente investigados nesta auditoria

| Fluxo | Motivo | Risco |
|---|---|---|
| Auto-update em produção (download, assinatura, rollback) | código lido parcialmente; operação não observada | médio |
| Relay 3211 em operação (túnel, token, GitHub Pages) | testes existem; runtime real não verificado | médio |
| Conexão WhatsApp real (provisorium client) | `client.ts` não auditado em profundidade; painel de status quebrado (404) | médio-alto |
| Importador Nex completo (encoding, GUID, MovEst) | relatórios próprios + homologação; não revalidado de ponta a ponta | baixo (congelado em homologação) |
| multi-terminal (terminais, sessões, concorrência entre 2 PDVs) | tabela `terminais` existe; cenário multi-terminal não traçado | médio |
| NF-e/SAT/TEF | placeholder "em breve" | n/a |
| Zonas de entrega: polígono vs CEP (mig 47 `ceps`) | lógica geo parcialmente lida; regra de desempate não verificada | baixo |

## Resumo de proteção contra duplicidade por fluxo

| Fluxo | Proteção | Status |
|---|---|---|
| Venda PDV | transação + status check | OK |
| Cancelamento venda | check `status='concluida'` + UNIQUE parcial em pós-fechamento (mig 50 inalcançável) | parcial/quebrado |
| Pedido online | UUID PK + OR IGNORE | OK |
| Pedido WhatsApp | carrinho status ORDERED impede re-finalizar | OK |
| Baixa estoque Delivery | nenhuma | ausente |
| Fila catálogo | nenhuma (mas full push tolera) | tolerável |
| Sequência venda/pedido | SELECT+UPDATE sem lock (fora/só na transação) | janela de corrida (hipótese) |
