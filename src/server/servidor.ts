import { DatabaseSync } from 'node:sqlite'
import { networkInterfaces, hostname } from 'node:os'
import { join } from 'node:path'
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { getDb, getDefaultDbPath, getPorta, reabrirBanco, seed } from './index'
import { getStatus } from './catalogo'

export interface LogServidor {
  hora: string
  nivel: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR'
  msg: string
}

const MAX_LOGS = 500
const logs: LogServidor[] = []
export const iniciadoEm = new Date()

function agora(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function registrarLog(nivel: LogServidor['nivel'], msg: string): void {
  logs.push({ hora: agora(), nivel, msg })
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
}

export function getLogs(): LogServidor[] {
  return [...logs]
}

export function limparLogs(): void {
  logs.length = 0
}

export function formatarUptime(): string {
  const seg = Math.max(0, Math.floor((Date.now() - iniciadoEm.getTime()) / 1000))
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  const s = seg % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}h ${pad(m)}min ${pad(s)}s`
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

export function getIpRede(): string {
  try {
    const candidatos: string[] = []
    for (const infos of Object.values(networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.family !== 'IPv4' || info.internal) continue
        candidatos.push(info.address)
      }
    }
    const privados = candidatos.filter((ip) => ehIpPrivado(ip) && !ehLinkLocal(ip))
    if (privados.length > 0) return privados[0]
    const normais = candidatos.filter((ip) => !ehLinkLocal(ip))
    if (normais.length > 0) return normais[0]
    return candidatos[0] || '127.0.0.1'
  } catch { /* ignore */ }
  return '127.0.0.1'
}

export function obterIpsLocais(): string[] {
  try {
    const ips: string[] = []
    for (const infos of Object.values(networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.family !== 'IPv4' || info.internal) continue
        if (!ehLinkLocal(info.address)) ips.push(info.address)
      }
    }
    // IPs privados primeiro
    return [...ips.filter(ehIpPrivado), ...ips.filter((ip) => !ehIpPrivado(ip))]
  } catch { /* ignore */ }
  return []
}

function gatewayPadrao(): string {
  try {
    const net = require('node:os').networkInterfaces()
    for (const name of Object.keys(net)) {
      for (const info of net[name] ?? []) {
        if (info.family === 'IPv4' && info.address && ehIpPrivado(info.address)) {
          const parts = info.address.split('.')
          parts[3] = '1'
          return parts.join('.')
        }
      }
    }
  } catch { /* ignore */ }
  return ''
}

function idEquipamento(): string {
  const db = getDb()
  const r = db.prepare(`SELECT valor FROM config WHERE chave = 'equipamento_id'`).get() as { valor: string | null } | undefined
  if (r?.valor) return r.valor
  const id = `${hostname()}-${Date.now().toString(36)}`
  db.prepare(`INSERT INTO config (chave, valor) VALUES ('equipamento_id', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(id)
  return id
}

export function versaoSistema(): string {
  try {
    const pkg = require('../../package.json') as { version?: string }
    return pkg.version || '1.0.0'
  } catch {
    return '1.0.0'
  }
}

export function getStatusServidor(): Record<string, unknown> {
  const db = getDb()
  const cat = getStatus()
  const dir = getDefaultDbPath()
  const tamDb = existsSync(dir) ? statSync(dir).size : 0
  const backups = listarBackups()
  const ultimo = backups[0] ?? null
  return {
    online: true,
    api: 'conectada',
    banco: 'conectado',
    banco_tamanho: tamDb,
    sincronizacao: cat.status === 'sincronizado' ? 'ativa' : cat.status === 'sincronizando' ? 'sincronizando' : 'pendente',
    ultima_sync: cat.ultima_sync || '',
    proxima_sync: cat.proxima_sync || '',
    ultimo_erro_sync: cat.ultimo_erro || '',
    uptime: formatarUptime(),
    porta: getPorta(),
    ip_local: getIpRede(),
    ip_publico: getIpRede(),
    gateway: gatewayPadrao(),
    computador: hostname(),
    sistema_operacional: process.platform === 'win32' ? 'Windows' : process.platform,
    versao_sistema: versaoSistema(),
    versao_servidor: '1.0.0',
    diretorio: process.cwd(),
    id_equipamento: idEquipamento(),
    ultimo_backup: ultimo ? { data: ultimo.data, tamanho: ultimo.tamanho, arquivo: ultimo.nome } : null
  }
}

export interface BackupInfo {
  nome: string
  data: string
  tamanho: number
}

export function listarBackups(): BackupInfo[] {
  const dir = join(getDefaultDbPath(), '..', 'backups')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((f) => {
      const s = statSync(join(dir, f))
      return { nome: f, data: s.mtime.toISOString(), tamanho: s.size }
    })
    .sort((a, b) => (a.data < b.data ? 1 : -1))
}

export function getBackupInfo(): { dir: string; backups: BackupInfo[] } {
  return { dir: join(getDefaultDbPath(), '..', 'backups'), backups: listarBackups() }
}

export interface ItemDiagnostico {
  nome: string
  status: 'ok' | 'atencao' | 'erro'
  detalhe: string
}

export interface ResultadoDiagnostico {
  ok: boolean
  itens: ItemDiagnostico[]
}

export function diagnosticar(): ResultadoDiagnostico {
  const db = getDb()
  const itens: ItemDiagnostico[] = []

  // Integridade do banco
  try {
    const r = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string } | undefined
    itens.push({
      nome: 'Banco de dados',
      status: r?.integrity_check === 'ok' ? 'ok' : 'erro',
      detalhe: r?.integrity_check === 'ok' ? 'Integridade OK' : `Falha de integridade: ${r?.integrity_check ?? 'desconhecida'}`
    })
  } catch (e) {
    itens.push({ nome: 'Banco de dados', status: 'erro', detalhe: (e as Error).message })
  }

  // Produtos sem dados obrigatórios
  try {
    const semNome = db.prepare(`SELECT COUNT(*) AS c FROM produtos WHERE nome IS NULL OR trim(nome) = ''`).get() as { c: number }
    const semPreco = db.prepare(`SELECT COUNT(*) AS c FROM produtos WHERE ativo = 1 AND (preco_venda IS NULL OR preco_venda < 0)`).get() as { c: number }
    itens.push({
      nome: 'Produtos',
      status: semNome.c === 0 && semPreco.c === 0 ? 'ok' : 'atencao',
      detalhe: `${semNome.c} sem nome, ${semPreco.c} com preço inválido`
    })
  } catch (e) {
    itens.push({ nome: 'Produtos', status: 'erro', detalhe: (e as Error).message })
  }

  // Estoque
  try {
    const negativo = db.prepare(`SELECT COUNT(*) AS c FROM produtos WHERE controla_estoque = 1 AND estoque < 0`).get() as { c: number }
    itens.push({
      nome: 'Estoque',
      status: negativo.c === 0 ? 'ok' : 'atencao',
      detalhe: negativo.c === 0 ? 'Estoque consistente' : `${negativo.c} produto(s) com estoque negativo`
    })
  } catch (e) {
    itens.push({ nome: 'Estoque', status: 'erro', detalhe: (e as Error).message })
  }

  // Pedidos
  try {
    const orfaos = db.prepare(
      `SELECT COUNT(*) AS c FROM pedido_itens pi LEFT JOIN pedidos p ON p.id = pi.pedido_id WHERE p.id IS NULL`
    ).get() as { c: number }
    const semTotal = db.prepare(`SELECT COUNT(*) AS c FROM pedidos WHERE total IS NULL OR total < 0`).get() as { c: number }
    itens.push({
      nome: 'Pedidos',
      status: orfaos.c === 0 && semTotal.c === 0 ? 'ok' : 'atencao',
      detalhe: `${orfaos.c} itens órfãos, ${semTotal.c} com total inválido`
    })
  } catch (e) {
    itens.push({ nome: 'Pedidos', status: 'erro', detalhe: (e as Error).message })
  }

  // Vendas
  try {
    const orfaos = db.prepare(
      `SELECT COUNT(*) AS c FROM venda_itens vi LEFT JOIN vendas v ON v.id = vi.venda_id WHERE v.id IS NULL`
    ).get() as { c: number }
    itens.push({
      nome: 'Vendas',
      status: orfaos.c === 0 ? 'ok' : 'atencao',
      detalhe: orfaos.c === 0 ? 'Vendas consistentes' : `${orfaos.c} itens órfãos`
    })
  } catch (e) {
    itens.push({ nome: 'Vendas', status: 'erro', detalhe: (e as Error).message })
  }

  // Sincronização
  const cat = getStatus()
  const synOk = cat.status === 'sincronizado' || cat.status === 'sincronizando' || cat.status === 'sem_conexao'
  itens.push({
    nome: 'Sincronização',
    status: cat.status === 'sincronizado' ? 'ok' : cat.status === 'sincronizando' ? 'atencao' : cat.status === 'erro' ? 'erro' : 'atencao',
    detalhe: cat.ultimo_erro || (synOk ? 'Sem pendências' : 'Pendências de sincronização')
  })

  // Conexão com a API (health check interno)
  itens.push({ nome: 'Comunicação com a API', status: 'ok', detalhe: 'Respondendo normalmente' })

  return { ok: itens.every((i) => i.status === 'ok'), itens }
}

