// Teste do Dashboard (Fase 5): valida que as consultas reais usadas pelo
// componente Home rodam contra o schema real do servidor, em 3 cenários:
//  (A) banco vazio (métricas zeradas, sem erro de SQL),
//  (B) banco com dados (faturamento só de vendas concluídas, estoque crítico,
//      vendas recentes, caixa, pedidos, contas), e
//  (C) servidor indisponível (chamada falha → estado offline do painel).
// Uso: npm run build:servidor && node --test tests/teste-dashboard.cjs
"use strict"

const { spawn } = require('node:child_process')
const { join } = require('node:path')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const assert = require('node:assert')
const { test, before, after } = require('node:test')

const PORTA = 3275
const BASE = 'http://127.0.0.1:' + PORTA
const DIR_TESTE = mkdtempSync(join(tmpdir(), 'dash-'))
const ARQ_DB = join(DIR_TESTE, 'tabacaria.sqlite')

let servidor = null
let token = null

// Mesmas queries do src/renderer/src/features/inicio/dashboardData.ts
const SQL_NOME_LOJA = `SELECT valor FROM config WHERE chave = 'nome_loja'`

function utcHoje() {
  const agora = new Date()
  const ini = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0)
  return { ini: ini.toISOString().slice(0, 19).replace('T', ' '), fim: new Date(agora).toISOString().slice(0, 19).replace('T', ' ') }
}

function utcOntem() {
  const agora = new Date()
  const ini = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1, 0, 0, 0, 0)
  const fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1, 23, 59, 59, 999)
  return { ini: ini.toISOString().slice(0, 19).replace('T', ' '), fim: fim.toISOString().slice(0, 19).replace('T', ' ') }
}

async function post(caminho, corpo, sessaoToken) {
  const headers = { 'content-type': 'application/json' }
  if (sessaoToken) headers['x-sessao-token'] = sessaoToken
  const res = await fetch(BASE + caminho, { method: 'POST', headers, body: JSON.stringify(corpo ?? {}) })
  const dados = await res.json().catch(() => ({}))
  return { status: res.status, dados }
}

