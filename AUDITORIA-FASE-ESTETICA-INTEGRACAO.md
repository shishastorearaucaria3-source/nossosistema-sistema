# AUDITORIA — Fase Estética + Integração + Sincronização

> Data: 30/08/2026 · Etapa 1–4 (auditar → mapear → planejar). **Nenhum código foi alterado.**
> Referência estável: `CHECKPOINT-NEX-IMPORTADOR.md` (importador Nex congelado nesta fase).
> Método: inspeção profunda de código (`arquivo:linha`). Classificação **visual** é **provisória** (por inspeção) e será ratificada ao reformar cada tela.

---

## 0. Resumo executivo

- **Arquitetura é saudável**: banco único central no servidor (`node:sqlite`, WAL, transações `BEGIN IMMEDIATE`), todos os terminais acessam via HTTP e **não há réplicas locais divergentes** — a "sincronização" real acontece pelo acesso ao mesmo SQLite.
- **Padrão de dados**: renderer → `window.api` (preload) → IPC → `servidorClient` (HTTP, `X-Sessao-Token`) → Express :3210 → SQLite. Toda tela busca dados do servidor no mount (sem cache global).
- **Catálogo**: é *pull sob demanda* — a cada visita, Cloudflare Worker → túnel → relay `127.0.0.1:3211` → JSON **gerado ao vivo** do banco. Não há publicação periódica; `catalogo_fila` é só marcador.
- **Pedido do catálogo → servidor: NÃO EXISTE ainda** (carrinho é frontend-only; não há rota de criação de pedido público). É o maior vão da "sincronização".
- **PDV/vendas** seguem caminho atômico no servidor (`/api/vendas/finalizar`, baixa de estoque + caixa + pagamentos em `BEGIN IMMEDIATE`) — correto contra venda duplicada/concorrência.
- **Visual**: um único `styles.css` global (~7.450 linhas) com tokens e classes compartilhadas → consistência base boa, mas **sem biblioteca de UI central** (componentes TSX reutilizáveis: só `CampoDinheiro` e `Cupom`); telas duplicam padrões de modal/tabela.
- **Riscos principais localizados**: ① baixa de estoque do Delivery fora de transação; ② publicação de catálogo com dois conceitos paralelos (`publicado` vs `catalogo_publicado`); ③ configs do PDV em `localStorage` por terminal; ④ dupla contabilidade de saldo no Caixa; ⑤ sem fila/retry offline no PDV.

---

## 1. MAPA DO SISTEMA

### 1.1 Topologia em camadas

```
SERVIDOR (fonte de verdade)
  → SQLite central único (<dataDir>/tabacaria.sqlite; WAL, busy_timeout=5s)
  → Express :3210 (negócios) + relay :127.0.0.1:3211 (catálogo, Bearer token)
CLIENTES DA LAN (nos terminais PDV)
  → HTTP síncrono request/response (sem WebSocket/SSE; sem réplica local)
CATÁLOGO ONLINE
  → Cloudflare Worker (catalogo-worker) → Tunnel → relay :3211 → banco (leitura ao vivo)
PAINEL SERV
  → janela do servidor (Electron) / servidor-exe — fetch direto em localhost, sem token (somenteLocal)
```

### 1.2 App desktop — telas e menus (`src/renderer/src/App.tsx`)

Navegação por estado local (`useState<Tela>`, **sem react-router**); sidebar recolhível; gate de permissão `temModulo()` em `App.tsx:216`. Landizar pós-login: **Início** (`setTela('inicio')`, `App.tsx:326`).

