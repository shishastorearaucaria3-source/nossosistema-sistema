// Teste do módulo de pedidos online do ERP: fluxo de status (Novo → Confirmado →
// Separando → Saiu para entrega → Entregue / Cancelado), tracking (histórico),
// busca por número/cliente/telefone, filtros por status/período e detalhe.
// Requer build do servidor (npm run build:servidor).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb } from '../out/server/server/index.js'
import {
  listarPedidosOnline,
  listarPedidoOnlineDetalhe,
  atualizarStatusPedidoOnline,
  STATUS_FLUXO,
  statusCanonico
} from '../out/server/server/pedidos-online.js'

const dir = mkdtempSync(join(tmpdir(), 'pedidos-online-teste-'))
const db = initDb(join(dir, 'teste.db'))

function seed(id, numero, cliente_nome, whats, status, criado, subtotal, taxa, total) {
  db.prepare(
    `INSERT INTO pedidos_online
       (id, numero, cliente_nome, cliente_whatsapp, modalidade, endereco, cep, zona_nome,
        taxa_entrega, subtotal, desconto, total, forma_pagamento, observacao, status,
        importado_em, criado_em, atualizado_em)
     VALUES (?,?,?,?,'entrega','Rua A, 123','80000000','Zona 1',?,?,0,?, 'pix', NULL, ?, ?, ?, ?)`
  ).run(id, numero, cliente_nome, whats, taxa, subtotal, total, status, criado, criado, criado)

  db.prepare(
    `INSERT INTO pedido_online_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal)
     VALUES (?, 1, 'Produto Teste', 2, ?, ?)`
  ).run(id, subtotal / 2, subtotal)

  db.prepare(
    `INSERT INTO pedido_online_tracking (pedido_id, status, origem, atualizado_em) VALUES (?, ?, 'online', ?)`
  ).run(id, status, criado)
}

test('preparação: dados de exemplo', () => {
  seed('p1', 1, 'Ana Souza', '41999990001', 'novo', '2026-09-01T10:00:00.000Z', 40, 8, 48)
  seed('p2', 2, 'Bruno Lima', '41988880002', 'confirmado', '2026-09-02T11:00:00.000Z', 60, 10, 70)
  seed('p3', 3, 'Carla Melo', '41977770003', 'entregue', '2026-09-03T12:00:00.000Z', 30, 5, 35)
  seed('p4', 4, 'Diego Reis', '41966660004', 'cancelado', '2026-09-04T13:00:00.000Z', 20, 0, 20)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM pedidos_online').get().c, 4)
})

test('fluxo de status: novo → confirmado → separando → saiu_entrega → entregue', async () => {
  assert.deepEqual(STATUS_FLUXO, ['novo', 'confirmado', 'separando', 'saiu_entrega', 'entregue', 'cancelado'])

  const passos = ['confirmado', 'separando', 'saiu_entrega', 'entregue']
  let atual = 'novo'
  for (const alvo of passos) {
    const r = await atualizarStatusPedidoOnline('p1', alvo)
    assert.equal(r.ok, true, `deve aceitar ${alvo}`)
    assert.equal(r.status, alvo)
    atual = alvo
  }
  assert.equal(atual, 'entregue')

  const detalhe = listarPedidoOnlineDetalhe('p1')
  assert.equal(detalhe.ok, true)
  const pedido = detalhe.pedido
  assert.equal(pedido.status, 'entregue')
  // tracking: import (novo/online) + 4 mudanças do ERP = 5 registros
  assert.equal(pedido.tracking.length, 5)
  const statusHistory = pedido.tracking.map((t) => t.status)
  assert.deepEqual(statusHistory, ['novo', 'confirmado', 'separando', 'saiu_entrega', 'entregue'])
})

test('cancelamento é um estado válido e tracking registra', async () => {
  seed('p5', 5, 'Eduardo Faria', '41955550005', 'novo', '2026-09-05T14:00:00.000Z', 15, 0, 15)
  const r = await atualizarStatusPedidoOnline('p5', 'cancelado')
  assert.equal(r.ok, true)
  assert.equal(r.status, 'cancelado')
  const detalhe = listarPedidoOnlineDetalhe('p5')
  assert.ok(detalhe.pedido.tracking.some((t) => t.status === 'cancelado' && t.origem === 'erp'))
})

test('status inválido é rejeitado', async () => {
  const r = await atualizarStatusPedidoOnline('p2', 'status_inexistente')
  assert.equal(r.ok, false)
  assert.equal(r.erro, 'status_invalido')
  // status local permanece inalterado
  const detalhe = listarPedidoOnlineDetalhe('p2')
  assert.equal(detalhe.pedido.status, 'confirmado')
})

test('pedido inexistente: erro pedido_nao_encontrado', async () => {
  const r = await atualizarStatusPedidoOnline('nao-existe', 'confirmado')
  assert.equal(r.ok, false)
  assert.equal(r.erro, 'pedido_nao_encontrado')
})

