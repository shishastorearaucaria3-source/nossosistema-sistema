import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { mkdirSync, existsSync, copyFileSync, readdirSync, rmSync, writeFileSync, readFileSync, createWriteStream, statSync } from 'node:fs'
import express from 'express'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { migrations, SCHEMA_VERSION } from '../shared/schema'
import { encontrarZona, Zona } from '../shared/geo'
import { getDefaultDbPath, getPortFilePath, getImportDir, getDataDir } from '../shared/data-dir'
export { getDefaultDbPath }
import { getConfig, salvarConfig, getStatus, notificarAlteracaoProduto, getExibicao, salvarExibicao, gerarCatalogoPublico } from './catalogo'
import { getStatusServidor, getLogs, limparLogs, getBackupInfo, diagnosticar, corrigir, zerarDados, restaurarBackup, registrarLog, versaoSistema } from './servidor'
import { extrairZip, listarArquivosImportacao, lerArquivoImportacao, importarProdutos, limparPastaImportacao, getProgressoImportacao } from './importar'
import { importarNex, getProgressoNex, analisarNex, importarNexDeZip, analisarNexDeZip } from './importar-nex'
import * as nexImportador from './auditoria/servidor-importador'
import { registerWhatsAppRoutes, stopWhatsApp } from '../whatsapp/index'
import bcrypt from 'bcryptjs'

function notificarProdutoSeNecessario(sql: string, params: unknown[]): void {
  try {
    const s = sql.toLowerCase()
    if (s.includes('update produtos') || s.includes('insert into produtos')) {
      // extrai id do where id = ?
      const m = sql.match(/where\s+id\s*=\s*(\?|\d+)/i)
      if (m) {
        const id = m[1] === '?' ? Number(params[0]) : Number(m[1])
        if (id) notificarAlteracaoProduto(id)
      } else if (s.includes('insert into produtos')) {
        const ultimo = getDb().prepare('SELECT last_insert_rowid() AS id').get() as { id: number }
        if (ultimo.id) notificarAlteracaoProduto(ultimo.id)
      }
    }
  } catch { /* ignore */ }
}

const MAX_BACKUPS = 30

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!db) throw new Error('DB not initialized')
  return db
}

