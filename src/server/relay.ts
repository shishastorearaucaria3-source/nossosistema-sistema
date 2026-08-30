// Réle local do catálogo (Fase 5 — estendido na Fase 9C-1)
//
// Ponte ÚNICA entre o Cloudflare Tunnel e os dados públicos do catálogo.
// SO escuta em 127.0.0.1:3211 (loopback). O Express 3210 NÃO é exposto pelo
// túnel — e este processo é totalmente independente dele.
//
// Token (Bearer): vem de CATALOGO_RELAY_TOKEN (env) ou, se ausente, do arquivo
// <dataDir>/catalogo-relay.token (fora do repositório — nunca versionar).
// Sem token configurado o réle NÃO inicia (fail-closed).
//
// Fase 9C-1 — proteção de instalação:
// O réle só sobe quando a instalação correspondente for identificada como
// SERVIDOR. Em instalações "cliente" ele NÃO inicia. Se a instalação não
// puder ser identificada com segurança, o comportamento é FAIL CLOSED
// (não iniciar) — exceto em modo desenvolvimento/teste (runtime node/electron
// fora de um instalador), onde a execução é explícita e manual.
//
// O banco continua sendo escolhido por getDefaultDbPath(); nenhum override
// automático é aplicado (nenhum uso de TABACARIA_DB em produção).
//
// Modo supervisor (Fase 9C-1): quando spawnado pelo relay-supervisao com
// canal IPC, o réle responde a { tipo: 'encerrar' } e sai sozinho quando o
// processo pai é encerrado (evento 'disconnect') — evitando processos órfãos.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { initDb, getDb, getDefaultDbPath } from './index'
import { gerarCatalogoPublico } from './catalogo'
import { getDataDir } from '../shared/data-dir'

const HOST = '127.0.0.1'
// Porta configurável apenas para testes/desenvolvimento (o padrão nunca muda).
const PORTA = Number(process.env.CATALOGO_RELAY_PORT || 3211) || 3211
const AUTORIZACAO = 'authorization'

/**
 * Lê o tipo de instalação a partir do instalacao.json no diretório informado.
 * Retorna 'servidor', 'cliente' ou null quando o arquivo não existe ou é
 * inválido/inseguro (falha fechada).
 */
export function tipoInstalacaoDoDiretorio(dir: string): 'servidor' | 'cliente' | null {
  try {
    const arquivo = join(dir, 'instalacao.json')
    if (!existsSync(arquivo)) return null
    const dados = JSON.parse(readFileSync(arquivo, 'utf8')) as { tipo?: unknown }
    const tipo = dados?.tipo
    if (tipo === 'servidor' || tipo === 'cliente') return tipo
    return null
  } catch {
    return null
  }
}

/**
 * Detecta execução de desenvolvimento/teste pelo nome do runtime (node/electron
 * fora de um instalador empacotado). NUNCA é usado como autorização em si — em
 * instalações reais (exe do produto) a autorização vem do instalacao.json.
 */
export function modoDesenvolvimento(execPath: string): boolean {
  const nome = basename(execPath).toLowerCase()
  return nome === 'node' || nome === 'node.exe' || nome === 'electron' || nome === 'electron.exe'
}

/**
 * Decisão de permissão do réle (FAIL CLOSED fora de dev):
 * - servidor → permitido
 * - cliente → bloqueado
 * - instalacao.json ausente/inválido em instalação real → bloqueado
 * - desenvolvimento/teste → permitido (execução explícita e manual)
 */
export function decisaoPermissaoRelay(opts: { execPath?: string; dirInstalacao?: string } = {}): { permitido: boolean; motivo: string } {
  const execPath = opts.execPath ?? process.execPath
  if (modoDesenvolvimento(execPath)) {
    return { permitido: true, motivo: 'desenvolvimento' }
  }
  const dirInstalacao = opts.dirInstalacao ?? dirname(resolve(execPath))
  const tipo = tipoInstalacaoDoDiretorio(dirInstalacao)
  if (tipo === 'servidor') return { permitido: true, motivo: 'servidor' }
  if (tipo === 'cliente') return { permitido: false, motivo: 'instalacao_cliente' }
  return { permitido: false, motivo: 'instalacao_indefinida' }
}

function carregarToken(): string {
  const doEnv = (process.env.CATALOGO_RELAY_TOKEN || '').trim()
  if (doEnv) return doEnv
  const arquivo =
    process.env.CATALOGO_RELAY_TOKEN_FILE || join(getDataDir(), 'catalogo-relay.token')
  try {
    if (existsSync(arquivo)) return readFileSync(arquivo, 'utf8').trim()
  } catch { /* ignore */ }
  return ''
}

function tokenValido(fornecido: string | null, esperado: string): boolean {
  if (!fornecido || !esperado) return false
  const a = Buffer.from(fornecido, 'utf8')
  const b = Buffer.from(esperado, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function extrairBearer(req: IncomingMessage): string | null {
  const valor = req.headers[AUTORIZACAO]
  if (!valor) return null
  const v = Array.isArray(valor) ? valor[0] : valor
  const m = /^Bearer\s+(\S+)$/.exec(v || '')
  return m ? m[1] : null
}

function json(res: ServerResponse, status: number, corpo: unknown): void {
  const buf = Buffer.from(JSON.stringify(corpo), 'utf8')
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length })
  res.end(buf)
}

