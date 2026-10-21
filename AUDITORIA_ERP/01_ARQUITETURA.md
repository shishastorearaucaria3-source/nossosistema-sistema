# 01 — Arquitetura Real

Data: 20/10/2026. Todos os caminhos conferidos por leitura direta do código. Confronto com docs em `06_MODULOS_E_PENDENCIAS.md`.

## 1. Visão geral de processos

```
Electron (main) ──spawn/HTTP──> Servidor Express embutido (porta 3210, TABACARIA_PORTA)
      │                               │
      │ preload (contextBridge)       │ DatabaseSync (node:sqlite) ──> tabacaria.sqlite (WAL)
      ▼                               │
Renderer React (SPA, sem router)      ├── Relay (relay.ts, porta 3211) ──> catálogo público
      │ window.api (IPC)              ├── WhatsApp bot (src/whatsapp/)
      ▼                               ├── Timer catálogo-auto (60s) + backups (4h)
db/run|all|get|exec|transacao ───────┘
```

- **Processo principal:** `src/main/index.ts` — cria janela, inicia servidor (`startServer` via `src/main/servidor.ts`), auto-update (`src/main/update.ts`), IPC (`src/main/ipc.ts`), log (`src/main/log.ts`). Nota: todo `src/main/` está **untracked** no git.
- **Preload:** `src/preload/index.ts:4-9` — expõe `window.api.db.{run,all,get,exec,transacao}` demais APIs (auth, estoque, servidor, catalogo, pedidosOnline, whatsapp, update, imagem, zonas).
- **Renderer:** React 18 + estado local (sem Redux/Zustand/Context global). Navegação por `useState` em `App.tsx:25-79, 459-505` (tipo `Tela`, switch-case). Componentes UI próprios em `components/ui/` + `css/` modular.
- **Servidor Express:** `src/server/index.ts` (2.298 linhas) — todas as rotas de domínio + proxy SQL genérico. Módulos auxiliares: `servidor.ts` (painel/backup/zerar), `catalogo*.ts`, `pedidos-online.ts`, `fila-offline.ts`, `importar-nex.ts`, `importar.ts`, `auditoria/`, `relay.ts`.
- **WhatsApp:** `src/whatsapp/` — 27 arquivos: engine, parser, intents, state, order, service, webhook, panel/routes.ts (~30 rotas sob `/api/whatsapp`), client (conexão provisória — ver pendências).
- **servidor-exe / setup-launcher:** variantes de empacotamento (`tsconfig.servidor-exe.json`, `electron-builder.servidor.yml`).
- **panel-servidor:** HTML estático copiado como extraResources; painel admin local (import Nex, importações, status).

## 2. Caminhos de comunicação renderer → backend

1. Renderer chama `window.api.*` (preload).
2. `src/main/servidor.ts` traduz para HTTP `127.0.0.1:<porta>` com header `X-Sessao-Token`.
3. `src/server/index.ts:393-402` — middleware global de sessão; `ROTAS_PUBLICAS` (`:381-392`): ping, versao, auth/usuarios, auth/login, config, catalogo/status|config|exibicao, zonas, taxa.
4. **Caminho dominante de dados:** proxy SQL genérico `/api/db/all|get|run|exec|transacao` (`:497-641`). Escrita em `usuarios`/`permissoes` exige admin (`:486-496`); `/api/db/exec` restrito a loopback (`:582`); `/api/db/transacao` usa `BEGIN IMMEDIATE`, máx. 5000 statements (`:623-637`). **O renderer não faz fetch HTTP direto** (exceto painel).
5. Exceções REST de domínio: `/api/vendas/finalizar`, `/api/vendas/cancelar`, `/api/pedidos/cancelar`, `/api/estoque/*`, `/api/auth/*`, `/api/catalogo/*`, `/api/servidor/*`, `/api/nex/*`, `/api/importar/*`, `/api/imagem/*`, `/api/backup`, `/api/taxa`, `/api/zonas`, `/api/whatsapp/*`.
6. **Endpoint quebrado:** `src/main/servidor.ts:372` chama `/api/servidor/whatsapp` — rota inexistente no server (404 silencioso no painel de status).

