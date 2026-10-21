import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

let handleRequest;
try {
  ({ handleRequest } = await import("../dist/index.js"));
} catch {
  console.error("ERRO: execute 'npm run build' antes dos testes (bundle dist/index.js ausente).");
  process.exit(1);
}

// Polyfill mínimo de `caches` para o worker rodar fora do workerd (testes em
// Node puro). O worker usa cache.match/put; no teste o cache fica vazio e o
// fluxo segue para o backend, sem cachear.
if (typeof globalThis.caches === "undefined") {
  const dados = new Map();
  const cacheStub = {
    async match() { return undefined; },
    async put(chave, resposta) { dados.set(String(chave), resposta); return undefined; },
    async delete(chave) { dados.delete(String(chave)); return true; },
  };
  globalThis.caches = { default: cacheStub };
}

const ENV = {};
const ENV_DEV_CORS = { CATALOGO_CORS_ORIGEM: "http://localhost:5173,http://127.0.0.1:5173" };
const BASE = "http://localhost/api/catalogo";

const pedir = (path, opts = {}, env = ENV) => {
  const url = `${BASE}${path}`;
  return handleRequest(new Request(url, opts), env);
};

const resultado = [];
const nome = (rotulo) => resultado.push(rotulo);

// 1. Catálogo público (sem Origin) → 200, version 1, mock sintético
{
  const res = await handleRequest(new Request(`${BASE}/publico`), ENV);
  const corpo = await res.json();
  assert.equal(res.status, 200);
  assert.equal(corpo.version, 1);
  assert.ok(Array.isArray(corpo.produtos) && corpo.produtos.length > 0);
  assert.ok(corpo.produtos.every((p) => p.nome.includes("Sintetic")));
  assert.equal(corpo.loja.nome, "Loja Teste Sintetica");
  nome("catalogo/publico: 200 mock sintetico");
}

// 2. Imagem existente → 200 com MIME por magic bytes
{
  const res = await pedir("/imagem/1");
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(bytes[0], 0x89);
  assert.equal(bytes[1], 0x50);
  nome("catalogo/imagem/1: 200 image/png");
}

// 3. Imagem inexistente → 404
{
  const res = await pedir("/imagem/999");
  assert.equal(res.status, 404);
  const corpo = await res.json();
  assert.equal(corpo.error, "imagem_nao_encontrada");
  nome("catalogo/imagem/999: 404");
}

// 4-6. Métodos != GET na rota válida → 405
for (const metodo of ["POST", "PUT", "DELETE"]) {
  const res = await pedir("/publico", { method: metodo });
  assert.equal(res.status, 405);
  const corpo = await res.json();
  assert.equal(corpo.error, "metodo_nao_permitido");
  nome(`${metodo} /publico: 405`);
}

// 7. Rota desconhecida (GET) → 404
{
  const res = await pedir("/rota-desconhecida");
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "nao_encontrado");
  nome("GET /rota-desconhecida: 404");
}

// 8-9. Endpoints de banco do ERP nunca expostos → 404
for (const path of ["/api/db/run", "/api/db/get", "/api/db/exec", "/api/db/query"]) {
  const res = await pedir(path);
  assert.equal(res.status, 404);
  nome(`GET ${path}: 404`);
}

// 10-11. Padrões clássicos de proxy → 404
for (const path of ["/proxy", "/fetch", "/api/catalogo/proxy"]) {
  const res = await pedir(path);
  assert.equal(res.status, 404);
  nome(`GET ${path}: 404`);
}

// 12-14. Parâmetros SSRF ignorados → mesmo corpo do baseline
{
  const baseline = await pedir("/publico");
  const baselineTexto = await baseline.text();

  const alvos = [
    "?url=http://127.0.0.1:3210/",
    "?host=192.168.0.1",
    "?target=http://example.com",
    "?port=3210",
    "?url=http://127.0.0.1:3211/api/catalogo/publico",
  ];
  for (const q of alvos) {
    const res = await pedir(`/publico${q}`);
    assert.equal(res.status, 200);
    const corpo = await res.json();
    delete corpo.generatedAt;
    const baseNormalizada = JSON.parse(baselineTexto);
    delete baseNormalizada.generatedAt;
    assert.deepEqual(corpo, baseNormalizada);
    nome(`SSRF ignorado (${q.split("?")[1].split("=")[0]}=...): mesmo corpo 200`);
  }
}