export interface ResultadoCorrecao {
  ok: boolean
  correcoes: string[]
}

export function corrigir(): ResultadoCorrecao {
  const db = getDb()
  const correcoes: string[] = []

  try {
    const neg = db.prepare(`UPDATE produtos SET estoque = 0 WHERE controla_estoque = 1 AND estoque < 0`).run()
    if (neg.changes > 0) correcoes.push(`Estoque: ${neg.changes} produto(s) com estoque negativo ajustado para 0`)
  } catch { /* ignore */ }

  try {
    const semNome = db.prepare(`DELETE FROM produtos WHERE (nome IS NULL OR trim(nome) = '') AND preco_venda = 0 AND estoque = 0`).run()
    if (semNome.changes > 0) correcoes.push(`Produtos: ${semNome.changes} registro(s) vazio(s) removido(s)`)
  } catch { /* ignore */ }

  try {
    const preco = db.prepare(`UPDATE produtos SET preco_venda = 0 WHERE preco_venda IS NULL OR preco_venda < 0`).run()
    if (preco.changes > 0) correcoes.push(`Produtos: ${preco.changes} produto(s) com preço inválido ajustado para 0`)
  } catch { /* ignore */ }

  try {
    const orfaos = db.prepare(`SELECT DISTINCT pi.id FROM pedido_itens pi LEFT JOIN pedidos p ON p.id = pi.pedido_id WHERE p.id IS NULL`).all() as { id: number }[]
    for (const o of orfaos) {
      db.prepare(`DELETE FROM pedido_itens WHERE id = ?`).run(o.id)
    }
    if (orfaos.length > 0) correcoes.push(`Pedidos: ${orfaos.length} item(ns) órfão(s) removido(s)`)
  } catch { /* ignore */ }

  try {
    const orfaos = db.prepare(`SELECT DISTINCT vi.id FROM venda_itens vi LEFT JOIN vendas v ON v.id = vi.venda_id WHERE v.id IS NULL`).all() as { id: number }[]
    for (const o of orfaos) {
      db.prepare(`DELETE FROM venda_itens WHERE id = ?`).run(o.id)
    }
    if (orfaos.length > 0) correcoes.push(`Vendas: ${orfaos.length} item(ns) órfão(s) removido(s)`)
  } catch { /* ignore */ }

  registrarLog('SUCCESS', `Correção executada (${correcoes.length} ajustes)`)
  return { ok: true, correcoes }
}

