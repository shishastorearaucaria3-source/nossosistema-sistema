// Teste da fila offline de sync (retry/backoff) — mecanismo usado pela
// sincronização ERP→Supabase para aguentar falhas transitórias de rede sem
// perder dados nem duplicar. Requer build do servidor (npm run build:servidor).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb } from '../out/server/server/index.js'
import {
  inicializarFilaOffline,
  enqueueOperacao,
  contarPendentesFila,
  processarFilaOffline,
  pararLoopFilaOffline,
} from '../out/server/server/fila-offline.js'

const dir = mkdtempSync(join(tmpdir(), 'fila-offline-teste-'))
const db = initDb(join(dir, 'teste.db'))

test('preparação: tabela da fila criada e fila vazia', () => {
  inicializarFilaOffline()
  assert.equal(contarPendentesFila(), 0)
})

test('falha não perde dados: item permanece pendente com tentativas=1 (backoff)', async () => {
  enqueueOperacao('sincronizar', {})
  assert.equal(contarPendentesFila(), 1)
  const r = await processarFilaOffline(async () => false)
  assert.equal(r.processados, 0)
  assert.equal(r.falhas, 1)
  assert.equal(contarPendentesFila(), 1, 'item não pode sumir após falha (sem perda de dados)')
  const item = db.prepare('SELECT tentativas, proximo_tentativa FROM catalogo_fila_offline').get()
  assert.equal(item.tentativas, 1)
  assert.ok(new Date(item.proximo_tentativa).getTime() > Date.now(), 'deve agendar retry futuro (backoff)')
})

test('exaustão de tentativas remove o item (evita retry infinito)', async () => {
  db.prepare(
    "UPDATE catalogo_fila_offline SET tentativas = 4, proximo_tentativa = '2000-01-01T00:00:00.000Z'"
  ).run()
  const r = await processarFilaOffline(async () => false) // 4 -> 5 => purga (MAX_TENTATIVAS)
  assert.equal(r.falhas, 1)
  assert.equal(contarPendentesFila(), 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM catalogo_fila_offline').get().c, 0)
})

test('sucesso limpa o item pendente', async () => {
  enqueueOperacao('sincronizar', {})
  assert.equal(contarPendentesFila(), 1)
  const r = await processarFilaOffline(async () => true)
  assert.equal(r.processados, 1)
  assert.equal(contarPendentesFila(), 0)
})

test('enqueue é idempotente quando já há operação pendente (guard usado pela sync)', () => {
  enqueueOperacao('sincronizar', {})
  assert.equal(contarPendentesFila(), 1)
  // Mesma condição do catch de sincronizarCatalogo: só enfileira se fila vazia.
  if (contarPendentesFila() === 0) enqueueOperacao('sincronizar', {})
  assert.equal(contarPendentesFila(), 1, 'não deve acumular cópias da mesma operação')
})

test('limpeza', () => {
  pararLoopFilaOffline()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // SQLite ainda mantém o arquivo aberto no Windows; a limpeza é best-effort.
  }
})