// 15. CORS com origem permitida → ACAO com echo da origem
{
  const res = await pedir("/publico", { headers: { origin: "http://localhost:5173" } }, ENV_DEV_CORS);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(res.headers.get("vary"), "Origin");
  nome("CORS origem permitida: ACAO gravado");
}

// 16. CORS com origem não permitida → 403 e sem ACAO
{
  const res = await pedir("/publico", { headers: { origin: "https://evil.example" } }, ENV);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  assert.equal((await res.json()).error, "origem_nao_permitida");
  nome("CORS origem negada: 403 sem ACAO");
}

// 17. OPTIONS preflight rota válida → 204; rota inexistente → 404
{
  const res = await pedir("/publico", { method: "OPTIONS", headers: { origin: "http://localhost:5173" } }, ENV_DEV_CORS);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.ok(res.headers.get("access-control-allow-methods").includes("GET"));
  assert.ok(res.headers.get("access-control-allow-methods").includes("OPTIONS"));

  const resRota = await pedir("/blah", { method: "OPTIONS", headers: { origin: "http://localhost:5173" } }, ENV_DEV_CORS);
  assert.equal(resRota.status, 404);
  nome("OPTIONS preflight: 204 rota valida, 404 rota inexistente");
}

// 18. Backend em modo erro → 503 genérico
{
  const res = await pedir("/publico", {}, { CATALOGO_BACKEND_MODE: "erro" });
  assert.equal(res.status, 503);
  const corpo = await res.json();
  assert.deepEqual(corpo, { error: "catalogo_indisponivel" });
  nome("backend 'erro': 503 generico");
}

// 19. Backend em modo timeout → 503 dentro do prazo
{
  const inicio = Date.now();
  const res = await pedir("/publico", {}, { CATALOGO_BACKEND_MODE: "timeout", CATALOGO_BACKEND_TIMEOUT_MS: "200" });
  const decorrido = Date.now() - inicio;
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "catalogo_indisponivel" });
  assert.ok(decorrido >= 150 && decorrido < 5000);
  nome("backend 'timeout': 503 no prazo");
}

// 20. Nenhuma resposta vaza indícios internos
{
  const res = await pedir("/publico", { headers: { origin: "http://localhost:5173" } }, ENV_DEV_CORS);
  const texto = await res.text();
  const tudo = texto.toLowerCase() + JSON.stringify([...res.headers.keys()]);
  for (const marcador of ["3210", "3211", "localhost", "127.0.0.1", "192.168", "sqlite", "token", "set-cookie", "c:\\"]) {
    assert.ok(!tudo.includes(marcador), `vazou ('${marcador}')`);
  }
  nome("respostas: sem indicios internos");

  const resImg = await pedir("/imagem/1");
  assert.equal(resImg.headers.get("set-cookie"), null);
  assert.equal(resImg.headers.get("access-control-allow-origin"), null);
}

// 21. Adapter VPC (binding CATALOGO_API) — usa o binding e envia o Bearer
{
  const tokenVpc = "token-stub-teste-vpc";
  let headerCapturado = null;
  const stubVpc = (fn) => ({ async fetch(url, init) { headerCapturado = init.headers; return fn(url, init); } });

  // 21a. publico via VPC (prova que o adapter VPC é usado, não o mock)
  {
    const envVpc = {
      CATALOGO_API: stubVpc(() => new Response(JSON.stringify({
        version: 1, generatedAt: "x", loja: { nome: "Loja VPC Stub" },
        categorias: [], produtos: [{ id: 99, nome: "Produto VPC Stub" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })),
      CATALOGO_RELAY_TOKEN: tokenVpc,
    };
    const res = await handleRequest(new Request(`${BASE}/publico`), envVpc);
    assert.equal(res.status, 200);
    const corpo = await res.json();
    assert.equal(corpo.produtos[0].nome, "Produto VPC Stub");
    assert.equal(headerCapturado.Authorization, `Bearer ${tokenVpc}`);
    nome("VPC adapter: publico usa binding e envia Bearer");
  }

  // 21b. relay responde 401 → 503 genérico
  {
    const envVpc = {
      CATALOGO_API: stubVpc(() => new Response(JSON.stringify({ error: "nao_autorizado" }), { status: 401 })),
      CATALOGO_RELAY_TOKEN: tokenVpc,
    };
    const res = await handleRequest(new Request(`${BASE}/publico`), envVpc);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "catalogo_indisponivel" });
    nome("VPC adapter: 401 do relay vira 503 generico");
  }

  // 21c. imagem 404 do relay → 404 imagem_nao_encontrada
  {
    const envVpc = {
      CATALOGO_API: stubVpc(() => new Response(null, { status: 404 })),
      CATALOGO_RELAY_TOKEN: tokenVpc,
    };
    const res = await handleRequest(new Request(`${BASE}/imagem/999`), envVpc);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "imagem_nao_encontrada");
    nome("VPC adapter: imagem 404 propaga como 404");
  }

  // 21d. imagem 200 com MIME → repassa type e bytes
  {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const envVpc = {
      CATALOGO_API: stubVpc(() => new Response(png, { status: 200, headers: { "Content-Type": "image/png" } })),
      CATALOGO_RELAY_TOKEN: tokenVpc,
    };
    const res = await handleRequest(new Request(`${BASE}/imagem/1`), envVpc);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.equal(bytes[1], 0x50);
    nome("VPC adapter: imagem 200 repassa MIME e bytes");
  }
}

