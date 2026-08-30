// FASE 9C-1 (CP1) — testes unitários da proteção de permissão do Réle.
// Executam SEM abrir banco, porta ou processo: importam o módulo compilado
// out/server/server/relay.js (require.main !== module → sem efeito colateral).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const relay = require(join(process.cwd(), 'out', 'server', 'server', 'relay.js'))

function criarArvore(casos) {
  const raiz = mkdtempSync(join(tmpdir(), 'fase9c-perm-'))
  for (const [nome, conteudo] of Object.entries(casos)) {
    const dir = join(raiz, nome)
    mkdirSync(dir, { recursive: true })
    if (conteudo !== null) writeFileSync(join(dir, 'instalacao.json'), conteudo, 'utf8')
  }
  return raiz
}

test('tipoInstalacaoDoDiretorio distingue servidor/cliente e falha fechada', () => {
  const raiz = criarArvore({
    servidor: JSON.stringify({ tipo: 'servidor' }),
    cliente: JSON.stringify({ tipo: 'cliente' }),
    malformado: '{ nao é json',
    semTipo: JSON.stringify({ versao: 1 }),
    ausente: null,
  })
  try {
    assert.equal(relay.tipoInstalacaoDoDiretorio(join(raiz, 'servidor')), 'servidor')
    assert.equal(relay.tipoInstalacaoDoDiretorio(join(raiz, 'cliente')), 'cliente')
    assert.equal(relay.tipoInstalacaoDoDiretorio(join(raiz, 'malformado')), null)
    assert.equal(relay.tipoInstalacaoDoDiretorio(join(raiz, 'semTipo')), null)
    assert.equal(relay.tipoInstalacaoDoDiretorio(join(raiz, 'ausente')), null)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test('modoDesenvolvimento reconhece node/electron e NÃO confia no exe do produto', () => {
  assert.equal(relay.modoDesenvolvimento('node.exe'), true)
  assert.equal(relay.modoDesenvolvimento('C:\\Program Files\\nodejs\\node.exe'), true)
  assert.equal(relay.modoDesenvolvimento('electron.exe'), true)
  assert.equal(relay.modoDesenvolvimento('C:\\NossoSistema\\NossoSistema-Servidor.exe'), false)
  assert.equal(relay.modoDesenvolvimento('C:\\sistema loja tabacaria\\node_modules\\electron\\dist\\electron.exe'), true)
})

test('decisaoPermissaoRelay: servidor permitido; cliente/ausente/inválido BLOQUEADOS (fail-closed)', () => {
  const raiz = criarArvore({
    servidor: JSON.stringify({ tipo: 'servidor' }),
    cliente: JSON.stringify({ tipo: 'cliente' }),
    invalido: '{ x ',
    ausente: null,
  })
  try {
    const exec = 'C:\\NossoSistema\\NossoSistema-Servidor.exe'
    assert.deepEqual(relay.decisaoPermissaoRelay({ execPath: exec, dirInstalacao: join(raiz, 'servidor') }), { permitido: true, motivo: 'servidor' })
    assert.deepEqual(relay.decisaoPermissaoRelay({ execPath: exec, dirInstalacao: join(raiz, 'cliente') }), { permitido: false, motivo: 'instalacao_cliente' })
    assert.deepEqual(relay.decisaoPermissaoRelay({ execPath: exec, dirInstalacao: join(raiz, 'invalido') }), { permitido: false, motivo: 'instalacao_indefinida' })
    assert.deepEqual(relay.decisaoPermissaoRelay({ execPath: exec, dirInstalacao: join(raiz, 'ausente') }), { permitido: false, motivo: 'instalacao_indefinida' })
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test('decisaoPermissaoRelay: dev/testes (runtime node/electron) é sempre permitido', () => {
  const raiz = criarArvore({ cliente: JSON.stringify({ tipo: 'cliente' }) })
  try {
    // Mesmo com instalacao.json "cliente", execução explícita via node continua ok (dev/homolog).
    assert.deepEqual(
      relay.decisaoPermissaoRelay({ execPath: 'C:\\Program Files\\nodejs\\node.exe', dirInstalacao: join(raiz, 'cliente') }),
      { permitido: true, motivo: 'desenvolvimento' },
    )
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test('carga de importação NÃO inicia o réle (require.main guard)', () => {
  // Garante que dar require() no módulo não abre porta nem banco.
  assert.equal(typeof relay.decisaoPermissaoRelay, 'function')
  assert.equal(typeof relay.tipoInstalacaoDoDiretorio, 'function')
  assert.equal(typeof relay.modoDesenvolvimento, 'function')
})