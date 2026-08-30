import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

let handleRequest;
try {
  ({ handleRequest } = await import("../dist/index.js"));
} catch {
  console.error("ERRO: execute 'npm run build' antes dos testes (bundle dist/index.js ausente).");
  process.exit(1);
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
  const bundle = await readFile("./dist/index.js", "utf8");
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
    "acao:",
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

console.log(`\n${resultado.length} testes OK.`);
console.log(resultado.map((r, i) => `${String(i + 1).padStart(2, "0")}. ${r}`).join("\n"));