# CHECKPOINT — Importação / Migração Nex (concluída nesta etapa)

> Data: 30/08/2026 · Escopo: somente a funcionalidade **Importação / Migração Nex**.
> Estados de interesse: **importador Nex funcional**, rotas `/api/nex/*`, tela do painel, homologação/snapshot, deduplicação, histórico, testes, limitações registradas.
> Diretrizes em vigor: não modificar comportamento do importador, não fazer refatoração desnecessária nele, não alterar produção, **sem release**.

---

## 1. Visão geral

O servidor/backend importa vendas exportadas do Nex (arquivos `.xls`/`.xlsx`) para um **snapshot de homologação** (cópia do banco de produção + dados reconstruídos do Nex), com correlação por id, deduplicação e rastreio de origem. Produção nunca é gravada.

Fluxo da tela: **Selecionar arquivo → Analisar → Preparar base → Pré-visualizar → Importar → Resultado/Histórico**.

## 2. Importador Nex funcionando

- Módulo controlador: `src/server/auditoria/servidor-importador.ts`.
- Reutiliza a auditoria existente (assinaturas): `xls.ts`, `correlacao.ts`, `homologacao.ts`, `importador.ts`, `pagespecies.ts`, `nex-leitura.ts`, `config.ts`.
- Exporta: `getProgresso`, `estaOcupado`, `comOcupacao`, `listarArquivos`, `identificarTipoArquivo`, `mapearColunas`, `analisar`, `getPreparado`, `preparar`, `montarPendentes`, `contagemPorConfiancaLocal`, `exigirPreparado`, `preview`, `importar`, `historico`, `liberar` (e reexporta `lerTransacoesXLS`, `normalizarTransacao`, `lerArquivoXLS`).
- Regras mantidas:
  - **Vendas** = `TranNome == "Venda"` + correlação `No.Tran == Tran.id` → **EXATA**.
  - **Itens** = registro `MovEst.nx1` vinculado à venda.
  - **Pagamentos** = `PagEspecies` (sem campo Valor → `NÃO DETERMINADO`).
  - Importação **transacional**: falha → ROLLBACK.
- Estado em memória (`preparado`): snapshot + buffers dos arquivos `.nx1` (~660 MB) + índices NX. **Vive no processo** — reiniciar o servidor exige re-executar "Preparar base".

## 3. Rotas `/api/nex/*`

Todas em `src/server/index.ts`, todas com `somenteLocal` (funcionam sem token requisitadas do próprio PC do servidor; remotas recebem 403). Respostas `{ ok, erro?, ... }`; 409 enquanto o controlador está ocupado.

| Método | Rota | Corpo | Descrição |
|---|---|---|---|
| GET | `/api/nex/arquivos` | — | Lista `.xls`/`.xlsx` de `AUD_XLS_DIR` |
| GET | `/api/nex/estado` | — | `ocupado`, `preparado {snapshotDir}`, `progresso` |
| POST | `/api/nex/progresso` | — | Progresso da operação em andamento |
| POST | `/api/nex/analisar` | `{ arquivo }` | Identifica tipo, mapeia colunas, contagens, totais |
| POST | `/api/nex/preparar` | `{ reusar }` | Snapshot + índices NX em memória (reuso do snapshot mais recente com SHA256 igual) |
| POST | `/api/nex/preview` | `{ arquivo, confiancaMin }` | Correlação + contagens por confiança (amostra) |
| POST | `/api/nex/importar` | `{ arquivo, confiancaMin }` | Grava no snapshot de homologação (dedup) |
| GET | `/api/nex/historico` | — | Lista snapshots com passos |
| POST | `/api/nex/liberar` | — | Descarta a base preparada da memória |

`confiancaMin`: `'EXATA'` (padrão) ou `'ALTA CONFIANÇA'`.

## 4. Tela do painel

- Arquivo: `src/panel-servidor/index.html` (single-file, vanilla JS; carregada pelo Electron em `src/main/index.ts`, copiada na release para `resources/servidor-panel` via `package.json > extraResources`).
- Item de menu **"Importação / Migração Nex"** (`data-tela="nex"`).
- Telas/helpers adicionados: `renderNex`, `apiNex`, `carregarArquivosNex`, `analisarNex`, `prepararNex`, `previewNex`, `importarNex`, `carregarEstadoNex`, `carregarHistoricoNex`, `liberarNex`, polling de progresso, modal de confirmação antes de importar.
- O painel **não** envia token de sessão; as rotas `/api/nex/*` usam `somenteLocal` para funcionar nesse padrão (decisão registrada na sessão).

## 5. Estrutura de homologação

- Diretório padrão: `homologacao/` (configurável por env `AUD_HOMOLOG_DIR`).
- Snapshots: `homologacao/snap-<AAAAMMDD-HHMMSS>-<tipo>/`, contendo:
  - `tabacaria.sqlite` — cópia do banco de produção + dados importados.
  - `homologacao.json` — metadados (abaixo).
- Envs afins: `AUD_PROD_DB`, `AUD_NX_DIR`, `AUD_XLS_DIR`.
- `producao_db_sha256` registra o hash do banco de produção no momento; snapshots com hash igual e tipo reaproveitável são reutilizados em `preparar({ reusar: true })`.

## 6. Mecanismo de snapshot

- `homologacao.json` contém: `ds` (CIRCUITO_AUDITORIA_1), `criado_em`, `producao_db_sha256`, `backups_sha256` (hash `nx:<arquivo>.nx1` e `xls:<arquivo>`), `snapshot { origem, criado_por_snapshot, bytes }`, `passos[]`, `ultimo_passo_em`.
- Preparar = criar/copiar o snapshot e reconstruir índices NX (Tran, MovEst, PagEspecies, etc.) em memória.
- Importar/Criar anexam linhas em `passos` e atualizam `ultimo_passo_em` (log imutável do que foi feito naquele snapshot).
- Snapshot mais recente usado na validação: `homologacao/snap-20260830-003840-nex-importacao`.

