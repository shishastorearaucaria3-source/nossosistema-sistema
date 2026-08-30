// TESTE — API pública do catálogo (Fase 1): GET /api/catalogo/publico
// Confirma que:
//   - local: responde 200 com version/generatedAt/loja/categorias/produtos
//   - só produtos ativos + publicados no catálogo aparecem
//   - regra de estoque (despublicar padrão) e configuração de exibição valem
//   - nenhum dado privado vaza (custo, fornecedor, cliente, token, sql, caminhos)
//   - remoto (sem sessão) → 401 (rota continua local nesta fase)
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.cwd().replace(/\\/g, '/')

async function subirServidor(baseDir, porta, forcarRemoto, inserirDados) {
  fs.mkdirSync(baseDir, { recursive: true })
  const DB = path.join(baseDir, 'tabacaria.sqlite')
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f) } catch {} }
  const script = `
const { initDb, getDb, seed, iniciarServidor } = require('${ROOT}/out/server/server/index.js')
initDb(${JSON.stringify(DB)})
seed(getDb())
${inserirDados}
iniciarServidor(${porta})
setTimeout(() => { console.log('PRONTO') }, 800)
setTimeout(() => process.exit(0), 8000)
`
  const serverFile = path.join(baseDir, 'servidor.cjs')
  fs.writeFileSync(serverFile, script, 'utf8')
  const env = { ...process.env, TABACARIA_DB: DB }
  if (forcarRemoto) env.TABACARIA_TEST_FORCE_REMOTE = '1'
  const serverProc = spawn(process.execPath, [serverFile], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve) => {
    let buf = ''
    const t = setTimeout(resolve, 15000)
    serverProc.stdout.on('data', (d) => { buf += d.toString(); if (buf.includes('PRONTO')) { clearTimeout(t); resolve() } })
    serverProc.stderr.on('data', () => {})
  })
  return serverProc
}

const SEED = `
;(() => {
  const db = getDb()
  const set = (chave, valor) => db.prepare(\`INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor\`).run(chave, valor)
  set('nome_loja', 'Tabacaria Teste')
  set('telefone_loja', '(41) 99999-0000')
  set('catalogo_mostrar_estoque', '1')
  const cat = Number(db.prepare(\`INSERT INTO categorias (nome) VALUES (?)\`).run('Eletrônicos').lastInsertRowid)
  const sub = Number(db.prepare(\`INSERT INTO subcategorias (nome, categoria_id) VALUES (?, ?)\`).run('Vaporizadores', cat).lastInsertRowid)
  const marca = Number(db.prepare(\`INSERT INTO marcas (nome) VALUES (?)\`).run('Innokin').lastInsertRowid)
  const ins = db.prepare(\`INSERT INTO produtos (nome, categoria_id, subcategoria_id, marca_id, preco_venda, estoque, ativo, descricao, preco_promo, promocional, catalogo_publicado, catalogo_ordem, imagem) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)\`)
  ins.run('Pod X', cat, sub, marca, 99.9, 10, 1, 'Pod descartavel', 79.9, 1, 1, 1, Buffer.from([1,2,3]))
  ins.run('Sem Estoque', cat, sub, marca, 89.9, 0, 1, '', 0, 0, 1, 2, null)
  ins.run('Nao Publicado', cat, null, null, 25, 3, 1, '', 0, 0, 0, 3, null)
  ins.run('Inativo', cat, null, null, 15, 4, 0, '', 0, 0, 1, 4, null)
})()
`

;(async function main() {
  const LOCAL = 'C:/fase1-teste-catalogo-publico/local'
  const PORTA_LOCAL = 3282
  let ok = 0, falha = 0
  const check = (n, cond, det) => { if (cond) { ok++; console.log(`TESTE ${n}: OK`) } else { falha++; console.log(`TESTE ${n}: FALHA ${det}`) } }
  const out = {}

  // --- Modo local (acesso sem sessão) ---
  const serverLocal = await subirServidor(LOCAL, PORTA_LOCAL, false, SEED)
  const baseUrl = `http://127.0.0.1:${PORTA_LOCAL}`

  const res = await fetch(`${baseUrl}/api/catalogo/publico`)
  out.http = res.status
  const j = await res.json()
  check(1, res.status === 200, `http=${res.status}`)
  check(2, j.version === 1 && !isNaN(Date.parse(j.generatedAt || '')), `version=${j.version} generatedAt=${j.generatedAt}`)
  check(3, j.loja && j.loja.nome === 'Tabacaria Teste' && j.loja.whatsapp === '(41) 99999-0000', `loja=${JSON.stringify(j.loja)}`)
  check(4, Array.isArray(j.categorias) && j.categorias.length === 1 && j.categorias[0].nome === 'Eletrônicos', `categorias=${JSON.stringify(j.categorias)}`)

  const nomes = (j.produtos || []).map(p => p.nome)
  const pod = (j.produtos || []).find(p => p.nome === 'Pod X')
  check(5, nomes.includes('Pod X') && pod.preco === 99.9 && pod.tem_promo === true && pod.preco_promo === 79.9, `produtos=${JSON.stringify(nomes)}`)
  check(6, pod.imagem === pod.id && pod.estoque === 10 && pod.disponivel === true, `imagem=${pod.imagem} estoque=${pod.estoque}`)
  check(7, !nomes.includes('Inativo') && !nomes.includes('Nao Publicado') && !nomes.includes('Sem Estoque'), `vazou=${JSON.stringify(nomes)}`)
  check(8, !('codigo' in pod) && !('codigo_barras' in pod), 'codigo exposto?')

  const texto = JSON.stringify(j)
  const privados = ['senha', 'password', 'token', 'github', 'custo', 'margem', 'fornecedor', 'cliente', 'cpf', 'venda', 'pagamento', 'usuario', 'sqlite', 'api_key', 'estoque_minimo', 'preco_custo', '192.168', 'localhost', ':3210']
  const vazados = privados.filter(p => texto.toLowerCase().includes(p))
  check(9, vazados.length === 0, `vazou=${JSON.stringify(vazados)}`)

  out.produtosContados = (j.produtos || []).length
  await new Promise((r) => { serverLocal.on('exit', r); setTimeout(r, 9000) })

  // --- Modo remoto (FORCE_REMOTE=1): sem sessão → 401 ---
  const REMOTO = 'C:/fase1-teste-catalogo-publico/remoto'
  const PORTA_REMOTO = 3283
  const serverRemoto = await subirServidor(REMOTO, PORTA_REMOTO, true, SEED)
  const remoto = await fetch(`http://127.0.0.1:${PORTA_REMOTO}/api/catalogo/publico`)
  check(10, remoto.status === 401, `remoto sem sessao=${remoto.status}`)
  await new Promise((r) => { serverRemoto.on('exit', r); setTimeout(r, 9000) })

  console.log(JSON.stringify(out, null, 2))
  console.log(`\nTOTAL: ${ok} OK, ${falha} FALHA`)
  process.exit(falha > 0 ? 1 : 0)
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })