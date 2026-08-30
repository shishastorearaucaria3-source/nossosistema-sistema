# Sistema Loja Tabacaria

Sistema de gestão para loja de tabacaria, substituindo o software atual (NexTar — exe local com servidor só em rede, dados presos numa pasta do computador).

Objetivo: um sistema mais funcional, com mais controle, mais relatórios e catálogo online — rodando localmente, sem depender de serviço externo para o funcionamento da loja.

---

## O que é / o que não é

**É:** sistema desktop (Windows) para uso no balcão da loja + catálogo online (produtos, imagens e pedidos por WhatsApp) para clientes.

**Não é (por enquanto):** integração com NFC-e, SAT, TEF/pagamento em maquininha, emissão de nota fiscal. Isso entra numa fase futura, desenhado para ser plugável.

---

## Funcionalidades

### PVD (balcão) — núcleo
- Venda rápida no balcão
- Busca de produto por nome / código de barras
- Carrinho, descontos, formas de pagamento (dinheiro, pix, cartão, fiado) configuráveis
- Venda com atendente (comissão)
- Venda rápida com poucos cliques
- Caixa: abertura/fechamento, sangria, suprimento (saldo por turno)

### Gestão de preços
- Alteração em massa: percentual (+/-) ou preço fixo, filtrando por nome/categoria/marca
- Histórico de alterações com preço anterior/novo

### Servidor (módulo de administração)
- Painel de status do servidor local: API, banco, sincronização, uptime, porta, IP local e nome do PC (atualizado automaticamente)
- **Backup**: criar backup completo, listar backups com data/tamanho/localização
- **Restaurar**: selecionar um backup e restaurar os dados (com confirmação em duas etapas)
- **Corrigir**: diagnóstico de integridade do banco, produtos, estoque, pedidos, vendas e sincronização; correções seguras
- **Zerar dados**: limpeza controlada (vendas, pedidos, clientes, estoque, etc.) com confirmação em duas etapas
- **Importar dados**: CSV, Excel ou JSON de produtos com mapeamento de colunas, prévia e validação
- **Log do servidor**: níveis INFO/SUCCESS/WARNING/ERROR, limpar logs
- **Sincronização**: status por módulo (produtos, estoque, preços, pedidos, clientes, categorias) + botão sincronizar agora
- Servidor roda em segundo plano e continua ativo em outras áreas do sistema

### Formas de pagamento
- Cadastro de formas (dinheiro, pix, cartão, fiado) com troco, parcelas, taxa e dias para receber
- PDV usa as formas ativas cadastradas

### Catálogo público (site)
- Catálogo online com produtos, categorias, preços, imagens e estoque
- Carrinho com checkout no próprio site: nome, WhatsApp, endereço/CEP e modalidade (entrega ou retirada)
- Zonas de entrega publicadas no site: taxa calculada pela zona do endereço (via CEP + geolocalização) ou pela taxa padrão
- Pedido montado com endereço, zona e taxa e enviado pelo WhatsApp do cliente
- **Botão de manutenção** no app: quando ativado, o site público mostra uma página de "em manutenção"; ao desativar, volta ao catálogo
- **Toggle de pedidos ativos**: quando desativado, o site esconde o carrinho e desabilita os botões de pedido
- A publicação das mudanças no site é feita pela infraestrutura própria do catálogo (nova arquitetura em implantação, substituindo o GitHub Pages)

### Controle de estoque avançado
- Cadastro de produtos (categorias, marca, código de barras, preço de custo/venda, lucro)
- Controle de estoque por produto
- Nível mínimo com alerta de reposição
- Entradas/saídas/ajustes de estoque
- Compras de fornecedores (pedido de compra, recebimento de mercadoria)
- Múltiplos fornecedores
- Controle de validade/lote (essencial para tabacaria: isqueiros, eletrônicos, etc.)