export function reabrirBanco(): DatabaseSync {
  const path = getDefaultDbPath()
  db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  // Espera até 5s por lock em vez de falhar imediato (multi-PDV na mesma rede).
  db.exec('PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

export function initDb(path = getDefaultDbPath()): DatabaseSync {
  if (db) return db
  const dir = join(path, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  // Espera até 5s por lock em vez de falhar imediato (multi-PDV na mesma rede).
  db.exec('PRAGMA busy_timeout = 5000;')
  migrate(db)
  limparBackupConfigLegado()
  return db
}

// Remoção da integração antiga (GitHub Pages): apaga o backup local da
// configuração do catálogo, que armazenava o token do GitHub em texto puro.
function limparBackupConfigLegado(): void {
  try {
    const arquivo = join(getDataDir(), 'catalogo_config_backup.json')
    if (existsSync(arquivo)) {
      rmSync(arquivo, { force: true })
      registrarLog('INFO', 'Backup antigo da configuração do catálogo (token GitHub) removido')
    }
  } catch { /* ignore */ }
}

function migrate(database: DatabaseSync): void {
  const existing = database.prepare('PRAGMA user_version').get() as { user_version: number }
  let current = existing.user_version ?? 0
  while (current < SCHEMA_VERSION) {
    const next = current + 1
    const sql = migrations[next]
    if (!sql) throw new Error(`Migration ${next} not found`)
    database.exec('BEGIN')
    try {
      database.exec(sql)
      database.exec(`PRAGMA user_version = ${next}`)
      database.exec('COMMIT')
    } catch (err) {
      database.exec('ROLLBACK')
      throw err
    }
    current = next
  }
}

// Legado (somente para validar hashes antigos e migrar no primeiro login).
export function hashSenha(senha: string): string {
  return createHash('sha256').update(senha).digest('hex')
}

const BCRYPT_ROUNDS = 10

export function hashSenhaForte(senha: string): string {
  return bcrypt.hashSync(senha, BCRYPT_ROUNDS)
}

// Valida a senha contra o hash gravado. Aceita bcrypt (novo) e sha256 (legado).
// Quando o hash é legado e a senha confere, devolve upgraded=true para o chamador
// persistir o hash forte — migração transparente, sem quebrar usuários existentes.
export function verificarSenha(hashGravado: string, senha: string): { ok: boolean; upgraded?: string } {
  if (hashGravado.startsWith('$2a$') || hashGravado.startsWith('$2b$')) {
    const ok = bcrypt.compareSync(senha, hashGravado)
    return { ok }
  }
  if (hashGravado === hashSenha(senha)) {
    return { ok: true, upgraded: hashSenhaForte(senha) }
  }
  return { ok: false }
}

export function seed(database: DatabaseSync): void {
  // Cria o admin padrão SOMENTE em banco novo. Nunca reseta senha/perfil/ativo
  // de um admin existente — a senha escolhida pelo lojista sobrevive ao restart.
  const adminExiste = database.prepare('SELECT id FROM usuarios WHERE login = ?').get('admin') as { id: number } | undefined
  if (!adminExiste) {
    database
      .prepare(`INSERT INTO usuarios (nome, login, senha_hash, perfil, comissao_percent) VALUES (?, ?, ?, 'admin', 0)`)
      .run('Administrador', 'admin', hashSenhaForte('admin123'))
  }
  // Guarda por CATEGORIAS (não por contagem de usuários): bancos com um único
  // usuário voltavam a reinserir categorias no segundo boot e morriam com
  // UNIQUE constraint. Idempotente: semeia somente quando não há nenhuma.
  const cats = database.prepare('SELECT COUNT(*) AS c FROM categorias').get() as { c: number }
  if (cats.c > 0) return
  database.prepare('INSERT INTO categorias (nome) VALUES (?)').run('Cigarros')
  database.prepare('INSERT INTO categorias (nome) VALUES (?)').run('Charutos')
  database.prepare('INSERT INTO categorias (nome) VALUES (?)').run('Tabaco')
  database.prepare('INSERT INTO categorias (nome) VALUES (?)').run('Acessorios')
  database.prepare('INSERT INTO categorias (nome) VALUES (?)').run('Bebidas')
}

function backupDir(): string {
  const dir = join(getDefaultDbPath(), '..', 'backups')
  mkdirSync(dir, { recursive: true })
  return dir
}

function backupName(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.sqlite`
}

export function fazerBackup(): { ok: boolean; arquivo: string } {
  try {
    const d = getDb()
    d.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const dir = backupDir()
    const arquivo = join(dir, backupName())
    copyFileSync(getDefaultDbPath(), arquivo)

    const arquivos = readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort()
    while (arquivos.length > MAX_BACKUPS) {
      const antigo = arquivos.shift()!
      rmSync(join(dir, antigo))
    }
    return { ok: true, arquivo }
  } catch (err) {
    return { ok: false, arquivo: String((err as Error).message) }
  }
}

let server: Server | null = null
let portaAtual = 0

// Chave de API exigida em requisições NÃO-loopback (outros PDVs da rede).
// Loopback (o próprio aplicativo no servidor) tem acesso integral.
let apiKeyAtual = ''

function garantirApiKey(): string {
  const row = getDb().prepare(`SELECT valor FROM config WHERE chave = 'api_key'`).get() as { valor: string } | undefined
  if (row?.valor) {
    apiKeyAtual = row.valor
    return apiKeyAtual
  }
  apiKeyAtual = randomBytes(24).toString('hex')
  getDb().prepare(`INSERT INTO config (chave, valor) VALUES ('api_key', ?)`).run(apiKeyAtual)
  registrarLog('INFO', 'Chave de API gerada para acesso de outros terminais na rede.')
  return apiKeyAtual
}

export function getApiKey(): string {
  if (!apiKeyAtual) garantirApiKey()
  return apiKeyAtual
}

export function regenerarApiKey(): string {
  apiKeyAtual = randomBytes(24).toString('hex')
  getDb().prepare(`INSERT INTO config (chave, valor) VALUES ('api_key', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(apiKeyAtual)
  registrarLog('SUCCESS', 'Chave de API regenerada — terminais remotos precisam ser reconfigurados.')
  return apiKeyAtual
}

export function getPorta(): number {
  return portaAtual
}

function ehIpPrivado(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p[0] === 10) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  if (p[0] === 192 && p[1] === 168) return true
  return false
}

function ehLinkLocal(ip: string): boolean {
  return ip.startsWith('169.254.')
}

function ehLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('::ffff:192.168.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:172.')
}

function mesmaSubnet(a: string, b: string): boolean {
  const pa = a.split('.')
  const pb = b.split('.')
  if (pa.length !== 4 || pb.length !== 4) return false
  return pa[0] === pb[0] && pa[1] === pb[1]
}

export function getIpRede(): string {
  try {
    const candidatos: string[] = []
    for (const infos of Object.values(networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.family !== 'IPv4' || info.internal) continue
        candidatos.push(info.address)
      }
    }
    // Prioriza IP privado (rede local/Wi-Fi/Ethernet), ignora link-local (169.254)
    const privados = candidatos.filter((ip) => ehIpPrivado(ip) && !ehLinkLocal(ip))
    if (privados.length > 0) return privados[0]
    const normais = candidatos.filter((ip) => !ehLinkLocal(ip))
    if (normais.length > 0) return normais[0]
    return candidatos[0] || '127.0.0.1'
  } catch { /* ignore */ }
  return '127.0.0.1'
}

function caminhoArquivoPorta(): string {
  return getPortFilePath()
}

function gravarPorta(porta: number): void {
  try {
    const arquivo = caminhoArquivoPorta()
    mkdirSync(join(arquivo, '..'), { recursive: true })
    writeFileSync(arquivo, String(porta), 'utf8')
  } catch { /* ignore */ }
}

function lerPortaGravada(): number {
  try {
    return Number(readFileSync(caminhoArquivoPorta(), 'utf8')) || 0
  } catch {
    return 0
  }
}

export function iniciarServidor(porta = 3210): void {
  const database = getDb()
  garantirApiKey()
  const app = express()
  app.use(express.json({ limit: '100mb' }))

  // Restringe acesso à rede local (e ao próprio computador). Conexões de fora da
  // subnet do servidor são bloqueadas — o servidor só é acessível dentro do roteador.
  const ipLocal = getIpRede()
  const localReq = (req: express.Request): boolean => ehLoopback(req.socket.remoteAddress || '')
  app.use((req, res, next) => {
    const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    if (localReq(req) || remote === ipLocal || ehIpPrivado(remote) && mesmaSubnet(remote, ipLocal)) {
      next()
      return
    }
    res.status(403).json({ erro: 'Acesso permitido apenas na rede local.' })
  })

  // Ping público (dentro da LAN) — permite testar conexão e descoberta.
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true })
  })

  // Sessões de login em memória: o terminal autentica com usuário/senha e recebe
  // um token de sessão aleatório. Nenhuma API Key manual é exigida do terminal —
  // a autenticação real passa a ser o login de usuário (admin/operador).
  const sessoes = new Map<string, { usuario_id: number; login: string; perfil: string; criado_em: number }>()
  const VALIDADE_SESSAO_MS = 12 * 60 * 60 * 1000

  function gerarTokenSessao(): string {
    return randomBytes(32).toString('hex')
  }

  function limparSessoesExpiradas(): void {
    const agora = Date.now()
    for (const [t, s] of sessoes) {
      if (agora - s.criado_em > VALIDADE_SESSAO_MS) sessoes.delete(t)
    }
  }

  // Lista básica de usuários para a tela de login (apenas id/nome/login/perfil —
  // nunca senhas nem dados sensíveis). Acessível na LAN para o terminal montar a
  // lista de seleção antes de autenticar.
  app.get('/api/auth/usuarios', (_req, res) => {
    const rows = database
      .prepare(`SELECT id, nome, login, perfil FROM usuarios WHERE ativo = 1 ORDER BY nome`)
      .all() as { id: number; nome: string; login: string; perfil: string }[]
    res.json(rows)
  })

  // Autenticação por SESSÃO DE LOGIN: loopback (aplicativo no próprio servidor)
  // tem acesso integral; qualquer terminal da rede precisa de um token de sessão
  // obtido via /api/auth/login. Rotas marcadas como públicas (ping, versao,
  // auth/usuarios, auth/login, config, catálogo de leitura) não passam por aqui.
  // Override de TESTE (TABACARIA_TEST_FORCE_REMOTE=1): trata toda requisição
  // como remota para exercitar o fluxo de autenticação deterministicamente.
  const forcarRemoto = process.env.TABACARIA_TEST_FORCE_REMOTE === '1'
  const ehLocalEfetivo = (req: express.Request): boolean => !forcarRemoto && localReq(req)
  const ROTAS_PUBLICAS = new Set([
    '/api/ping',
    '/api/versao',
    '/api/auth/usuarios',
    '/api/auth/login',
    '/api/config',
    '/api/catalogo/status',
    '/api/catalogo/config',
    '/api/catalogo/exibicao',
    '/api/zonas',
    '/api/taxa'
  ])
  app.use((req, res, next) => {
    if (ehLocalEfetivo(req)) { next(); return }
    if (ROTAS_PUBLICAS.has(req.path)) { next(); return }
    limparSessoesExpiradas()
    const token = String(req.get('x-sessao-token') || '')
    const sessao = token ? sessoes.get(token) : undefined
    if (sessao) { next(); return }
    registrarLog('WARNING', `Requisição sem sessão válida bloqueada: ${req.method} ${req.path} de ${req.socket.remoteAddress}`)
    res.status(401).json({ erro: 'Sessão inválida ou ausente. Faça login no terminal.' })
  })

  // Rotas administrativas: exigem sessão válida com perfil 'admin', em QUALQUER
  // computador (servidor ou cliente da LAN). A autorização não depende mais de
  // loopback vs rede — é a mesma em todos os terminais.
  const somenteLocal = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    if (ehLocalEfetivo(req)) { next(); return }
    res.status(403).json({ erro: 'Esta operação só pode ser executada no computador do servidor.' })
  }

  // ---------------------------------------------------------------------------
  // Autorização por SESSÃO — fonte única de identidade do usuário autenticado.
  // Regra central: o que vale é sessão válida + perfil do usuário, nunca a
  // localidade (loopback vs rede). Assim o servidor e os clientes da LAN se
  // comportam de forma consistente.
  // ---------------------------------------------------------------------------
  function sessaoAtualDoReq(req: express.Request):
    | { usuario_id: number; login: string; perfil: string; criado_em: number }
    | undefined {
    limparSessoesExpiradas()
    const token = String(req.get('x-sessao-token') || '')
    return token ? sessoes.get(token) : undefined
  }

  // Exige sessão válida com perfil 'admin'. NÃO abre exceção por localidade —
  // a regra é idêntica em qualquer computador. Sem sessão → 401; sessão sem
  // perfil admin → 403.
  const requerAdmin = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const sessao = sessaoAtualDoReq(req)
    if (sessao && sessao.perfil === 'admin') { next(); return }
    if (!sessao) {
      res.status(401).json({ erro: 'Sessão inválida ou ausente. Faça login no terminal.' })
      return
    }
    res.status(403).json({ erro: 'Acesso restrito ao perfil administrador.' })
  }

  // Autorização para gerenciamento de usuários: permite o perfil 'admin' ou
  // 'gerente'. As restrições anti-escala (não tocar em admin, não elevar a admin)
  // são aplicadas dentro de cada rota, já que gerente NÃO pode criar/promover
  // administradores.
  const requerAdminOuGerente = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const sessao = sessaoAtualDoReq(req)
    if (sessao && (sessao.perfil === 'admin' || sessao.perfil === 'gerente')) { next(); return }
    if (!sessao) {
      res.status(401).json({ erro: 'Sessão inválida ou ausente. Faça login no terminal.' })
      return
    }
    res.status(403).json({ erro: 'Acesso restrito ao perfil administrador ou gerente.' })
  }

  // Dados completos do usuário autenticado na sessão (para ler campos de
  // autorização como perfil, limitar_desconto, desconto_max_percent e permissões).
  function usuarioAutenticadoDoReq(req: express.Request):
    | { id: number; nome: string; login: string; perfil: string; limitar_desconto: number; desconto_max_percent: number }
    | undefined {
    const sessao = sessaoAtualDoReq(req)
    if (!sessao) return undefined
    return database
      .prepare(`SELECT id, nome, login, perfil, limitar_desconto, desconto_max_percent FROM usuarios WHERE id = ? AND ativo = 1`)
      .get(sessao.usuario_id) as
      | { id: number; nome: string; login: string; perfil: string; limitar_desconto: number; desconto_max_percent: number }
      | undefined
  }

  function usuarioTemPermissao(usuarioId: number, modulo: string): boolean {
    return !!database.prepare(`SELECT 1 AS ok FROM permissoes WHERE usuario_id = ? AND modulo = ?`).get(usuarioId, modulo)
  }

  // Invalida todas as sessões de um usuário (senha trocada, perfil rebaixado,
  // usuário desativado ou deletado). Evita token órfão válido por 12h.
  function invalidarSessoesDoUsuario(usuarioId: number): void {
    for (const [t, s] of sessoes) {
      if (s.usuario_id === usuarioId) sessoes.delete(t)
    }
  }

  // Detecta operação de ESCRITA (INSERT/UPDATE/DELETE/REPLACE) sobre tabelas
  // sensíveis de autorização. Usado para impedir o contorno de autorização via
  // rotas genéricas de banco (/api/db/run e /api/db/transacao).
  const TABELAS_SENSIVEIS = new Set(['usuarios', 'permissoes'])
  function tabelaEscrita(sqlRaw: unknown): string | null {
    if (typeof sqlRaw !== 'string') return null
    const sql = sqlRaw.trim().replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ')
    const m = sql.match(/^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/i)
    return m ? m[1].toLowerCase() : null
  }
  function ehEscritaSensivel(sql: unknown): boolean {
    const t = tabelaEscrita(sql)
    return !!t && TABELAS_SENSIVEIS.has(t)
  }
  app.post('/api/db/all', (req, res) => {
    const { sql, params } = req.body ?? {}
    if (typeof sql !== 'string') {
      res.status(400).json({ erro: 'sql obrigatório' })
      return
    }
    // Endpoint de LEITURA: escrita aqui (INSERT/UPDATE/DELETE/REPLACE, inclusive
    // via RETURNING) contornaria a autorização por sessão/perfil. Só admin pode.
    if (tabelaEscrita(sql)) {
      const sessao = sessaoAtualDoReq(req)
      if (!sessao) {
        res.status(401).json({ erro: 'Sessão inválida ou ausente. Faça login no terminal.' })
        return
      }
      if (sessao.perfil !== 'admin') {
        res.status(403).json({ erro: 'Acesso restrito ao perfil administrador.' })
        return
      }
    }
    try {
      res.json(database.prepare(sql).all(...(Array.isArray(params) ? params : [])))
    } catch (err) {
      registrarLog('ERROR', `SQL (/all) ${sql.slice(0, 120)}: ${(err as Error).message}`)
      res.status(400).json({ erro: (err as Error).message })
    }
  })

  app.post('/api/db/get', (req, res) => {
    const { sql, params } = req.body ?? {}
    if (typeof sql !== 'string') {
      res.status(400).json({ erro: 'sql obrigatório' })
      return
    }
    // Endpoint de LEITURA: escrita aqui (INSERT/UPDATE/DELETE/REPLACE, inclusive
    // via RETURNING) contornaria a autorização por sessão/perfil. Só admin pode.
    if (tabelaEscrita(sql)) {
      const sessao = sessaoAtualDoReq(req)
      if (!sessao) {
        res.status(401).json({ erro: 'Sessão inválida ou ausente. Faça login no terminal.' })
        return
      }
      if (sessao.perfil !== 'admin') {
        res.status(403).json({ erro: 'Acesso restrito ao perfil administrador.' })
        return
      }
    }
    try {
      const result = database.prepare(sql).get(...(Array.isArray(params) ? params : []))
      res.json(result ?? null)
    } catch (err) {
      registrarLog('ERROR', `SQL (/get) ${sql.slice(0, 120)}: ${(err as Error).message}`)
      res.status(400).json({ erro: (err as Error).message })
    }
  })

  app.post('/api/db/run', (req, res) => {
    const { sql, params } = req.body ?? {}
    if (typeof sql !== 'string') {
      res.status(400).json({ erro: 'sql obrigatório' })
      return
    }
    // Proteção de contorno: escrita em tabelas sensíveis (usuarios/permissoes)
    // exige sessão 'admin'. Leituras continuam liberadas com sessão válida.
    if (ehEscritaSensivel(sql)) {
      const sessao = sessaoAtualDoReq(req)
      if (!sessao) {
        res.status(401).json({ erro: 'Sessão inválida ou ausente. Faça login no terminal.' })
        return
      }
      if (sessao.perfil !== 'admin') {
        res.status(403).json({ erro: 'Acesso restrito ao perfil administrador.' })
        return
      }
    }
    try {
      const result = database.prepare(sql).run(...(Array.isArray(params) ? params : []))
      notificarProdutoSeNecessario(sql, Array.isArray(params) ? params : [])
      res.json({ changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) })
    } catch (err) {
      registrarLog('ERROR', `SQL (/run) ${sql.slice(0, 120)}: ${(err as Error).message}`)
      res.status(400).json({ erro: (err as Error).message })
    }
  })

  // Multi-statement: PERIGOSO por natureza — aceito apenas do próprio servidor.
  app.post('/api/db/exec', somenteLocal, (req, res) => {
    const { sql } = req.body ?? {}
    if (typeof sql !== 'string') {
      res.status(400).json({ erro: 'sql obrigatório' })
      return
    }
    try {
      database.exec(sql)
      res.json({ ok: true })
    } catch (err) {
      res.status(400).json({ erro: (err as Error).message })
    }
  })

  // Lote transacional: executa N statements em BEGIN IMMEDIATE…COMMIT.
  // Qualquer falha reverte TUDO e devolve o índice do statement que falhou —
  // garante que operações compostas (venda, cancelamento) nunca fiquem pela metade.
  app.post('/api/db/transacao', (req, res) => {
    const { statements } = req.body ?? {}
    if (!Array.isArray(statements) || statements.length === 0) {
      res.status(400).json({ ok: false, erro: 'Informe statements.' })
      return
    }
    if (statements.length > 5000) {
      res.status(400).json({ ok: false, erro: 'Máximo de 5000 statements por transação.' })
      return
    }
    // Proteção de contorno: qualquer statement que escreva em tabelas sensíveis
    // (usuarios/permissoes) exige sessão 'admin' — mesmo via lote transacional.
    if (statements.some((st) => ehEscritaSensivel(st?.sql))) {
      const sessao = sessaoAtualDoReq(req)
      if (!sessao) {
        res.status(401).json({ ok: false, erro: 'Sessão inválida ou ausente. Faça login no terminal.' })
        return
      }
      if (sessao.perfil !== 'admin') {
        res.status(403).json({ ok: false, erro: 'Acesso restrito ao perfil administrador.' })
        return
      }
    }
    const resultados: { changes: number; lastInsertRowid: number }[] = []
    database.exec('BEGIN IMMEDIATE')
    try {
      for (let i = 0; i < statements.length; i++) {
        const st = statements[i]
        const sql = typeof st?.sql === 'string' ? st.sql : ''
        const params = Array.isArray(st?.params) ? st.params : []
        if (!sql) throw new Error(`Statement ${i}: sql obrigatório`)
        const r = database.prepare(sql).run(...params)
        notificarProdutoSeNecessario(sql, params)
        resultados.push({ changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) })
      }
      database.exec('COMMIT')
      res.json({ ok: true, resultados })
    } catch (err) {
      database.exec('ROLLBACK')
      registrarLog('ERROR', `Transação revertida no statement ${resultados.length}: ${(err as Error).message}`)
      res.status(400).json({ ok: false, indice: resultados.length, erro: (err as Error).message })
    }
  })

  app.post('/api/auth/login', (req, res) => {
    const { login, senha } = req.body ?? {}
    const user = database
      .prepare(`SELECT id, nome, login, perfil, comissao_percent FROM usuarios WHERE login = ? AND ativo = 1`)
      .get(login) as { id: number; nome: string; login: string; perfil: string; comissao_percent: number } | undefined
    if (!user) {
      res.json({ ok: false, erro: 'Usuário não encontrado' })
      return
    }
    const row = database.prepare(`SELECT senha_hash FROM usuarios WHERE id = ?`).get(user.id) as { senha_hash: string }
    const ver = verificarSenha(row.senha_hash, String(senha ?? ''))
    if (!ver.ok) {
      res.json({ ok: false, erro: 'Senha incorreta' })
      return
    }
    // Migração transparente sha256 → bcrypt no primeiro login bem-sucedido.
    if (ver.upgraded) {
      try {
        database.prepare(`UPDATE usuarios SET senha_hash = ? WHERE id = ?`).run(ver.upgraded, user.id)
      } catch { /* ignore — migração é best-effort */ }
    }
    // Cria a sessão de login (token aleatório) para o terminal usar nas rotas.
    limparSessoesExpiradas()
    const token = gerarTokenSessao()
    sessoes.set(token, { usuario_id: user.id, login: user.login, perfil: user.perfil, criado_em: Date.now() })
    registrarLog('INFO', `Login: ${user.login} (${user.perfil})`)
    res.json({ ok: true, usuario: user, token })
  })

  app.post('/api/auth/logout', (req, res) => {
    const token = String(req.get('x-sessao-token') || '')
    if (token) sessoes.delete(token)
    res.json({ ok: true })
  })

  // Retorna 403 com mensagem de erro padrão quando o usuário da sessão não pode
  // operar sobre um usuário-alvo (não-admin tentando tocar em admin).
  function bloquearEscalada(alvo: { id: number; perfil: string } | undefined, res: express.Response): boolean {
    if (alvo?.perfil === 'admin') {
      res.status(403).json({ ok: false, erro: 'Somente o administrador pode gerenciar usuários com perfil administrador.' })
      return true
    }
    return false
  }

  app.post('/api/auth/criarUsuario', requerAdminOuGerente, (req, res) => {
    const dados = req.body ?? {}
    const sessao = sessaoAtualDoReq(req)
    const perfil = String(dados.perfil ?? 'vendedor')
    // Gerente não pode criar administrador — só o admin cria admin.
    if (sessao?.perfil !== 'admin' && perfil === 'admin') {
      res.status(403).json({ ok: false, erro: 'Somente o administrador pode criar usuários com perfil administrador.' })
      return
    }
    const hash = hashSenhaForte(String(dados.senha ?? ''))
    const result = database
      .prepare(`INSERT INTO usuarios (nome, login, senha_hash, perfil, comissao_percent) VALUES (?, ?, ?, ?, ?)`)
      .run(String(dados.nome), String(dados.login), hash, perfil, Number(dados.comissao) || 0)
    res.json({ ok: true, id: Number(result.lastInsertRowid) })
  })

  app.post('/api/auth/alterarSenha', requerAdminOuGerente, (req, res) => {
    const { usuarioId, novaSenha } = req.body ?? {}
    const alvo = database.prepare(`SELECT id, perfil FROM usuarios WHERE id = ?`).get(Number(usuarioId)) as
      | { id: number; perfil: string }
      | undefined
    if (bloquearEscalada(alvo, res)) return
    const hash = hashSenhaForte(String(novaSenha ?? ''))
    database.prepare(`UPDATE usuarios SET senha_hash = ? WHERE id = ?`).run(hash, Number(usuarioId))
    invalidarSessoesDoUsuario(Number(usuarioId))
    res.json({ ok: true })
  })

  app.post('/api/auth/atualizarUsuario', requerAdminOuGerente, (req, res) => {
    const { usuarioId, nome, login, perfil, comissao, senha } = req.body ?? {}
    const id = Number(usuarioId)
    const sessao = sessaoAtualDoReq(req)
    const alvo = database.prepare(`SELECT id, perfil FROM usuarios WHERE id = ?`).get(id) as
      | { id: number; perfil: string }
      | undefined
    if (bloquearEscalada(alvo, res)) return
    const novoPerfil = String(perfil ?? alvo?.perfil ?? 'vendedor')
    // Gerente não pode elevar ninguém a admin (nem na edição).
    if (sessao?.perfil !== 'admin' && novoPerfil === 'admin') {
      res.status(403).json({ ok: false, erro: 'Somente o administrador pode conceder o perfil administrador.' })
      return
    }
    const mudouPerfil = alvo && alvo.perfil !== novoPerfil
    if (senha) {
      const hash = hashSenhaForte(String(senha))
      database
        .prepare(`UPDATE usuarios SET nome = ?, login = ?, perfil = ?, comissao_percent = ?, senha_hash = ? WHERE id = ?`)
        .run(String(nome), String(login), novoPerfil, Number(comissao) || 0, hash, id)
    } else {
      database
        .prepare(`UPDATE usuarios SET nome = ?, login = ?, perfil = ?, comissao_percent = ? WHERE id = ?`)
        .run(String(nome), String(login), novoPerfil, Number(comissao) || 0, id)
    }
    // Se o perfil mudou (ou a senha), invalida as sessões do alvo para o novo
    // perfil valer (ex.: rebaixado de admin → não pode mais agir como admin).
    if (mudouPerfil) invalidarSessoesDoUsuario(id)
    res.json({ ok: true })
  })

  // Atualiza apenas as opções de permissão do usuário (usar_web/usar_app/
  // limitar_desconto/desconto_max_percent). Via rota dedicada para que a tela
  // não precise usar /api/db/run em tabelas sensíveis (evita escalada por SQL).
  app.post('/api/auth/atualizarOpcoes', requerAdminOuGerente, (req, res) => {
    const { usuarioId, usar_web, usar_app, limitar_desconto, desconto_max_percent } = req.body ?? {}
    const id = Number(usuarioId)
    const alvo = database.prepare(`SELECT id, perfil FROM usuarios WHERE id = ?`).get(id) as
      | { id: number; perfil: string }
      | undefined
    if (bloquearEscalada(alvo, res)) return
    database
      .prepare(`UPDATE usuarios SET usar_web = ?, usar_app = ?, limitar_desconto = ?, desconto_max_percent = ? WHERE id = ?`)
      .run(
        usar_web ? 1 : 0,
        usar_app ? 1 : 0,
        limitar_desconto ? 1 : 0,
        Number(desconto_max_percent) || 0,
        id
      )
    res.json({ ok: true })
  })

  // Substitui a lista de permissões de um usuário por uma nova. NÃO toca em admin.
  app.post('/api/auth/atualizarPermissoes', requerAdminOuGerente, (req, res) => {
    const { usuarioId, modulos } = req.body ?? {}
    const id = Number(usuarioId)
    const alvo = database.prepare(`SELECT id, perfil FROM usuarios WHERE id = ?`).get(id) as
      | { id: number; perfil: string }
      | undefined
    if (bloquearEscalada(alvo, res)) return
    const lista = Array.isArray(modulos) ? modulos.map((m) => String(m)) : []
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`DELETE FROM permissoes WHERE usuario_id = ?`).run(id)
      const ins = database.prepare(`INSERT INTO permissoes (usuario_id, modulo) VALUES (?, ?)`)
      for (const m of lista) ins.run(id, m)
      database.exec('COMMIT')
    } catch (err) {
      database.exec('ROLLBACK')
      res.status(400).json({ ok: false, erro: (err as Error).message })
      return
    }
    res.json({ ok: true })
  })

  // Desativa/ativa um usuário. Não toca em admin.
  app.post('/api/auth/ativarDesativar', requerAdminOuGerente, (req, res) => {
    const { usuarioId, ativo } = req.body ?? {}
    const id = Number(usuarioId)
    const alvo = database.prepare(`SELECT id, perfil FROM usuarios WHERE id = ?`).get(id) as
      | { id: number; perfil: string }
      | undefined
    if (bloquearEscalada(alvo, res)) return
    database.prepare(`UPDATE usuarios SET ativo = ? WHERE id = ?`).run(ativo ? 1 : 0, id)
    // Usuário desativado não pode manter sessão válida.
    if (!ativo) invalidarSessoesDoUsuario(id)
    res.json({ ok: true })
  })

  // Deleta um usuário e suas permissões. Não toca em admin nem em si mesmo
  // (para o gerente não se auto-remover e perder o acesso).
  app.post('/api/auth/deletar', requerAdminOuGerente, (req, res) => {
    const { usuarioId } = req.body ?? {}
    const id = Number(usuarioId)
    const sessao = sessaoAtualDoReq(req)
    if (sessao && sessao.usuario_id === id) {
      res.status(403).json({ ok: false, erro: 'Você não pode deletar o próprio usuário.' })
      return
    }
    const alvo = database.prepare(`SELECT id, perfil FROM usuarios WHERE id = ?`).get(id) as
      | { id: number; perfil: string }
      | undefined
    if (bloquearEscalada(alvo, res)) return
    database.prepare(`DELETE FROM permissoes WHERE usuario_id = ?`).run(id)
    database.prepare(`DELETE FROM usuarios WHERE id = ?`).run(id)
    invalidarSessoesDoUsuario(id)
    res.json({ ok: true })
  })

  app.get('/api/imagem/:id', (req, res) => {
    const row = database
      .prepare(`SELECT imagem FROM produtos WHERE id = ?`)
      .get(Number(req.params.id)) as { imagem: Uint8Array | null } | undefined
    if (!row?.imagem || row.imagem.length === 0) {
      res.json(null)
      return
    }
    res.json(Buffer.from(row.imagem).toString('base64'))
  })

  app.get('/api/imagem/list', (_req, res) => {
    const rows = database
      .prepare(`SELECT id, imagem FROM produtos WHERE imagem IS NOT NULL AND length(imagem) > 0`)
      .all() as { id: number; imagem: Uint8Array }[]
    const mapa: Record<number, string> = {}
    for (const r of rows) {
      mapa[r.id] = Buffer.from(r.imagem).toString('base64')
    }
    res.json(mapa)
  })

  app.post('/api/imagem/listPorIds', (req, res) => {
    const { ids } = req.body ?? {}
    if (!Array.isArray(ids) || ids.length === 0) {
      res.json({})
      return
    }
    const mapa: Record<number, string> = {}
    const placeholders = ids.map(() => '?').join(',')
    const rows = database
      .prepare(`SELECT id, imagem FROM produtos WHERE id IN (${placeholders}) AND imagem IS NOT NULL AND length(imagem) > 0`)
      .all(...ids) as { id: number; imagem: Uint8Array }[]
    for (const row of rows) {
      mapa[row.id] = Buffer.from(row.imagem).toString('base64')
    }
    res.json(mapa)
  })

  app.post('/api/imagem/definir', (req, res) => {
    const { produtoId, base64 } = req.body ?? {}
    const buf = Buffer.from(String(base64 ?? ''), 'base64')
    database.prepare(`UPDATE produtos SET imagem = ? WHERE id = ?`).run(buf, Number(produtoId))
    res.json({ ok: true })
  })

  app.post('/api/imagem/remover', (req, res) => {
    const { produtoId } = req.body ?? {}
    database.prepare(`UPDATE produtos SET imagem = NULL WHERE id = ?`).run(Number(produtoId))
    res.json({ ok: true })
  })

  app.post('/api/backup', (_req, res) => {
    res.json(fazerBackup())
  })

  app.get('/api/config', (_req, res) => {
    const rows = database.prepare(`SELECT chave, valor FROM config`).all() as { chave: string; valor: string }[]
    const config: Record<string, string> = {}
    for (const r of rows) {
      // NUNCA expõe segredos (api_key) em respostas públicas da LAN.
      if (r.chave === 'api_key') continue
      config[r.chave] = r.valor
    }
    res.json(config)
  })

  app.get('/api/versao', (_req, res) => {
    res.json({
      versao: versaoSistema(),
      schema: (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      schema_atual: SCHEMA_VERSION
    })
  })

  app.get('/api/zonas', (_req, res) => {
    const rows = database.prepare(`SELECT id, nome, preco, poligono, ativo FROM zonas_entrega ORDER BY nome`).all()
    res.json(rows)
  })

  app.get('/api/taxa', (req, res) => {
    const lat = Number(req.query.lat)
    const lng = Number(req.query.lng)
    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ erro: 'Informe lat e lng' })
      return
    }
    const zonas = database.prepare(`SELECT id, nome, preco, poligono, ativo FROM zonas_entrega`).all() as unknown as Zona[]
    const zona = encontrarZona({ lat, lng }, zonas)
    if (!zona) {
      res.json({ zona: null, taxa: null, erro: 'Fora da área de entrega' })
      return
    }
    res.json({ zona: zona.nome, taxa: zona.preco })
  })

  app.get('/api/catalogo/status', (_req, res) => {
    res.json(getStatus())
  })

