/**
 * FASE A — Estrutura da homologação.
 *
 * Produz um snapshot CONSISTENTE do banco de produção (via VACUUM INTO, que só
 * LÊ o banco de origem — produção nunca é alterada) e registra a "chave de
 * circuito": hashes (SHA-256) dos arquivos de origem. Qualquer mudança nos
 * backups invalida o circuito (relatórios ficam marcados como desatualizados).
 *
 * Nenhuma função aqui escreve em produção. Todos os produtos deste módulo são
 * diretórios sob `homologacao/`.
 */
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getProducaoDbPath, getNxDir, getXlsDir, getHomologDir, getFiles } from './config'

export interface Circuito {
  ds: 'CIRCUITO_AUDITORIA_1'
  criado_em: string
  producao_db_sha256: string
  backups_sha256: Record<string, string>
}

export interface SnapshotHomologacao {
  dir: string
  dbPath: string
  estadoPath: string
  circuito: Circuito
}

export function sha256Arquivo(caminho: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const rs = createReadStream(caminho)
    rs.on('error', reject)
    rs.on('data', (c) => h.update(c))
    rs.on('end', () => resolve(h.digest('hex')))
  })
}

function dh(prefixo: string, caminho: string) {
  return new Promise<string>((resolve, reject) => {
    const h = createHash('sha256')
    const rs = createReadStream(caminho)
    rs.on('error', () => resolve(prefixo + ':INDISPONIVEL'))
    rs.on('data', (c) => h.update(c))
    rs.on('end', () => resolve(h.digest('hex')))
  })
}

function tsRotulo(): string {
  const d = new Date()
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function montarCircuito(): Promise<Circuito> {
  const backups: Record<string, string> = {}
  const nx = getNxDir()
  for (const f of getFiles()) {
    backups['nx:' + f] = await dh('nx:' + f, join(nx, f))
  }
  const xlsDir = getXlsDir()
  if (existsSync(xlsDir)) {
    const { readdirSync } = await import('node:fs')
    for (const f of readdirSync(xlsDir).filter((x) => /\.xls$/i.test(x) || /\.xlsx$/i.test(x))) {
      backups['xls:' + f] = await dh('xls:' + f, join(xlsDir, f))
    }
  }
  backupFiles = backups
  return {
    ds: 'CIRCUITO_AUDITORIA_1',
    criado_em: new Date().toISOString(),
    producao_db_sha256: await sha256Arquivo(getProducaoDbPath()),
    backups_sha256: backups,
  }
}
let backupFiles: Record<string, string>

export function getCircuitoCache(): Record<string, string> {
  return backupFiles || {}
}

/**
 * Cria snapshot do banco de produção (leitura) e chave de circuito.
 * Não sobrescreve snapshots existentes — cada execução gera novo diretório.
 */
export async function criarSnapshotHomologacao(rotulo = 'recon'): Promise<SnapshotHomologacao> {
  const base = join(getHomologDir(), `snap-${tsRotulo()}-${rotulo}`)
  mkdirSync(base, { recursive: true })
  const dbPath = join(base, 'tabacaria.sqlite')
  const origem = getProducaoDbPath()
  const origemAbs = origem.replace(/'/g, "''")
  const leitura = new DatabaseSync(origem, { readOnly: true })
  try {
    leitura.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`)
  } finally {
    leitura.close()
  }
  const circuito = await montarCircuito()
  const estadoPath = join(base, 'homologacao.json')
  const estado = {
    ...circuito,
    snapshot: { origem, criado_por_snapshot: new Date().toISOString(), bytes: statSync(dbPath).size },
    passos: [] as string[],
  }
  writeFileSync(estadoPath, JSON.stringify(estado, null, 2), 'utf-8')
  return { dir: base, dbPath, estadoPath, circuito }
}

export function lerEstado(snapshot: SnapshotHomologacao) {
  try {
    return JSON.parse(readFileSync(snapshot.estadoPath, 'utf-8'))
  } catch {
    return null
  }
}

export function registrarPasso(snapshot: SnapshotHomologacao, passo: string) {
  const state = lerEstado(snapshot) || {}
  state.passos = Array.isArray(state.passos) ? state.passos : []
  state.passos.push(passo)
  state.ultimo_passo_em = new Date().toISOString()
  writeFileSync(snapshot.estadoPath, JSON.stringify(state, null, 2), 'utf-8')
}

export function abrirBancoHomolog(snapshot: SnapshotHomologacao): DatabaseSync {
  return new DatabaseSync(snapshot.dbPath)
}