### Relatórios e dashboard
- Vendas por dia, por período
- Vendas por produto / categoria
- Vendas por vendedor
- Margem de lucro por produto e geral
- Ticket médio, produtos mais vendidos
- Gráficos no painel inicial

### Comissão de vendedores
- Meta e percentual de comissão por vendedor
- Comissão calculada automaticamente nas vendas
- Relatório de comissão por período

### Gestão de clientes (CRM)
- Cadastro de clientes
- Histórico de compras por cliente
- Fidelidade (pontos)
- Aniversário e contato
- Saldo fiado (cliente que deve)

### Financeiro
- Contas a pagar (fornecedores, despesas fixas)
- Contas a receber (fiado, parcelas)
- Fluxo de caixa (entradas, saídas)
- Extrato simples / DRE

---

## Stack (decisão técnica)

| Camada | Escolha | Por quê |
|---|---|---|
| Desktop | Electron | App instalável no PC da loja, interface nativa, roda offline |
| Interface | React + TypeScript | Componentes reutilizáveis |
| Banco de dados | SQLite (better-sqlite3) | Arquivo único local, rápido, sem servidor externo — dados ficam na loja |
| API local | Express | Servidor interno que o Electron usa (localhost:3210), só para o sistema desktop |
| Catálogo público | Infraestrutura própria (em implantação) | Publicação do catálogo online; substitui o antigo GitHub Pages |
| Build | Vite + Electron Forge / electron-builder | Empacota o app em .exe instalável |
| Estado (front) | Zustand | Leve, simples |

Por que SQLite: o problema do sistema atual é dados presos em pasta sem controle. SQLite é um arquivo único que a gente pode **backupear, versionar e migrar**. Sem depender de serviço em nuvem. Se um dia quiser, exporta pra PostgreSQL/MySQL.

---

## Arquitetura

```
SISTEMA INTERNO (desktop, PC da loja)

┌──────────────────────────────┐
│  ELECTRON APP                │
│  ┌───────────┐  ┌─────────┐  │
│  │  PVD/UI   │  │ Módulos │  │
│  └─────┬─────┘  └─────────┘  │
│        │ (IPC)               │
│  ┌─────┴─────┐               │
│  │ API :3210 │  (localhost)  │
│  └─────┬─────┘               │
│  ┌─────┴─────┐               │
│  │  SQLite   │               │
│  └───────────┘               │
└──────────────────────────────┘

SISTEMA PÚBLICO (clientes)

┌──────────────────────────────┐
│ catalogo.shishastore.com.br  │
│  Catálogo → Carrinho →       │
│  Checkout → Pedido (WhatsApp)│
└──────────────────────────────┘
```

- **PC da loja** roda o Electron: PVD no balcão + API interna (porta 3210) + SQLite.
- **API na rede**: o servidor escuta em `0.0.0.0` e fica acessível na rede local pelo IP da máquina (ex.: `http://26.168.12.169:3210`), como o Nex. Se a porta padrão estiver ocupada, ele sobe na próxima livre automaticamente.
- **Servidor inicia com o Windows**: registrado na pasta de Inicializar (`servidor:instalar`), sobe sozinho ao ligar o PC, sem janela. O app apenas conecta a ele.
- **Catálogo público** é publicado pela infraestrutura própria do sistema; a arquitetura nova (substituindo o GitHub Pages) está em implantação.
- O cliente final usa **somente** `catalogo.shishastore.com.br` — nunca acessa o IP do PC nem `localhost:3210`.
- O delivery local (servido pela porta 3210) foi removido: existe um único canal de delivery para o cliente.

---

## Estrutura de pastas (proposta)