## 3. Banco de dados

- **Biblioteca:** `node:sqlite` (`DatabaseSync`) — sem better-sqlite3/sqlite3/sql.js no package.json. Decisão registrada em MEMORIA.md ("NÃO DESFAZER").
- **Singleton:** `getDb()` `index.ts:73-78`; `initDb()` `:91-103` abre com `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`; `reabrirBanco()` `:83-86` idem.
- **Schema:** `src/shared/schema.ts` — `SCHEMA_VERSION = 49` (`:1`), `migrations: Record<number,string>` versões 1→50 (`:3`). Aplicador `migrate()` `index.ts:117-135`: loop `while (current < SCHEMA_VERSION)`, cada migração em `BEGIN…COMMIT`, `PRAGMA user_version`.
  - **BUG:** `migrations[50]` existe (`schema.ts:970-998`) mas o loop nunca chega nela. Tabela `vendas_canceladas_pos_fechamento` não é criada; cancelamento de venda de caixa fechado falha (`index.ts:1900`).
  - `migrations[49]` é string vazia (no-op reservado).
  - Maioria das migrações NÃO é idempotente por si (ALTER ADD COLUMN / CREATE TABLE sem IF NOT EXISTS) — idempotência depende exclusivamente do `user_version`.
  - Tabelas fora do versionamento: `catalogo_fila_offline` (runtime, `fila-offline.ts:19-27`), `_auditoria_origem` (só snapshots).
- **~65 tabelas** (lista completa em inventário interno): usuarios, categorias, subcategorias, marcas, fornecedores, produtos, clientes, clientes_enderecos, categorias_clientes, vendas, venda_itens, pagamentos, movimentacoes, compras, compra_itens, contas, reservas_contas, separacoes_dinheiro, config, marcas, pedidos, pedido_itens, pedidos_online, pedido_online_itens, pedidos_online_sync, zonas_entrega, caixas, movimentos_caixa, formas_pagamento, alteracoes_preco(+itens), listas_pdv(+itens), sequencias, permissoes, orcamentos(+itens), catalogo_sync, catalogo_fila, ncm/cest/cfop_cadastro, produtos_fiscais, historico_remocoes, logs_sistema, terminais, nex_dados_brutos, comissoes, inventarios(+itens), whatsapp_* (12 tabelas), vendas_canceladas_pos_fechamento (inalcançável).
- **Pragmas/robustez:** transações com try/ROLLBACK em todos os fluxos críticos do servidor; prepared statements universais; `PRAGMA integrity_check` no diagnóstico; `wal_checkpoint(TRUNCATE)` antes de restore.

## 4. Localização do banco por ambiente

Resolução única em `src/shared/data-dir.ts:44-68` (usada por todos os processos):

| Prioridade | Variável | Caminho |
|---|---|---|
| 1 | `TABACARIA_DB` | caminho absoluto do `.sqlite` (dev/testes/val-nex) |
| 2 | `SETUP_DADOS_DIR` | instalador NSIS escolhe pasta |
| 3 | `PORTABLE_EXECUTABLE_DIR` | `<exe-dir>/sistema-loja-tabacaria/` (portátil SFX) |
| 4 | default instalado | `<dir-exe>/sistema-loja-tabacaria/tabacaria.sqlite` → produção = `C:\NossoSistema\sistema-loja-tabacaria\tabacaria.sqlite` (confirmado em `auditoria/config.ts:9-11`) |

Backups: `<data-dir>/backups` (`data-dir.ts:97-99`), retenção 30, `VACUUM INTO` (`index.ts:195-223`), automático 1º ~2min + 4h (`:2222-2246`).

## 5. Nuvem e integrações