async function esperarServidor() {
  const limite = Date.now() + 30000
  while (Date.now() < limite) {
    try {
      const res = await fetch(BASE + '/api/ping', { method: 'GET' })
      if (res.ok) return
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('Servidor não respondeu em 30s')
}

const consultas = {
  nomeLoja: async () => dbGet(SQL_NOME_LOJA),
  vendasHoje: async (p) =>
    dbGet(
      `SELECT COUNT(*) AS vendas, COALESCE(SUM(total), 0) AS faturamento
       FROM vendas v WHERE v.status = 'concluida' AND v.created_at >= ? AND v.created_at <= ?`,
      [p.ini, p.fim]
    ),
  faturamentoOntem: async (p) =>
    dbGet(
      `SELECT COALESCE(SUM(total), 0) AS faturamento
       FROM vendas v WHERE v.status = 'concluida' AND v.created_at >= ? AND v.created_at <= ?`,
      [p.ini, p.fim]
    ),
  caixa: async () => dbGet(`SELECT u.nome AS usuario_nome FROM caixas c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE c.aberto = 1 ORDER BY c.id DESC LIMIT 1`),
  pedidosNovos: async () => dbGet(`SELECT COUNT(*) AS c FROM pedidos WHERE status = 'novo'`),
  produtosAtivos: async () => dbGet(`SELECT COUNT(*) AS c FROM produtos WHERE ativo = 1`),
  estoqueCritico: async () =>
    dbAll(
      `SELECT id, nome, estoque, estoque_minimo, preco_venda
       FROM produtos
       WHERE ativo = 1 AND controla_estoque = 1 AND estoque <= estoque_minimo
       ORDER BY (estoque_minimo - estoque) DESC
       LIMIT 8`
    ),
  vendasRecentes: async () =>
    dbAll(
      `SELECT v.numero, v.created_at AS criada_em, COALESCE(c.nome, 'Consumidor não identificado') AS cliente, v.total
       FROM vendas v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE v.status = 'concluida'
       ORDER BY v.created_at DESC, v.id DESC
       LIMIT 8`
    ),
  contasAbertas: async () => dbGet(`SELECT COUNT(*) AS c FROM contas WHERE status = 'aberta'`)
}

async function dbGet(sql, params) {
  const r = await post('/api/db/get', { sql, params: params ?? [] }, token)
  assert.strictEqual(r.status, 200, `db/get falhou: ${JSON.stringify(r.dados)}`)
  if (r.dados && r.dados.erro) throw new Error(r.dados.erro)
  return r.dados
}

async function dbAll(sql, params) {
  const r = await post('/api/db/all', { sql, params: params ?? [] }, token)
  assert.strictEqual(r.status, 200, `db/all falhou: ${JSON.stringify(r.dados)}`)
  if (r.dados && r.dados.erro) throw new Error(r.dados.erro)
  return r.dados
}

async function dbRun(sql, params) {
  const r = await post('/api/db/run', { sql, params: params ?? [] }, token)
  assert.strictEqual(r.status, 200, `db/run falhou: ${JSON.stringify(r.dados)}`)
  return r.dados
}

before(async () => {
  servidor = spawn(process.execPath, [join(__dirname, '..', 'out', 'server', 'server', 'index.js')], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      TABACARIA_DB: ARQ_DB,
      TABACARIA_PORTA: String(PORTA)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  servidor.stdout.on('data', () => {})
  servidor.stderr.on('data', (d) => process.stderr.write(`[servidor] ${d}`))
  await esperarServidor()

  const login = await post('/api/auth/login', { login: 'admin', senha: 'admin123' })
  assert.strictEqual(login.dados.ok, true, `login falhou: ${JSON.stringify(login.dados)}`)
  token = login.dados.token
  assert.ok(token, 'token de sessão ausente')
})

after(() => {
  if (servidor) servidor.kill()
  try { rmSync(DIR_TESTE, { recursive: true, force: true }) } catch { /* ignore */ }
})

test('A — banco vazio: métricas zeradas e SQL válido', async () => {
  const h = utcHoje()
  const o = utcOntem()

  assert.strictEqual((await consultas.vendasHoje(h)).vendas, 0)
  assert.strictEqual((await consultas.vendasHoje(h)).faturamento, 0)
  assert.strictEqual((await consultas.faturamentoOntem(o)).faturamento, 0)
  assert.strictEqual(await consultas.caixa(), null)
  assert.strictEqual((await consultas.pedidosNovos()).c, 0)
  assert.strictEqual((await consultas.produtosAtivos()).c, 0)
  assert.deepStrictEqual(await consultas.estoqueCritico(), [])
  assert.deepStrictEqual(await consultas.vendasRecentes(), [])
  assert.strictEqual((await consultas.contasAbertas()).c, 0)
})

test('B — banco com dados: métricas corretas', async () => {
  const h = utcHoje()
  const o = utcOntem()
  const agoraUtc = utcHoje().fim

  await dbRun(`UPDATE config SET valor = 'Loja Teste' WHERE chave = 'nome_loja'`)

  const [p1, p2, p3, p4, p5] = await Promise.all([
    dbRun(`INSERT INTO produtos (nome, preco_venda, estoque, estoque_minimo, ativo, controla_estoque) VALUES ('Cigarro Baixo', 15, 2, 5, 1, 1)`),
    dbRun(`INSERT INTO produtos (nome, preco_venda, estoque, estoque_minimo, ativo, controla_estoque) VALUES ('Isqueiro Ok', 5, 50, 5, 1, 1)`),
    dbRun(`INSERT INTO produtos (nome, preco_venda, estoque, estoque_minimo, ativo, controla_estoque) VALUES ('Charuto Zerado', 40, 0, 3, 1, 1)`),
    dbRun(`INSERT INTO produtos (nome, preco_venda, estoque, estoque_minimo, ativo, controla_estoque) VALUES ('Nao Controla', 8, 1, 5, 1, 0)`),
    dbRun(`INSERT INTO produtos (nome, preco_venda, estoque, estoque_minimo, ativo, controla_estoque) VALUES ('Desativado', 9, 1, 5, 0, 1)`)
  ])

  const cli = await dbRun(`INSERT INTO clientes (nome) VALUES ('Cliente Fiél')`)
  const idCli = cli.lastInsertRowid

  const v1 = await dbRun(`INSERT INTO vendas (numero, tipo, subtotal, desconto, total, status, created_at, cliente_id) VALUES ('V-0001', 'balcao', 100, 0, 100, 'concluida', ?, ?)`, [agoraUtc, idCli])
  const v2 = await dbRun(`INSERT INTO vendas (numero, tipo, subtotal, desconto, total, status, created_at, cliente_id) VALUES ('V-0002', 'balcao', 200, 0, 200, 'concluida', ?, ?)`, [agoraUtc, idCli])
  await dbRun(`INSERT INTO vendas (numero, tipo, subtotal, desconto, total, status, created_at, cancelada_em) VALUES ('V-0003', 'balcao', 999, 0, 999, 'cancelada', ?, datetime('now'))`, [agoraUtc])
  await dbRun(`INSERT INTO vendas (numero, tipo, subtotal, desconto, total, status, created_at) VALUES ('V-0004', 'balcao', 50, 0, 50, 'concluida', ?)`, [o.fim])

  await dbRun(`INSERT INTO pedidos (numero, cliente_nome, subtotal, taxa_entrega, total, status, criado_em) VALUES ('P-0001', 'Online', 30, 5, 35, 'novo', ?)`, [agoraUtc])
  await dbRun(`INSERT INTO pedidos (numero, cliente_nome, subtotal, taxa_entrega, total, status, criado_em) VALUES ('P-0002', 'Online 2', 30, 5, 35, 'confirmado', ?)`, [agoraUtc])

  await dbRun(`INSERT INTO caixas (usuario_id, aberto, saldo_inicial, total_vendas, qtd_vendas, aberto_em) VALUES (1, 1, 0, 0, 0, ?)`, [agoraUtc])

  await dbRun(`INSERT INTO contas (tipo, descricao, valor, status, vencimento) VALUES ('pagar', 'Aluguel', 1200, 'aberta', ?)`, [agoraUtc])
  await dbRun(`INSERT INTO contas (tipo, descricao, valor, status) VALUES ('pagar', 'Energia', 350, 'paga')`)

  const nomeLoja = await consultas.nomeLoja()
  assert.strictEqual(nomeLoja.valor, 'Loja Teste')

  const hoje = await consultas.vendasHoje(h)
  assert.strictEqual(hoje.vendas, 2)
  assert.strictEqual(hoje.faturamento, 300)

  const ontem = await consultas.faturamentoOntem(o)
  assert.strictEqual(ontem.faturamento, 50)

  assert.strictEqual((await consultas.pedidosNovos()).c, 1)
  assert.strictEqual((await consultas.produtosAtivos()).c, 4)

  const criticos = await consultas.estoqueCritico()
  assert.strictEqual(criticos.length, 2)
  for (const nome of ['Cigarro Baixo', 'Charuto Zerado']) {
    assert.ok(criticos.some((x) => x.nome === nome), `${nome} deveria estar no estoque crítico`)
  }
  const zerado = criticos.find((x) => x.nome === 'Charuto Zerado')
  assert.strictEqual(zerado.estoque, 0)

  const recentes = await consultas.vendasRecentes()
  assert.strictEqual(recentes.length, 3)
  assert.ok(recentes.every((r) => !r.numero.includes('0003')), 'venda cancelada não pode aparecer')
  assert.strictEqual(recentes[0].cliente, 'Cliente Fiél')

  const caixa = await consultas.caixa()
  assert.strictEqual(caixa.usuario_nome, 'Administrador')

  assert.strictEqual((await consultas.contasAbertas()).c, 1)
})

test('C — servidor indisponível: chamada falha (estado offline do painel)', async () => {
  const portaFechada = PORTA + 100
  await assert.rejects(
    fetch(`http://127.0.0.1:${portaFechada}/api/ping`, { method: 'GET' }).catch((e) => {
      assert.match(String(e.cause?.code ?? e.message), /ECONNREFUSED|fetch failed/i)
      throw e
    }),
    'conexão recusada deveria lançar'
  )
})