```
sistema-loja-tabacaria/
├─ package.json
├─ electron/               # processo principal do Electron
│  ├─ main.ts              # janela, ciclo de vida
│  ├─ db.ts                # conexão SQLite, migrations
│  └─ server.ts            # sobe API Express
├─ src/                    # código React (PVD + telas)
│  ├─ app/                 # router, layout
│  ├─ features/
│  │  ├─ pvd/              # venda no balcão
│  │  ├─ estoque/          # produtos, movimentações, compras
│  │  ├─ financeiro/       # contas, fluxo de caixa
│  │  ├─ relatorios/       # dashboard, gráficos
│  │  ├─ crm/              # clientes, fidelidade, fiado
│  │  ├─ comissoes/        # vendedores, metas, comissão
│  │  └─ delivery/         # pedidos online
│  ├─ shared/              # tipos, utils, business logic
│  └─ api/                 # cliente HTTP p/ API local
├─ server/                 # API Express
│  └─ routes/              # endpoints (produtos, vendas, pedidos...)
├─ db/
│  ├─ migrations/          # schema versionado
│  └─ seed.sql             # categorias/produtos iniciais
├─ delivery/               # site de delivery (front separado)
└─ build/                  # instalador .exe
```

---

## Faseamento (roadmap)

### Fase 1 — Fundação (MVP) ✅ em andamento
- [x] Projeto Electron + React rodando
- [x] SQLite com migrations (`node:sqlite` nativo, sem recompilar)
- [ ] Login de operador (vendedor/admin)
- [x] Cadastro de produtos e categorias (schema + seed)
- [x] PVD: vender, formas de pagamento, fechamento
- [x] Estoque: baixa automática na venda + movimentações
- [x] Caixa: abertura/fechamento + sangria/suprimento
- [x] Formas de pagamento configuráveis
- [x] Alteração em massa de preços
- [ ] Backup automático do banco

> **Status atual:** PVD funcional (busca produto, carrinho, pagamentos, baixa de estoque, movimentações). Pendente: tela de login e telas de cadastro no app.

### Fase 2 — Gestão
- Relatórios e dashboard
- Comissão de vendedores
- CRM de clientes + fiado + fidelidade
- Financeiro: contas a pagar/receber, fluxo de caixa

### Fase 3 — Delivery online
- API local + site de delivery
- Pedidos do site caem no PVD em tempo real
- Status do pedido, taxa de entrega, checkout
- ✅ **Catálogo público implementado** (checkout por WhatsApp): `catalogo.shishastore.com.br` — publicação via infraestrutura própria em implantação (fim do GitHub Pages)
- ✅ **Checkout completo no catálogo** (carrinho → endereço/CEP → zona → taxa → pedido WhatsApp)
- ✅ **Zonas de entrega integradas ao catálogo** (publicadas e calculadas no site)
- ✅ **Manutenção + pedidos ativos** publicados no site (página de manutenção e toggle de pedidos do app refletem no catálogo)
- ✅ Delivery local removido (porta 3210 serve apenas a API interna)

### Fase 4 — Fiscal e extras
- NFC-e / SAT / TEF (plugável, desenhado para entrar depois)
- Mapa e rastreio de entrega
- Múltiplas lojas / usuários avançados
- App do entregador

---

## Como rodar (desenvolvimento)

Pré-requisitos: Node.js (18+), npm.

```bash
# instalar dependências
npm install

# rodar em desenvolvimento (janela Electron + hot reload)
npm run dev

# iniciar o servidor sozinho (rede local)
npm run servidor

# registrar o servidor para iniciar com o Windows (uma vez por máquina)
npm run servidor:instalar

# gerar instalador .exe
npm run build
npm run package
```

> **Primeiro acesso:** login `admin`, senha `admin123` (usuário criado automaticamente no primeiro uso). Mude depois. Banco fica em `%APPDATA%\sistema-loja-tabacaria\tabacaria.sqlite`.

---

## Assinatura e publicação de releases (GitHub Actions + Sigstore)

Os instaladores `.exe` são **assinados digitalmente sem custo** via Sigstore (cosign) com OIDC do GitHub Actions: sem chaves privadas, sem segredos, com registro público e auditável no Rekor.

### Fluxo de publicação

