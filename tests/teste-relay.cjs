// TESTE — Réle local seguro do catálogo (Fase 5)
// Sobe um ERP isolado (seed em DB temporário) + o réle (out/server/server/relay.js)
// e valida os 18 cenários exigidos + 2 extras (EADDRINUSE e headers).
// O token real é passado SOMENTE via environment — não aparece em nenhum arquivo.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')

const ROOT = process.cwd().replace(/\\/g, '/')
const BASE = 'C:/fase5-teste-relay'
const DB = path.join(BASE, 'tabacaria.sqlite')
const PORTA_SEED = 3290
const PORTA_RELAY = 3211
const TOKEN_TESTE = 'TOKEN_RELAY_TESTE_9f8e7d6c5b4a3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f'
const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function spawnWait(proc, termino, rotulo, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const t = setTimeout(() => { reject(new Error(`${rotulo}: timeout aguardando '${termino}'`)) }, timeoutMs)
    proc.stdout.on('data', (d) => {
      buf += d.toString()
      if (buf.includes(termino)) { clearTimeout(t); resolve() }
    })
    proc.stderr.on('data', (d) => { buf += d.toString() })
    proc.on('exit', (code) => {
      clearTimeout(t)
      reject(new Error(`${rotulo}: saiu cedo (code=${code}). Saida: ${buf.slice(-800)}`))
    })
  })
}

function ping(p) { fs.mkdirSync(p, { recursive: true }) }
ping(BASE)
for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f) } catch {} }

const SEED_SCRIPT = `
const { initDb, getDb, seed, iniciarServidor } = require('${ROOT}/out/server/server/index.js')
initDb(${JSON.stringify(DB)})
seed(getDb())
;(() => {
  const db = getDb()
  const set = (chave, valor) => db.prepare(\`INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor\`).run(chave, valor)
  set('nome_loja', 'Tabacaria Relay Teste')
  set('telefone_loja', '(41) 98888-7777')
  set('catalogo_mostrar_estoque', '1')
  const cat = Number(db.prepare(\`INSERT INTO categorias (nome) VALUES (?)\`).run('Eletronicos').lastInsertRowid)
  const sub = Number(db.prepare(\`INSERT INTO subcategorias (nome, categoria_id) VALUES (?, ?)\`).run('Atacado', cat).lastInsertRowid)
  const marca = Number(db.prepare(\`INSERT INTO marcas (nome) VALUES (?)\`).run('Tesseract').lastInsertRowid)
  const png = Buffer.from(${JSON.stringify(PNG_1X1_B64)}, 'base64')
  const ins = db.prepare(\`INSERT INTO produtos (nome, categoria_id, subcategoria_id, marca_id, preco_venda, estoque, ativo, descricao, preco_promo, promocional, catalogo_publicado, catalogo_ordem, imagem) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)\`)
  const vape = Number(ins.run('Vape X', cat, sub, marca, 149.9, 10, 1, 'Vaporizador top', 129.9, 1, 1, 1, png).lastInsertRowid)
  ins.run('Caneta Magnetica', cat, null, marca, 60, 5, 1, '', 0, 0, 1, 2, null)
  ins.run('Sem Estoque', cat, null, null, 89.9, 0, 1, '', 0, 0, 1, 3, null)
  ins.run('Nao Publicado', cat, null, null, 25, 3, 1, '', 0, 0, 0, 4, null)
  ins.run('Inativo', cat, null, null, 15, 4, 0, '', 0, 0, 1, 5, null)
  console.log('VIDAPE=' + vape)
})()
iniciarServidor(${PORTA_SEED})
setTimeout(() => console.log('PRONTO'), 800)
`
fs.writeFileSync(path.join(BASE, 'seed.cjs'), SEED_SCRIPT, 'utf8')

let serverSeed = null
let relayProc = null
let ok = 0
let falha = 0
const check = (n, cond, det) => { if (cond) { ok++; console.log(`TESTE ${n}: OK`) } else { falha++; console.log(`TESTE ${n}: FALHA ${det}`) } }