function erroGenerico(res: ServerResponse): void {
  json(res, 500, { error: 'catalogo_indisponivel' })
}

function detectarMime(buf: Buffer): string {
  if (buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return 'application/octet-stream'
}

async function lidar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    const fornecido = extrairBearer(req)
    if (!tokenValido(fornecido, TOKEN)) {
      json(res, 401, { error: 'nao_autorizado' })
      return
    }

    const partes = url.pathname.split('/').filter((p) => p !== '')
    const caminho = '/' + partes.join('/')

    if (req.method !== 'GET') {
      if (caminho === '/api/catalogo/publico' || /^\/api\/catalogo\/imagem\/[^/]+$/.test(caminho)) {
        res.writeHead(405, { 'Content-Length': 0 })
        res.end()
        return
      }
      json(res, 404, { error: 'nao_encontrado' })
      return
    }

    if (caminho === '/api/catalogo/publico' && partes.length === 3) {
      const dados = gerarCatalogoPublico()
      json(res, 200, dados)
      return
    }

    if (partes.length === 4 && partes[0] === 'api' && partes[1] === 'catalogo' && partes[2] === 'imagem') {
      const idTexto = partes[3]
      if (!/^[1-9]\d*$/.test(idTexto)) {
        json(res, 400, { error: 'id_invalido' })
        return
      }
      const db = getDb()
      const row = db.prepare(`SELECT imagem FROM produtos WHERE id = ?`).get(Number(idTexto)) as { imagem: Uint8Array | null } | undefined
      if (!row?.imagem || row.imagem.length === 0) {
        json(res, 404, { error: 'imagem_nao_encontrada' })
        return
      }
      const buf = Buffer.from(row.imagem)
      res.writeHead(200, { 'Content-Type': detectarMime(buf), 'Content-Length': buf.length })
      res.end(buf)
      return
    }

    json(res, 404, { error: 'nao_encontrado' })
  } catch {
    try { erroGenerico(res) } catch { /* ignore */ }
  }
}

let TOKEN = ''
let servidorApi: ReturnType<typeof createServer> | null = null
let encerrando = false

function encerrarApos(saidaLimpa: boolean): void {
  if (encerrando) {
    if (saidaLimpa) process.exit(0)
    return
  }
  encerrando = true
  // Rede de segurança: nunca deixar o processo vivo após pedir encerramento.
  setTimeout(() => process.exit(saidaLimpa ? 0 : 1), 1500)?.unref?.()
  if (servidorApi) {
    try {
      servidorApi.close(() => {
        if (saidaLimpa) process.exit(0)
      })
    } catch {
      if (saidaLimpa) process.exit(0)
    }
  } else if (saidaLimpa) {
    process.exit(0)
  }
}

/**
 * Fase 9C-1: quando rodando sob o supervisor (canal IPC), o réle avisa "pronto"
 * (após bind da porta), atende { tipo: 'encerrar' } e encerra sozinho quando o
 * processo supervisor morre ('disconnect') — nada de processos órfãos.
 * Os listeners são registrados sempre; sem canal IPC eles simplesmente nunca
 * disparam.
 */
function conectarIpcSupervisor(): void {
  process.on('message', (msg) => {
    if (msg && typeof msg === 'object' && (msg as { tipo?: string }).tipo === 'encerrar') {
      console.log('RELAY: encerrando a pedido do supervisor.')
      encerrarApos(true)
    }
  })
  process.on('disconnect', () => {
    console.log('RELAY: supervisor desconectado — encerrando sozinho.')
    encerrarApos(true)
  })
}

function notificarPronto(): void {
  try {
    if (typeof process.send === 'function') process.send({ tipo: 'pronto' })
  } catch { /* ignore */ }
}

function iniciar(): void {
  const permissao = decisaoPermissaoRelay()
  if (!permissao.permitido) {
    console.error(`RELAY: não iniciado (${permissao.motivo}). Réle é exclusivo de instalações SERVIDOR.`)
    process.exit(1)
  }

  TOKEN = carregarToken()
  const dbPath = getDefaultDbPath()
  if (!TOKEN) {
    console.error('RELAY: sem CATALOGO_RELAY_TOKEN configurado (env ou <dataDir>/catalogo-relay.token). Abortando.')
    process.exit(1)
  }
  initDb(dbPath)

  servidorApi = createServer(lidar)
  servidorApi.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`RELAY: porta ${PORTA} já está em uso. Não vou escolher outra porta — corrija e tente de novo.`)
    } else {
      console.error(`RELAY: erro ao iniciar: ${err.message}`)
    }
    process.exit(1)
  })
  servidorApi.listen(PORTA, HOST, () => {
    console.log(`RELAY PRONTO ${HOST}:${PORTA} (sqlite: ${dbPath})`)
    notificarPronto()
  })
  conectarIpcSupervisor()
}

// Só inicia quando executado diretamente (node out/server/server/relay.js).
// Via require() (testes) não há efeito colateral.
if (require.main === module) {
  iniciar()
}