## 7. Deduplicação

- Identificada por `vendas.numero` (`SELECT id FROM vendas WHERE numero = ?`): linha já existente no snapshot → **não gravada**, contabilizada como `duplicadas`.
- Proveniência em `_auditoria_origem` (criada no snapshot): `venda_id, numero, arquivo_xls, id_xls, nx_id, confianca, importado_em`.
- Relatórios: `duplicadasEncontradas` (preview) e `duplicadas` (resultado, por arquivo + total).
- Validação executada com re-import do mesmo ano → 4142 já presentes foram detectadas como duplicadas (0 inseridas novas).

## 8. Histórico

- `historico()` / `GET /api/nex/historico`: lista snapshots com `dir`, `nome`, `criado_em`, `passos`, `ultimo_passo_em`, `producao_db_sha256`, `bytes`, `vendas`, `origens` (contagem de `_auditoria_origem`).
- Tela mostra a lista com data/tamanho/origens e botão "passos".

## 9. Testes executados

| Teste | Resultado |
|---|---|
| Build `npx.cmd tsc -p tsconfig.server.json` (+ `--noEmit`) | Passou |
| E2E `Exportar1jan202331122023.xls` (controller, base reservada) | 5.810 vendas + 1.742 outras; EXATA 4.142 (PROVÁVEL 47, AMBÍGUA 1.040, NÃO ENCONTRADA 581); **importar → 4.142 inseridas, 3.972 pagamentos, 0 erros** |
| Re-import do mesmo arquivo | **0 novas, 4.142 duplicadas** (dedup OK) |
| E2E `Exportarvendas.xls` (export recente, 12 linhas) | tipo `vendas_nex`; EXATA 0 / PROVÁVEL 2 / AMBÍGUA 4 / NÃO ENCONTRADA 6; import **0** (comportamento honesto, sem inventar correlação) |
| HTTP (servidor porta 3299, `TABACARIA_DB` descartável, loopback sem token) | `arquivos`, `estado`, `historico`, `analisar` → 200 |
| Contagens de origem no snapshot | `snap-20260830-003840-nex-importacao`: 4.142 origens registradas |

## 10. Limitações conhecidas (fase futura)

> Registradas, **fora do escopo atual**. Sem previsão de implementação agora.

- **Gap dos 616 IDs**: XLS 20.470 ids × NX 19.854 (16.196 EXATA importadas anteriormente); vértice 2020–2022 com data NX em world-time (export off-by-one).
- **Reconstrução completa de PagEspecies**: layout não expõe valor → pagamento = `NÃO DETERMINADO`.
- **Validações avançadas de vendedor** (hoje usa o campo do XLS/nx1).
- **Validações avançadas de produtos**.
- **Deduplicação avançada de clientes**.
- Técnica: estado `preparado` em memória (ao reiniciar o servidor, "Preparar base" precisa ser re-executado).

## 11. Arquivos alterados/criados

- `src/server/auditoria/servidor-importador.ts` — **novo** (controlador).
- `src/server/index.ts` — rotas `/api/nex/*` + import do controlador.
- `src/panel-servidor/index.html` — menu + tela completa.
- `src/server/auditoria/` — pipeline de auditoria (XLS, correlação, homologação, importador, PagEspecies, Nex) já existente, reutilizado.
- Compilado: `out/server/server/auditoria/servidor-importador.js` (via `tsconfig.server.json`).
- Dados: `homologacao/snap-20260830-003840-nex-importacao/` e demais `homologacao/snap-*` (gerados nos testes).
- Scripts de teste E2E (fora do repositório): `C:\Users\maciel\AppData\Local\Temp\opencode\teste-importador-nex.cjs` e `teste-ano2023.cjs`.

> Estado do git: alterações NÃO commitadas / **nenhum release** enviado. `src/server/auditoria/` e `homologacao/` estão untracked.

## 12. Como reproduzir os testes

```powershell
# 1. Build do servidor (PowerShell: usar npx.cmd)
npx.cmd tsc -p tsconfig.server.json

# 2. E2E rápido (Exportarvendas.xls — análise/prepara/preview/import/dedup/histórico)
node C:\Users\maciel\AppData\Local\Temp\opencode\teste-importador-nex.cjs

# 3. E2E ano 2023 (direto/reuso de snapshot; 4142 EXATA → inserir/duplicar)
node C:\Users\maciel\AppData\Local\Temp\opencode\teste-ano2023.cjs
```

Pré-requisitos dos E2E: fontes em `D:\backup nex\backupnex json xml\29-08-2026\` (`Exportarvendas.xls`, `Exportar1jan202331122023.xls`) e `D:\backup nex\bakcuptotal 28082026\Nex\Dados`; `AUD_HOMOLOG_DIR` apontando para `homologacao/` (padrão).

Pipeline completo via CLI do próprio projeto:

```powershell
node out\server\server\auditoria\run.js [--reuse] [--importar] [--exata]
```

Smoke HTTP (banco descartável, mesma máquina, sem token):

```powershell
$env:TABACARIA_DB="C:\...\temp-teste.sqlite"
node out\server\server\index.js  # ou launcher chamando initDb() + iniciarServidor(porta)
# GET http://localhost:<porta>/api/nex/arquivos  → 200
```

---

## Próxima fase (foco daqui em diante)

**Estética + Integração + Sincronização** entre: **Servidor → sistema desktop → PDV → estoque → financeiro → clientes → catálogo online**. A resolver em nova etapa; o escopo deste checkpoint permanece congelado.