app.post('/api/catalogo/config', requerAdmin, (req, res) => {
    const { site_url, nome_loja } = req.body ?? {}
    const novo = salvarConfig({
      site_url: typeof site_url === 'string' ? site_url : undefined,
      nome_loja: typeof nome_loja === 'string' ? nome_loja : undefined
    })
    res.json({ ok: true, config: novo })
  })

  app.get('/api/catalogo/config', (_req, res) => {
    const cfg = getConfig()
    res.json({ site_url: cfg.site_url, nome_loja: cfg.nome_loja })
  })

  app.get('/api/catalogo/exibicao', (_req, res) => {
    res.json(getExibicao())
  })

app.post('/api/catalogo/exibicao', (req, res) => {
    const { mostrar_estoque, sem_estoque, aceitar_pedidos_sem_estoque, destacar_promocoes } = req.body ?? {}
    const salvo = salvarExibicao({
      mostrar_estoque: typeof mostrar_estoque === 'boolean' ? mostrar_estoque : undefined,
      sem_estoque: sem_estoque === 'manter' ? 'manter' : undefined,
      aceitar_pedidos_sem_estoque: typeof aceitar_pedidos_sem_estoque === 'boolean' ? aceitar_pedidos_sem_estoque : undefined,
      destacar_promocoes: typeof destacar_promocoes === 'boolean' ? destacar_promocoes : undefined
    })
    res.json({ ok: true, exibicao: salvo })
  })

  // Catálogo público (somente leitura) — consumido futuramente pelo site externo.
  // Fica DE FORA de ROTAS_PUBLICAS: nesta fase responde apenas para requisições
  // locais; requisições remotas exigem sessão válida (mesmo middleware padrão).
  app.get('/api/catalogo/publico', (_req, res) => {
    res.json(gerarCatalogoPublico())
  })

  // Módulo Servidor
  app.get('/api/servidor/status', (_req, res) => {
    try {
      res.json({ ok: true, ...getStatusServidor() })
    } catch (err) {
      res.status(500).json({ ok: false, erro: (err as Error).message })
    }
  })

  app.get('/api/servidor/logs', (_req, res) => {
    res.json({ ok: true, logs: getLogs() })
  })

  app.post('/api/servidor/logs/limpar', requerAdmin, (_req, res) => {
    limparLogs()
    res.json({ ok: true })
  })

  app.get('/api/servidor/backup/info', (_req, res) => {
    res.json({ ok: true, ...getBackupInfo() })
  })

  app.post('/api/servidor/diagnostico', (_req, res) => {
    res.json(diagnosticar())
  })

  app.post('/api/servidor/corrigir', requerAdmin, (_req, res) => {
    const r = corrigir()
    res.json({ ok: r.ok, correcoes: r.correcoes })
  })

  // Chave de API: exibição/regeneração SOMENTE no computador do servidor.
  app.get('/api/servidor/apikey', requerAdmin, somenteLocal, (_req, res) => {
    res.json({ ok: true, api_key: getApiKey() })
  })

  app.post('/api/servidor/apikey/regenerar', requerAdmin, somenteLocal, (_req, res) => {
    res.json({ ok: true, api_key: regenerarApiKey() })
  })

  app.post('/api/servidor/zerar', requerAdmin, (req, res) => {
    const { alvos, confirmar } = req.body ?? {}
    if (confirmar !== true) {
      res.status(400).json({ ok: false, erro: 'Confirmação explícita obrigatória (confirmar: true).' })
      return
    }
    if (!Array.isArray(alvos) || alvos.length === 0) {
      res.status(400).json({ ok: false, erro: 'Selecione ao menos um alvo para zerar.' })
      return
    }
    const r = zerarDados(alvos)
    registrarLog('WARNING', `ZERAR executado. Alvos: ${alvos.join(', ')}. Removidos: ${(r.removidos ?? []).join(', ')}`)
    res.json(r)
  })

  app.post('/api/servidor/restaurar', requerAdmin, (req, res) => {
    const { arquivo } = req.body ?? {}
    if (typeof arquivo !== 'string' || !arquivo) {
      res.status(400).json({ ok: false, erro: 'Arquivo de backup obrigatório.' })
      return
    }
    // Segurança: só aceita arquivos DENTRO da pasta de backups do sistema
    // (bloqueia caminho arbitrário/traversal que sobrescreveria o banco com qualquer .sqlite).
    const alvo = resolve(arquivo)
    const base = resolve(backupDir())
    if (!alvo.startsWith(base + sep)) {
      res.status(400).json({ ok: false, erro: `Restauração permitida apenas com arquivos da pasta de backups (${base}).` })
      return
    }
    if (!existsSync(alvo)) {
      res.status(400).json({ ok: false, erro: 'Arquivo de backup não encontrado.' })
      return
    }
    const r = restaurarBackup(alvo)
    if (r.ok) {
      registrarLog('WARNING', `Banco restaurado do backup ${alvo}`)
      res.json({ ok: true })
    } else {
      res.status(400).json({ ok: false, erro: r.erro })
    }
  })