| Tela | Arquivo principal | Função |
|---|---|---|
| Início (dashboard) | `features/inicio/Home.tsx` | stats (produtos/vendas hoje/caixa/pedidos) + grid de módulos + PDV |
| PDV | `features/pdv/Pdv.tsx` (~2.047 linhas) | venda de balcão: catálogo, carrinho, desconto, vendedor, cliente, pagamento, pedido/orçamento, cupom, listas |
| Produtos | `features/produtos/Produtos.tsx` | CRUD, fotos, preços, filtros, colunas configuráveis, `catalogo_publicado` |
| Clientes | `features/clientes/Clientes.tsx` | CRM, débito/fiado, categorias, foto |
| Vendas | `features/vendas/Vendas.tsx` | histórico, pedidos em aberto, orçamentos, cancelar, aprovar orçamento |
| Estoque | `features/estoque/Estoque.tsx` | abas: produtos, transações, validade, inventário |
| Financeiro | `features/financeiro/Financeiro.tsx` | contas a pagar/receber, reservas, regras, fornecedores |
| Comissões | `features/comissoes/Comissoes.tsx` | % por vendedor |
| Relatórios | `features/relatorios/Relatorios.tsx` | ~20 relatórios, métricas, gráfico, filtros de período |
| Usuários | `features/usuarios/Usuarios.tsx` | CRUD, permissões por módulo |
| Delivery | `features/delivery/Delivery.tsx` | pedidos online: novo→aceito→em_preparo→saiu→entregue |
| Zonas | `features/zonas/Zonas.tsx` | zonas de entrega com Leaflet |
| Catálogo Online | `features/catalogo/CatalogoOnline.tsx` (+12 componentes) | publicação, descrição, estoque/exibição, formas, loja |
| Caixa | `features/caixa/Caixa.tsx` | abertura/sangria/suprimento/fechamento + conferência + importar |
| Formas de pagamento | `features/formaspagamento/FormasPagamento.tsx` | ativar/desativar, parcelas, taxa |
| Alterar preços | `features/precos/AlterarPrecos.tsx` | remarcação em massa (log `alteracoes_preco`) |
| WhatsApp | `features/whatsapp/AtendimentoWhatsApp.tsx` | atendimento via proxy `/api/whatsapp` |
| Servidor (ferramenta) | `features/servidor/Servidor.tsx` | status/logs/backup/diagnóstico/conexão (~reenvia painel) |
| NFe / Sobre | — | placeholder "Em breve" (`EmBreve`, `App.tsx:514`) |

Menus (sidebar): **Principal** = Vendas, Clientes, Produtos, Estoque, Catálogo, Contas a Pagar, Caixa, Relatórios, Nota Fiscal(em breve); **Gestão** = Comissões, Alterar preços, WhatsApp(admin), Usuários(admin). Atalhos: F3 PDV, F4 novo pedido, F5 novo orçamento; dentro do PDV F1/F2/F3/F4/F6/F11.

### 1.3 Servidor — grupos de rotas (`src/server/index.ts`)

| Grupo | Rotas | Observação |
|---|---|---|
| Auth | `/api/auth/*` (login/logout/usuários/CRUD/permissões) | sessão em memória 12h, token 32 bytes, perfil admin/gerente/vendedor |
| Banco genérico | `/api/db/{all,get,run,exec,transacao}` | CRUD de produtos/clientes/financeiro/relatórios vai por aqui; escrita sensível exige admin; `run` dispara `notificarAlteracaoProduto` |
| Imagem | `/api/imagem/*` | fotos base64 |
| Catálogo | `/api/catalogo/{status,config,exibicao,publico}` | `/publico` gera JSON ao vivo; config pública |
| Servidor | `/api/servidor/{status,logs,backup,diagnostico,corrigir,apikey,zerar,restaurar,encerrar}` | painel; zerar/corrigir/restaurar admin |
| Estoque | `/api/estoque/{movimentar, inventario/*}` | transacional, valida saldo |
| PDV/Vendas | `/api/vendas/{finalizar,cancelar}`, `/api/pedidos/cancelar` | atômicos, `BEGIN IMMEDIATE`, sequência `UPDATE ... RETURNING` |
| Importar planilha | `/api/importar/*` | zip/arquivo/produtos |
| Nex (auditoria) | `/api/nex/*` (9 rotas, `somenteLocal`) | grava SÓ em homologação (congelado) |
| WhatsApp | `/api/whatsapp/*` | proxy WAWebPlus |
| Públicas | `/api/ping`, `/versao`, `/config`, `/auth/usuarios`, `/auth/login`, `/catalogo/status\|config\|exibicao`, `/zonas`, `/taxa` | acessíveis sem sessão |

### 1.4 Painéis

- **Painel do servidor** (`src/panel-servidor/index.html`, carregado pela janela do Electron): telas `suporte, backup, restaurar, corrigir, zerar, importar, nex, info, logs`. Fetch direto em `http://localhost:<porta>` sem token (rotas `somenteLocal`).
- **Servidor-exe** (`src/servidor-exe/`): entry point autônomo com o mesmo painel (sem `nex`; "Simular Importação" extra).

### 1.5 Catálogo online