// 22. Bundle (dist/index.js) limpo e com origem de produção
{
  const bundle = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  for (const proibido of [
    "X-Sessao-Token",
    "3210",
    "3211",
    "sqlite",
    "192.168",
    "10.0",
    "localhost",
    "127.0.0.1",
    "C:\\",
  ]) {
    assert.ok(!bundle.includes(proibido), `bundle contem '${proibido}'`);
  }
  assert.ok(bundle.includes("catalogo.shishastore.com.br"));
  assert.ok(bundle.includes("CATALOGO_API"));
  const arquivoToken = process.env.CATALOGO_TEST_TOKEN_FILE;
  if (arquivoToken) {
    const valor = (await readFile(arquivoToken, "utf8")).trim();
    if (valor) assert.ok(!bundle.includes(valor), "bundle contem o valor do token do relay");
  }
  nome("bundle limpo (sem portas/ips/paths/valor de token) e binding VPC presente");
}

// 23. Adapter D1 — lê de D1 e R2
{
  const mockD1 = {
    prepare(sql) {
      const stmt = {
        _bindings: [],
        bind(...args) { this._bindings = args; return this; },
        all() { return { results: [] }; },
        first() { return null; },
      };
      if (sql.includes("loja_config")) {
        stmt.all = () => ({ results: [
          { chave: "nome_loja", valor: "Loja D1" },
          { chave: "pedidos_ativos", valor: "1" },
          { chave: "mostrar_estoque", valor: "1" },
        ]});
      }
      if (sql.includes("categorias") && !sql.includes("LEFT")) {
        stmt.all = () => ({ results: [{ id: 1, nome: "Cat D1" }] });
      }
      if (sql.includes("produtos")) {
        stmt.all = () => ({ results: [{
          id: 10, nome: "Produto D1", descricao: null, categoria_id: 1,
          categoria: "Cat D1", subcategoria: null, marca: null,
          preco: 29.9, preco_promo: null, tem_promo: 0,
          disponivel: 1, estoque: 5, ordem: 1, imagem_key: "produtos/10.jpg",
        }]});
      }
      if (sql.includes("zonas")) {
        stmt.all = () => ({ results: [] });
      }
      if (sql.includes("imagem_key") && sql.includes("WHERE")) {
        stmt.first = () => (stmt._bindings?.[0] === 10 ? { imagem_key: "produtos/10.jpg" } : null);
      }
      return stmt;
    },
    exec() { return {}; },
    batch(stmts) { return Promise.all(stmts.map(() => {})); },
  };

  const mockBucket = {
    async get(key) {
      if (key === "produtos/10.jpg") {
        return { async arrayBuffer() { return new ArrayBuffer(8); } };
      }
      return null;
    },
  };

  const envD1 = { CATALOGO_DB: mockD1, CATALOGO_BUCKET: mockBucket };

  // 23a. publico via D1
  {
    const res = await handleRequest(new Request(`${BASE}/publico`), envD1);
    assert.equal(res.status, 200);
    const corpo = await res.json();
    assert.equal(corpo.version, 1);
    assert.equal(corpo.loja.nome, "Loja D1");
    assert.equal(corpo.produtos.length, 1);
    assert.equal(corpo.produtos[0].nome, "Produto D1");
    assert.equal(corpo.produtos[0].imagem, 10);
    nome("D1 adapter: publico lê de D1");
  }

  // 23b. imagem via D1+R2
  {
    const res = await handleRequest(new Request(`${BASE}/imagem/10`), envD1);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
    nome("D1 adapter: imagem lê de R2");
  }

  // 23c. imagem inexistente no D1
  {
    const res = await handleRequest(new Request(`${BASE}/imagem/999`), envD1);
    assert.equal(res.status, 404);
    nome("D1 adapter: imagem 404");
  }
}

