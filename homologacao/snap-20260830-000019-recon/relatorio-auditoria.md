# Relatório de Auditoria — Importador/Homologação

- Circuito: criado em **2026-08-30T03:02:51.172Z** | sha256(produção db): `ce0d752b00355879…` | 23 backups conferidos
- Snapshot de homologação: `D:\sistema loja tabacaria\homologacao\snap-20260830-000019-recon`
- Escopo: reconstrução NX (Tran.nx1/MovEst.nx1/PagEspecies.nx1) + correlação XLS (4 arquivos, 18.481 linhas) + reconciliação de valores

## §10.1 VENDAS

| Métrica | Qtd | Situação |
| --- | --- | --- |
| Transações registradas no Tran.nx1 (walker) | 54.671 | DETERMINADO |
| TranNome = Venda | 37.572 | DETERMINADO (regra aprovada) |
| Vendas com data decodificada | 37.572 | DETERMINADO |
| Distribuição por ano (vendas com data) | 2020:3359 2021:11511 2022:5663 2023:4988 2024:4841 2025:4532 2026:2678 | DETERMINADO |
| Correlacionadas EXATA | 61 | DETERMINADO |
| ALTA CONFIANÇA | 0 | DETERMINADO |
| PROVÁVEL | 187 | DETERMINADO |
| AMBÍGUA | 17.479 | DETERMINADO |
| NÃO ENCONTRADA (só XLS) | 754 | DETERMINADO |
| Canceladas (XLS: Cancelado=Sim) | 372 | DETERMINADO (só XLS 2023-2026) |
| Vendas com código "-C" (XLS) | 714 | DETERMINADO — não existem no Tran.nx1; usam estratégia secundária |
| Canceladas no NX (2020-2022) | 0 | NÃO DETERMINADO (offset Cancelado do Tran não validado; regra candidata via MovEst aguarda validação) |

## §10.2 VALORES

| Fonte | Total | Situação |
| --- | --- | --- |
| Soma itens MovEst (TranNome=Venda, reconstruída) | R$ 3.333.374,30 | DETERMINADO |
| XLS — soma Total Final (2023-2026) | R$ 1.397.839,83 | DETERMINADO |
| XLS — soma Valor Pago (2023-2026) | R$ 1.385.543,71 | DETERMINADO |
| Nosso sistema — soma `vendas.total` | R$ 3.185.862,86 | DETERMINADO (snapshot) |
| Lucratividade — Receitas | NÃO DETERMINADO | NÃO DETERMINADO |
| Lucratividade — Troco | NÃO DETERMINADO | NÃO DETERMINADO |
| Lucratividade — Receitas−pendências | NÃO DETERMINADO | NÃO DETERMINADO |
| Relatório por produto — Total Vendas | R$ 2.389.608,43 | DETERMINADO |
| Relatório por produto — Valor Pago | R$ 2.325.963,47 | DETERMINADO |
| Relatório por produto — Descontos | R$ 63.624,55 | DETERMINADO |
| Despesas | R$ 0,00 | NÃO DETERMINADO (CP.nx1 vazio / Nex reporta 0) |

### §10.2.1 Divergências (investigação em andamento — NADA foi corrigido)

- **Lucratividade (Receitas) × Relatório por produto (Total Vendas)**: ∅ × R$ 2.389.608,43 → diferença ∅
  - Causas prováveis: critérios de vendas diferentes (transações vs movimentos de produto); filtro de período/default dos arquivos diferentes; descontos lançados dentro do total; vendas sem item de estoque (serviços/frete); devoluções.
- **Lucratividade (Receitas−pendências) × Relatório por produto (Total Vendas)**: ∅ × R$ 2.389.608,43 → diferença ∅
  - Causas prováveis: troco (116.199,90) deduzido em um relatório apenas; pendências (créditos/links) contadas em só um lado; descontos 63.624,55 distribuídos de forma diferente.
- **Relatório por produto: Total Vendas × Valor Pago**: R$ 2.389.608,43 × R$ 2.325.963,47 → diferença R$ 63.644,96
  - Causas prováveis: descontos 63.624,55; troco concedido; crédito utilizado; cancelamentos (1.668 em 2023; 185 em 2024).
- **Nosso sistema (soma vendas) × NX reconstruído (soma itens MovEst, apenas TranNome=Venda)**: R$ 3.185.862,86 × ∅ → diferença ∅
  - Causas prováveis: 54.671 registros incluem COMPRAS/AJUSTES/SANGRIAS; a regra correta é TranNome=Venda; histórico importado com a regra antiga (total>0 + quantidade de registros); itens duplicados/ausentes no MovEst.
