# Worker do Catálogo (Cloud-Independent)

Worker de borda do catálogo da loja. Lê dados de **Cloudflare D1** (metadata) e **R2** (imagens), funcionando 24/7 sem depender do computador da loja.

```
GET /api/catalogo/publico        → catálogo em JSON (version 1)
GET /api/catalogo/imagem/:id     → bytes da imagem (R2 ou inline)
POST /api/catalogo/sync          → sincronização autenticada (local → cloud)
OPTIONS /api/catalogo/*          → preflight CORS
qualquer outra rota              → 404
método != GET/POST (rota válida) → 405
origem CORS não permitida        → 403
erro/timeout do backend          → 503 {"error":"catalogo_indisponivel"}
```

## Arquitetura

### Modo Cloud (produção — prioridade)
```
Browser → Worker → D1 (metadata) + R2 (imagens)
                        ↑
Local ERP → POST /api/catalogo/sync → D1 + R2
```

### Modo VPC (fallback — legado)
```
Browser → Worker → VPC Service → Tunnel → cloudflared → Relay(:3211) → SQLite
```

### Seleção automática
`criarBackend(env)` escolhe:
| Condição | Backend |
|---|---|
| `env.CATALOGO_DB` presente | `BackendD1` (D1 + R2) |
| `env.CATALOGO_API` presente | `BackendVpc` (VPC → relay) |
| `CATALOGO_BACKEND_MODE=erro` | falha (produção sem DB) |
| padrão | `BackendMock` (testes) |

## D1 Schema

```sql
loja_config     → chave/valor (nome, whatsapp, endereço, etc.)
categorias     → id, nome
produtos       → id, nome, descricao, categoria_id, preco, imagem_key, etc.
zonas_entrega  → id, nome, preco
sync_meta      → ultima_sync, versao
```

Schema: `src/schema-d1.sql`

## R2 Bucket

Bucket: `catalogo-imagens`
Chaves: `produtos/{id}.{jpg|png|webp}`
Cache-Control: `public, max-age=86400`

## Sync Endpoint

`POST /api/catalogo/sync` aceita JSON com:
```json
{
  "loja": { "nome_loja": "...", "whatsapp": "...", ... },
  "categorias": [{ "id": 1, "nome": "Essências" }],
  "produtos": [{ "id": 1, "nome": "...", "imagem_b64": "...", "imagem_ext": "jpg" }],
  "zonas": [{ "id": 1, "nome": "Centro", "preco": 5 }]
}
```

Autenticação: `Authorization: Bearer <CATALOGO_SYNC_TOKEN>`

## Setup Cloud

```bash
# 1. Criar D1 + R2
node scripts/setup-catalogo-cloud.mjs

# 2. Atualizar database_id no wrangler.jsonc

# 3. Configurar secrets
npx wrangler secret put CATALOGO_SYNC_TOKEN

# 4. Deploy
npx wrangler deploy
```

## Bindings (wrangler.jsonc)

```jsonc
"d1_databases": [{
  "binding": "CATALOGO_DB",
  "database_name": "catalogo-db",
  "database_id": "<ID>"
}],
"r2_buckets": [{
  "binding": "CATALOGO_BUCKET",
  "bucket_name": "catalogo-imagens"
}],
"vpc_services": [{  // fallback legado
  "binding": "CATALOGO_API",
  "service_id": "<service-id>",
  "remote": true
}]
```

## Secrets

Somente nome, nunca valor:
- `CATALOGO_SYNC_TOKEN` — token de autenticação do sync local→cloud
- `CATALOGO_RELAY_TOKEN` — (legado) Bearer do relay via VPC

## Build e testes

```bash
npm run typecheck   # tsc --noEmit
npm run build       # wrangler deploy --dry-run --outdir dist
npm test            # node tests/teste-worker.mjs
```

## Deploy

```bash
npx wrangler deploy
```
