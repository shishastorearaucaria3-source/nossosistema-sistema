# 06 — Módulos e Pendências

Data: 20/10/2026. Inventário de módulos com grau de implementação, estado de sincronização e pendências. Base: leitura de código + AUDITORIA-FUNCIONAL (24/08) + AUDITORIA-FASE-ESTETICA (30/08) + relatórios Nex.

Legenda de status: **Completa** (funcional com ressalvas pontuais) · **Parcial** (funciona mas com lacuna importante) · **Quebrada** (falha comprovada de operação) · **Desconectada** (existe mas não integra) · **Legada** (coexiste com implementação nova) · **Placeholder** (só UI).

---

## Módulos funcionais

| # | Módulo | Status | Onde | Pendências principais |
|---|---|---|---|---|
| 1 | Produtos e categorias | Completa | `Produtos.tsx`, schema mig 1-38 | `preco_automatico` morto (P3-05); imagem BLOB em SQLite (escala?) |
| 2 | Cadastro/edição de produtos | Completa | `Produtos.tsx` (~2k linhas, overlay do PDV) | UI monolítica; código morto de preco_automatico |
| 3 | Preços/custos/margens | Parcial | `AlterarPrecos.tsx`, `alteracoes_preco*` | sem transação (P2-09); lucro histórico sem snapshot (P1-05) |
| 4 | Estoque (entradas/saídas/ajustes/inventário/validade) | Completa | `Estoque.tsx`, `Movimentacoes.tsx`, `Inventario.tsx`, `Validade.tsx`, `index.ts:1334-1695` | saídas de venda sem categoria/usuario (P2-04); índices (P2-14) |
| 5 | PDV | Completa (preservar) | `Pdv.tsx`, `index.ts:1704-1828` | número fora da transação (P1-08); modo pedido/orçamento sem transação (P2-09) |
| 6 | Vendas / lista / edição | Quebrada (recusa de pedido) | `Vendas.tsx` | bypass de cancelamento (P1-03); filtro de status (P2-01) |
| 7 | Cancelamentos/estornos | Quebrada | `index.ts:1832-2014` | mig 50 (P1-01); pagamentos (P1-06); premissa de pedido (P0-02) |
| 8 | Caixa (abertura/mov./fechamento/sangria) | Parcial | `Caixa.tsx`, `CaixaTransacoes.tsx`, `OpcoesCaixa.tsx`, `index.ts:1744-1916` | lucro 52% (P1-05); desconto-por-item ignorado; sangria sem transação; fallback troca definição |
| 9 | Financeiro (contas/reservas/separações) | Parcial | `Financeiro.tsx` | reservas infladas (P2-08); sem integração com compras/vendas; totais multi-fonte |
| 10 | Fornecedores | Parcial | `Fornecedores.tsx` | "Comprado" = R$ 0 (P1-02) |
| 11 | Compras | Parcial | `Compra.tsx`, `index.ts:1495-1575` | total nunca gravado (P1-02); status fixo; custo não revertido |
| 12 | Clientes/CRM | Completa | `Clientes.tsx` | fidelidade/fiado mortos (P2-06); última compra '—' |
| 13 | Relatórios/dashboards | Parcial | `Relatorios.tsx`, `data.ts`, `dashboardData.ts` | divergências detalhadas no Fluxo 3 da matriz; período CORRIGIDO (periodo.ts + 4 testes) |
| 14 | Importador Nex | Completa (homologação) | `importar-nex.ts`, `nex-binary.ts`, `auditoria/*` | congelado em snapshots (decisão correta); estado em memória ~660MB; gap 616 IDs 2020-2022; reimport de caixas/produtos duplica (relatório próprio) |
| 15 | Pedidos online | Parcial/Quebrada | `pedidos-online.ts`, `PedidosOnline.tsx` | tracking inexistente (P1-07); baixa sem movimentação; fora dos relatórios |
| 16 | Catálogo online | Completa | `CatalogoOnline.tsx`, `catalogo*.ts`, `catalogo/` (site), `catalogo-worker/` | full push 60s; duplo caminho D1 legado; fila inútil; SSRF (P3-11) falso positivo provável |
| 17 | WhatsApp (bot+atendimento) | Completa (backend) / Parcial (integração) | `src/whatsapp/*`, `AtendimentoWhatsApp.tsx` | baixa de estoque sem movimentação; cancelCart não desfaz pedido; painel status 404; ~20 módulos e ~30 rotas sem teste; client.ts não auditado a fundo |
| 18 | Entregas/taxas/zonas | Completa | `Zonas.tsx`, `Delivery.tsx`, `geo.ts`, `/api/taxa` | baixa de estoque local fora de transação; zonas duplicadas no catálogo |
| 19 | Usuários/permissões/sessões | Completa | `Usuarios.tsx`, auth em `index.ts:393-670` | loopback=admin (P3-15, decisão de design) |
| 20 | Backup/restauração/diagnóstico/zerar | Completa | `servidor.ts`, `Servidor.tsx`, `index.ts:195-223` | zerar usa SQL dinâmico de lista fechada (ok); restore não tem teste automatizado |
| 21 | Servidor/painel/relay | Completa | `Servidor.tsx`, `panel-servidor/`, `relay.ts`, `servidor-exe/` | rota whatsapp 404 (P2-15); relay runtime não observado |
| 22 | Auto-update/instalador | Completa (não verificada E2E nesta auditoria) | `main/update.ts`, `setup-launcher/`, `scripts/package-*`, ymls | teste de instalação/persistência pós-restart = pendência clássica (MEMORIA.md) |
| 23 | Comissões | Desconectada | `Comissoes.tsx`; tabela `comissoes` vazia | relatório on-the-fly; decidir snapshot vs cálculo |
| 24 | Formas de pagamento | Completa | `FormasPagamento.tsx`, seed mig 8 | colunas `taxa/dias_receber` pouco usadas (citação da auditoria anterior) |
| 25 | Importação XLS/imagens | Completa | `importar.ts`, `/api/imagem/*` | sem teste |
| 26 | Inventário físico | Completa | `Inventario.tsx`, `index.ts:1576-1695` | sem teste E2E |
| 27 | NFe | Placeholder | menu `emBreve` | não implementada |

