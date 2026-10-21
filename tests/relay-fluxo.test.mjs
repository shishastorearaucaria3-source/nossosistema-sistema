// FASE 9C-2 (CP5) — teste de fluxo REAL (servidor Express + relay) com banco
// temporário. Valida:
//   A) garantirTokenRelay cria <dataDir>/catalogo-relay.token quando ausente
//   B) /api/catalogo/conexao (admin/loopback) confirma tokens configurados (sem expor valor)
//   C) relay exige Bearer (401 sem / 200 com) e serve dados do banco real
//   D) alternar catalogo_publicado no banco reflete NO MESMO INSTANTE no payload
//      (o catálogo é gerado ao vivo por requisição; não há fila para isto)
//   E) configs de entrega/manutenção/pedidos (pedidos_ativos, aceita_*, taxa,
//      zonas) propagam no payload loja
// Usa portas fora da faixa real (3210/3211 intactas).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const RAIZ = process.cwd()
const BASE_TEMP = 'C:\\Users\\maciel\\AppData\\Local\\Temp\\opencode\\fase9c-fluxo-teste'
const RELAY_PATH = join(RAIZ, 'out', 'server', 'server', 'relay.js')
const INDEX_PATH = join(RAIZ, 'out', 'server', 'server', 'index.js')
const RELAY_TOKEN_PATH = join(RAIZ, 'out', 'server', 'shared', 'relay-token.js')