| Integração | Papel | Arquivos | Fonte oficial |
|---|---|---|---|
| Supabase (Postgres + Storage) | espelho do catálogo online + recebimento de pedidos | `supabase-client.ts`, `catalogo-sync.ts`, `supabase/migrations/001_schema.sql` | local → nuvem (push); pedidos: nuvem → local |
| Cloudflare Worker/D1 | caminho legado do catálogo (GitHub Pages + worker) | `catalogo-worker/`, `scripts/sync-catalogo.mjs`, `migrar-d1-para-supabase.mjs` | coexiste com Supabase — dupla implementação |
| Relay (3211) | publicação ao vivo do catálogo ao site | `relay.ts`, testes `relay-*` | local |
| WhatsApp | bot de atendimento + pedidos | `src/whatsapp/*` | pedidos entram na tabela `pedidos` local |
| Nex (NexusDB) | importação de dados do legado | `importar-nex.ts`, `nex-binary.ts`, `auditoria/`, `nexbackuptotal/`, `val-nex/` | só via snapshots de homologação |
| Auto-update | atualização do app | `main/update.ts`, `setup-launcher/autoupdate.ts` | GitHub Releases |

## 6. Build, empacotamento e scripts

- **Dev:** `npm run dev` = build servidor (`tsc -p tsconfig.server.json` → `out/server/`) + `electron-vite dev`.
- **Targets:** portable (`electron-builder.portable.yml`), setup NSIS (`setup.yml`), servidor (`servidor.yml`, extraMetadata main), padrão (`package.json#build`).
- **Scripts (18):** publicar-versao, package-setup-fast, compilar-setup, download-autoupdate-node, copiar-servidor-exe, instalar-servidor, verificar-assinatura, migrações Supabase/D1, sync-catalogo, extrair-fotos-nex, limpar-categorias, etc. (detalhamento em `06_MODULOS_E_PENDENCIAS.md`).
- **CI:** `.github/workflows` presente (release NossoSistema-Setup conforme git log `b51423c`).
- **Typecheck:** `tsconfig.node.json` (main/preload/server) + `tsconfig.web.json` (renderer) — **PASS** em 20/10/2026.

## 7. Estado do Git (documentação da proteção — sem ação)

- Branch `main` local = `a0bf568` ("feat(fase5): design system minimo + dashboard Inicio"), **1 commit à frente de `origin/main` (`4fa7b7b`) ainda não pushado**.
- Existe checkpoint remoto `c25450e` ("cline checkpoint session=... run=1", 30/08/2026) em histórico — merge de untracked daquela data; **não cobre as mudanças posteriores a 30/08**.
- Working tree: **109 arquivos alterados** (68 M, 40 ??, 1 D). Áreas: `src/renderer` (24M+6??), `src/server` (6M+7??, incl. `pedidos-online.ts`, `fila-offline.ts`, `catalogo-auto.ts`, `catalogo-sync.ts`, `supabase-client.ts`, `auditoria/` untracked), `src/main/` **inteiro untracked (5 arquivos)**, `catalogo/` (13M+2??), `catalogo-worker/` (3M+4??), `tests/` (5??+1M), `scripts/` (7??), `supabase/`, `val-nex/`, `src/preload`, `src/panel-servidor`, `src/servidor-exe` untracked.
- Backups independentes de banco existem: `backups/` (5 dumps de 14/08/2026, ~174MB cada) e 10 snapshots `homologacao/snap-*` (29-30/08/2026, `VACUUM INTO` de produção). **Não há backup independente do código além do repositório git.**
- Estratégia segura de proteção (para aprovação, NÃO executada): (1) `git add -A` seletivo revisado para excluir `.env`, `*.sqlite`, `homologacao/`, `nexbackuptotal/` grandes; (2) commit de mensagem `wip(auditoria): snapshot antes de correcoes P0/P1`; (3) push para origin/main. Nenhum reset/clean/checkout destrutivo.

## 8. Pendências de investigação arquitetural

- Config exata que produz `dist-setup/.../embedded/app` (`package-setup-fast.js`, `verificar-assinatura.ps1`) — não confirmada nos YMLs.
- Enumeração exaustiva linha-a-linha de toda referência a caminho de banco (amostragem cobriu os caminhos oficiais; pontas: scripts legados).
- Tabela completa de rotas WhatsApp (~30 em `panel/routes.ts`) sem teste HTTP.
- Runtime real do relay em produção (modo standalone vs embutido) — código existe (`relay.ts`, npm script `relay`), operação não observada.