1. O projeto precisa estar em um repositório GitHub (o workflow roda no GitHub, não localmente).
2. Publicar uma versão = empurrar uma **tag** `vX.Y.Z`:

   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

   ou, sem tag: aba **Actions** → *Assinar e publicar release* → **Run workflow** → informar a tag.

3. O workflow (`.github/workflows/release.yml`) compila o app (instalador NSIS + portátil + `NossoSistema-Setup.exe`), **assina cada `.exe`** com cosign keyless, **verifica a assinatura** e anexa tudo à GitHub Release:
   - os `.exe` (instaladores e portátil);
   - os bundles de assinatura (`artifacts/*.sigstore.json` — assinatura + certificado efêmero + entrada do Rekor);
   - `SHA256SUMS` (integridade de todos os arquivos);
   - `release/manifest.json` (manifesto do canal de atualização).

### Verificar uma assinatura

```bash
# instala o cosign: https://github.com/sigstore/cosign
cosign verify-blob \
  --bundle NossoSistema-Setup.exe.sigstore.json \
  --certificate-identity "https://github.com/SEU-USUARIO/SEU-REPO/.github/workflows/release.yml@refs/tags/v1.0.1" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  NossoSistema-Setup.exe
```

Saída `Verified OK` = o arquivo veio exatamente do build do workflow (integridade + procedência).

### Atenção: Sigstore ≠ Authenticode

A assinatura Sigstore **não é** uma assinatura Authenticode. O Windows/SmartScreen **continua mostrando** "Editor desconhecido / arquivo não seguro" no primeiro download (não há certificado de CA pago). O Sigstore garante **integridade** (arquivo não adulterado) e **procedência pública**, mas não remove o aviso do Windows.

Para remover o aviso: comprar um certificado de código (OV) e rodar:

```bash
scripts\assinar.cmd C:\caminho\certificado.pfx sua-senha
```

---

## Canal de atualização (HTTPS gratuito — GitHub)

| Peça | Onde fica |
|---|---|
| Binários (Setup.exe, portátil) | **GitHub Releases**: `https://github.com/USUARIO/REPO/releases/download/vX.Y.Z/NossoSistema-Setup.exe` |
| `manifest.json` (URL fixa) | **GitHub Pages**: `https://USUARIO.github.io/REPO/manifest.json` |

- O canal é configurado uma única vez no painel **Servidor → Canal de atualização** (URL do Pages). Nunca precisa mudar por versão.
- **Segurança:** canal externo exige **HTTPS** (HTTP aceito só para localhost/rede local); download valida **tamanho + SHA-256**; **backup do banco** antes de instalar; versão decide por semver — downgrade só com `"rollback": true` no manifesto.
- **Offline-first:** sem internet o app apenas não atualiza; nada quebra.
- Repo precisa ser **público** (asset de release privado exige login).

### Publicar uma versão
```bash
git tag v1.0.2 && git push origin v1.0.2
```
O workflow (`.github/workflows/release.yml`) compila, assina (Sigstore keyless), cria a Release e publica o `manifest.json` no Pages. Manual: Actions → *Assinar e publicar release* → Run workflow → informar a tag (+ opção *rollback*).

### Rollback
Rodar o workflow manualmente com a **tag boa anterior** marcando **rollback = true** — clientes fazem downgrade automático (com backup e validação completas).

### Homologação
Criar um **repositório separado** (ex.: `tabacaria-updates-homolog`) com este mesmo código/workflow; testar lá primeiro. Produção só aponta para o repo oficial após validado.

---


## Princípios

- **Dados do lojista**: tudo local, backup simples de um arquivo.
- **Offline-first**: loja funciona sem internet; o catálogo público precisa de internet para o cliente.
- **Um único delivery**: o catálogo público (`catalogo.shishastore.com.br`) é o único canal do cliente; a API `:3210` é apenas backend interno.
- **Preparado para fiscal**: NFC-e/TEF entram por camada, sem reescrever o sistema.
