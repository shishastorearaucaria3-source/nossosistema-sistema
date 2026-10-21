import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface ConexaoSupabase {
  id: string
  rotulo: string
  url: string
  serviceRoleKey: string
  empresaId: string
  ativa: boolean
}

// Chave onde a lista de conexões salvas do catálogo fica persistida no banco
// (tabela `config`). Isso permite configurar/recuperar as credenciais
// diretamente pelo Painel do Servidor, sem depender de arquivo `.env`.
const CHAVE_CONEXOES = 'catalogo_supabase_conexoes'

let cliente: SupabaseClient | null = null

// Acesso preguiçoso ao banco (evita dependência circular no load do módulo).
function getDatabase() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getDb } = require('./index') as { getDb: () => import('node:sqlite').DatabaseSync }
  return getDb()
}

function lerRaw(chave: string): string {
  try {
    const db = getDatabase()
    const r = db.prepare(`SELECT valor FROM config WHERE chave = ?`).get(chave) as { valor: string | null } | undefined
    return r?.valor ?? ''
  } catch { return '' }
}

function gravar(chave: string, valor: string): void {
  const db = getDatabase()
  db.prepare(`INSERT INTO config (chave, valor) VALUES (?, ?)
              ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`)
    .run(chave, valor)
}

// Lista de conexões salvas (configuração do painel). Ordenadas de forma estável.
export function carregarConexoesSupabase(): ConexaoSupabase[] {
  const raw = lerRaw(CHAVE_CONEXOES)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return (arr as ConexaoSupabase[]).filter((c) => c && typeof c === 'object' && typeof c.id === 'string')
  } catch {
    return []
  }
}

// A conexão marcada como ativa, se houver (com credenciais mínimas completas).
export function conexaoAtivaSupabase(): ConexaoSupabase | null {
  const lista = carregarConexoesSupabase()
  const ativa = lista.find((c) => c.ativa === true)
  if (ativa && ativa.url && ativa.serviceRoleKey && ativa.empresaId) return ativa
  return null
}

// Persiste a lista completa de conexões, garantindo no máximo uma ativa
// (mantém a primeira que estiver marcada; se nenhuma, marca a primeira).
export function salvarConexoesSupabase(lista: ConexaoSupabase[]): { ok: boolean; lista: ConexaoSupabase[] } {
  try {
    const limpa = (lista || []).filter((c) => c && typeof c.id === 'string')
    let jaAtivas = 0
    for (const c of limpa) {
      c.rotulo = (c.rotulo || '').trim()
      c.url = (c.url || '').trim().replace(/\/+$/, '')
      c.serviceRoleKey = (c.serviceRoleKey || '').trim()
      c.empresaId = (c.empresaId || '').trim()
      if (c.ativa) {
        jaAtivas++
        if (jaAtivas > 1) c.ativa = false
      }
    }
    if (jaAtivas === 0 && limpa.length > 0) limpa[0].ativa = true
    gravar(CHAVE_CONEXOES, JSON.stringify(limpa))
    resetClienteSupabase()
    return { ok: true, lista: limpa }
  } catch {
    return { ok: false, lista: carregarConexoesSupabase() }
  }
}

// Credenciais efetivas: conexão ativa salva tem prioridade; caso contrário usa
// o ambiente (variáveis de sistema / arquivo .env carregado na inicialização).
function credenciaisEfetivas(): { url: string; key: string; empresaId: string } {
  const ativa = conexaoAtivaSupabase()
  if (ativa) return { url: ativa.url, key: ativa.serviceRoleKey, empresaId: ativa.empresaId }
  return {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    empresaId: process.env.EMPRESA_ID || '',
  }
}

export function getSupabaseUrl(): string {
  return credenciaisEfetivas().url
}

export function getEmpresaId(): string {
  return credenciaisEfetivas().empresaId
}

export function getSupabase(): SupabaseClient {
  const cred = credenciaisEfetivas()
  if (!cred.url || !cred.key) throw new Error('SUPABASE URL/KEY não configurados')
  if (cliente) return cliente
  cliente = createClient(cred.url, cred.key, { auth: { persistSession: false } })
  return cliente
}

// Indicadores para o painel: quais credenciais estão disponíveis no momento.
export function statusCredenciaisSupabase(): {
  url: string
  empresaId: string
  temChave: boolean
  viaPainel: boolean
  configurado: boolean
} {
  const cred = credenciaisEfetivas()
  return {
    url: cred.url,
    empresaId: cred.empresaId,
    temChave: !!cred.key,
    viaPainel: !!conexaoAtivaSupabase(),
    configurado: !!(cred.url && cred.key && cred.empresaId),
  }
}

// Descarta o cliente em cache para que novas credenciais sejam aplicadas.
export function resetClienteSupabase(): void {
  cliente = null
}