const require = createRequire(import.meta.url)
const serverIndex = require(INDEX_PATH)
const relayToken = require(RELAY_TOKEN_PATH)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function tempDir(rotulo) {
  const d = join(BASE_TEMP, `${rotulo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  mkdirSync(d, { recursive: true })
  return d
}
async function esperarAte(fn, { intervaloMs = 150, timeoutMs = 30000, msg = 'timeout' } = {}) {
  const inicio = Date.now()
  for (;;) {
    const v = typeof fn === 'function' ? await fn() : fn
    if (v) return v
    if (Date.now() - inicio > timeoutMs) throw new Error(msg)
    await sleep(intervaloMs)
  }
}
async function pedir(url, { method = 'GET', headers, body } = {}) {
  const res = await fetch(url, { method, headers, body })
  const texto = await res.text()
  return { status: res.status, corpo: texto ? JSON.parse(texto) : null, headers: res.headers }
}
function mudarEnvVars(parcial) {
  const antes = {}
  for (const [chave, valor] of Object.entries(parcial)) {
    antes[chave] = process.env[chave]
    if (valor === undefined) delete process.env[chave]
    else process.env[chave] = valor
  }
  return () => {
    for (const [chave, valor] of Object.entries(antes)) {
      if (valor === undefined) delete process.env[chave]
      else process.env[chave] = valor
    }
  }
}
function limparPasta(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch { /* windows pode segurar handle por um instante — ignorar */ }
}

const criancas = new Set()
after(async () => {
  for (const c of criancas) {
    try {
      c.kill()
    } catch { /* ignore */ }
  }
  criancas.clear()
})

function spawnNode(args, env) {
  const c = spawn(process.execPath, args, { env, stdio: 'ignore', windowsHide: true })
  criancas.add(c)
  return c
}

let proxPorta = 4800
function novaPorta() {
  proxPorta += 1
  return proxPorta
}
function tokenNovo() {
  return `tok-fluxo-${Math.random().toString(36).slice(2)}`
}

// ---------------------------------------------------------------------------
// A — garantirTokenRelay cria o arquivo quando ausente
// ---------------------------------------------------------------------------
test('A: garantirTokenRelay cria catalogo-relay.token (hex 64) quando não existe', () => {
  const dir = tempDir('fluxoA')
  const limpar = mudarEnvVars({
    TABACARIA_DB: join(dir, 'tabacaria.sqlite'),
    CATALOGO_RELAY_TOKEN: undefined,
    CATALOGO_RELAY_TOKEN_FILE: undefined,
  })
  try {
    const token = relayToken.garantirTokenRelay()
    const arquivo = join(dir, 'catalogo-relay.token')
    assert.ok(existsSync(arquivo), 'arquivo de token não foi criado')
    assert.equal(token, readFileSync(arquivo, 'utf8').trim())
    assert.match(token, /^[0-9a-f]{64}$/)
    assert.equal(relayToken.lerTokenRelay(), token)
    // Idempotente: segunda chamada devolve o mesmo token
    assert.equal(relayToken.garantirTokenRelay(), token)
  } finally {
    limpar()
    limparPasta(dir)
  }
})

// ---------------------------------------------------------------------------
// B–E — servidor + relay reais com banco seedado
// ---------------------------------------------------------------------------
test('B–E: fluxo real — token admin, relay com Bearer, publicação ao vivo e config de entrega', async () => {
  const dir = tempDir('fluxoBCDE')
  const portaSrv = novaPorta()
  const portaRelay = novaPorta()
  const token = tokenNovo()
  const dbFile = join(dir, 'tabacaria.sqlite')

  // Seed: produto publicado + configs de loja e entrega + zona ativa
  const db = serverIndex.initDb(dbFile)
  serverIndex.seed(db)
  db.prepare(
    `INSERT INTO produtos (nome, preco_venda, estoque, ativo, catalogo_publicado, catalogo_ordem) VALUES (?, ?, ?, 1, 1, 1)`,
  ).run('Produto Fluxo E2E', 12.5, 5)
  const gravarConfig = (chave, valor) =>
    db.prepare(`INSERT INTO config (chave, valor) VALUES (?, ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(chave, valor)
  gravarConfig('nome_loja', 'Loja Fluxo E2E')
  gravarConfig('telefone_loja', '(41) 99999-0000')
  gravarConfig('endereco_loja', 'Rua Teste, 1')
  gravarConfig('horario_funcionamento', '10h às 22h')
  gravarConfig('pedidos_ativos', '1')
  gravarConfig('aceita_entrega', '1')
  gravarConfig('aceita_retirada', '1')
  gravarConfig('taxa_entrega', '7')
  gravarConfig('manutencao_ativos', '0')
  db.prepare(`INSERT INTO zonas_entrega (nome, preco, poligono, ativo) VALUES ('Centro', 7, '{}', 1)`).run()
  db.prepare(`INSERT INTO zonas_entrega (nome, preco, poligono, ativo) VALUES ('Zona Desativada', 99, '{}', 0)`).run()
  db.close()

  // Token por arquivo (cenário de produção real: operador copia o arquivo)
  writeFileSync(join(dir, 'catalogo-relay.token'), token + '\n', 'utf8')

  const envBase = {
    ...process.env,
    TABACARIA_DB: dbFile,
  }
  const procSrv = spawnNode([INDEX_PATH], { ...envBase, TABACARIA_PORTA: String(portaSrv) })
  const procRelay = spawnNode([RELAY_PATH], { ...envBase, CATALOGO_RELAY_PORT: String(portaRelay) })

  try {
    await esperarAte(async () => {
      try {
        return (await pedir(`http://127.0.0.1:${portaSrv}/api/ping`)).status === 200 ? true : null
      } catch {
        return null
      }
    }, { msg: 'servidor Express não subiu' })
    await esperarAte(async () => {
      try {
        return (await pedir(`http://127.0.0.1:${portaRelay}/api/catalogo/publico`)).status === 401 ? true : null
      } catch {
        return null
      }
    }, { msg: 'relay não subiu (esperava 401 sem token)' })

    // B — endpoint admin devolve o token (login admin + requisição loopback)
    {
      const login = await pedir(`http://127.0.0.1:${portaSrv}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'admin', senha: 'admin123' }),
      })
      assert.equal(login.status, 200)
      assert.equal(login.corpo.ok, true)
      const sessao = login.corpo.token
      const r = await pedir(`http://127.0.0.1:${portaSrv}/api/catalogo/conexao`, {
        headers: { 'X-Sessao-Token': sessao },
      })
      assert.equal(r.status, 200)
      assert.equal(r.corpo.ok, true)
      assert.equal(r.corpo.token_relay_configurado, true)
      assert.equal(r.corpo.token_sync_configurado, true)
    }

    // B2 — painel do servidor (LOOPBACK SEM sessão): o painel local do servidor
    // (janela/EXE do servidor) chama o endpoint sem X-Sessao-Token. Loopback
    // conta como admin direto e deve devolver 200 (sem expor o token).
    {
      const sem = await pedir(`http://127.0.0.1:${portaSrv}/api/catalogo/conexao`)
      assert.equal(sem.status, 200)
      assert.equal(sem.corpo.ok, true)
      assert.equal(sem.corpo.token_relay_configurado, true)
    }

    // C — relay: 401 sem Bearer, 200 com Bearer
    {
      const sem = await pedir(`http://127.0.0.1:${portaRelay}/api/catalogo/publico`)
      assert.equal(sem.status, 401)
      assert.equal(sem.corpo.error, 'nao_autorizado')

      const com = await pedir(`http://127.0.0.1:${portaRelay}/api/catalogo/publico`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      assert.equal(com.status, 200)
      assert.equal(com.corpo.version, 1)
      assert.equal(com.corpo.loja.nome, 'Loja Fluxo E2E')
      assert.equal(com.corpo.loja.whatsapp, '(41) 99999-0000')
      assert.equal(com.corpo.produtos.length, 1)
      assert.equal(com.corpo.produtos[0].nome, 'Produto Fluxo E2E')
    }

    // E — configs de operação e entrega propagam no payload público
    {
      const pub = (await pedir(`http://127.0.0.1:${portaRelay}/api/catalogo/publico`, {
        headers: { Authorization: `Bearer ${token}` },
      })).corpo
      assert.equal(pub.loja.pedidos_ativos, true)
      assert.equal(pub.loja.manutencao_ativos, false)
      assert.equal(pub.loja.aceita_entrega, true)
      assert.equal(pub.loja.aceita_retirada, true)
      assert.equal(pub.loja.taxa_entrega, 7)
      // taxa fixa quando nenhuma zona selecionada (zona tablea: preco da zona)
      assert.equal(pub.loja.zonas.length, 1)
      assert.equal(pub.loja.zonas[0].nome, 'Centro')
      assert.equal(pub.loja.zonas[0].preco, 7)
    }

    // D — alternar publicação reflete NA MESMA REQUISIÇÃO (sem fila/sincronização)
    {
      const db2 = new DatabaseSync(dbFile)
      db2.prepare(`UPDATE produtos SET catalogo_publicado = 0 WHERE nome = 'Produto Fluxo E2E'`).run()
      db2.close()
      const semProduto = (await pedir(`http://127.0.0.1:${portaRelay}/api/catalogo/publico`, {
        headers: { Authorization: `Bearer ${token}` },
      })).corpo
      assert.equal(semProduto.produtos.length, 0)

      // E — pedidos pausados propaga imediatamente ao desligar pedidos_ativos
      const db3 = new DatabaseSync(dbFile)
      db3.prepare(`INSERT INTO config (chave, valor) VALUES ('pedidos_ativos', '0')
                   ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run()
      db3.prepare(`UPDATE produtos SET catalogo_publicado = 1 WHERE nome = 'Produto Fluxo E2E'`).run()
      db3.close()
      const com = (await pedir(`http://127.0.0.1:${portaRelay}/api/catalogo/publico`, {
        headers: { Authorization: `Bearer ${token}` },
      })).corpo
      assert.equal(com.produtos.length, 1)
      assert.equal(com.loja.pedidos_ativos, false)
    }
  } finally {
    for (const c of [procRelay, procSrv]) {
      try {
        c.kill()
      } catch { /* ignore */ }
    }
    limparPasta(dir)
  }
})