- **Despesas (relatório lucratividade)**: ∅ × R$ 0,00 → diferença ∅
  - Causas prováveis: CP.nx1 vazio; Nex reporta despesas = 0 → registro = NÃO DETERMINADO (não inventar); lucro próprio calculado sem despesas fica comprometido.

## §10.3 ITENS

| Métrica | Qtd | Situação |
| --- | --- | --- |
| Itens no MovEst.nx1 | 124.324 | DETERMINADO |
| Vendas com ≥1 item reconstruído | 36.395 | DETERMINADO |
| Itens sem venda (tran não é Venda/fantasma) | 15.162 | DETERMINADO |
| Vendas sem itens | 1.177 | DETERMINADO |
| Itens ambíguos (sem id de venda válido) | - | DETERMINADO (contidos em “itens sem venda”) |

## §10.4 PAGAMENTOS

| Métrica | Qtd | Situação |
| --- | --- | --- |
| Registros PagEspecies com tripla [caixa,data,tran] válida | 94.970 | DETERMINADO (layout novo validado) |
| ... vinculados a uma Venda | 85.053 | DETERMINADO |
| ... não vinculados | 9.917 | DETERMINADO |
| Valores de pagamento determinados | 0 | NÃO DETERMINADO — registro não possui campo Valor; fontes a investigar: Tran.PagEspValor/Troco (memos), Recebiveis (cartão). Nenhum valor inventado. |
| Especies (forma de pagamento) identificadas | 30 | DETERMINADO (ids; mapeamento p/ nome via XLS na FASE E) |
| Cancelado (PagEspecies) | 0 | NÃO DETERMINADO (offset não validado) |
| Devolução (PagEspecies) | 0 | NÃO DETERMINADO (offset não validado) |

Espécies encontradas (id: ocorrências):

| EspecieId | Ocorrências |
| --- | --- |
| 1 | 18.060 |
| 3 | 15.580 |
| 6 | 12.933 |
| 2 | 7.119 |
| 4 | 1.688 |
| 9 | 1.672 |
| 18 | 1.672 |
| 16 | 1.650 |
| 8 | 1.628 |
| 17 | 1.606 |
| 20 | 1.606 |
| 22 | 1.606 |
| 27 | 1.606 |
| 5 | 1.586 |
| 11 | 1.584 |
| 12 | 1.584 |
| 19 | 1.584 |
| 24 | 1.584 |
| 15 | 1.584 |
| 21 | 1.584 |
| 25 | 1.584 |
| 7 | 1.562 |
| 10 | 1.562 |
| 13 | 1.562 |
| 26 | 1.562 |
| 28 | 1.540 |
| 29 | 1.540 |
| 0 | 1.521 |
| 14 | 1.496 |
| 23 | 1.496 |

## §10.5 CLIENTES

- Nome do cliente por venda no NX: **NÃO DETERMINADO** nesta fase (o campo Cliente do Tran não teve offset validado; heurística de presença será confrontada com o XLS na FASE E).
- Clientes com nome preenchido no XLS (2023-2026): 5.057 linhas.
- Clientes duplicados: verificação agendada para a FASE E (nomes equivalentes em caixa/token).

## §10.6 PRODUTOS

- Produtos referenciados pelo MovEst: levantados na FASE E (UID .NET → nex_uid), com conflito de códigos mapeado.
- Confrontação com `produtos.nex_uid` do snapshot: agendada; divergências serão listadas sem alteração.

## Regras e descobertas desta fase

1. **Vendas** = TranNome=="Venda" no Tran.nx1 (regra aprovada; 39.018 no total das transações 54.671).
2. **Itens** = MovEst.nx1 via `MovEst.Tran` (rel +20).
3. **PagEspecies**: layout real é [Caixa u32][DataHora][Tran u32] contíguos; offsets antigos (venda+40/etc.) e os sugeridos anteriormente foram **rejeitados**; **não há campo Valor** → valor = NÃO DETERMINADO.
4. **Correlação XLS→NX**: id numérico como chave; "-C" e ids inexistentes → estratégia secundária com classificação EXATA/ALTA/PROVÁVEL/AMBÍGUA/NÃO ENCONTRADA.
5. **Nada foi importado em produção. Nada foi corrigido.**

## Notas

- Valores de PagEspecies ficam NÃO DETERMINADO até validar a fonte (PagEspValor/Troco memos ou Recebiveis).
- Casos "-C" e AMBÍGUAS/NÃO ENCONTRADAS não são importados automaticamente.
- Importação em produção é proibida nesta fase.

*Gerado em 2026-08-30T03:02:51.317Z — circuito de auditoria, não produz efeito em produção.*