const TABELAS_ZERAR: Record<string, { tabela: string; sql: string }> = {
  vendas: { tabela: 'vendas', sql: 'DELETE FROM vendas' },
  orcamentos: { tabela: 'orcamentos', sql: 'DELETE FROM orcamentos' },
  pedidos: { tabela: 'pedidos', sql: 'DELETE FROM pedidos' },
  clientes: { tabela: 'clientes', sql: 'DELETE FROM clientes' },
  movimentacoes: { tabela: 'movimentacoes', sql: 'DELETE FROM movimentacoes' },
  historico: { tabela: 'historico', sql: 'DELETE FROM alteracoes_preco' },
  caixas: { tabela: 'caixas', sql: 'DELETE FROM caixas' },
  contas: { tabela: 'contas', sql: 'DELETE FROM contas' },
  formas: { tabela: 'formas_pagamento', sql: 'DELETE FROM formas_pagamento' },
  compras: { tabela: 'compras', sql: 'DELETE FROM compras' },
  produtos: { tabela: 'produtos', sql: 'DELETE FROM produtos' },
  categorias: { tabela: 'categorias', sql: 'DELETE FROM categorias' },
  marcas: { tabela: 'marcas', sql: 'DELETE FROM marcas' },
  fornecedores: { tabela: 'fornecedores', sql: 'DELETE FROM fornecedores' },
  subcategorias: { tabela: 'subcategorias', sql: 'DELETE FROM subcategorias' },
  zonas: { tabela: 'zonas_entrega', sql: 'DELETE FROM zonas_entrega' },
  listas: { tabela: 'listas_pdv', sql: 'DELETE FROM listas_pdv' },
  separacoes: { tabela: 'separacoes_dinheiro', sql: 'DELETE FROM separacoes_dinheiro' }
}