// 23d. D1 expõe zonas com CEPs no catálogo público
{
  const mockZonas = {
    prepare(sql) {
      const stmt = { bind() { return this; }, all() { return { results: [] }; }, first() { return null; } };
      if (sql.includes("loja_config")) {
        stmt.all = () => ({ results: [
          { chave: "nome_loja", valor: "Loja Zona" },
          { chave: "aceita_entrega", valor: "1" },
          { chave: "aceita_retirada", valor: "1" },
        ]});
      }
      if (sql.includes("categorias") && !sql.includes("LEFT")) stmt.all = () => ({ results: [] });
      if (sql.includes("produtos")) stmt.all = () => ({ results: [] });
      if (sql.includes("zonas")) {
        stmt.all = () => ({ results: [
          { id: 1, nome: "Centro", preco: 5, ceps: '["01310","01320999"]' },
          { id: 2, nome: "Zona Sul", preco: 0, ceps: '["040"]' },
        ]});
      }
      return stmt;
    },
    exec() { return {}; },
    batch() { return Promise.resolve(); },
  };
  const res = await handleRequest(new Request(`${BASE}/publico`), { CATALOGO_DB: mockZonas });
  assert.equal(res.status, 200);
  const corpo = await res.json();
  assert.ok(Array.isArray(corpo.loja.zonas) && corpo.loja.zonas.length === 2);
  const centro = corpo.loja.zonas.find((z) => z.id === 1);
  assert.ok(centro && Array.isArray(centro.ceps) && centro.ceps.includes("01310"));
  assert.ok(corpo.loja.zonas.find((z) => z.id === 2).preco === 0);
  assert.ok(!JSON.stringify(corpo).includes("poligono"), "poligono não deve vazar");
  nome("D1 adapter: zones com ceps (sem poligono)");
}

// 24. Sync endpoint — autenticação
{
  const tokenSync = "sync-test-token-12345678";
  const envSync = { CATALOGO_SYNC_TOKEN: tokenSync };

  // 24a. POST sem token → 401
  {
    const res = await handleRequest(new Request(`${BASE}/sync`, { method: "POST" }), envSync);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "nao_autorizado");
    nome("sync: POST sem token → 401");
  }

  // 24b. POST com token errado → 401
  {
    const res = await handleRequest(
      new Request(`${BASE}/sync`, {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
      }),
      envSync,
    );
    assert.equal(res.status, 401);
    nome("sync: POST token errado → 401");
  }

  // 24c. POST com token correto mas sem D1 → 503
  {
    const res = await handleRequest(
      new Request(`${BASE}/sync`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokenSync}` },
        body: JSON.stringify({}),
      }),
      envSync,
    );
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "d1_nao_configurado");
    nome("sync: POST token ok sem D1 → 503");
  }

  // 24d. GET /sync → 405
  {
    const res = await handleRequest(new Request(`${BASE}/sync`), envSync);
    assert.equal(res.status, 405);
    nome("sync: GET → 405");
  }

  // 24e. Sync de zonas faz substituição total (remove zonas órfãs/antigas)
  {
    let execDeletes = [];
    const stmtsGravados = [];
    const mockSyncDb = {
      prepare(sql) {
        const stmt = {
          _b: [],
          bind(...args) { this._b = args; return this; },
          run() { return {}; },
          all() { return { results: [] }; },
          first() { return null; },
        };
        if (sql.includes("DELETE FROM zonas_entrega")) stmt.run = () => { execDeletes.push(1); return {}; };
        return stmt;
      },
      async exec(sql) { if (sql.includes("DELETE FROM zonas_entrega")) execDeletes.push(1); return {}; },
      async batch(stmts) { stmts.forEach((s) => stmtsGravados.push(s._b)); return []; },
    };
    const envSyncDb = { CATALOGO_SYNC_TOKEN: tokenSync, CATALOGO_DB: mockSyncDb };
    const res = await handleRequest(
      new Request(`${BASE}/sync`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokenSync}` },
        body: JSON.stringify({ zonas: [
          { id: 7, nome: "Nova", preco: 5, ceps: ["01000"] },
          { id: 8, nome: "Nova2", preco: 0, ceps: ["02000"] },
        ] }),
      }),
      envSyncDb,
    );
    assert.equal(res.status, 200);
    assert.equal(execDeletes.length, 1, "deve limpar zonas antes de inserir (sem zonas órfãs)");
    assert.deepEqual(stmtsGravados[0], [7, "Nova", 5, '["01000"]']);
    assert.deepEqual(stmtsGravados[1], [8, "Nova2", 0, '["02000"]']);
    nome("sync: zonas substituídas por completo (sem órfãs)");
  }
}

