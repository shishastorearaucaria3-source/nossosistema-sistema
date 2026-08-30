# Worker do Catálogo (Fase 7 — integração real)

Worker de borda do catálogo da loja. Desde a Fase 7 ele consome a infraestrutura
**real** da Cloudflare: Worker → VPC Service → Cloudflare Tunnel → cloudflared →
`127.0.0.1:3211` (catalogo-relay) → banco da loja.

```
GET /api/catalogo/publico        → catálogo em JSON (version 1)
GET /api/catalogo/imagem/:id     → bytes da imagem (MIME por magic bytes)
OPTIONS /api/catalogo/*          → preflight CORS (GET, OPTIONS)
qualquer outra rota              → 404
método != GET (rota válida)      → 405
origem CORS não permitida        → 403
erro/timeout do backend          → 503 {"error":"catalogo_indisponivel"}
```

- `src/router.ts` — rótulo da rota a partir do pathname (whitelist).
- `src/cors.ts` — política CORS restritiva (allowlist por origem).
- `src/backend.ts` — camada de backend abstraída (`CatalogoBackend`).
- `src/index.ts` — composição: rota → método → backend → resposta sanitizada.

O destino do backend é **fixado pela configuração do VPC Service** (binding
`env.CATALOGO_API`): mesmo que a URL do `fetch` traga outro host, a rota vai
sempre para o serviço cadastrado (loopback `127.0.0.1:3211`). Query params como
`?url=`, `?host=`, `?target=`, `?port=` são ignorados — sem SSRF.

## Arquitetura da cadeia (produção/homologação real)

```text
Internet → Cloudflare Worker → VPC Service → Cloudflare Tunnel
        → cloudflared (na loja) → 127.0.0.1:3211 → catalogo-relay → SQLite
```

- O relay (`src/server/relay.ts` na raiz) é o **único** processo que recebe o
  tráfego do túnel e exige `Authorization: Bearer <CATALOGO_RELAY_TOKEN>`.
- O Express/`3210` **não participa** e não é alcançável pelo caminho Cloudflare.
- O túnel não possui hostname público (acesso apenas por VPC).

## Bindings

`wrangler.jsonc`:

```jsonc
"vpc_services": [
  {
    "binding": "CATALOGO_API",
    "service_id": "<service-id do VPC Service>",
    "remote": true
  }
]
```

O `service_id` referencia o VPC Service `catalogo-api` (type `http`, porta 3211,
IPv4 `127.0.0.1`, túnel `shishastore-catalogo`).

## Secrets

Somente nome, nunca valor:

- `CATALOGO_RELAY_TOKEN` (`secret_text`) — Bearer aceito pelo relay. Definido em:
  - Cloudflare: `npx wrangler secret put CATALOGO_RELAY_TOKEN`
  - Relay local: arquivo `<dataDir>/catalogo-relay.token` ou env
    `CATALOGO_RELAY_TOKEN`.

Não existe secret no `wrangler.jsonc`, nem no bundle, nem no frontend.

## Backend (adapter)

`criarBackend(env)` escolhe o adapter:

| Condição                    | Adapter            |
| --------------------------- | ------------------ |
| `env.CATALOGO_API` presente | `BackendVpc` (VPC Service → relay) |
| senão `CATALOGO_BACKEND_MODE=erro/timeout` | simula falha (desenvolvimento) |
| senão (padrão)              | `BackendMock` (dados sintéticos, só testes) |

## Rodando (desenvolvimento local)

```bash
npm install
npx wrangler dev --port 8787
```

CORS de produção (`https://catalogo.shishastore.com.br`) embutido; origens extras
entram por `.dev.vars` (ver `.dev.vars.example`): `CATALOGO_CORS_ORIGEM`.

Em `wrangler dev`, com `remote: true`, o binding resolve para o VPC Service real
— depende do tunnel/cloudflared/relay ativos.

## Build e testes

```bash
npm run typecheck   # tsc --noEmit
npm run build       # wrangler deploy --dry-run --outdir dist (sem publicar)
npm test            # node tests/teste-worker.mjs (unit, mock + adapter VPC stub)
node tests/teste-e2e-worker.mjs  # E2E externo contra o deploy (cadeia real)
```

O `test` de bundle usa `CATALOGO_TEST_TOKEN_FILE=<caminho do token local>` para
garantir que o valor do segredo NÃO está no bundle.

## Deploy e rollback

```bash
npx wrangler deploy          # publica homologação em workers.dev
npx wrangler versions list   # versões publicadas
npx wrangler rollback        # volta para a versão anterior
```

Homologação atual: `https://catalogo-worker.shishastore-tabacaria.workers.dev`
(sem custom domain/DNS nesta fase).

## Verificação da infra

```bash
# túnel
cloudflared tunnel list
cloudflared tunnel info shishastore-catalogo

# VPC Service
npx wrangler vpc service list
npx wrangler vpc service get <service-id>

# relay
(Get-NetTCPConnection -State Listen -LocalPort 3211)

# secrets
npx wrangler secret list
```

## Troubleshooting

- **503 `catalogo_indisponivel`**: relay fora do ar, cloudflared desconectado ou
  VPC sem conexão. Verificar `cloudflared tunnel info`, porta 3211 e token do
  relay. 401 do relay vira 503 (sem vazar o erro interno).
- **CORS 403**: origem não está na allowlist (production ou `CATALOGO_CORS_ORIGEM`).
- **Imagem 404**: produto publicado sem imagem no banco.
- **ERRO ao iniciar relay (EADDRINUSE)**: porta 3211 já em uso; corrija antes
  (fail-closed, o relay não troca de porta).

## Limites atuais

- Sem KV/rate limit ainda; a estrutura de resposta já prevê `Cache-Control`.
- O frontend continua apontado para a URL do worker de homologação até a Fase 8.