## Módulos legados coexistindo

| Legado | Novo | Risco |
|---|---|---|
| Cloudflare Worker/D1 catálogo (`catalogo-worker/`, `scripts/sync-catalogo.mjs`) | Supabase (`catalogo-sync.ts`, `supabase/`) | dupla manutenção; config de qual está ativa? (ambos no repo) |
| SHA-256 senhas (validação de hash antigo) | bcrypt | OK — migração transparente intencional |
| Rotas `/api/nex/{analisar,preparar,importar}` sem chamador | painel usa subset | órfãs, manter só p/ CLI documentado |
| `importar-nex.ts.bak-movest` | importador MovEst | backup de arquivo no repo — remover após confirmação |
| Checkpoint cline (30/08) | commits normais | histórico não linear — sem dano |

## Dados grandes fora de código

| Pasta | Conteúdo | Ação |
|---|---|---|
| `nexbackuptotal/` | backup completo Nex (NexusDB + ~3GB .nx1 + instaladores) | fonte da migração; não é código; manter fora do git (já ignorado) |
| `val-nex/` | 16 .nx1 reduzidos + drills .cjs | validação do importador; manter |
| `homologacao/` | 10 snapshots VACUUM INTO de produção (ago/2026) | único acesso seguro a dados reais para conferências; não versionar |
| `backups/` | 5 dumps de 14/08/2026 (~174MB) | backups do app; o automático de produção fica no data-dir (`C:\NossoSistema\...`), não aqui |

## Docs do repo vs realidade

| Doc | Estado |
|---|---|
| README.md | geral, parcialmente atual |
| AGENTS.md | orientações de agente |
| MEMORIA.md | **desatualizado** (schema 17 vs 49; não cita whatsapp/pedidos-online/supabase/auditoria) — atualizar na Etapa 9 |
| AUDITORIA-FUNCIONAL.md | 179 achados; ~12 corrigidos; resto aberto (cruzamento em `03_INVENTARIO_PROBLEMAS.md`) |
| AUDITORIA-FASE-ESTETICA-INTEGRACAO.md | riscos de UI/arquitetura; parte do plano visual já em andamento (commit fase5); **durante correções P0/P1: nenhuma reformulação visual** |
| Relatórios Nex (3) | status do importador; pendências ainda abertas listadas acima |
| `resultado-pages.txt` | artefato de teste de páginas; script gerador ausente |

## Pendências de investigação (não cobertas por completo nesta auditoria)

1. Runtime do WhatsApp real (client.ts, conexão, handoff) — só leitura estrutural.
2. Multi-terminal (2 PDVs concorrentes, tabela `terminais`, sessões) — cenário não traçado.
3. Auto-update E2E e instalador (persistência pós-restart, ACL, elevação) — código lido, operação não testada.
4. Relay/túnel em produção (token, GitHub Pages ao vivo).
5. Inspeção do banco real de produção — só possível via snapshots `homologacao/snap-*` (SHA-256 circuit-breaker disponível).
6. Magnitude real de erros de ponto flutuante em somatórios do banco (P2-13).
7. Performance com 54k+ vendas importadas (índices P2-14).
8. SSRF `resultado-pages.txt` — reproduzir varredura em ambiente isolado para confirmar falso positivo.
9. `package-setup-fast.js` / layout `embedded/app` do dist-setup — não confirmado nos YMLs.
10. Concorrência real de número de venda (P1-08) — janela comprovada, ocorrência não medida.

## Pendências de produto (decisão humana necessária)

- Fidelidade/fiado: implementar ou remover.
- Comissões: snapshot ou cálculo.
- Pedido online: virar venda/caixa ou fluxo separado rotulado.
- NFe: priorizar ou manter placeholder.
- D1/Supabase: oficializar Supabase e arquivar worker.
- REAL vs centavos para dinheiro (decisão antiga registrada; reafirmar).