test("legado: em_atendimento e concluido sao mapeados", async () => {
  assert.equal(statusCanonico('em_atendimento'), 'confirmado')
  assert.equal(statusCanonico('concluido'), 'entregue')
  assert.equal(statusCanonico('cancelado'), 'cancelado')
  // atualizarStatusPedidoOnline também aceita o status legado e normaliza
  const r = await atualizarStatusPedidoOnline('p2', 'em_atendimento')
  assert.equal(r.ok, true)
  assert.equal(r.status, 'confirmado')
})

test('detalhe do pedido traz itens e tracking', () => {
  const r = listarPedidoOnlineDetalhe('p2')
  assert.equal(r.ok, true)
  assert.equal(r.pedido.itens.length, 1)
  assert.equal(r.pedido.itens[0].nome_produto, 'Produto Teste')
  assert.equal(r.pedido.itens[0].quantidade, 2)
  assert.equal(r.pedido.observacao, null)
})

test('busca por número do pedido', () => {
  const r = listarPedidosOnline({ busca: '3' })
  assert.equal(r.pedidos.length, 1)
  assert.equal(r.pedidos[0].numero, 3)
})

test('busca por nome do cliente (case-insensitive)', () => {
  const r = listarPedidosOnline({ busca: 'ana' })
  assert.equal(r.pedidos.length, 1)
  assert.equal(r.pedidos[0].numero, 1)
})

test('busca por telefone (ignora formatação)', () => {
  const r = listarPedidosOnline({ busca: '(41) 99999-0001' })
  assert.equal(r.pedidos.length, 1)
  assert.equal(r.pedidos[0].numero, 1)
})

test('filtro por status', () => {
  const entregues = listarPedidosOnline({ status: 'entregue' })
  assert.equal(entregues.pedidos.length, 2) // p1 (entregue) e p3 (entregue)
  const cancelados = listarPedidosOnline({ status: 'cancelado' })
  assert.equal(cancelados.pedidos.length, 2) // p4 e p5
  assert.ok(cancelados.pedidos.some((p) => p.numero === 4))
  const novos = listarPedidosOnline({ status: 'novo' })
  assert.equal(novos.pedidos.length, 0) // p1 já foi entregue
})

test('filtro por período (de/ate, inclusivo por dia)', () => {
  const r = listarPedidosOnline({ de: '2026-09-02', ate: '2026-09-03' })
  assert.equal(r.pedidos.length, 2) // p2 (02) e p3 (03)
  assert.ok(r.pedidos.some((p) => p.numero === 2))
  assert.ok(r.pedidos.some((p) => p.numero === 3))
})

test('ordenar: pedidos mais recentes primeiro', () => {
  const r = listarPedidosOnline({})
  assert.equal(r.pedidos[0].numero, 5) // criado em 05/09
})

test('cancelamento restaura o estoque debitado na importação', async () => {
  const pid = Number(
    db.prepare(`INSERT INTO produtos (nome, preco_custo, preco_venda, estoque, estoque_minimo, unidade, controla_estoque) VALUES ('Produto Estoque', 10, 20, 10, 0, 'un', 1)`).run().lastInsertRowid
  )
  seed('p6', 6, 'Fábio Guedes', '41944440006', 'novo', '2026-09-06T15:00:00.000Z', 40, 0, 40)
  db.exec('BEGIN')
  try {
    // referencia o item ao produto e simula o débito da importação
    db.prepare(`UPDATE pedido_online_itens SET produto_id = ? WHERE pedido_id = 'p6'`).run(pid)
    db.prepare(`UPDATE produtos SET estoque = estoque - 2 WHERE id = ?`).run(pid)
    db.exec('COMMIT')
  } catch {
    db.exec('ROLLBACK')
    throw new Error('setup do teste falhou')
  }
  assert.equal(db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid).estoque, 8)

  const r = await atualizarStatusPedidoOnline('p6', 'cancelado')
  assert.equal(r.ok, true)
  assert.equal(r.status, 'cancelado')
  assert.equal(db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid).estoque, 10, 'estoque restaurado no cancelamento')

  const mov = db.prepare(`SELECT tipo, categoria, quantidade, estoque_anterior, estoque_posterior FROM movimentacoes WHERE documento = ?`).get('PO-p6')
  assert.ok(mov, 'movimentação de restauração registrada')
  assert.equal(mov.tipo, 'entrada')
  assert.equal(mov.categoria, 'outras_entradas')
  assert.equal(mov.estoque_anterior, 8)
  assert.equal(mov.estoque_posterior, 10)

  // cancelar novamente é idempotente: não restaura em dobro
  await atualizarStatusPedidoOnline('p6', 'cancelado')
  const movs = db.prepare(`SELECT COUNT(*) c FROM movimentacoes WHERE documento = ?`).get('PO-p6').c
  assert.equal(movs, 1, 'restauração única')
  assert.equal(db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(pid).estoque, 10)
})

test('limpeza', () => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // SQLite ainda mantém o arquivo aberto no Windows; a limpeza é best-effort.
  }
})
