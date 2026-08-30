// FASE 9C-1 (CP2+CP4) — testes de integração do Supervisor do Réle.
// Criam banco e pidfile TEMPORÁRIOS (C:\Users\maciel\AppData\Local\Temp\opencode\fase9c-relay-teste)
// e usam portas CATALOGO_RELAY_PORT fora da faixa real (3211 permanece intocada).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const RAIZ = process.cwd()
const BASE_TEMP = 'C:\\Users\\maciel\\AppData\\Local\\Temp\\opencode\\fase9c-relay-teste'
const RELAY_PATH = join(RAIZ, 'out', 'server', 'server', 'relay.js')
const SUPERVISOR_PATH = join(RAIZ, 'out', 'server', 'server', 'relay-supervisao.js')
const INDEX_PATH = join(RAIZ, 'out', 'server', 'server', 'index.js')

const require = createRequire(import.meta.url)
const supervisor = require(SUPERVISOR_PATH)
const serverIndex = require(INDEX_PATH)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function tempDir(rotulo) {
  const d = join(BASE_TEMP, `${rotulo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  mkdirSync(d, { recursive: true })
  return d
}
async function esperarAte(fn, { intervaloMs = 120, timeoutMs = 30000, msg = 'timeout' } = {}) {
  const inicio = Date.now()
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() - inicio > timeoutMs) throw new Error(msg)
    await sleep(intervaloMs)
  }
}
async function getJson(porta, caminho, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : undefined
  const res = await fetch(`http://127.0.0.1:${porta}${caminho}`, { headers })
  const corpo = await res.json()
  return { status: res.status, corpo }
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

let proxPorta = 4700
function novaPorta() {
  proxPorta += 1
  return proxPorta
}
function tokenNovo() {
  return `tok-fase9c-${Math.random().toString(36).slice(2)}`
}

// Registro de processos para garantir que nenhum relay/supervisor sobrevive ao
// fim da suíte (mesmo quando um teste falha no meio).
const supervisoresAtivos = new Set()
function rastrearSupervisor(sup) {
  supervisoresAtivos.add(sup)
  return sup
}
const criancasDiretas = new Set()
function rastrearCrianca(child) {
  criancasDiretas.add(child)
  return child
}
after(async () => {
  for (const sup of supervisoresAtivos) {
    try {
      await sup.parar()
    } catch { /* ignore */ }
  }
  supervisoresAtivos.clear()
  for (const child of criancasDiretas) {
    try {
      child.kill()
    } catch { /* ignore */ }
  }
  criancasDiretas.clear()
})

// ---------------------------------------------------------------------------
// Cenário A — sobe, responde (200/401) e encerra limpo via IPC
// ---------------------------------------------------------------------------
test('A: relay sobe sob supervisor, responde com/token, encerra via IPC sem órfão', async () => {
  const dir = tempDir('cenarioA')
  const porta = novaPorta()
  const token = tokenNovo()
  const limpar = mudarEnvVars({
    TABACARIA_DB: join(dir, 'tabacaria.sqlite'),
    CATALOGO_RELAY_TOKEN: token,
    CATALOGO_RELAY_PORT: String(porta),
  })
  const eventos = []
  const sup = rastrearSupervisor(new supervisor.SupervisorRelay({ dirDados: dir, porta, atrasosMs: [200, 300, 400], log: (l) => eventos.push(l) }))
  try {
    const r = sup.iniciar()
    assert.equal(r.ok, true)

    await esperarAte(() => sup.getEstado() === 'rodando', { msg: 'relay não ficou rodando' })
    const pid1 = sup.getPidRelay()
    assert.ok(Number.isInteger(pid1) && pid1 > 0, `pid do relay inválido: ${pid1}`)

    const sem = await getJson(porta, '/api/catalogo/publico', null)
    assert.equal(sem.status, 401)
    assert.equal(sem.corpo.error, 'nao_autorizado')

    const com = await getJson(porta, '/api/catalogo/publico', token)
    assert.equal(com.status, 200)
    assert.equal(com.corpo.version, 1)
    assert.ok(Array.isArray(com.corpo.produtos))

    await sup.parar()
    assert.equal(sup.getEstado(), 'parado')
    assert.equal(sup.getPidRelay(), null)
    await esperarAte(() => !existsSync(join(dir, 'relay.pid')), { msg: 'pidfile não foi removido' })
    // pid não deve mais estar vivo
    let vivo = true
    try {
      process.kill(pid1, 0)
    } catch {
      vivo = false
    }
    assert.equal(vivo, false, 'processo relay ficou órfão')
  } finally {
    limpar()
    limparPasta(dir)
  }
})

// ---------------------------------------------------------------------------
// Cenário B — relay cai (crash simulado) e o supervisor reinicia/backoff
// ---------------------------------------------------------------------------
test('B: crash do relay é detectado e o sofwer reinicia com novo pid', async () => {
  const dir = tempDir('cenarioB')
  const porta = novaPorta()
  const token = tokenNovo()
  const limpar = mudarEnvVars({
    TABACARIA_DB: join(dir, 'tabacaria.sqlite'),
    CATALOGO_RELAY_TOKEN: token,
    CATALOGO_RELAY_PORT: String(porta),
  })
  const eventos = []
  const sup = rastrearSupervisor(new supervisor.SupervisorRelay({ dirDados: dir, porta, atrasosMs: [250, 350, 450], log: (l) => eventos.push(l) }))
  try {
    const r = sup.iniciar()
    assert.equal(r.ok, true)
    await esperarAte(() => sup.getEstado() === 'rodando', { msg: 'relay não ficou rodando' })
    const pid1 = sup.getPidRelay()
    try {
      process.kill(pid1, 'SIGKILL') // simula travamento/queda do nosso próprio relay
    } catch { /* pode já ter morrido */ }

    await esperarAte(() => {
      const p2 = sup.getPidRelay()
      return sup.getEstado() === 'rodando' && p2 && p2 !== pid1 ? p2 : null
    }, { msg: 'relay não reiniciou após crash' })

    await esperarAte(() => getJson(porta, '/api/catalogo/publico', token).then((x) => (x.status === 200 ? true : null)), {
      msg: 'relay reiniciado não responde',
    })
    assert.ok(eventos.some((l) => l.includes('saiu inesperadamente')), 'crash não foi registrado no log')
    assert.ok(eventos.some((l) => l.includes('reiniciando em')), 'backoff não foi aplicado')
    await sup.parar()
  } finally {
    limpar()
    limparPasta(dir)
  }
})

// ---------------------------------------------------------------------------
// Cenário C — guarda de supervisor duplicado via pidfile
// ---------------------------------------------------------------------------
test('C: segundo supervisor no mesmo dir de dados é bloqueado', async () => {
  const dir = tempDir('cenarioC')
  const porta = novaPorta()
  const token = tokenNovo()
  const limpar = mudarEnvVars({
    TABACARIA_DB: join(dir, 'tabacaria.sqlite'),
    CATALOGO_RELAY_TOKEN: token,
    CATALOGO_RELAY_PORT: String(porta),
  })
  const sup1 = rastrearSupervisor(new supervisor.SupervisorRelay({ dirDados: dir, porta, atrasosMs: [200, 300] }))
  const sup2 = rastrearSupervisor(new supervisor.SupervisorRelay({ dirDados: dir, porta, atrasosMs: [200, 300] }))
  try {
    assert.equal(sup1.iniciar().ok, true)
    await esperarAte(() => sup1.getEstado() === 'rodando', { msg: 'primeiro relay não rodou' })
    assert.ok(existsSync(join(dir, 'relay.pid')), 'pidfile não foi gravado')

    const r2 = sup2.iniciar()
    assert.equal(r2.ok, false)
    assert.equal(r2.motivo, 'outro_supervisor_em_execucao')
    assert.equal(sup2.getPidRelay(), null, 'segundo supervisor não deveria ter processo')

    const lido = JSON.parse(readFileSync(join(dir, 'relay.pid'), 'utf8'))
    assert.equal(typeof lido.supervisorPid, 'number')
    assert.equal(typeof lido.relayPid, 'number')
    assert.equal(typeof lido.iniciadoEm, 'string')
    await sup1.parar()
  } finally {
    limpar()
    limparPasta(dir)
  }
})

// ---------------------------------------------------------------------------
// Cenário D — pidfile manejado: atualiza relayPid ao reiniciar e some ao parar
// ---------------------------------------------------------------------------
test('D: pidfile reflete o relay atual e é removido no encerramento', async () => {
  const dir = tempDir('cenarioD')
  const porta = novaPorta()
  const token = tokenNovo()
  const limpar = mudarEnvVars({
    TABACARIA_DB: join(dir, 'tabacaria.sqlite'),
    CATALOGO_RELAY_TOKEN: token,
    CATALOGO_RELAY_PORT: String(porta),
  })
  const sup = rastrearSupervisor(new supervisor.SupervisorRelay({ dirDados: dir, porta, atrasosMs: [200, 300, 400] }))
  try {
    assert.equal(sup.iniciar().ok, true)
    await esperarAte(() => sup.getEstado() === 'rodando')
    const pidA = JSON.parse(readFileSync(join(dir, 'relay.pid'), 'utf8')).relayPid
    assert.equal(pidA, sup.getPidRelay())

    try {
      process.kill(pidA, 'SIGKILL')
    } catch { /* ignore */ }
    await esperarAte(() => {
      const p2 = sup.getPidRelay()
      return sup.getEstado() === 'rodando' && p2 && p2 !== pidA
    }, { msg: 'não reiniciou' })
    const pidB = JSON.parse(readFileSync(join(dir, 'relay.pid'), 'utf8')).relayPid
    assert.equal(pidB, sup.getPidRelay())
    assert.notEqual(pidB, pidA)

    await sup.parar()
    assert.equal(existsSync(join(dir, 'relay.pid')), false)
  } finally {
    limpar()
    limparPasta(dir)
  }
})

// ---------------------------------------------------------------------------
// Cenário E — falha de inicialização (script inexistente) vira backoff, não loop
// ---------------------------------------------------------------------------
test('E: relay que não sobe entra em backoff crescente e para sem loop agressivo', async () => {
  const dir = tempDir('cenarioE')
  const porta = novaPorta()
  const limpar = mudarEnvVars({
    TABACARIA_DB: join(dir, 'tabacaria.sqlite'),
    CATALOGO_RELAY_TOKEN: tokenNovo(),
    CATALOGO_RELAY_PORT: String(porta),
  })
  const eventos = []
  const sup = rastrearSupervisor(new supervisor.SupervisorRelay({
    dirDados: dir,
    porta,
    scriptRelay: join(dir, 'relay-inexistente.js'),
    atrasosMs: [60, 120, 200, 320],
    log: (l) => eventos.push(l),
  }))
  try {
    assert.equal(sup.iniciar().ok, true)
    await esperarAte(() => eventos.some((l) => l.includes('reiniciando em 120ms')), {
      timeoutMs: 8000,
      msg: 'backoff crescente não observado',
    })
    const totalMs = 700
    await sleep(totalMs)
    const texto = eventos.join('\n')
    const qtdReinicios = (texto.match(/reiniciando em/g) || []).length
    assert.ok(qtdReinicios >= 2, `esperava pelo menos 2 reinícios, veio ${qtdReinicios}`)
    assert.match(texto, /reiniciando em 60ms/)
    assert.match(texto, /reiniciando em 120ms/)
    await sup.parar()
    assert.equal(sup.getEstado(), 'parado')
  } finally {
    limpar()
    limparPasta(dir)
  }
})

// ---------------------------------------------------------------------------
// Cenário F (CP4) — banco TEMPORÁRIO com seed: catálogo servido com dados reais
// ---------------------------------------------------------------------------
test('F: catálogo com seed em banco temporário é servido pelo relay sob supervisor', async () => {
  const dir = tempDir('cenarioF')
  const porta = novaPorta()
  const token = tokenNovo()
  const limpar = mudarEnvVars({
    TABACARIA_DB: join(dir, 'tabacaria.sqlite'),
    CATALOGO_RELAY_TOKEN: token,
    CATALOGO_RELAY_PORT: String(porta),
  })
  try {
    const db = serverIndex.initDb(join(dir, 'tabacaria.sqlite'))
    serverIndex.seed(db)
    db.prepare(
      `INSERT INTO produtos (nome, preco_venda, estoque, ativo, catalogo_publicado, catalogo_ordem) VALUES (?, ?, ?, 1, 1, 1)`,
    ).run('Cigarro Fase 9C Teste', 25.9, 8)
    db.prepare(
      `INSERT INTO config (chave, valor) VALUES ('nome_loja', ?)
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
    ).run('Loja Fase 9C-1')
    db.close()

    const sup = rastrearSupervisor(new supervisor.SupervisorRelay({ dirDados: dir, porta, atrasosMs: [200, 300] }))
    assert.equal(sup.iniciar().ok, true)
    await esperarAte(() => sup.getEstado() === 'rodando')
    const res = await getJson(porta, '/api/catalogo/publico', token)
    assert.equal(res.status, 200)
    assert.equal(res.corpo.loja.nome, 'Loja Fase 9C-1')
    assert.equal(res.corpo.produtos.length, 1)
    assert.equal(res.corpo.produtos[0].nome, 'Cigarro Fase 9C Teste')
    await sup.parar()
  } finally {
    limpar()
    limparPasta(dir)
  }
})

// ---------------------------------------------------------------------------
// Cenário H — EADDRINUSE: relay NÃO troca de porta, sai e supervisor reinicia
// (preserva a cobertura do teste legado Fase 5, que fica bloqueada com o relay
// real na 3211)
// ---------------------------------------------------------------------------
test('H: porta ocupada → relay aborta com mensagem clara e não escolhe outra porta', async () => {
  const dir = tempDir('cenarioH')
  const porta = novaPorta()
  const token = tokenNovo()
  const limpar = mudarEnvVars({
    TABACARIA_DB: join(dir, 'tabacaria.sqlite'),
    CATALOGO_RELAY_TOKEN: token,
    CATALOGO_RELAY_PORT: String(porta),
  })
  const ocupada = require('node:net').createServer()
  const eventos = []
  try {
    await new Promise((resolve, reject) => {
      ocupada.listen(porta, '127.0.0.1', resolve)
      ocupada.on('error', reject)
    })
    const sup = rastrearSupervisor(new supervisor.SupervisorRelay({
      dirDados: dir,
      porta,
      atrasosMs: [80, 120, 160],
      log: (l) => eventos.push(l),
    }))
    assert.equal(sup.iniciar().ok, true)
    await esperarAte(() => eventos.some((l) => l.includes('já está em uso')), {
      timeoutMs: 10000,
      msg: 'EADDRINUSE não foi detectado',
    })
    await esperarAte(() => eventos.some((l) => l.includes('saiu inesperadamente')), {
      timeoutMs: 10000,
      msg: 'queda por porta ocupada não registrada no log',
    })
    // Ainda com a porta ocupada, o relay não escolhe outra porta e o supervisor
    // continua a tentativa (backoff), sem aceitar trocar de porta.
    await esperarAte(() => (eventos.join('\n').match(/saiu inesperadamente/g) || []).length >= 2, {
      timeoutMs: 10000,
      msg: 'esperava mais de uma tentativa na mesma porta',
    })
    await sup.parar()
  } finally {
    ocupada.close()
    limpar()
    limparPasta(dir)
  }
})

// ---------------------------------------------------------------------------
// Cenário G — token vem do arquivo <dataDir>/catalogo-relay.token (sem env)
// ---------------------------------------------------------------------------
test('G: token lido do arquivo catalogo-relay.token mantém o relay funcional', async () => {
  const dir = tempDir('cenarioG')
  const porta = novaPorta()
  const token = tokenNovo()
  writeFileSync(join(dir, 'catalogo-relay.token'), token, 'utf8')

  const { CATALOGO_RELAY_TOKEN: _ignorado, ...base } = process.env
  const env = {
    ...base,
    TABACARIA_DB: join(dir, 'tabacaria.sqlite'),
    CATALOGO_RELAY_PORT: String(porta),
  }
  const crianca = rastrearCrianca(spawn(process.execPath, [RELAY_PATH], { env, stdio: 'ignore', windowsHide: true }))
  try {
    await esperarAte(async () => {
      try {
        const x = await getJson(porta, '/api/catalogo/publico', token)
        return x.status === 200 ? true : null
      } catch {
        return null
      }
    }, { msg: 'relay (token por arquivo) não respondeu' })
  } finally {
    try {
      crianca.kill()
    } catch { /* ignore */ }
    limparPasta(dir)
  }
})

// ---------------------------------------------------------------------------
// Cenário I (CP3-E) — supervisor é encerrado à força (crash): o réle detecta o
// 'disconnect' e sai sozinho — sem processo órfão.
// ---------------------------------------------------------------------------
test('I: morte abrupta do supervisor não deixa o relay órfão (IPC disconnect)', async () => {
  const dir = tempDir('cenarioI')
  const porta = novaPorta()
  const token = tokenNovo()
  const limpar = mudarEnvVars({
    TABACARIA_DB: join(dir, 'tabacaria.sqlite'),
    CATALOGO_RELAY_TOKEN: token,
    CATALOGO_RELAY_PORT: String(porta),
    DIR_DADOS: dir,
  })
  const runner = join(dir, 'runner-supervisor.cjs')
  writeFileSync(
    runner,
    `
const { SupervisorRelay } = require(${JSON.stringify(SUPERVISOR_PATH.replace(/\\/g, '/'))})
const sup = new SupervisorRelay({ dirDados: process.env.DIR_DADOS, porta: Number(process.env.CATALOGO_RELAY_PORT), atrasosMs: [200, 300] })
const r = sup.iniciar()
if (!r.ok) { console.error('no-start ' + JSON.stringify(r)); process.exit(1) }
const t = setInterval(() => {
  if (sup.getEstado() === 'rodando') {
    clearInterval(t)
    console.log('SUPERVISOR_PRONTO pid-relay=' + sup.getPidRelay())
  }
}, 150)
setTimeout(() => { console.error('timeout esperando rodar'); process.exit(2) }, 20000)
`,
    'utf8',
  )
  const proc = spawn(process.execPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  try {
    const prontoPid = await new Promise((resolve, reject) => {
      let buf = ''
      const timer = setTimeout(() => reject(new Error('supervisor de teste não ficou pronto')), 25000)
      proc.stdout.on('data', (d) => {
        buf += d.toString()
        const m = /SUPERVISOR_PRONTO pid-relay=(\d+)/.exec(buf)
        if (m) {
          clearTimeout(timer)
          resolve(Number(m[1]))
        }
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`runner saiu cedo (code=${code})`))
      })
    })
    assert.ok(Number.isInteger(prontoPid) && prontoPid > 0, `pid do relay inválido: ${prontoPid}`)

    // Derruba o supervisor de forma abrupta (como um crash do NossoSistema).
    try {
      process.kill(proc.pid, 'SIGKILL')
    } catch { /* ignore */ }

    await esperarAte(() => !pidEstaVivo(prontoPid), {
      timeoutMs: 15000,
      msg: 'réle continuou vivo após a morte do supervisor (órfão)',
    })
  } finally {
    try {
      proc.kill()
    } catch { /* ignore */ }
    limpar()
    limparPasta(dir)
  }
})

function pidEstaVivo(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}