// 25. Prioridade D1 > VPC
{
  let fonte = null;
  const stubD1 = {
    prepare(sql) {
      const stmt = {
        bind() { return this; },
        all() {
          if (sql.includes("loja_config")) return { results: [{ chave: "nome_loja", valor: "D1优先" }] };
          if (sql.includes("categorias") && !sql.includes("LEFT")) return { results: [] };
          if (sql.includes("produtos")) return { results: [] };
          if (sql.includes("zonas")) return { results: [] };
          return { results: [] };
        },
        first() { return null; },
      };
      return stmt;
    },
    exec() { return {}; },
    batch() { return Promise.resolve(); },
  };
  const stubVpc2 = (fn) => ({
    async fetch() { fonte = "vpc"; return fn(); },
  });

  const envBoth = {
    CATALOGO_DB: stubD1,
    CATALOGO_API: stubVpc2(() => new Response(JSON.stringify({}), { status: 200 })),
  };
  const res = await handleRequest(new Request(`${BASE}/publico`), envBoth);
  assert.equal(res.status, 200);
  assert.equal(fonte, null);
  assert.equal((await res.json()).loja.nome, "D1优先");
  nome("prioridade: D1 > VPC (VPC não chamado)");
}

// 26. Pedidos online — criar (POST /pedido) e listar (GET /pedidos)
{
  const tokenSync = "sync-test-token-12345678";

  const buildDbPedido = () => {
    const gravados = { pedidos: 0, itens: 0 };
    const db = {
      prepare(sql) {
        const s = String(sql);
        const stmt = {
          _b: [],
          bind(...args) { this._b = args; return this; },
          run() { return {}; },
          all() { return { results: [] }; },
          first() { return null; },
        };
        if (s.includes("loja_config")) {
          stmt.all = () => ({ results: [
            { chave: "pedidos_ativos", valor: "1" },
            { chave: "aceita_entrega", valor: "1" },
            { chave: "aceita_retirada", valor: "1" },
          ] });
        } else if (s.includes("FROM produtos") && s.includes("WHERE id IN")) {
          stmt.all = () => ({
            results: stmt._b.map((id) =>
              id === 5
                ? { id: 5, nome: "Produto Pedido", preco: 10, preco_promo: null, tem_promo: 0, disponivel: 1, estoque: 100 }
                : id === 7
                  ? { id: 7, nome: "Sem Estoque", preco: 3, preco_promo: null, tem_promo: 0, disponivel: 1, estoque: 1 }
                  : { id, nome: "Desconhecido", preco: 0, preco_promo: null, tem_promo: 0, disponivel: 0, estoque: 0 }
            ),
          });
        } else if (s.includes("FROM zonas_entrega")) {
          stmt.all = () => ({ results: [
            { id: 1, nome: "Centro", preco: 5, ceps: '["01000"]' },
            { id: 2, nome: "Zona Fixa", preco: 8, ceps: '["020"]' },
          ] });
        } else if (s.includes("INSERT INTO pedidos_online")) {
          stmt.run = () => { gravados.pedidos++; return {}; };
        } else if (s.includes("INSERT INTO pedido_itens_online")) {
          stmt.run = () => { gravados.itens++; return {}; };
        }
        return stmt;
      },
      exec() { return {}; },
      async batch(list) { list.forEach((x) => x.run && x.run()); return []; },
    };
    return { db, gravados };
  };

  const envPedido = () => ({ CATALOGO_DB: buildDbPedido().db, CATALOGO_SYNC_TOKEN: tokenSync });

  // 26a. POST /pedido sem D1 → 503
  {
    const res = await pedir("/pedido", { method: "POST", body: JSON.stringify({}) });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "d1_nao_configurado");
    nome("pedido: POST sem D1 → 503");
  }

  // 26b. Pedido válido (entrega, CEP em zona) → 201 com total recalculado no backend
  {
    const { db, gravados } = buildDbPedido();
    const res = await pedir("/pedido", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify({
        cliente: { nome: "Joao", whatsapp: "(41)999999999" },
        modalidade: "entrega",
        cep: "01000999",
        endereco: "Rua X, 1",
        forma_pagamento: "pix",
        itens: [{ produto_id: 5, quantidade: 2 }],
      }),
    }, { CATALOGO_DB: db });
    assert.equal(res.status, 201);
    const corpo = await res.json();
    assert.equal(corpo.ok, true);
    assert.equal(corpo.pedido.subtotal, 20);
    assert.equal(corpo.pedido.taxa_entrega, 5);
    assert.equal(corpo.pedido.total, 25);
    assert.equal(gravados.pedidos, 1, "deve gravar 1 pedido");
    assert.equal(gravados.itens, 1, "deve gravar 1 item");
    nome("pedido: cria com preço/taxa recalculados no backend (201)");
  }

  // 26c. Preço do front é ignorado — usa preço do catálogo (não confia no front)
  {
    const { db } = buildDbPedido();
    const res = await pedir("/pedido", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.5" },
      body: JSON.stringify({
        cliente: { nome: "Maria", whatsapp: "(41)888888888" },
        modalidade: "retirada",
        itens: [{ produto_id: 5, quantidade: 3 }],
      }),
    }, { CATALOGO_DB: db });
    assert.equal(res.status, 201);
    const corpo = await res.json();
    assert.equal(corpo.pedido.subtotal, 30); // 3 x preco 10 (do catálogo, não do front)
    assert.equal(corpo.pedido.taxa_entrega, 0); // retirada não tem taxa
    nome("pedido: preço sempre do catálogo (front não determina total)");
  }

  // 26d. Estoque insuficiente → 400
  {
    const { db } = buildDbPedido();
    const res = await pedir("/pedido", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.6" },
      body: JSON.stringify({
        cliente: { nome: "Ana", whatsapp: "(41)777777777" },
        modalidade: "retirada",
        itens: [{ produto_id: 7, quantidade: 5 }],
      }),
    }, { CATALOGO_DB: db });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "estoque_insuficiente");
    nome("pedido: estoque insuficiente → 400");
  }

  // 26e. CEP fora de zona na entrega → 400
  {
    const { db } = buildDbPedido();
    const res = await pedir("/pedido", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.7" },
      body: JSON.stringify({
        cliente: { nome: "Carla", whatsapp: "(41)666666666" },
        modalidade: "entrega",
        cep: "99999999",
        endereco: "Rua Y, 2",
        itens: [{ produto_id: 5, quantidade: 1 }],
      }),
    }, { CATALOGO_DB: db });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "cep_fora_zona");
    nome("pedido: CEP fora das zonas → 400");
  }

  // 26f. GET /pedidos exige token sync
  {
    const res = await pedir("/pedidos");
    assert.equal(res.status, 401);
    nome("pedidos: listar sem token → 401");
  }

  // 26g. GET /pedidos com token → 200 (lista vazia no mock)
  {
    const res = await pedir(
      "/pedidos",
      { headers: { authorization: `Bearer ${tokenSync}` } },
      { CATALOGO_SYNC_TOKEN: tokenSync, CATALOGO_DB: buildDbPedido().db },
    );
    assert.equal(res.status, 200);
    const corpo = await res.json();
    assert.equal(corpo.ok, true);
    assert.ok(Array.isArray(corpo.pedidos));
    nome("pedidos: listar com token → 200");
  }

  // 26h. Rate-limit: mesmo IP bloqueado após teto (~6/min) → 429
  {
    const { db } = buildDbPedido();
    const env = { CATALOGO_DB: db };
    const cab = { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" };
    const corpo = {
      cliente: { nome: "Brut", whatsapp: "(41)555555555" },
      modalidade: "retirada",
      itens: [{ produto_id: 5, quantidade: 1 }],
    };
    for (let i = 0; i < 6; i++) {
      const r = await pedir("/pedido", { method: "POST", headers: cab, body: JSON.stringify(corpo) }, env);
      assert.equal(r.status, 201);
    }
    const resBloqueado = await pedir("/pedido", { method: "POST", headers: cab, body: JSON.stringify(corpo) }, env);
    assert.equal(resBloqueado.status, 429);
    assert.equal((await resBloqueado.json()).error, "limite_excedido");
    nome("pedido: rate-limit por IP → 429 após teto");
  }
}

console.log(`\n${resultado.length} testes OK.`);
console.log(resultado.map((r, i) => `${String(i + 1).padStart(2, "0")}. ${r}`).join("\n"));