- Worker `catalogo-worker/` (Cloudflare): `GET /api/catalogo/publico`, `GET /api/catalogo/imagem/:id`; timeout backend 3s → 503 `catalogo_indisponivel`.
- Site `catalogo/` (React): somente leitura; carrinho frontend-only.
- Relay `src/server/relay.ts`: ponte única `127.0.0.1:3211`, Bearer token, fail-closed, só GET. Supervisor `relay-supervisao.ts` mantém vivo (backoff 1–30s), apenas em instalação **servidor**.

---

## 2. FONTE DE VERDADE — MAPA DE DADOS

### 2.1 Princípio

**Fonte de verdade única = SQLite central no servidor.** Desktop nunca mantém banco local; toda tela lê/escreve via `/api/db/*` e rotas de negócio. Isso elimina réplicas divergentes por construção — exceções pontuais listadas em 2.5.

### 2.2 Tabela central × módulos (`src/shared/schema.ts`, migrações 1–42)

| Tabela | Módulos que usam |
|---|---|
| `produtos` (preço+estoque+fiscal+catálogo) | Produtos, PDV, Estoque, Catálogo, Vendas, Preços, Delivery, Relatórios |
| `vendas`, `venda_itens`, `pagamentos` | Vendas, PDV, Caixa, Relatórios, Comissões, Financeiro, Delivery |
| `caixas`, `movimentos_caixa` | Caixa, Vendas, Relatórios |
| `clientes`, `categorias_clientes` | Clientes, PDV, Vendas, Financeiro, Relatórios |
| `contas`, `reservas_contas` | Financeiro |
| `pedidos`, `pedido_itens` | Delivery, Vendas, PDV (modo pedido), WhatsApp |
| `orcamentos`, `orcamento_itens` | Vendas, PDV (modo orçamento) |
| `estoque` (`movimentacoes`, `inventarios`) | Estoque, Vendas, Delivery |
| `formas_pagamento` | PDV, Caixa, Catálogo |
| `config` | Todas (nome loja, taxa, catálogo, PDV server-side) |
| `usuarios`, `permissoes` | Login, Usuários, gate `temModulo` |
| `catalogo_sync`, `catalogo_fila` | Rastreio de mudança de produto → catálogo (ver 3.2) |
| `whatsapp_*` | WhatsApp |

### 2.3 Fonte oficial por informação

| Informação | Fonte oficial | Como chega |
|---|---|---|
| Produto (cadastro) | `Servidor/Banco` (`produtos`) | via `/api/db/*` |
| Estoque | `Servidor/Banco` (`produtos.estoque` + `movimentacoes`) | movimentação transacional `/api/estoque/*`, baixa em `/api/vendas/finalizar` |
| Venda | `Servidor/Banco` (`vendas`/`venda_itens`/`pagamentos`) | `/api/vendas/finalizar` |
| Cliente | `Servidor/Banco` (`clientes`) | via `/api/db/*` |
| Preço | `Servidor/Banco` (`produtos.preco_*`) | via `/api/db/*`; histórico `alteracoes_preco` |
| Caixa | `Servidor/Banco` (`caixas`) | `/api/vendas/finalizar`, Caixa/sangria |
| Catálogo (conteúdo exibido) | `Servidor → Catálogo` (derivado de `produtos`) | JSON ao vivo via relay/worker |
| Pedido online | **`Catálogo → Servidor`: NÃO IMPLEMENTADO** | hoje pedidos entram por `pedidos` origem whatsapp/sistema |

### 2.4 Fonte de dados por tela (padrão dominante)

Todas as telas usam `getDbApi()`/`getXxxApi()` → IPC → `servidorClient` → HTTP → servidor. Exemplos: PDV `Pdv.tsx:463-481`; Vendas `Vendas.tsx:149-253`; Produtos `Produtos.tsx:376-392`; Financeiro `Financeiro.tsx:111-157`; Relatórios `data.ts` (período central); Catálogo `CatalogoOnline.tsx:94-100`; Caixa `Caixa.tsx:87-191`. Única chamada HTTP direta do renderer: **Nominatim/OSM** em `Zonas.tsx:351` (geocodificação, serviço externo).

### 2.5 Divergências de fonte conhecidas (investigar/reformar)