app.post('/api/servidor/encerrar', requerAdmin, (_req, res) => {
    res.json({ ok: true })
    setTimeout(() => {
      try { process.exit(0) } catch { /* ignore */ }
    }, 300)
  })

  // ---------- Importação / Migração Nex (auditoria; grava SÓ em homologação) ----------
  // Reutiliza o pipeline de auditoria aprovado. Nenhuma rota aqui escreve em
  // produção: a importação acontece dentro de um snapshot (homologacao/).
  const validarArquivoNex = (req: express.Request) => {
    const { arquivo } = req.body ?? {}
    if (typeof arquivo !== 'string' || !arquivo) return null
    return arquivo
  }
  const respondErroNex = (res: express.Response, err: Error) => {
    const msg = err instanceof Error ? err.message : String(err)
    if (/em andamento/i.test(msg)) res.status(409).json({ ok: false, erro: msg })
    else res.status(400).json({ ok: false, erro: msg })
  }

  app.get('/api/nex/arquivos', somenteLocal, (_req, res) => {
    const r = nexImportador.listarArquivos()
    res.json({ ok: true, ...r })
  })

  app.get('/api/nex/estado', somenteLocal, (_req, res) => {
    res.json({ ok: true, progresso: nexImportador.getProgresso(), ocupado: nexImportador.estaOcupado(), preparado: nexImportador.getPreparado() })
  })

  app.post('/api/nex/progresso', somenteLocal, (_req, res) => {
    res.json({ ok: true, ...nexImportador.getProgresso() })
  })

  app.post('/api/nex/analisar', somenteLocal, (req, res) => {
    const arquivo = validarArquivoNex(req)
    if (!arquivo) { res.status(400).json({ ok: false, erro: 'Arquivo obrigatório.' }); return }
    nexImportador.analisar(arquivo).then((r) => res.json({ ok: true, ...r })).catch((err: Error) => respondErroNex(res, err))
  })

  app.post('/api/nex/preparar', somenteLocal, (req, res) => {
    const reusar = req.body?.reusar === true
    nexImportador.preparar({ reusar }).then((r) => {
      registrarLog('INFO', `Nex: base preparada em ${r.snapshotDir} (${r.recon ? JSON.stringify((r.recon as { vendasNX?: number }).vendasNX ?? '') : ''} vendas NX)`)
      res.json({ ok: true, ...r })
    }).catch((err: Error) => respondErroNex(res, err))
  })

  app.post('/api/nex/preview', somenteLocal, (req, res) => {
    const arquivo = validarArquivoNex(req)
    if (!arquivo) { res.status(400).json({ ok: false, erro: 'Arquivo obrigatório.' }); return }
    const confiancaMin = req.body?.confiancaMin === 'ALTA CONFIANÇA' ? 'ALTA CONFIANÇA' as const : 'EXATA' as const
    nexImportador.preview(arquivo, confiancaMin).then((r) => res.json({ ok: true, ...r })).catch((err: Error) => respondErroNex(res, err))
  })

  app.post('/api/nex/importar', somenteLocal, (req, res) => {
    const arquivo = validarArquivoNex(req)
    if (!arquivo) { res.status(400).json({ ok: false, erro: 'Arquivo obrigatório.' }); return }
    const confiancaMin = req.body?.confiancaMin === 'ALTA CONFIANÇA' ? 'ALTA CONFIANÇA' as const : 'EXATA' as const
    nexImportador.importar(arquivo, confiancaMin).then((r) => {
      registrarLog('INFO', `Nex: importação homolog em ${r.snapshotDir} — inseridas ${r.resultado.inseridas}, duplicadas ${r.resultado.duplicadas}, caso-C ${r.resultado.naoImportadasCasoC}, ambíguas ${r.resultado.ambiguas}, sem correlação ${r.resultado.semCorrelacao}`)
      res.json({ ok: true, ...r })
    }).catch((err: Error) => respondErroNex(res, err))
  })

  app.get('/api/nex/historico', somenteLocal, (_req, res) => {
    res.json({ ok: true, snapshots: nexImportador.historico() })
  })

  app.post('/api/nex/liberar', somenteLocal, (_req, res) => {
    nexImportador.liberar()
    res.json({ ok: true })
  })

  // ---------- Estoque (movimentações e inventário) ----------
  const CATEGORIAS_ENTRADA = new Set([
    'compra', 'devolucao_cliente', 'transferencia_entrada', 'retorno_remessa', 'ajuste_entrada', 'outras_entradas'
  ])
  const CATEGORIAS_SAIDA = new Set([
    'devolucao_fornecedor', 'transferencia_saida', 'uso_interno', 'remessa_conserto', 'ajuste_saida', 'outras_saidas', 'bonificacao'
  ])

  const PREFIXOS_DOCUMENTO: Record<string, string> = {
    compra: 'C', devolucao_cliente: 'DC', transferencia_entrada: 'TE', retorno_remessa: 'RR',
    ajuste_entrada: 'AE', outras_entradas: 'OE', devolucao_fornecedor: 'DF', transferencia_saida: 'TS',
    uso_interno: 'UI', remessa_conserto: 'RC', ajuste_saida: 'AS', outras_saidas: 'OS', bonificacao: 'BO'
  }

  function produtoParaMovimento(id: number): { id: number; preco_custo: number; preco_venda: number; estoque: number; controla_estoque: number } | undefined {
    return database.prepare(`SELECT id, preco_custo, preco_venda, estoque, controla_estoque FROM produtos WHERE id = ?`).get(id) as
      | { id: number; preco_custo: number; preco_venda: number; estoque: number; controla_estoque: number }
      | undefined
  }

  app.post('/api/estoque/movimentar', (req, res) => {
    const corpo = req.body ?? {}
    const tipo = corpo.tipo
    const categoria = String(corpo.categoria ?? '')
    const itens = corpo.itens
    if (tipo !== 'entrada' && tipo !== 'saida') {
      res.status(400).json({ ok: false, erro: 'Tipo inválido (use entrada ou saida).' })
      return
    }
    const categoriasValidas = tipo === 'entrada' ? CATEGORIAS_ENTRADA : CATEGORIAS_SAIDA
    if (!categoriasValidas.has(categoria)) {
      res.status(400).json({ ok: false, erro: `Categoria "${categoria}" inválida para ${tipo}.` })
      return
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      res.status(400).json({ ok: false, erro: 'Informe ao menos um item.' })
      return
    }
    if (itens.length > 500) {
      res.status(400).json({ ok: false, erro: 'Máximo de 500 itens por movimentação.' })
      return
    }
    if (corpo.usuario_id != null) {
      const u = database.prepare('SELECT id FROM usuarios WHERE id = ?').get(Number(corpo.usuario_id)) as { id: number } | undefined
      if (!u) {
        res.status(400).json({ ok: false, erro: 'Usuário não encontrado.' })
        return
      }
    }
    if (corpo.fornecedor_id != null) {
      const f = database.prepare('SELECT id FROM fornecedores WHERE id = ?').get(Number(corpo.fornecedor_id)) as { id: number } | undefined
      if (!f) {
        res.status(400).json({ ok: false, erro: 'Fornecedor não encontrado.' })
        return
      }
    }
    if (corpo.cliente_id != null) {
      const c = database.prepare('SELECT id FROM clientes WHERE id = ?').get(Number(corpo.cliente_id)) as { id: number } | undefined
      if (!c) {
        res.status(400).json({ ok: false, erro: 'Cliente não encontrado.' })
        return
      }
    }

    const linhas = new Map<number, { quantidade: number; preco_custo: number | null; lote: string | null; data_validade: string | null; data_fabricacao: string | null }>()
    for (const item of itens) {
      const pid = Number(item?.produto_id)
      const qtd = Number(item?.quantidade)
      if (!Number.isInteger(pid) || pid <= 0 || !produtoParaMovimento(pid)) {
        res.status(400).json({ ok: false, erro: 'Produto inválido na movimentação.' })
        return
      }
      if (!Number.isFinite(qtd) || qtd <= 0) {
        res.status(400).json({ ok: false, erro: 'Quantidade deve ser um número maior que zero.' })
        return
      }
      const existente = linhas.get(pid)
      const custo = item.preco_custo == null || item.preco_custo === '' ? null : Number(item.preco_custo)
      if (existente) {
        existente.quantidade += qtd
        if (custo != null && Number.isFinite(custo)) existente.preco_custo = custo
      } else {
        linhas.set(pid, {
          quantidade: qtd,
          preco_custo: custo != null && Number.isFinite(custo) ? custo : null,
          lote: item.lote ? String(item.lote) : null,
          data_validade: item.data_validade ? String(item.data_validade) : null,
          data_fabricacao: item.data_fabricacao ? String(item.data_fabricacao) : null
        })
      }
    }

    const agora = corpo.data ? String(corpo.data) : new Date().toISOString()
    const documento = String(corpo.documento ?? '').trim() || `${PREFIXOS_DOCUMENTO[categoria] ?? 'M'}${Date.now()}`
    const usuarioId = corpo.usuario_id != null ? Number(corpo.usuario_id) : null
    const fornecedorId = corpo.fornecedor_id != null ? Number(corpo.fornecedor_id) : null
    const clienteId = corpo.cliente_id != null ? Number(corpo.cliente_id) : null
    const motivo = corpo.motivo ? String(corpo.motivo) : null
    const origem = corpo.origem ? String(corpo.origem) : null
    const destino = corpo.destino ? String(corpo.destino) : null

    let total = 0
    let aplicados = 0
    // Saída nunca deixa estoque negativo (a menos que force=true — uso interno
    // do sistema, ex.: inventário). Valida ANTES de aplicar e devolve a lista.
    const semSaldo: string[] = []
    if (tipo === 'saida' && corpo.force !== true) {
      for (const [pid, linha] of linhas) {
        const p = produtoParaMovimento(pid)!
        if (p.controla_estoque === 1 && p.estoque < linha.quantidade) {
          semSaldo.push(`${p.id} (${p.estoque} em estoque, pedido ${linha.quantidade})`)
        }
      }
      if (semSaldo.length > 0) {
        res.status(400).json({ ok: false, erro: `Estoque insuficiente para: ${semSaldo.join('; ')}.`, produtos_sem_saldo: semSaldo })
        return
      }
    }
    database.exec('BEGIN')
    try {
      for (const [pid, linha] of linhas) {
        const p = produtoParaMovimento(pid)!
        const custo = linha.preco_custo ?? p.preco_custo
        const valor = linha.quantidade * custo
        total += valor
        if (tipo === 'entrada') {
          if (linha.preco_custo != null) {
            database.prepare(`UPDATE produtos SET estoque = estoque + ?, preco_custo = ? WHERE id = ?`).run(linha.quantidade, custo, pid)
          } else {
            database.prepare(`UPDATE produtos SET estoque = estoque + ? WHERE id = ?`).run(linha.quantidade, pid)
          }
        } else {
          database.prepare(`UPDATE produtos SET estoque = estoque - ? WHERE id = ?`).run(linha.quantidade, pid)
        }
        if (linha.lote || linha.data_validade || linha.data_fabricacao) {
          database.prepare(
            `UPDATE produtos SET lote = COALESCE(?, lote), data_validade = COALESCE(?, data_validade), data_fabricacao = COALESCE(?, data_fabricacao) WHERE id = ?`
          ).run(linha.lote, linha.data_validade, linha.data_fabricacao, pid)
        }
        database.prepare(
          `INSERT INTO movimentacoes (produto_id, tipo, categoria, quantidade, motivo, documento, valor, origem, destino, cliente_id, fornecedor_id, usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(pid, tipo, categoria, linha.quantidade, motivo, documento, valor, origem, destino, clienteId, fornecedorId, usuarioId, agora)
        notificarAlteracaoProduto(pid)
        aplicados++
      }
      if (categoria === 'compra') {
        const compraId = Number(database.prepare(`INSERT INTO compras (fornecedor_id, numero, total, status) VALUES (?, ?, ?, 'paga')`).run(fornecedorId, documento, total).lastInsertRowid)
        for (const [pid, linha] of linhas) {
          const p = produtoParaMovimento(pid)!
          const custo = linha.preco_custo ?? p.preco_custo
          database.prepare(`INSERT INTO compra_itens (compra_id, produto_id, quantidade, preco_custo, subtotal) VALUES (?, ?, ?, ?, ?)`)
            .run(compraId, pid, linha.quantidade, custo, linha.quantidade * custo)
        }
      }
      database.exec('COMMIT')
    } catch (err) {
      database.exec('ROLLBACK')
      registrarLog('ERROR', `Estoque/movimentar: ${(err as Error).message}`)
      res.status(500).json({ ok: false, erro: (err as Error).message })
      return
    }
    res.json({ ok: true, documento, total, itens: aplicados, tipo, categoria })
  })

  app.post('/api/estoque/inventario/abrir', (req, res) => {
    const corpo = req.body ?? {}
    const ids = corpo.produtos
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ ok: false, erro: 'Selecione ao menos um produto para o inventário.' })
      return
    }
    if (ids.length > 10000) {
      res.status(400).json({ ok: false, erro: 'Inventário limitado a 10.000 produtos.' })
      return
    }
    if (corpo.usuario_id != null) {
      const u = database.prepare('SELECT id FROM usuarios WHERE id = ?').get(Number(corpo.usuario_id)) as { id: number } | undefined
      if (!u) {
        res.status(400).json({ ok: false, erro: 'Usuário não encontrado.' })
        return
      }
    }
    const numeros = ids.map(() => '?').join(',')
    const produtos = database.prepare(
      `SELECT id, estoque FROM produtos WHERE id IN (${numeros}) AND controla_estoque = 1`
    ).all(...ids.map(Number)) as { id: number; estoque: number }[]
    if (produtos.length === 0) {
      res.status(400).json({ ok: false, erro: 'Nenhum produto válido selecionado.' })
      return
    }
    const numero = `INV-${Date.now()}`
    database.exec('BEGIN')
    try {
      const invId = Number(
        database.prepare(`INSERT INTO inventarios (numero, usuario_id, observacao, total_itens, status) VALUES (?, ?, ?, ?, 'aberto')`)
          .run(numero, corpo.usuario_id != null ? Number(corpo.usuario_id) : null, corpo.observacao ? String(corpo.observacao) : null, produtos.length)
          .lastInsertRowid
      )
      const ins = database.prepare(`INSERT INTO inventario_itens (inventario_id, produto_id, estoque_sistema) VALUES (?, ?, ?)`)
      for (const p of produtos) ins.run(invId, p.id, p.estoque)
      database.exec('COMMIT')
      res.json({ ok: true, inventario_id: invId, numero, itens: produtos.length })
    } catch (err) {
      database.exec('ROLLBACK')
      res.status(500).json({ ok: false, erro: (err as Error).message })
    }
  })

  app.post('/api/estoque/inventario/finalizar', (req, res) => {
    const corpo = req.body ?? {}
    const invId = Number(corpo.inventario_id)
    const inv = database.prepare(`SELECT * FROM inventarios WHERE id = ?`).get(invId) as
      | { id: number; numero: string; status: string; observacao: string | null }
      | undefined
    if (!inv) {
      res.status(400).json({ ok: false, erro: 'Inventário não encontrado.' })
      return
    }
    if (inv.status !== 'aberto') {
      res.status(400).json({ ok: false, erro: 'Inventário já finalizado ou cancelado.' })
      return
    }
    if (corpo.usuario_id != null) {
      const u = database.prepare('SELECT id FROM usuarios WHERE id = ?').get(Number(corpo.usuario_id)) as { id: number } | undefined
      if (!u) {
        res.status(400).json({ ok: false, erro: 'Usuário não encontrado.' })
        return
      }
    }
    const itens = database.prepare(`SELECT * FROM inventario_itens WHERE inventario_id = ?`).all(invId) as {
      id: number
      produto_id: number
      estoque_sistema: number
      quantidade_fisica: number | null
      conferido: number
    }[]
    const usuarioId = corpo.usuario_id != null ? Number(corpo.usuario_id) : null
    const documento = `INV-${inv.numero.replace(/^INV-/, '')}`
    let divergencias = 0
    let ajustados = 0
    database.exec('BEGIN')
    try {
      const updItem = database.prepare(`UPDATE inventario_itens SET diferenca = ?, conferido = 1 WHERE id = ?`)
      const updEstoque = database.prepare(`UPDATE produtos SET estoque = ? WHERE id = ?`)
      const insMov = database.prepare(
        `INSERT INTO movimentacoes (produto_id, tipo, categoria, quantidade, motivo, documento, valor, usuario_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const item of itens) {
        if (!item.conferido || item.quantidade_fisica == null) continue
        const dif = item.quantidade_fisica - item.estoque_sistema
        updItem.run(dif, item.id)
        if (Math.abs(dif) < 0.0001) continue
        divergencias++
        const p = produtoParaMovimento(item.produto_id)!
        updEstoque.run(item.quantidade_fisica, item.produto_id)
        const ajuste = dif > 0 ? 'ajuste_entrada' : 'ajuste_saida'
        const tipo = dif > 0 ? 'entrada' : 'saida'
        insMov.run(
          item.produto_id, tipo, ajuste, Math.abs(dif),
          `Inventário ${inv.numero}${inv.observacao ? ` — ${inv.observacao}` : ''}`,
          documento, Math.abs(dif) * p.preco_custo, usuarioId, new Date().toISOString()
        )
        notificarAlteracaoProduto(item.produto_id)
        ajustados++
      }
      database.prepare(
        `UPDATE inventarios SET status = 'finalizado', total_itens = ?, total_conferidos = ?, total_divergencias = ?, finalizado_em = ? WHERE id = ?`
      ).run(itens.length, itens.filter((i) => i.conferido).length, divergencias, new Date().toISOString(), invId)
      database.exec('COMMIT')
    } catch (err) {
      database.exec('ROLLBACK')
      registrarLog('ERROR', `Estoque/inventario/finalizar: ${(err as Error).message}`)
      res.status(500).json({ ok: false, erro: (err as Error).message })
      return
    }
    res.json({ ok: true, inventario_id: invId, numero: inv.numero, divergencias, ajustados, conferidos: itens.filter((i) => i.conferido).length })
  })

  app.post('/api/estoque/inventario/cancelar', (req, res) => {
    const invId = Number(req.body?.inventario_id)
    const r = database.prepare(`UPDATE inventarios SET status = 'cancelado' WHERE id = ? AND status = 'aberto'`).run(invId)
    if (Number(r.changes) === 0) {
      res.status(400).json({ ok: false, erro: 'Inventário não encontrado ou já finalizado.' })
      return
    }
    res.json({ ok: true })
  })

  // ---------- Finalização de venda (transacional, com regras de estoque) ----------
  app.post('/api/vendas/finalizar', (req, res) => {
    const corpo = req.body ?? {}
    const itens = corpo.itens
    const pagamentos = corpo.pagamentos
    const subtotal = Number(corpo.subtotal ?? 0)
    const desconto = Number(corpo.desconto ?? 0)
    const total = Number(corpo.total ?? 0)
    if (!Array.isArray(itens) || itens.length === 0) {
      res.status(400).json({ ok: false, erro: 'Informe ao menos um item.' })
      return
    }
    if (!Number.isFinite(total) || total < 0) {
      res.status(400).json({ ok: false, erro: 'Total inválido.' })
      return
    }
    const usuarioId = corpo.usuario_id != null ? Number(corpo.usuario_id) : null

    // Identidade autorizadora = SESSÃO (nunca o corpo). O terminal envia o token
    // de sessão; é a fonte confiável de perfil e permissões.
    const autenticado = usuarioAutenticadoDoReq(req)
    if (!autenticado) {
      res.status(401).json({ ok: false, erro: 'Sessão inválida ou ausente. Faça login no terminal.' })
      return
    }

    // Regra de estoque: bloqueia venda sem saldo, SALVO se a configuração da loja
    // permitir ou o operador tiver a permissão específica.
    let permitirSemEstoque = false
    try {
      const cfgRow = database.prepare(`SELECT valor FROM config WHERE chave = 'pdv_permitir_sem_estoque'`).get() as { valor: string } | undefined
      if ((cfgRow?.valor ?? '0') === '1') permitirSemEstoque = true
    } catch { /* ignore */ }
    if (!permitirSemEstoque && usuarioTemPermissao(autenticado.id, 'vender_sem_estoque')) {
      permitirSemEstoque = true
    }

    // Limite de desconto: se o usuário autenticado tem limitar_desconto ativo,
    // o desconto não pode passar de desconto_max_percent% do subtotal.
    if (autenticado.limitar_desconto === 1) {
      const max = Math.max(0, Math.min(100, Number(autenticado.desconto_max_percent) || 0))
      const maxDesconto = subtotal * (max / 100)
      if (desconto > maxDesconto + 0.009) {
        res.status(400).json({ ok: false, erro: `Desconto máximo permitido para este usuário: ${max}% (R$ ${maxDesconto.toFixed(2)}).` })
        return
      }
    }

    // Caixa informado precisa existir e estar aberto.
    let caixaId: number | null = null
    if (corpo.caixa_id != null) {
      const cx = Number(corpo.caixa_id)
      const cxRow = database.prepare(`SELECT id FROM caixas WHERE id = ? AND aberto = 1`).get(cx) as { id: number } | undefined
      if (!cxRow) {
        res.status(400).json({ ok: false, erro: 'Caixa não encontrado ou fechado.' })
        return
      }
      caixaId = cx
    }

    // Número da venda fora da transação (sequência própria é atômica por UPDATE).
    let numero = ''
    try {
      const seq = database.prepare(`UPDATE sequencias SET valor = valor + 1 WHERE chave = 'venda' RETURNING valor`).get() as { valor: number }
      numero = String(seq.valor)
    } catch {
      // sequência ausente (banco antigo): cria na hora
      database.prepare(`INSERT INTO sequencias (chave, valor) VALUES ('venda', 56781) ON CONFLICT(chave) DO NOTHING`).run()
      const seq = database.prepare(`UPDATE sequencias SET valor = valor + 1 WHERE chave = 'venda' RETURNING valor`).get() as { valor: number }
      numero = String(seq.valor)
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      const vendaId = Number(
        database
          .prepare(`INSERT INTO vendas (numero, tipo, subtotal, desconto, total, status, vendedor_id, caixa_id, cliente_id, observacoes, taxa_entrega, cliente_endereco) VALUES (?, 'balcao', ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?)`)
          .run(
            numero,
            subtotal,
            desconto,
            total,
            corpo.vendedor_id != null ? Number(corpo.vendedor_id) : null,
            caixaId,
            corpo.cliente_id != null ? Number(corpo.cliente_id) : null,
            corpo.observacoes ? String(corpo.observacoes) : null,
            Number(corpo.taxa_entrega ?? 0),
            corpo.cliente_endereco ? String(corpo.cliente_endereco) : null
          ).lastInsertRowid
      )
      const insItem = database.prepare(
        `INSERT INTO venda_itens (venda_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal, desconto, observacao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const baixa = database.prepare(`UPDATE produtos SET estoque = estoque - ? WHERE id = ?`)
      const insMov = database.prepare(
        `INSERT INTO movimentacoes (produto_id, tipo, quantidade, motivo, venda_id) VALUES (?, 'saida', ?, 'venda', ?)`
      )
      for (const item of itens) {
        const pid = Number(item?.produto_id)
        const qtd = Number(item?.quantidade)
        if (!Number.isInteger(pid) || pid <= 0 || !(qtd > 0)) {
          throw new Error('Item inválido no carrinho.')
        }
        insItem.run(vendaId, pid, String(item.nome ?? ''), qtd, Number(item.preco_unitario ?? 0), qtd * Number(item.preco_unitario ?? 0), Number(item.desconto ?? 0), item.observacao ? String(item.observacao) : null)
        const p = database.prepare(`SELECT controla_estoque, estoque, nome FROM produtos WHERE id = ?`).get(pid) as
          | { controla_estoque: number; estoque: number; nome: string }
          | undefined
        if (p && p.controla_estoque === 1) {
          if (p.estoque < qtd && !permitirSemEstoque) {
            const e = new Error(`Estoque insuficiente para "${p.nome}" (disponível ${p.estoque}, pedido ${qtd}).`) as Error & { codigo?: string }
            e.codigo = 'ESTOQUE_INSUFICIENTE'
            throw e
          }
          baixa.run(qtd, pid)
          insMov.run(pid, qtd, vendaId)
        }
      }
      const insPag = database.prepare(`INSERT INTO pagamentos (venda_id, forma, valor) VALUES (?, ?, ?)`)
      if (Array.isArray(pagamentos)) {
        for (const pg of pagamentos) {
          const valor = Number(pg?.valor ?? 0)
          if (!(valor > 0)) continue
          insPag.run(vendaId, String(pg.forma ?? ''), valor)
        }
      }
      if (caixaId != null) {
        database.prepare(`UPDATE caixas SET total_vendas = total_vendas + ?, qtd_vendas = qtd_vendas + 1 WHERE id = ?`).run(total, caixaId)
      }
      database.exec('COMMIT')
      res.json({ ok: true, numero, venda_id: vendaId })
    } catch (err) {
      database.exec('ROLLBACK')
      const e = err as Error & { codigo?: string }
      registrarLog('ERROR', `Vendas/finalizar: ${e.message}`)
      res.status(e.codigo === 'ESTOQUE_INSUFICIENTE' ? 400 : 500).json({ ok: false, erro: e.message, codigo: e.codigo })
    }
  })

  // ---------- Cancelamentos (transacionais, com autorização) ----------

  app.post('/api/vendas/cancelar', (req, res) => {
    const { venda_id } = req.body ?? {}
    const vid = Number(venda_id)
    if (!Number.isInteger(vid) || vid <= 0) {
      res.status(400).json({ ok: false, erro: 'venda_id obrigatório.' })
      return
    }
    // Autorização pela SESSÃO (nunca pelo corpo). Admin/gerente podem sempre;
    // demais usuários precisam da permissão fina 'vendas_cancelar'.
    const autenticado = usuarioAutenticadoDoReq(req)
    const podeCancelar =
      !!autenticado &&
      (autenticado.perfil === 'admin' || autenticado.perfil === 'gerente' || usuarioTemPermissao(autenticado.id, 'vendas_cancelar'))
    if (!autenticado) {
      res.status(401).json({ ok: false, erro: 'Sessão inválida ou ausente. Faça login no terminal.' })
      return
    }
    if (!podeCancelar) {
      res.status(403).json({ ok: false, erro: 'Somente administrador, gerente ou usuário com permissão de cancelar vendas.' })
      return
    }
    const u = autenticado
    const venda = database.prepare(`SELECT id, numero, total, status, caixa_id FROM vendas WHERE id = ?`).get(vid) as
      | { id: number; numero: string; total: number; status: string; caixa_id: number | null }
      | undefined
    if (!venda) {
      res.status(400).json({ ok: false, erro: 'Venda não encontrada.' })
      return
    }
    if (venda.status !== 'concluida') {
      res.status(400).json({ ok: false, erro: `Venda ${venda.numero} não está concluída (status atual: ${venda.status}).` })
      return
    }
    database.exec('BEGIN IMMEDIATE')
    try {
      const itens = database
        .prepare(
          `SELECT vi.produto_id, vi.quantidade FROM venda_itens vi
           JOIN produtos p ON p.id = vi.produto_id
           WHERE vi.venda_id = ? AND vi.produto_id IS NOT NULL AND p.controla_estoque = 1`
        )
        .all(vid) as { produto_id: number; quantidade: number }[]
      const devolve = database.prepare(`UPDATE produtos SET estoque = estoque + ? WHERE id = ?`)
      for (const it of itens) devolve.run(it.quantidade, it.produto_id)

      database.prepare(`UPDATE movimentacoes SET tipo = 'cancelamento' WHERE venda_id = ?`).run(vid)

      if (venda.caixa_id != null) {
        database
          .prepare(
            `UPDATE caixas SET total_vendas = MAX(0, total_vendas - ?), qtd_vendas = MAX(0, qtd_vendas - 1), cancelamentos = cancelamentos + ? WHERE id = ?`
          )
          .run(venda.total, venda.total, venda.caixa_id)
      }

      database.prepare(`UPDATE vendas SET status = 'cancelada', cancelada_em = datetime('now') WHERE id = ?`).run(vid)
      database.exec('COMMIT')
      registrarLog('WARNING', `Venda ${venda.numero} cancelada por ${u.nome}. Caixa ajustado.`)
      res.json({ ok: true, numero: venda.numero, itens_devolvidos: itens.length })
    } catch (err) {
      database.exec('ROLLBACK')
      registrarLog('ERROR', `Cancelar venda ${vid}: ${(err as Error).message}`)
      res.status(500).json({ ok: false, erro: (err as Error).message })
    }
  })

  app.post('/api/pedidos/cancelar', (req, res) => {
    const { pedido_id } = req.body ?? {}
    const pid = Number(pedido_id)
    if (!Number.isInteger(pid) || pid <= 0) {
      res.status(400).json({ ok: false, erro: 'pedido_id obrigatório.' })
      return
    }
    // Autorização pela SESSÃO (nunca pelo corpo).
    const autenticado = usuarioAutenticadoDoReq(req)
    const podeCancelar =
      !!autenticado &&
      (autenticado.perfil === 'admin' || autenticado.perfil === 'gerente' || usuarioTemPermissao(autenticado.id, 'vendas_cancelar'))
    if (!autenticado) {
      res.status(401).json({ ok: false, erro: 'Sessão inválida ou ausente. Faça login no terminal.' })
      return
    }
    if (!podeCancelar) {
      res.status(403).json({ ok: false, erro: 'Somente administrador, gerente ou usuário com permissão de cancelar pedidos.' })
      return
    }
    const u = autenticado
    const pedido = database.prepare(`SELECT id, numero, status FROM pedidos WHERE id = ?`).get(pid) as
      | { id: number; numero: string; status: string }
      | undefined
    if (!pedido) {
      res.status(400).json({ ok: false, erro: 'Pedido não encontrado.' })
      return
    }
    if (pedido.status === 'cancelado') {
      res.status(400).json({ ok: false, erro: 'Pedido já está cancelado.' })
      return
    }
    if (pedido.status === 'entregue') {
      res.status(400).json({ ok: false, erro: 'Pedido já entregue — use troca/devolução, não cancelamento.' })
      return
    }
    // Estoque só foi debitado quando o pedido passou de 'novo' (novo→aceito).
    const estoqueDebitado = pedido.status !== 'novo'
    database.exec('BEGIN IMMEDIATE')
    try {
      if (estoqueDebitado) {
        const itens = database
          .prepare(
            `SELECT pi.produto_id, pi.quantidade FROM pedido_itens pi
             JOIN produtos p ON p.id = pi.produto_id
             WHERE pi.pedido_id = ? AND pi.produto_id IS NOT NULL AND p.controla_estoque = 1`
          )
          .all(pid) as { produto_id: number; quantidade: number }[]
        const devolve = database.prepare(`UPDATE produtos SET estoque = estoque + ? WHERE id = ?`)
        const insMov = database.prepare(
          `INSERT INTO movimentacoes (produto_id, tipo, categoria, quantidade, motivo, documento, usuario_id, criado_em)
           VALUES (?, 'entrada', 'outras_entradas', ?, ?, ?, ?, ?)`
        )
        const documento = `PC-${pedido.numero}`
        for (const it of itens) {
          devolve.run(it.quantidade, it.produto_id)
          insMov.run(
            it.produto_id, it.quantidade,
            `Cancelamento do pedido ${pedido.numero}`,
            documento, u.id, new Date().toISOString()
          )
        }
      }
      database.prepare(`UPDATE pedidos SET status = 'cancelado' WHERE id = ?`).run(pid)
      database.exec('COMMIT')
      registrarLog('WARNING', `Pedido ${pedido.numero} cancelado por ${u.nome}${estoqueDebitado ? ' — estoque devolvido.' : '.'}`)
      res.json({ ok: true, estoque_devolvido: estoqueDebitado })
    } catch (err) {
      database.exec('ROLLBACK')
      registrarLog('ERROR', `Cancelar pedido ${pid}: ${(err as Error).message}`)
      res.status(500).json({ ok: false, erro: (err as Error).message })
    }
  })

  // ---------- Importação via ZIP ----------
  app.post('/api/importar/zip', express.raw({ type: 'application/octet-stream', limit: '600mb' }), async (req, res) => {
    const nome = (() => {
      try { return decodeURIComponent(req.get('x-zip-nome') || 'arquivo.zip') } catch { return req.get('x-zip-nome') || 'arquivo.zip' }
    })()
    const buffer = Buffer.isBuffer(req.body) ? req.body : null
    if (!buffer || buffer.length === 0) {
      res.status(400).json({ ok: false, erro: 'Arquivo ZIP obrigatório.' })
      return
    }
    const r = await extrairZip(buffer, nome)
    if (!r.ok) {
      res.status(400).json({ ok: false, erro: r.erro })
      return
    }
    res.json({ ok: true, arquivos: r.arquivos })
  })

  app.get('/api/importar/arquivos', (_req, res) => {
    res.json({ ok: true, arquivos: listarArquivosImportacao() })
  })

  app.get('/api/importar/progresso', (_req, res) => {
    res.json({ ok: true, ...getProgressoImportacao() })
  })

  app.post('/api/importar/arquivo', (req, res) => {
    const { arquivo } = req.body ?? {}
    if (typeof arquivo !== 'string' || !arquivo) {
      res.status(400).json({ ok: false, erro: 'Arquivo obrigatório.' })
      return
    }
    const r = lerArquivoImportacao(arquivo)
    if (!r.ok) {
      res.status(400).json({ ok: false, erro: r.erro })
      return
    }
    res.json({ ok: true, colunas: r.colunas, linhas: r.linhas, arquivo })
  })

  app.post('/api/importar/produtos', async (req, res) => {
    const { arquivo } = req.body ?? {}
    if (typeof arquivo !== 'string' || !arquivo) {
      res.status(400).json({ ok: false, erro: 'Arquivo obrigatório.' })
      return
    }
    const r = await importarProdutos(arquivo)
    res.json(r)
  })

  app.post('/api/importar/limpar', (_req, res) => {
    limparPastaImportacao()
    res.json({ ok: true })
  })

// Grava o corpo (ZIP de até GBs) diretamente num arquivo temporário — nunca o
  // deixa inteiro na memória (um Dados.zip de 757MB + os .nx1 descomprimidos
  // travaram o servidor em máquinas sem RAM). O nome é único por upload.
  const gravarBodyEmTemp = (req: express.Request): Promise<string> =>
    new Promise((resolve, reject) => {
      const dir = getImportDir()
      mkdirSync(dir, { recursive: true })
      const tmp = join(dir, `upload-nex-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`)
      const ws = createWriteStream(tmp)
      req.pipe(ws)
      ws.on('finish', () => resolve(tmp))
      ws.on('error', reject)
      req.on('error', reject)
    })

  app.post('/api/importar/nex', async (req, res) => {
    const nome = (() => {
      try { return decodeURIComponent(req.get('x-zip-nome') || 'backup.zip') } catch { return req.get('x-zip-nome') || 'backup.zip' }
    })()
    let tmp: string | null = null
    try {
      tmp = await gravarBodyEmTemp(req)
      if ((statSync(tmp)?.size ?? 0) === 0) {
        res.status(400).json({ ok: false, erro: 'Arquivo ZIP obrigatório.' })
        return
      }
      const r = await importarNexDeZip(tmp, nome)
      res.json(r)
    } catch (err) {
      registrarLog('ERROR', `Falha ao receber ZIP Nex: ${(err as Error).message}`)
      res.status(500).json({ ok: false, erro: (err as Error).message })
    } finally {
      if (tmp) { try { rmSync(tmp, { force: true }) } catch { /* ignora */ } }
    }
  })

  app.get('/api/importar/nex/progresso', (_req, res) => {
    res.json({ ok: true, ...getProgressoNex() })
  })

app.post('/api/importar/nex/analisar', async (req, res) => {
    const nome = (() => {
      try { return decodeURIComponent(req.get('x-zip-nome') || 'backup.zip') } catch { return req.get('x-zip-nome') || 'backup.zip' }
    })()
    let tmp: string | null = null
    try {
      tmp = await gravarBodyEmTemp(req)
      if ((statSync(tmp)?.size ?? 0) === 0) {
        res.status(400).json({ ok: false, erro: 'Arquivo ZIP obrigatório.' })
        return
      }
      const r = await analisarNexDeZip(tmp, nome)
      res.json(r)
    } catch (err) {
      registrarLog('ERROR', `Falha ao receber ZIP Nex: ${(err as Error).message}`)
      res.status(500).json({ ok: false, erro: (err as Error).message })
    } finally {
      if (tmp) { try { rmSync(tmp, { force: true }) } catch { /* ignora */ } }
    }
  })

  // ---------- WhatsApp Bot ----------
  registerWhatsAppRoutes(app, database, (token) => (token ? sessoes.has(token) : false))

  // Registra erros de todas as rotas da API no log
  registrarErrosApi(app)

  const tentarPorta = (p: number) => {
    const srv = createServer(app)
    srv.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && p < porta + 50) {
        console.log(`[servidor] Porta ${p} em uso — tentando ${p + 1}...`)
        tentarPorta(p + 1)
      } else {
        console.error(`[servidor] Falha ao iniciar servidor na porta ${p}: ${err.message}`)
      }
    })
    srv.listen(p, '0.0.0.0', () => {
      server = srv
      portaAtual = p
      gravarPorta(p)
      const ip = getIpRede()
      registrarLog('SUCCESS', `Servidor iniciado na porta ${p}`)
      registrarLog('INFO', `Banco conectado`)
      registrarLog('SUCCESS', `API iniciada em http://${ip}:${p}`)
console.log(`[servidor] API em http://${ip}:${p} (local: http://localhost:${p})`)
      agendarBackupAutomatico()
    })
  }

  // Se já houver uma porta gravada de execução anterior, usa; senão começa da padrão.
  const gravada = lerPortaGravada()
  tentarPorta(gravada || porta)
}

// Backup automático: primeiro em ~2 min de uptime, depois a cada 4 horas.
let backupAgendado = false
function agendarBackupAutomatico(): void {
  if (backupAgendado) return
  backupAgendado = true
  const INTERVALO_MS = 4 * 60 * 60 * 1000
  setTimeout(() => {
    try {
      const r = fazerBackup()
      if (r.ok) registrarLog('SUCCESS', `Backup automático realizado: ${r.arquivo}`)
      else registrarLog('ERROR', `Backup automático falhou: ${r.arquivo}`)
    } catch (err) {
      console.error('[servidor] Erro no backup automático:', (err as Error).message)
    }
  }, 2 * 60 * 1000)
  setInterval(() => {
    try {
      const r = fazerBackup()
      if (r.ok) registrarLog('SUCCESS', `Backup automático realizado: ${r.arquivo}`)
      else registrarLog('ERROR', `Backup automático falhou: ${r.arquivo}`)
    } catch (err) {
      console.error('[servidor] Erro no backup automático:', (err as Error).message)
    }
  }, INTERVALO_MS)
}

export function pararServidor(): void {
  try { stopWhatsApp() } catch {}
  if (server) {
    server.close()
    server = null
  }
}

// Captura erros não tratados e os registra no log do servidor (área "console").
process.on('uncaughtException', (err) => {
  try {
    registrarLog('ERROR', `Erro não tratado: ${(err as Error).message}\n${(err as Error).stack ?? ''}`)
  } catch { /* ignore */ }
  console.error('[servidor] uncaughtException:', err)
})

process.on('unhandledRejection', (reason) => {
  try {
    registrarLog('ERROR', `Rejeição não tratada: ${String(reason)}`)
  } catch { /* ignore */ }
  console.error('[servidor] unhandledRejection:', reason)
})

// Registra erros de rotas da API no log (qualquer erro que o sistema encontre).
function registrarErrosApi(app: express.Express): void {
  app.use((err: Error, req: express.Request, _res: express.Response, next: express.NextFunction) => {
    try {
      registrarLog('ERROR', `Erro em ${req.method} ${req.path}: ${err.message}`)
    } catch { /* ignore */ }
    next(err)
  })
}

if (require.main === module) {
  initDb()
  seed(getDb())
  iniciarServidor(Number(process.env.TABACARIA_PORTA) || 3210)

  // Graceful shutdown
  const shutdown = () => {
    try { registrarLog('INFO', 'Servidor encerrando (shutdown)...') } catch {}
    try { pararServidor() } catch {}
    try {
      const d = getDb()
      if (d) { d.close(); db = null }
    } catch {}
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