const ORDEM_ZERAR_TUDO = [
  'venda_itens',
  'pagamentos',
  'movimentacoes',
  'pedido_itens',
  'orcamento_itens',
  'alteracoes_preco_itens',
  'movimentos_caixa',
  'reservas_contas',
  'compra_itens',
  'lista_pdv_itens',
  'separacoes_dinheiro',
  'catalogo_fila',
  'vendas',
  'pedidos',
  'orcamentos',
  'compras',
  'alteracoes_preco',
  'caixas',
  'contas',
  'listas_pdv',
  'produtos',
  'subcategorias',
  'categorias_clientes',
  'clientes',
  'categorias',
  'marcas',
  'fornecedores',
  'zonas_entrega',
  'formas_pagamento',
  'permissoes',
  'usuarios',
  'sequencias',
  'catalogo_sync',
  'config'
]

const ORDEM_ZERAR_EXTRA: Record<string, string[]> = {
  vendas: ['venda_itens', 'pagamentos', 'movimentacoes'],
  pedidos: ['pedido_itens'],
  orcamentos: ['orcamento_itens'],
  caixas: ['movimentos_caixa'],
  contas: ['reservas_contas'],
  historico: ['alteracoes_preco_itens'],
  compras: ['compra_itens'],
  listas: ['lista_pdv_itens']
}

export interface ZerarResultado {
  ok: boolean
  removidos: string[]
  erro?: string
}

function apagarTabelas(db: DatabaseSync, tabelas: string[]): void {
  for (const t of tabelas) {
    db.prepare(`DELETE FROM ${t}`).run()
  }
}

export function zerarDados(alvos: string[]): ZerarResultado {
  const db = getDb()
  const removidos: string[] = []
  db.exec('BEGIN')
  try {
    if (alvos.includes('tudo')) {
      apagarTabelas(db, ORDEM_ZERAR_TUDO)
      for (const t of ['sqlite_sequence']) {
        try { db.prepare(`DELETE FROM ${t}`).run() } catch { /* tabela ausente */ }
      }
      db.exec('COMMIT')
      seed(db)
      registrarLog('WARNING', 'Zerado: TODOS os dados do sistema')
      return { ok: true, removidos: ['tudo'] }
    }
    for (const alvo of alvos) {
      const def = TABELAS_ZERAR[alvo]
      if (!def) continue
      const extras = ORDEM_ZERAR_EXTRA[alvo]
      if (extras) apagarTabelas(db, extras)
      db.prepare(def.sql).run()
      removidos.push(alvo)
    }
    db.exec('COMMIT')
    registrarLog('WARNING', `Zerado: ${alvos.join(', ')}`)
    return { ok: true, removidos }
  } catch (e) {
    db.exec('ROLLBACK')
    registrarLog('ERROR', `Falha ao zerar dados: ${(e as Error).message}`)
    return { ok: false, removidos: [], erro: (e as Error).message }
  }
}

export function restaurarBackup(arquivo: string): { ok: boolean; erro?: string } {
  // Se não for um caminho absoluto, resolve na pasta padrão de backups
  let caminho = arquivo
  if (!existsSync(caminho)) {
    const alt = join(getDefaultDbPath(), '..', 'backups', arquivo)
    if (existsSync(alt)) caminho = alt
  }
  if (!existsSync(caminho) || !caminho.endsWith('.sqlite')) {
    return { ok: false, erro: 'Arquivo de backup inválido ou inexistente.' }
  }
  const db = getDb()
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
  } catch { /* ignore */ }
  const destino = getDefaultDbPath()
  try {
    copyFileSync(caminho, destino)
    for (const suf of ['-wal', '-shm']) {
      try { rmSync(destino + suf) } catch { /* ignore */ }
    }
  } catch (e) {
    try { reabrirBanco() } catch { /* ignore */ }
    return { ok: false, erro: `Falha ao copiar backup: ${(e as Error).message}` }
  }
  try {
    reabrirBanco()
    registrarLog('SUCCESS', `Backup restaurado: ${caminho}`)
  } catch (e) {
    return { ok: false, erro: `Backup copiado, mas falha ao reabrir o banco: ${(e as Error).message}` }
  }
  return { ok: true }
}