async function main() {
  const baseUrl = `http://127.0.0.1:${PORTA_RELAY}`
  const h = { Authorization: `Bearer ${TOKEN_TESTE}` }

  serverSeed = spawn(process.execPath, [path.join(BASE, 'seed.cjs')], { env: { ...process.env, TABACARIA_DB: DB }, stdio: ['ignore', 'pipe', 'pipe'] })
  await spawnWait(serverSeed, 'PRONTO', 'seed')

  relayProc = spawn(process.execPath, [ROOT + '/out/server/server/relay.js'], {
    env: { ...process.env, TABACARIA_DB: DB, CATALOGO_RELAY_TOKEN: TOKEN_TESTE },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  await spawnWait(relayProc, 'RELAY PRONTO', 'relay')

  const jGet = async (p, token) => {
    const res = await fetch(baseUrl + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    let corpo = null
    try { corpo = await res.json() } catch { corpo = await res.text() }
    return { status: res.status, corpo, res }
  }

  // 1 — sem token → 401
  const t1 = await jGet('/api/catalogo/publico')
  check(1, t1.status === 401, `status=${t1.status}`)

  // 2 — token incorreto → 401
  const t2 = await jGet('/api/catalogo/publico', 'TOKEN_ERRADO_123')
  check(2, t2.status === 401, `status=${t2.status}`)

  // 3 — token correto → 200
  const t3 = await jGet('/api/catalogo/publico', TOKEN_TESTE)
  check(3, t3.status === 200, `status=${t3.status}`)

  // 4 — contrato Fase 1
  const j = t3.corpo
  check(4,
    j.version === 1 && !isNaN(Date.parse(j.generatedAt || '')) &&
    j.loja && j.loja.nome === 'Tabacaria Relay Teste' &&
    Array.isArray(j.categorias) && Array.isArray(j.produtos) &&
    !t3.res.headers.get('set-cookie'),
    `version=${j.version} loja=${JSON.stringify(j.loja)} setCookie=${t3.res.headers.get('set-cookie')}`)

  // 5 — privado/inativo/não publicado fora
  const nomes = (j.produtos || []).map((p) => p.nome)
  const vazou = ['Inativo', 'Nao Publicado', 'Sem Estoque'].filter((n) => nomes.includes(n))
  check(5, vazou.length === 0 && nomes.length === 2, `nomes=${JSON.stringify(nomes)}`)

  // 6 — estoque e promo seguem as regras
  const vape = (j.produtos || []).find((p) => p.nome === 'Vape X')
  check(6,
    vape && vape.estoque === 10 && vape.disponivel === true && vape.tem_promo === true &&
    vape.preco_promo === 129.9 && vape.preco === 149.9,
    `vape=${JSON.stringify(vape)}`)

  // 7 — imagem válida → PNG correto
  const img = await fetch(baseUrl + `/api/catalogo/imagem/${vape.id}`, { headers: h })
  const imgBuf = Buffer.from(await img.arrayBuffer())
  const pngEsperado = Buffer.from(PNG_1X1_B64, 'base64')
  check(7,
    img.status === 200 && img.headers.get('content-type') === 'image/png' &&
    imgBuf.length === pngEsperado.length && imgBuf.equals(pngEsperado),
    `status=${img.status} mime=${img.headers.get('content-type')} tam=${imgBuf.length}`)

  // 8 — ID inválido → 400/404
  const t8a = await jGet('/api/catalogo/imagem/0', TOKEN_TESTE)
  const t8b = await jGet('/api/catalogo/imagem/abc', TOKEN_TESTE)
  const t8c = await jGet('/api/catalogo/imagem/999999', TOKEN_TESTE)
  check(8, (t8a.status === 400 || t8a.status === 404) && (t8b.status === 400 || t8b.status === 404) && (t8c.status === 404 || t8c.status === 400), `0=${t8a.status} abc=${t8b.status} 999999=${t8c.status}`)

  // 9 — path traversal → rejeitado
  const t9a = await fetch(baseUrl + '/api/catalogo/imagem/../../etc/passwd', { headers: h })
  const t9b = await fetch(baseUrl + '/api/catalogo/imagem/..%2F..%2Fwindows%2Fwin.ini', { headers: h })
  const t9c = await fetch(baseUrl + '/api/catalogo/imagem/1/2', { headers: h })
  const corpo9a = await t9a.text()
  check(9, [400, 404, 405].includes(t9a.status) && [400, 404, 405].includes(t9b.status) && [400, 404].includes(t9c.status) && !corpo9a.includes('boot.ini'), `traversal: ${t9a.status} ${t9b.status} ${t9c.status}`)

  // 10 — URL externa / proxy genérico → inexistente
  const t10a = await fetch(baseUrl + '/proxy?url=https://evil.com', { headers: h })
  const t10b = await fetch(baseUrl + '/fetch?target=https://evil.com', { headers: h })
  const t10c = await fetch(baseUrl + '/api/catalogo/publico?url=https://evil.com', { headers: h })
  check(10, t10a.status === 404 && t10b.status === 404 && t10c.status === 200, `proxy=${t10a.status} fetch=${t10b.status} comQuery=${t10c.status}`)

  // 11, 12, 13 — métodos proibidos → 404/405
  const t11 = await fetch(baseUrl + '/api/catalogo/publico', { method: 'POST', headers: h })
  const t12 = await fetch(baseUrl + '/api/catalogo/publico', { method: 'PUT', headers: h })
  const t13 = await fetch(baseUrl + '/api/catalogo/publico', { method: 'DELETE', headers: h })
  check(11, t11.status === 404 || t11.status === 405, `POST=${t11.status}`)
  check(12, t12.status === 404 || t12.status === 405, `PUT=${t12.status}`)
  check(13, t13.status === 404 || t13.status === 405, `DELETE=${t13.status}`)

  // 14, 15, 16 — rotas proibidas inexistentes
  const t14 = await fetch(baseUrl + '/api/db/run', { headers: h })
  const t15 = await fetch(baseUrl + '/api/db/get', { headers: h })
  const t16a = await fetch(baseUrl + '/api/servidor/apikey', { headers: h })
  const t16b = await fetch(baseUrl + '/api/imagem/definir', { method: 'POST', headers: h })
  check(14, t14.status === 404, `db/run=${t14.status}`)
  check(15, t15.status === 404, `db/get=${t15.status}`)
  check(16, t16a.status === 404 && t16b.status === 404, `admin=${t16a.status} definir=${t16b.status}`)

  // 17 — bind somente 127.0.0.1:3211
  let netOk = 'nao verificado'
  try {
    const linhas = execSync('netstat -ano -p TCP | findstr "3211"').toString().split(/\r?\n/)
    const ouvinte = linhas.find((l) => l.includes('LISTENING'))
    const soLoopback = ouvinte && ouvinte.includes('127.0.0.1:3211') && !ouvinte.includes('0.0.0.0:3211') && !ouvinte.includes('[::]:3211')
    const lanIp = lanIPv4()
    let lanFechada = true
    if (lanIp) {
      lanFechada = await new Promise((resolve) => {
        const s = net.connect({ host: lanIp, port: PORTA_RELAY, timeout: 500 })
        s.on('connect', () => { s.destroy(); resolve(false) })
        s.on('error', () => { s.destroy(); resolve(true) })
        s.on('timeout', () => { s.destroy(); resolve(true) })
      })
    }
    netOk = `lan=${lanIp} loopback=${ouvinte}`
    check(17, soLoopback && lanFechada, netOk)
  } catch (e) { check(17, false, 'netstat falhou ' + e.message) }

  // 18 — sem acesso genérico (alvo fixo; query ignorada)
  const t18a = await fetch(baseUrl + `/api/catalogo/imagem/${vape.id}?url=https://evil.com`, { headers: h })
  const t18b = await fetch(baseUrl + `/api/catalogo/imagem/${vape.id}?host=192.168.1.1:3210`, { headers: h })
  const buf18a = Buffer.from(await t18a.arrayBuffer())
  check(18, t18a.status === 200 && t18b.status === 200 && buf18a.equals(pngEsperado), `a=${t18a.status} b=${t18b.status} mime=${t18a.headers.get('content-type')}`)

  // EXTRA — EADDRINUSE: segunda instância deve abortar, não trocar de porta
  const dup = spawn(process.execPath, [ROOT + '/out/server/server/relay.js'], {
    env: { ...process.env, TABACARIA_DB: DB, CATALOGO_RELAY_TOKEN: TOKEN_TESTE },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const saiu = await new Promise((resolve) => {
    let saida = ''
    dup.stdout.on('data', (d) => { saida += d.toString() })
    dup.stderr.on('data', (d) => { saida += d.toString() })
    dup.on('exit', (code) => resolve({ code, saida }))
    setTimeout(() => { dup.kill(); resolve({ code: null, saida }) }, 6000)
  })
  check('EXTRA-EADDRINUSE', saiu.code === 1 && /já está em uso/.test(saiu.saida), `code=${saiu.code} saida=${saiu.saida.slice(-160)}`)

  return { j, nomes, vape, outT1: t1, outT2: t2 }
}

function lanIPv4() {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }
  return null
}

function execSync(cmd) { return require('node:child_process').execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }) }

;(async () => {
  try {
    await main()
  } finally {
    try { relayProc.kill() } catch {}
    try { serverSeed.kill() } catch {}
  }
  console.log(`\nTOTAL: ${ok} OK, ${falha} FALHA`)
  process.exit(falha > 0 ? 1 : 0)
})().catch((e) => { console.error('ERRO GERAL:', e.message); try { relayProc.kill() } catch {}; try { serverSeed.kill() } catch {}; process.exit(1) })