1. **Publicação de catálogo em dois conceitos paralelos**: tela Catálogo grava `produtos.publicado`; editando produto grava-se `catalogo_publicado`/`catalogo_ordem` (`CatalogOnline.tsx:151-161` vs `Produtos.tsx:719-743`). Mesmo domínio, dois campos.
2. **Fila de catálogo não alimentada pelo renderer**: `catalogo_fila`/`catalogo_sync`/`alterado_em` existem no schema (mig 33) e são marcados pelo servidor em `catalogo.ts:51-61`, mas o app escreve `produtos` direto (a marcação é no `/api/db/run` — ler 3.2 antes de julgar).
3. **Configs do PDV em `localStorage` por terminal** (`pdv_permitir_sem_estoque`, casas decimais, modo quantidade, etc.) — divergem entre balcões (UX, não fonte de negócio; a regra real é server-side na finalização).
4. **Caixa — dupla contabilidade**: timeline recalculada por SQL × colunas acumuladoras (`total_sangrias` etc.) atualizadas manualmente (`Caixa.tsx:230-292`).
5. **`salvarExibicao` do Catálogo**: gravação real ocorre no modal (`ExibicaoModal.tsx:50`), handler local só atualiza estado, com `.catch(()=>{})` silencioso — pode divergir sem aviso.

---

## 3. MAPA DE SINCRONIZAÇÃO

### 3.1 Desktop ↔ Servidor

- **Sobe** (Desktop → Servidor): comandos de negócio (`vendas:finalizar`, `vendas:cancelar`, `pedidos:cancelar`, `estoque:movimentar`, inventário, auth), além de `/api/db/{run,exec,transacao}` para todo o CRUD (produtos, clientes, contas, configs, caixa, catálogo).
- **Desce** (Servidor → Desktop): resultados das consultas `/api/db/{all,get}` (estado atual do banco), imagens, status/logs. Não há cache: cada tela busca no mount.
- **Polling explícito**: pedidos novos a cada 6s (`App.tsx:93-133`, com som + badge); Delivery a cada 5s (`Delivery.tsx:97`); rodapé/status; monitor de conexão a cada 2s (`App.tsx:174-211`, 2 falhas → logout).
- **Retry/offline**: sem fila local, sem retry com backoff, sem buffer — cada chamada é request/response; falha devolve `{ok:false, online:false}`. No boot, se o servidor não responde, o app orienta "Outro (rede)" (LAN) e não sobe servidor local em instalação cliente.

### 3.2 Servidor → Catálogo (o que é publicado)

- **Mudou produto** → `/api/db/run` (e `/api/estoque/*`) chamam `notificarAlteracaoProduto()` (`catalogo.ts:51-61`) → marca `alterado_em` e incrementa `catalogo_fila` (marcador).
- **Não há push nem agendador**: `proxima_sync` é `ultima+1h` derivado, exibido no painel. O catálogo é regenerado **ao vivo** a cada visita (worker → relay → `gerarDadosPublicos()` → JSON). Preço/estoque exibidos = leitura direta de `produtos` no momento da visita (regras: `ativo=1 AND catalogo_publicado=1`; `sem_estoque='despublicar'` esconde zerados; `mostrar_estoque` controla exposição).

### 3.3 Catálogo → Servidor

- **Retorna pedidos: NÃO IMPLEMENTADO.** Carrinho do site é frontend-only; não há rota pública de criação de pedido. Pedidos atuais entram via sistema/WhatsApp (`origem 'whatsapp'|'sistema'`).

### 3.4 Diagrama textual

```
[PDV A/B ... LAN] ──HTTP + X-Sessao-Token──▶  SERVIDOR (:3210 Express)
      ▲                                          │  SQL (starter único)
      │ (response = estado do banco)             ▼
      └────────────────────────────────────  SQLite central (WAL)
                                               │ gerarCatalogoPublico()
                                               ▼
                              relay :127.0.0.1:3211 (Bearer) ◀── Tunnel/cloudflared
                                               ▲
                                               │ GET
                                     Cloudflare Worker ──▶ [site catálogo React] (leitura)
                                                      (pedido p/ trás: IMPLEMENTAR)
```

### 3.5 Mecanismos (situação atual)

| Mecanismo | Existe? | Onde/como |
|---|---|---|
| Polling | Sim | pedidos 6s, delivery 5s, status 2s — no renderer |
| Eventos / push | Não | sem WebSocket/SSE |
| Sincronização periódica | Parcial | backup automático 4h; catálogo NÃO sincroniza (é pull) |
| Fila | Não (histórico) | `catalogo_fila` é contador/marcador, não fila processada |
| Retry | Não | falha → `{ok:false, online:false}` |
| Offline | Parcial | boot: orienta rede; runtime: telas mostram erro; sem fila de pendências |
| Conflitos | Parcial | resolvidos por transação no servidor (ver §4) |
| Estoque | Tempo real | baixa na finalização (transacional) e delivery (ver risco §6) |
| Preço | Tempo real | leitura direta; histórico em `alteracoes_preco` |

