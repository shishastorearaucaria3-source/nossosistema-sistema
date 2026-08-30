// Teste end-to-end EXTERNO da Fase 7: Worker(deploy) -> VPC -> Tunnel -> 3211 -> Relay -> SQLite.
// Uso: node tests/teste-e2e-worker.mjs
// Env: WORKER_URL (default deployed), RELAY_URL, RELAY_TOKEN_FILE, DB_PATH.
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { strict as assert } from "node:assert";

const WORKER = process.env.WORKER_URL || "https://catalogo-worker.shishastore-tabacaria.workers.dev";
const RELAY = process.env.RELAY_URL || "http://127.0.0.1:3211";
const TOKEN = (await readFile(process.env.RELAY_TOKEN_FILE || "C:/Users/maciel/AppData/Local/Temp/opencode/catalogo-real/catalogo-relay.token", "utf8")).trim();
const DB_PATH = process.env.DB_PATH || "C:/Users/maciel/AppData/Local/Temp/opencode/catalogo-real/tabacaria.sqlite";

const nome = (r) => console.log("  OK  " + r);
const j = (o) => JSON.stringify(o);
const media = async (url) => {
  const r = await fetch(url);
  return { r, texto: await r.text() };
};

console.log(`Worker: ${WORKER}\nRelay local: ${RELAY}`);

