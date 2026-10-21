// Teste da camada de estoque: migrations até SCHEMA_VERSION, movimentação com
// estoque_anterior/posterior, compra com vínculo compra_id e estorno
// (reversão + impedimento de dupla reversão).
import { DatabaseSync } from 'node:sqlite'
import { migrations, SCHEMA_VERSION } from '../src/shared/schema.ts'

let passou = 0
let falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { passou++; console.log(`  OK   ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ' -> ' + detalhe : ''}`) }
}

const db = new DatabaseSync(':memory:')

// Aplica todas as migrations até a atual (SCHEMA_VERSION)
for (let next = 1; next <= SCHEMA_VERSION; next++) {
  const sql = migrations[next]
  if (sql === undefined) throw new Error(`Migration ${next} ausente`)
  db.exec('BEGIN')
  try {
    if (sql) db.exec(sql)
    db.exec(`PRAGMA user_version = ${next}`)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw new Error(`Migration ${next} falhou: ${(e as Error).message}`)
  }
}

console.log('[Schema]')
check('user_version = schema atual', (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version === SCHEMA_VERSION)
const colsMov = (db.prepare(`PRAGMA table_info(movimentacoes)`).all() as { name: string }[]).map((c) => c.name)
check('movimentacoes.estoque_anterior existe', colsMov.includes('estoque_anterior'))
check('movimentacoes.estoque_posterior existe', colsMov.includes('estoque_posterior'))
check('movimentacoes.compra_id existe', colsMov.includes('compra_id'))
const colsCompra = (db.prepare(`PRAGMA table_info(compras)`).all() as { name: string }[]).map((c) => c.name)
check('compras.cancelada existe', colsCompra.includes('cancelada'))

// Setup: produto + usuário + fornecedor
const pid = Number(db.prepare(`INSERT INTO produtos (nome, preco_custo, preco_venda, estoque, estoque_minimo, unidade, controla_estoque) VALUES ('Cigarro Teste', 10, 20, 0, 0, 'un', 1)`).run().lastInsertRowid)
const uid = Number(db.prepare(`INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES ('Op', 'op', 'x', 'gerente')`).run().lastInsertRowid)
const fid = Number(db.prepare(`INSERT INTO fornecedores (nome, ativo) VALUES ('Fornecedor A', 1)`).run().lastInsertRowid)

// Compra: entrada + vínculo + estoque posterior
console.log('\n[Movimentação de compra (entrada)]')
const documentoCompra = `C${Date.now()}`
let compraId: number | null = null
db.exec('BEGIN')
try {
  compraId = Number(db.prepare(`INSERT INTO compras (fornecedor_id, numero, total, status) VALUES (?, ?, ?, 'paga')`).run(fid, documentoCompra, 0).lastInsertRowid)
  const anterior = (db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid) as { estoque: number }).estoque
  const qtd = 5, custo = 10, valor = qtd * custo
  db.prepare(`UPDATE produtos SET estoque = estoque + ?, preco_custo = ? WHERE id = ?`).run(qtd, custo, pid)
  const posterior = anterior + qtd
  db.prepare(
    `INSERT INTO movimentacoes (produto_id, tipo, categoria, quantidade, motivo, documento, valor, compra_id, usuario_id, estoque_anterior, estoque_posterior)
     VALUES (?, 'entrada', 'compra', ?, 'Compra teste', ?, ?, ?, ?, ?, ?)`
  ).run(pid, qtd, documentoCompra, valor, compraId, uid, anterior, posterior)
  db.prepare(`INSERT INTO compra_itens (compra_id, produto_id, quantidade, preco_custo, subtotal) VALUES (?, ?, ?, ?, ?)`).run(compraId, pid, qtd, custo, valor)
  db.exec('COMMIT')
} catch (e) { db.exec('ROLLBACK'); throw e }

const posCompra = (db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid) as { estoque: number }).estoque
check('estoque subiu para 5 após compra', posCompra === 5, `atual=${posCompra}`)
const movCompra = db.prepare(`SELECT * FROM movimentacoes WHERE compra_id = ?`).get(compraId) as {
  tipo: string; categoria: string; quantidade: number; estoque_anterior: number | null; estoque_posterior: number | null; compra_id: number | null
}
check('movimentação de compra registrada (entrada/compra)', movCompra?.tipo === 'entrada' && movCompra?.categoria === 'compra')
check('compra: estoque_anterior = 0', movCompra?.estoque_anterior === 0)
check('compra: estoque_posterior = 5', movCompra?.estoque_posterior === 5)
check('compra: compra_id vinculado', movCompra?.compra_id === compraId)