---

## 4. CONCORRÊNCIA (como está hoje)

- **WAL + `busy_timeout=5000`** (`index.ts:50-53`) — escritas concorrentes de multi-PDV esperam lock (até 5s) sem falhar.
- **`BEGIN IMMEDIATE`** para venda (`index.ts:1432`), cancelamento (`1534`), cancelamento de pedido (`1605`), permissões (`730`), `/api/db/transacao` (`575`).
- **Número da venda atômico**: `UPDATE sequencias SET valor=valor+1 ... RETURNING` (`1423`) — sem duplicidade sob concorrência.
- **Baixa de estoque sem corrida**: re-leitura + checagem de saldo dentro da transação antes do `UPDATE` (`1465-1476`); `ESTQ_INSUFICIENTE` → ROLLBACK total.
- **Serialização real**: um único processo síncrono + um `DatabaseSync` → transações serializadas pelo lock do SQLite. Duas vendas simultâneas nunca dobram baixa.
- **Pedido online/conexão perdida**: hoje não há fila de pedidos (catálogo não cria pedidos) e o PDV não enfileira vendas offline.

---

## 5. MAPA VISUAL

### 5.1 Estado atual do estilo

- **Um único CSS global** `src/renderer/src/styles.css` (~7.450 linhas), importado em `main.tsx:5`.
- **Tokens em `:root`** (`styles.css:34-42`): `--bg/--bg2/--bg3/--texto/--texto2/--borda/--primaria/--primaria-escura/--verde/--vermelho` (tema claro, azul `#2563eb`).
- Classes compartilhadas: `.btn-primario/.btn-secundario/.btn-mini/.btn-icone/.btn-danger`, `.modal*`, `.tabela*`, `.mensagem`, `.sem-resultado`, `.card*`, `.page/.page-header`.
- **Sem biblioteca de UI central** (componentes TSX globais: só `shared/CampoDinheiro.tsx` e `shared/Cupom.tsx`). Componentes locais por feature (relatorios/, catalogo/).
- **Painéis**: CSS próprio escuro inline (`panel-servidor/index.html:8`) — **segunda linguagem visual** em relação ao app claro. `panel-servidor` (light app) e `servidor-exe` (dark) também diferem entre si (só diferem em `nex`/simular, mas compartilham base). O painel **Servidor** (`features/servidor/Servidor.tsx`) é um terceiro estilo.

### 5.2 Classificação 🟢 / 🟡 / 🔴 (provisória — ratificar em execução)

| Tela | Status | Critério |
|---|---|---|
| Relatórios | 🟢 | componente (`Header/ReportsSidebar/ReportFilters/MetricCard/SalesChart/ReportTable`), filtro de período central |
| Catálogo Online | 🟢 | modular (12 componentes), recente |
| Usuários | 🟢 | recente, consistente |
| Caixa | 🟢 | recente (CaixaTransacoes, contador), consistente |
| Servidor (ferramenta) | 🟢 | recente |
| Formas pagamento / Comissões / Preços | 🟢→🟡 | simples, ok, podem ganhar padrão de formulário |
| Início (dashboard) | 🟡 | estático; cards simples, sem gráfico/tendência; botão PDV bom |
| PDV | 🟡 (candidato a reorganizar) | componente único de ~2.047 linhas; denso; crítico para o operador |
| Produtos | 🟡 | tabela grande, muitas colunas, filtros — precisa hierarquia melhor |
| Vendas | 🟡 | painéis ricos; espaçamento/hierarquia a revisar |
| Estoque | 🟡 | 4 abas; transições entre abas a padronizar |
| Financeiro | 🟡 | tabela densa; filtros/estados podem melhorar |
| Clientes | 🟡 | tabela + finanças do cliente |
| Delivery | 🟡 | lista de pedidos + avanço de status; melhorar estados e confirmações |
| Zonas | 🟡→🔴 | mapa Leaflet embutido; layout complexo, risco de responsividade |
| NFe / Sobre | 🔴 | placeholder "Em breve" (a construir) |
| Login | 🟡 | revisar estados de erro/conexão |

