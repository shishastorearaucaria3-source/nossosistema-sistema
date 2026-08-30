export type SqlValue = null | number | bigint | string

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getDataDir } from '../shared/data-dir'
import { networkInterfaces } from 'node:os'

let baseUrl = process.env.TABACARIA_SERVIDOR || ''

function caminhoBase(): string {
  return getDataDir()
}

function caminhoArquivoPorta(): string {
  return join(caminhoBase(), 'servidor.porta')
}

function caminhoArquivoUrl(): string {
  return join(caminhoBase(), 'servidor.url')
}

// SessÃ£o de login do terminal (obtida via /api/auth/login). Toda requisiÃ§Ã£o ao
// servidor envia o token de sessÃ£o â€” o terminal NÃƒO possui nem gerencia API Key.
let sessaoToken = ''

export function definirSessao(token: string): void {
  sessaoToken = String(token ?? '').trim()
}

export function getSessaoToken(): string {
  return sessaoToken
}

export function limparSessao(): void {
  sessaoToken = ''
}

export function lerPortaGravada(): number {
  try {
    const f = caminhoArquivoPorta()
    if (!existsSync(f)) return 0
    const n = Number(readFileSync(f, 'utf8'))
    return Number.isInteger(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function lerUrlGravada(): string {
  try {
    const f = caminhoArquivoUrl()
    if (!existsSync(f)) return ''
    return readFileSync(f, 'utf8').trim()
  } catch {
    return ''
  }
}

export function configurarServidor(url: string): void {
  baseUrl = url.replace(/\/$/, '')
}

export function getServidorUrl(): string {
  if (baseUrl) return baseUrl
  const gravada = lerUrlGravada()
  if (gravada) return gravada
  const porta = lerPortaGravada() || 3210
  return `http://localhost:${porta}`
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

export function obterIpsRede(): string[] {
  const ips: string[] = []
  try {
    for (const infos of Object.values(networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.family !== 'IPv4' || info.internal) continue
        if (!ehLinkLocal(info.address)) ips.push(info.address)
      }
    }
  } catch { /* ignore */ }
  // IPs privados (rede local) primeiro, depois os demais
  return [...ips.filter(ehIpPrivado), ...ips.filter((ip) => !ehIpPrivado(ip))]
}

export function configurarConexaoServidor(opcoes: { local?: boolean; ip?: string; url?: string }): { ok: boolean; url: string; ips: string[] } {
  const ips = obterIpsRede()
  let url: string
  if (opcoes.local) {
    url = `http://localhost:${lerPortaGravada() || 3210}`
  } else if (opcoes.url) {
    // URL completa informada pelo usuÃ¡rio (host e porta explÃ­citos)
    url = opcoes.url.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  } else {
    const ip = (opcoes.ip || ips.find(ehIpPrivado) || ips[0] || 'localhost').replace(/^http:\/\//, '').replace(/\/.*$/, '')
    url = `http://${ip}:${lerPortaGravada() || 3210}`
  }
  try {
    mkdirSync(caminhoBase(), { recursive: true })
    writeFileSync(caminhoArquivoUrl(), url, 'utf8')
  } catch { /* ignore */ }
  configurarServidor(url)
  return { ok: true, url, ips }
}

export async function testarServidor(): Promise<{ ok: boolean; url: string; erro?: string }> {
  const url = getServidorUrl()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    // /api/ping é público dentro da LAN — permite testar conexão antes do login.
    const res = await fetch(`${url}/api/ping`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (res.ok) return { ok: true, url }
    return { ok: false, url, erro: `Servidor respondeu com status ${res.status}` }
  } catch (e) {
    return { ok: false, url, erro: 'Não foi possível conectar ao servidor.' }
  }
}

// Descoberta automática do servidor na LAN. Varre os IPs da mesma subnet do
// terminal (e o próprio localhost) tentando /api/ping na porta padrão/gravada.
// O terminal NÃO precisa digitar IP nem chave — encontra o servidor sozinho.
export async function descobrirServidor(): Promise<{ servidores: string[]; porta: number }> {
  const porta = lerPortaGravada() || 3210
  const candidatos = new Set<string>()

  // Loopback (o próprio computador pode ser o servidor)
  candidatos.add(`http://localhost:${porta}`)

  // IPs da rede local: expande cada IP privado para a subnet /24
  for (const ip of obterIpsRede()) {
    const partes = ip.split('.')
    if (partes.length !== 4) continue
    const base = partes.slice(0, 3).join('.')
    // Varre .1 a .254 com timeout curto — não varre o próprio IP (já tentado via localhost)
    const local = ip
    for (let i = 1; i <= 254; i++) {
      const cand = `${base}.${i}`
      if (cand === local) continue
      candidatos.add(`http://${cand}:${porta}`)
    }
  }

  const servidores: string[] = []
  const TAMANHO_LOTE = 32
  const lista = [...candidatos]
  for (let lote = 0; lote < lista.length; lote += TAMANHO_LOTE) {
    const fatia = lista.slice(lote, lote + TAMANHO_LOTE)
    const resultados = await Promise.allSettled(
      fatia.map(async (url) => {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 700)
        try {
          const res = await fetch(`${url}/api/ping`, { signal: ctrl.signal })
          clearTimeout(timer)
          if (res.ok) return url
          return null
        } catch {
          clearTimeout(timer)
          return null
        }
      })
    )
    for (const r of resultados) {
      if (r.status === 'fulfilled' && r.value) servidores.push(r.value)
    }
    if (servidores.length > 0) break
  }

return { servidores, porta }
}

// Headers padrão de toda requisição ao servidor — inclui o token de sessão do
// terminal (obtido no login). O terminal nunca envia API Key.
function headersComSessao(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  if (sessaoToken) h['X-Sessao-Token'] = sessaoToken
  return h
}

async function post<T>(caminho: string, corpo: unknown): Promise<T> {
  const res = await fetch(`${getServidorUrl()}${caminho}`, {
    method: 'POST',
    headers: headersComSessao(),
    body: JSON.stringify(corpo)
  })
  if (!res.ok) {
    const texto = await res.text()
    throw new Error(`Servidor ${caminho}: HTTP ${res.status} ${texto.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export const servidorClient = {
  all: (sql: string, params: unknown[] = []) => post<unknown[]>('/api/db/all', { sql, params }),
  get: (sql: string, params: unknown[] = []) => post<unknown>('/api/db/get', { sql, params }),
  run: (sql: string, params: unknown[] = []) =>
    post<{ changes: number; lastInsertRowid: number }>('/api/db/run', { sql, params }),
  exec: (sql: string) => post<{ ok: boolean }>('/api/db/exec', { sql }),
authLogin: async (login: string, senha: string) => {
    const res = await post<{ ok: boolean; erro?: string; usuario?: { id: number; nome: string; login: string; perfil: string; comissao_percent: number }; token?: string }>(
      '/api/auth/login',
      { login, senha }
    )
    // Guarda o token de sessão para as próximas requisições (sem API Key manual).
    if (res.ok && res.token) definirSessao(res.token)
    return res
  },
  authLogout: () => post<{ ok: boolean }>('/api/auth/logout', {}).then((r) => { limparSessao(); return r }).catch(() => { limparSessao(); return { ok: true } }),
  authUsuarios: () => fetch(`${getServidorUrl()}/api/auth/usuarios`, { headers: headersComSessao() }).then((r) => r.json() as Promise<{ id: number; nome: string; login: string; perfil: string }[]>),
  authCriarUsuario: (dados: { nome: string; login: string; senha: string; perfil: string; comissao: number }) =>
    post<{ ok: boolean; id: number }>('/api/auth/criarUsuario', dados),
  authAlterarSenha: (usuarioId: number, novaSenha: string) =>
    post<{ ok: boolean }>('/api/auth/alterarSenha', { usuarioId, novaSenha }),
  authAtualizarUsuario: (dados: { usuarioId: number; nome: string; login: string; perfil: string; comissao: number; senha?: string }) =>
    post<{ ok: boolean }>('/api/auth/atualizarUsuario', dados),
  authAtualizarOpcoes: (dados: { usuarioId: number; usar_web: boolean; usar_app: boolean; limitar_desconto: boolean; desconto_max_percent: number }) =>
    post<{ ok: boolean }>('/api/auth/atualizarOpcoes', dados),
  authAtualizarPermissoes: (dados: { usuarioId: number; modulos: string[] }) =>
    post<{ ok: boolean }>('/api/auth/atualizarPermissoes', dados),
  authAtivarDesativar: (dados: { usuarioId: number; ativo: boolean }) =>
    post<{ ok: boolean }>('/api/auth/ativarDesativar', dados),
  authDeletar: (dados: { usuarioId: number }) =>
    post<{ ok: boolean }>('/api/auth/deletar', dados),
  imagemGet: (produtoId: number) => fetch(`${getServidorUrl()}/api/imagem/${produtoId}`, { headers: headersComSessao() }).then((r) => r.json() as Promise<string | null>),
  imagemList: () => fetch(`${getServidorUrl()}/api/imagem/list`, { headers: headersComSessao() }).then((r) => r.json() as Promise<Record<number, string>>),
  imagemListPorIds: (ids: number[]) => post<Record<number, string>>('/api/imagem/listPorIds', { ids }),
  imagemDefinir: (produtoId: number, base64: string) => post<{ ok: boolean }>('/api/imagem/definir', { produtoId, base64 }),
  imagemRemover: (produtoId: number) => post<{ ok: boolean }>('/api/imagem/remover', { produtoId }),
  backup: () => post<{ ok: boolean; arquivo: string }>('/api/backup', {}),
catalogoGetExibicao: () => fetch(`${getServidorUrl()}/api/catalogo/exibicao`, { headers: headersComSessao() }).then((r) => r.json() as Promise<unknown>),
  catalogoSalvarExibicao: (dados: Record<string, unknown>) => post<{ ok: boolean; exibicao: unknown }>('/api/catalogo/exibicao', dados),
  servidorStatus: () => fetch(`${getServidorUrl()}/api/servidor/status`, { headers: headersComSessao() }).then((r) => r.json() as Promise<Record<string, unknown>>),
  servidorLogs: () => fetch(`${getServidorUrl()}/api/servidor/logs`, { headers: headersComSessao() }).then((r) => r.json() as Promise<{ ok: boolean; logs: { hora: string; nivel: string; msg: string }[] }>),
  servidorLimparLogs: () => post<{ ok: boolean }>('/api/servidor/logs/limpar', {}),
  servidorBackupInfo: () => fetch(`${getServidorUrl()}/api/servidor/backup/info`, { headers: headersComSessao() }).then((r) => r.json() as Promise<{ ok: boolean; dir: string; backups: { nome: string; data: string; tamanho: number }[] }>),
  servidorDiagnostico: () => post<{ ok: boolean; itens: { nome: string; status: string; detalhe: string }[] }>('/api/servidor/diagnostico', {}),
  servidorCorrigir: () => post<{ ok: boolean; correcoes: string[] }>('/api/servidor/corrigir', {}),
  servidorZerar: (alvos: string[]) => post<{ ok: boolean; removidos: string[]; erro?: string }>('/api/servidor/zerar', { alvos, confirmar: true }),
  servidorRestaurar: (arquivo: string) => post<{ ok: boolean; erro?: string }>('/api/servidor/restaurar', { arquivo }),
  estoqueMovimentar: (dados: Record<string, unknown>) =>
    post<{ ok: boolean; documento: string; total: number; itens: number; tipo: string; categoria: string; erro?: string }>(
      '/api/estoque/movimentar',
      dados
    ),
  estoqueInventarioAbrir: (dados: { produtos: number[]; usuario_id?: number | null; observacao?: string | null }) =>
    post<{ ok: boolean; inventario_id: number; numero: string; itens: number; erro?: string }>('/api/estoque/inventario/abrir', dados),
  estoqueInventarioFinalizar: (dados: { inventario_id: number; usuario_id?: number | null }) =>
    post<{ ok: boolean; inventario_id: number; numero: string; divergencias: number; ajustados: number; conferidos: number; erro?: string }>(
      '/api/estoque/inventario/finalizar',
      dados
    ),
  estoqueInventarioCancelar: (dados: { inventario_id: number }) =>
    post<{ ok: boolean; erro?: string }>('/api/estoque/inventario/cancelar', dados),
  // Lote transacional (venda, cancelamentos â€” atomicidade garantida no servidor)
  dbTransacao: (statements: { sql: string; params?: unknown[] }[]) =>
    post<{ ok: boolean; resultados: { changes: number; lastInsertRowid: number }[]; indice?: number; erro?: string }>(
      '/api/db/transacao',
      { statements }
    ),
  vendasCancelar: (vendaId: number, usuarioId: number) =>
    post<{ ok: boolean; numero: string; itens_devolvidos: number; erro?: string }>('/api/vendas/cancelar', {
      venda_id: vendaId,
      usuario_id: usuarioId
    }),
  vendasFinalizar: (dados: {
    itens: { produto_id: number; nome: string; quantidade: number; preco_unitario: number; desconto?: number; observacao?: string | null }[]
    pagamentos: { forma: string; valor: number }[]
    subtotal: number
    desconto: number
    total: number
    vendedor_id?: number | null
    caixa_id?: number | null
    usuario_id?: number | null
  }) =>
    post<{ ok: boolean; numero: string; venda_id: number; erro?: string; codigo?: string }>('/api/vendas/finalizar', dados),
  pedidosCancelar: (pedidoId: number, usuarioId: number) =>
    post<{ ok: boolean; estoque_devolvido: boolean; erro?: string }>('/api/pedidos/cancelar', {
      pedido_id: pedidoId,
      usuario_id: usuarioId
    }),
  apiKeyGet: () => fetch(`${getServidorUrl()}/api/servidor/apikey`, { headers: headersComSessao() }).then((r) => r.json() as Promise<{ ok: boolean; api_key: string }>),
  apiKeyRegenerar: () => post<{ ok: boolean; api_key: string }>('/api/servidor/apikey/regenerar', {}),
  // WhatsApp panel proxy (authenticated via the NossoSistema session)
  whatsapp: {
    get: (path: string) =>
      fetch(`${getServidorUrl()}/api/whatsapp${path}`, {
        headers: headersComSessao()
      }).then((r) => r.json()),
    post: (path: string, body: unknown) =>
      fetch(`${getServidorUrl()}/api/whatsapp${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersComSessao() },
        body: JSON.stringify(body)
      }).then((r) => r.json()),
  },
  whatsappStatus: () => fetch(`${getServidorUrl()}/api/servidor/whatsapp`, { headers: headersComSessao() }).then((r) => r.json() as Promise<{ ok: boolean; running: boolean; configured: boolean }>)
}