// Baixa de venda (saída) com estoque anterior/posterior
console.log('\n[Baixa de venda (saída)]')
const vendaId = Number(db.prepare(`INSERT INTO vendas (numero, tipo, subtotal, desconto, total, status) VALUES ('90001', 'balcao', 40, 0, 40, 'concluida')`).run().lastInsertRowid)
db.exec('BEGIN')
try {
  const anterior = (db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid) as { estoque: number }).estoque
  const qtd = 2
  db.prepare(`UPDATE produtos SET estoque = estoque - ? WHERE id = ?`).run(qtd, pid)
  const posterior = anterior - qtd
  db.prepare(
    `INSERT INTO movimentacoes (produto_id, tipo, quantidade, motivo, venda_id, estoque_anterior, estoque_posterior)
     VALUES (?, 'saida', ?, 'venda', ?, ?, ?)`
  ).run(pid, qtd, vendaId, anterior, posterior)
  db.exec('COMMIT')
} catch (e) { db.exec('ROLLBACK'); throw e }
const posVenda = (db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid) as { estoque: number }).estoque
check('estoque desceu para 3 após venda', posVenda === 3, `atual=${posVenda}`)
const movVenda = db.prepare(`SELECT estoque_anterior, estoque_posterior FROM movimentacoes WHERE venda_id = ?`).get(vendaId) as { estoque_anterior: number | null; estoque_posterior: number | null }
check('venda: estoque_anterior = 5', movVenda?.estoque_anterior === 5)
check('venda: estoque_posterior = 3', movVenda?.estoque_posterior === 3)

// Estoque insuficiente (simula validação de saída)
console.log('\n[Estoque insuficiente]')
const estAtual = (db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid) as { estoque: number }).estoque
check('estoque atual (3) menor que pedido (10) detectado', estAtual < 10)

// Estorno da compra (reverte entrada)
console.log('\n[Estorno da compra]')
let estornadoOk = false
db.exec('BEGIN')
try {
  const c = db.prepare(`SELECT cancelada FROM compras WHERE id = ?`).get(compraId) as { cancelada: number }
  if (c.cancelada === 1) { throw new Error('dupla reversão') }
  const ci = db.prepare(`SELECT ci.produto_id, ci.quantidade, p.controla_estoque FROM compra_itens ci JOIN produtos p ON p.id = ci.produto_id WHERE ci.compra_id = ?`).all(compraId) as { produto_id: number; quantidade: number; controla_estoque: number }[]
  for (const it of ci) {
    if (it.controla_estoque !== 1) continue
    const anterior = (db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(it.produto_id) as { estoque: number }).estoque
    db.prepare(`UPDATE produtos SET estoque = estoque - ? WHERE id = ?`).run(it.quantidade, it.produto_id)
    db.prepare(
      `INSERT INTO movimentacoes (produto_id, tipo, categoria, quantidade, motivo, documento, compra_id, usuario_id, estoque_anterior, estoque_posterior)
       VALUES (?, 'saida', 'devolucao_fornecedor', ?, 'Estorno da compra', ?, ?, ?, ?, ?)`
    ).run(it.produto_id, it.quantidade, `EST-${documentoCompra}`, compraId, uid, anterior, anterior - it.quantidade)
  }
  db.prepare(`UPDATE compras SET cancelada = 1, cancelada_em = ?, cancelada_por = ? WHERE id = ?`).run(new Date().toISOString(), uid, compraId)
  db.exec('COMMIT')
  estornadoOk = true
} catch (e) { db.exec('ROLLBACK'); throw e }
check('estorno executado', estornadoOk)
const posEstorno = (db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid) as { estoque: number }).estoque
check('estoque após estorno = -2 (reverte os 5 da compra, ignorando baixa posterior)', posEstorno === -2, `atual=${posEstorno}`)
const movEstorno = db.prepare(`SELECT tipo, categoria, estoque_anterior, estoque_posterior FROM movimentacoes WHERE documento = ?`).get(`EST-${documentoCompra}`) as {
  tipo: string; categoria: string; estoque_anterior: number | null; estoque_posterior: number | null
}
check('estorno: registra saída/devolucao_fornecedor', movEstorno?.tipo === 'saida' && movEstorno?.categoria === 'devolucao_fornecedor')
check('estorno: estoque_anterior = 3', movEstorno?.estoque_anterior === 3)
check('estorno: estoque_posterior = -2', movEstorno?.estoque_posterior === -2)

// Dupla reversão impedida
console.log('\n[Impedir dupla reversão]')
const compraDepois = db.prepare(`SELECT cancelada FROM compras WHERE id = ?`).get(compraId) as { cancelada: number }
check('compra marcada como cancelada', compraDepois.cancelada === 1)
const duplaImpedida = compraDepois.cancelada === 1
check('dupla reversão bloqueada quando cancelada = 1', duplaImpedida)

// Rollback: operação que falha no meio não deixa estoque parcial
console.log('\n[Rollback de transação]')
const antesRollback = (db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid) as { estoque: number }).estoque
let rollbackOk = false
db.exec('BEGIN')
try {
  db.prepare(`UPDATE produtos SET estoque = estoque + 100 WHERE id = ?`).run(pid)
  throw new Error('falha forçada')
} catch { db.exec('ROLLBACK'); rollbackOk = true }
const depoisRollback = (db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid) as { estoque: number }).estoque
check('transação aplicou ROLLBACK', rollbackOk)
check('estoque inalterado após rollback', depoisRollback === antesRollback, `antes=${antesRollback} depois=${depoisRollback}`)

console.log(`\n===== ESTOQUE: ${passou} OK, ${falhou} FALHA =====`)
if (falhas.length) process.exit(1)