Painéis: `panel-servidor` e `servidor-exe` **🟡** (visual ok/escuro, mas com linguagem própria e duplicação entre os dois; `info`/`logs` simples; `suporte` é stub com botões que só mostram mensagem).

### 5.3 Problemas visuais observados (áreas do pedido)

| Área | Situação |
|---|---|
| Tipografia | Tokens existem; sem escala tipográfica definida (títulos/mensagens inconsistentes entre telas) |
| Espaçamento | Padrão por classe, mas varia entre features |
| Cores | Paleta global ok; o verde `--green` é usado para "ok" e o vermelho para erro em muitos pontos; falta definir semântica (info/warn/success/danger) |
| Botões | Classes boas (primario/secundario/danger/mini) — mas `btn-danger`/`btn-perigo`/`btn-vermelho` convivem (pequena fragmentação) |
| Tabelas | Boas variações, mas células de ação/estado mal padronizadas |
| Filtros | Sem padrão único (cada tela monta o seu) |
| Cards | `card`/`card-stat`/`home-modulo` distintos; sem componente unificado de status |
| Modais | Padrão consistente (`.modal-*`) — melhorar acessibilidade (focus, ESC, aria) |
| Formulários | Inputs ok; validações/mensagens por tela, sem padrão |
| Responsividade | Barra lateral recolhível ok; grids/PDV densos merecem revisão |
| Navegação | Estado local simples funciona; relação "Início" (dashboard) vs sidebar deve ser clara |
| Hierarquia visual | Boa estrutura `page/page-header`; telas de tabela grande perdem hierarquia |
| Estados vazios | `.sem-resultado` existe, mas não é padrão em todas as telas |
| Carregamento | Sem skeleton/spinner padrão — cada tela trata à sua maneira |
| Erros | `.mensagem` ok; vários `.catch(()=>{})` silenciosos no Catálogo |
| Confirmações | Modais em ações destrutivas (zerar/cancelar); iniciar padrão em edições |

---

## 6. PROBLEMAS CRÍTICOS

> Confirmar impacto; **não corrigir nesta etapa** (apenas registrar prioridade).

1. **Pedido online não chega ao servidor** (catálogo sem "comprar"): o vão central da integração — impede "pedido chegou do catálogo → estoque reservado/baixado → atendimento trabalha".
2. **Baixa de estoque do Delivery fora de transação** (`Delivery.tsx:114-121`): `UPDATE produtos SET estoque=estoque-?` linha a linha, sem `BEGIN/ROLLBACK` e sem `alterado_em`. Falha no meio → estoque parcialmente baixado.
3. **Dupla fonte de publicação de catálogo** (`publicado` vs `catalogo_publicado`): preço/estoque exibidos no site podem divergir do que o operador "publica" na tela Produtos.
4. **Configs de PDV por terminal (`localStorage`)**: `pdv_permitir_sem_estoque` etc. — dois balcões podem ter regras diferentes de venda/estoque (UX divergente, ainda que a regra final seja server-side).
5. **Caixa com dupla contabilidade de saldo**: colunas acumuladoras vs timeline recalculada — risco de valor de saldo divergente na própria tela.
6. **Sem fila/retry offline no PDV**: venda com servidor fora do ar não é enfileirada (vira erro ao usuário). Definir política (bloquear venda vs fila).
7. **NFe não implementada** (placeholder) — lacuna de ERP.
8. **`catalogo_fila` não é processado**: indicador pode "pendular" sem efeito (estado de sync enganoso no painel).
9. **Painéis duplicados** (`panel-servidor` vs `servidor-exe`) mantêm duas cópias do mesmo painel — qualquer correção precisa duplicar.
10. **Sessões em memória** (reinício do servidor derruba logins; sem persistência) — aceitável hoje, listar como risco de UX na sincronização.
11. **Zonas/Leaflet**: mapa embutido com layout frágil (risco de responsividade e performance).
12. **`.catch(()=>{})` silenciosos** (Catálogo/Home/Login parcial): erros de carregamento desaparecem.

---

## 7. PLANO DE REFORMA (ordem proposta)

Seguindo a prioridade do operador (o que o funcionário usa o dia todo) e a regra **funcionar → sincronizar → bonito → fácil**:

1. **Dashboard (Início)** — vitrine: stats reais + atalhos + estado do dia (caixa/vendas/pedidos/estoque baixo).
2. **PDV** — reorganizar (componentes: carrinho, pagamento, cliente, vendedor), manter comportamento atômico.
3. **Produtos** — hierarquia de tabela, filtros e formulário; unificar publicação (1 campo).
4. **Estoque** — abas padronizadas; reforçar transação na baixa (Delivery); estados.
5. **Vendas/Pedidos** — listas, painéis, cancelamento com confirmação padrão.
6. **Clientes** — cartão de cliente + fiado/débito + histórico.
7. **Financeiro** — contas a pagar/receber, reservas; padrão de tabela/filtro.
8. **Relatórios** — reaproveitar componentes; filtros e exportação.
9. **Catálogo Online** — pub/exibição; ligar com fila de catálogo; pedido online (limite da fase: mapear arquitetura; implementação em fase própria de integração).
10. **Configurações** — agrupar configs (loja, PDV, formas, usuários, WhatsApp, zonas).
11. **Administração/Servidor** — unificar painéis (uma única fonte para panel-servidor/servidor-exe + tela Servidor) e alinhar ao design system.

> Sincronização é transversal: cada telha que tiver fila/cache respeitada usará o padrão definido em §8 (e as correções críticas de §6 entram como "dever" junto das telas correspondentes: Delivery/estoque no item 4; catálogo no item 9).

---

## 8. DESIGN SYSTEM PROPOSTO

**Estratégia**: manter o CSS global (1 arquivo) como fonte de tokens e classes base — uma alteração em `.componente` melhora todas as telas. Adicionar **componentes TSX reutilizáveis** progressivamente, começando pelos mais usados.

### 8.1 Tokens
- Ampliar `:root`: escala tipográfica (`--fs-xs/sm/md/lg/xl`), espaçamento (`--sp-1..6`), raios (`--r-sm/md/lg`), sombras, semântica de cor (`--success/--warning/--danger/--info`), foco/acessibilidade.

### 8.2 Componentes (lote inicial — "uma mudança, todas as telas melhoram")
| Componente | Substitui/centraliza | Estado atual |
|---|---|---|
| `Botao` (variantes ação/destrutiva/ícone/mini) | `.btn-*` | classes ok, componentes ausentes |
| `Input`/`Select`/`Busca` (com rótulo, erro, foco) | inputs soltos | classes ok |
| `Tabela` (+ ordenação, seleção, vazio) | `.tabela*` | várias variações |
| `Paginacao` | loops `slice/visiveis` | por tela |
| `Card`/`CardEstatistica`/`CardStatus` | `.card*`, `.card-stat` | classes ok |
| `Modal` (foco, ESC, overlay, confirmação) | `.modal-*` | consistente, sem a11y |
| `Confirmacao` (destrutiva) | modais ad-hoc | parcial |
| `Toast`/`Mensagem` | `.mensagem` (inline) | inline apenas |
| `Badge`/`Status` | `.badge-*`, `.nav-badge` | per-feature |
| `Loading` (skeleton/spinner) | ausente | ausente |
| `EmptyState` | `.sem-resultado` | parcial |
| `Sidebar`/`Header` | sidebar manual | manual |
| `FiltroPeriodo`/`Filtros` | por tela | duplicado |
| `CampoDinheiro` | já é compartilhado | manter e difundir |
| `Pdv*` (carrinho/pagamento/cliente/vendedor) | módulo PDV | dentro de Pdv.tsx |

### 8.3 Regras
- Novo código usa os componentes; telas legadas são migradas por etapa na ordem do §7 (sem "refazer tudo de uma vez").
- Painéis do servidor adotam o mesmo design system depois que a tela **Servidor** (renderer) servir de referência única.
- Scoring de adoção: toda tela reformada deve reutilizar ≥80% dos componentes-base (sem estilos novos sem necessidade).

---

## 9. Próximos passos (aprovar antes de codar)

1. Revisar/ratificar este mapa (em especial §5.2 classificação visual e §6 prioridades).
2. Definir a ordem de reforma (§7) e a primeira tela alvo (sugestão: **Dashboard**).
3. Para a integração, decidir a arquitetura do "pedido online → servidor" (escopo de fase própria) e a política offline do PDV.
4. Preparar o "design system" mínimo (§8) antes da primeira tela, para validar os padrões em uma tela real.

> Nesta etapa nada foi alterado. Aguardando sua revisão para autorizar a reforma por etapas.