// ---- 0. Baseline local (relay) e regras do SQLite ----
const [relayRes, db] = await Promise.all([
  fetch(`${RELAY}/api/catalogo/publico`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
  Promise.resolve(new DatabaseSync(DB_PATH, { readOnly: true })),
]);
assert.equal(relayRes.status, 200, "relay local deve estar 200");
const localRef = JSON.parse(await relayRes.text());

const rows = db.prepare(
  `SELECT p.id, p.ativo, p.catalogo_publicado, p.estoque, p.promocional, p.preco_promo,
          (p.imagem IS NOT NULL AND length(p.imagem) > 0) AS tem_imagem
   FROM produtos p ORDER BY p.catalogo_ordem, p.nome`
).all();

const publicado = new Set(rows.filter((r) => r.ativo === 1 && r.catalogo_publicado === 1 && r.estoque > 0).map((r) => r.id));
const publicadosSemEstoque = rows.filter((r) => r.ativo === 1 && r.catalogo_publicado === 1 && r.estoque === 0);
const semEstoque = new Set(rows.filter((r) => r.estoque === 0).map((r) => r.id));
const porId = Object.fromEntries(rows.map((r) => [r.id, r]));
const algumNaoPublicado = rows.find((r) => !(r.ativo === 1 && r.catalogo_publicado === 1));
const comImagem = rows.find((r) => publicado.has(r.id) && r.tem_imagem === 1);
const semImagem = rows.find((r) => publicado.has(r.id) && r.tem_imagem === 0);
db.close();

assert.ok(publicado.size > 0, "precisa haver produtos publicados");
assert.ok(comImagem && semImagem, "precisa ter publicado com e sem imagem");

// ---- 1+2. externo publico: 200, dados reais == local ----
{
  const { r, texto } = await media(`${WORKER}/api/catalogo/publico`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
  const ext = JSON.parse(texto);
  delete ext.generatedAt;
  delete localRef.generatedAt;
  assert.deepEqual(ext, localRef, "catálogo externo deve ser idêntico ao local (dados reais)");
  assert.ok(ext.produtos.every((p) => !p.nome.includes("Sintetico")), "não pode ter produtos mock");
  assert.equal(ext.loja.nome, localRef.loja.nome);
  console.log(`  OK  publico 200, catálogo real == local (${ext.produtos.length} produtos, ${
    ext.categorias.length} categorias)`);
}

// ---- 4+5. publicado aparece / não publicado não aparece (por id) ----
{
  const ext = JSON.parse((await media(`${WORKER}/api/catalogo/publico`)).texto);
  const extIds = new Set(ext.produtos.map((p) => p.id));
  for (const id of [...publicado]) assert.ok(extIds.has(id), `publicado ${id} deveria aparecer`);
  assert.ok(!algumNaoPublicado || !extIds.has(algumNaoPublicado.id), `id ${algumNaoPublicado?.id} não publicado não deveria aparecer`);
  for (const r of publicadosSemEstoque) assert.ok(!extIds.has(r.id), `publicado sem estoque ${r.id} não deveria aparecer (despublicar)`);
  nome("publicado aparece; não-publicado e sem estoque não aparecem");
}

// ---- 6. regras de estoque/promo/despublicar contra o SQLite ----
{
  const ext = JSON.parse((await media(`${WORKER}/api/catalogo/publico`)).texto);
  for (const p of ext.produtos) {
    const row = porId[p.id];
    assert.ok(row, `produto ${p.id} deve existir`);
    assert.ok((row.ativo === 1 && row.catalogo_publicado === 1) || row.estoque === 0, "regra publicado+sem estoque");
    assert.equal(p.tem_promo, !!(row.promocional && row.preco_promo && row.preco_promo > 0), `promo ${p.id}`);
    assert.equal(p.disponivel, row.estoque > 0, `disponivel ${p.id}`);
    if (row.estoque === 0) assert.ok(!ext.produtos.some((x) => x.id === p.id), "sem estoque deve ser ocultado (despublicar)");
  }
  const semEstoquePublicados = [...publicado].filter((id) => semEstoque.has(id));
  for (const id of semEstoquePublicados) assert.ok(!new Set(ext.produtos.map((x) => x.id)).has(id), `sem estoque ${id} ocultado`);
  nome("estoque/promo/despublicar conforme regras da Fase 1");
}

// ---- 3. imagem real via túnel ----
{
  const r = await fetch(`${WORKER}/api/catalogo/imagem/${comImagem.id}`);
  assert.equal(r.status, 200);
  const ct = r.headers.get("content-type") || "";
  assert.ok(ct.startsWith("image/"), `mime de imagem deveria ser image/* (${ct})`);
  const bytes = await r.arrayBuffer();
  assert.ok(bytes.byteLength > 0, "imagem não pode ser vazia");
  nome(`imagem/${comImagem.id} 200 real (${ct}, ${bytes.byteLength} bytes)`);

  const { r: r404, texto: t404 } = await media(`${WORKER}/api/catalogo/imagem/${semImagem.id}`);
  assert.equal(r404.status, 404);
  assert.equal(JSON.parse(t404).error, "imagem_nao_encontrada");
  nome(`imagem/${semImagem.id} 404 (publicado sem imagem)`);

  const { r: rBad } = await media(`${WORKER}/api/catalogo/imagem/abc`);
  assert.equal(rBad.status, 400);
  nome("imagem/abc 400 id invalido");
}

// ---- SSRF externo: params não mudam o destino ----
{
  const base = JSON.parse((await media(`${WORKER}/api/catalogo/publico`)).texto);
  delete base.generatedAt;
  for (const q of [
    "?url=http://127.0.0.1:3210",
    "?host=127.0.0.1",
    "?target=http://192.168.0.1",
    "?port=3210",
    "?url=http://127.0.0.1:3211/api/catalogo/publico",
  ]) {
    const ext = JSON.parse((await media(`${WORKER}/api/catalogo/publico${q}`)).texto);
    delete ext.generatedAt;
    assert.deepEqual(ext, base, `SSRF param '${q}' não pode alterar destino`);
  }
  nome("SSRF ignorado externamente (url/host/target/port)");
}

// ---- Segurança: rotas nunca expostas ----
{
  const alvos = ["/api/db/run", "/api/db/get", "/api/db/exec", "/api/servidor/status", "/api/imagem/definir", "/proxy", "/fetch"];
  for (const caminho of alvos) {
    for (const metodo of ["GET", "POST"]) {
      const r = await fetch(`${WORKER}${caminho}`, { method: metodo });
      assert.equal(r.status, 404, `${metodo} ${caminho} deveria 404`);
    }
  }
  nome("rotas do ERP/proxy nunca expostas (404 em GET e POST)");
}

// ---- CORS externo ----
{
  const ok = await fetch(`${WORKER}/api/catalogo/publico`, { headers: { origin: "https://catalogo.shishastore.com.br" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://catalogo.shishastore.com.br");
  nome("CORS origem de produção permitida");

  const evil = await fetch(`${WORKER}/api/catalogo/publico`, { headers: { origin: "https://dominio-teste-exemplo.org" } });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  assert.equal(JSON.parse(await evil.text()).error, "origem_nao_permitida");
  nome("CORS origem desconhecida rejeitada (403, sem ACAO)");

  const pre = await fetch(`${WORKER}/api/catalogo/publico`, { method: "OPTIONS", headers: { origin: "https://catalogo.shishastore.com.br" } });
  assert.equal(pre.status, 204);
  assert.ok(pre.headers.get("access-control-allow-methods").includes("GET"));
  nome("OPTIONS preflight 204");
}

// ---- Headers/leaks: nada de interno ----
{
  for (const alvo of ["/api/catalogo/publico", "/api/catalogo/imagem/" + comImagem.id]) {
    const r = await fetch(`${WORKER}${alvo}`);
    const corpo = await r.text();
    const tudo = (corpo + j([...r.headers])).toLowerCase();
    for (const m of ["set-cookie", "x-sessao-token", "3210", "3211", "sqlite", "c:\\", "192.168", "10.0"]) {
      assert.ok(!tudo.includes(m), `vazou '${m}' em ${alvo}`);
    }
  }
  nome("nenhum header/corpo vaza token/portas/IPs/path Windows");
}

console.log("\nE2E externo concluído com sucesso (cadeia real Worker→VPC→Tunnel→3211→Relay→SQLite).");