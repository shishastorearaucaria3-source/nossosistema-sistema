import type { CatalogoPublicoV1, PedidoOnlineEnvio, ResultadoPedidoOnline } from '../types'
import { apiConfigurada, urlApi } from '../config'
import { MOCK_CATALOGO } from '../mock/dados'

export type OrigemDados = 'api' | 'mock' | 'erro'

export interface ResultadoCatalogo {
  dados: CatalogoPublicoV1 | null
  origem: OrigemDados
}

// Cache em memória: uma única chamada à API por sessão de navegador.
let cacheCatalogo: CatalogoPublicoV1 | null = null

export async function obterCatalogo(forcar = false): Promise<ResultadoCatalogo> {
  if (!forcar && cacheCatalogo) return { dados: cacheCatalogo, origem: 'api' }
  // Produção sem API configurada (ou apontando p/ rede local): nunca usar mock.
  if (!import.meta.env.DEV && !apiConfigurada()) {
    return { dados: null, origem: 'erro' }
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    let res: Response
    try {
      res = await fetch(urlApi('/api/catalogo/publico'), { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const dados = (await res.json()) as CatalogoPublicoV1
    cacheCatalogo = dados
    return { dados, origem: 'api' }
  } catch {
    // Em desenvolvimento (vite dev) sem o servidor local ligado, cai no mock
    // fiel ao JSON da Fase 1. Em produção, nunca usar mock: reporta erro.
    if (import.meta.env.DEV) return { dados: MOCK_CATALOGO, origem: 'mock' }
    return { dados: null, origem: 'erro' }
  }
}

// Envia um pedido do catálogo para o Worker (persistido em D1). Em caso de
// falha (fora do ar, sem API configurada, validação) retorna erro — o checkout
// decide usar fallback por WhatsApp. O total é SEMPRE recalculado no backend.
export async function criarPedidoOnline(dados: PedidoOnlineEnvio): Promise<ResultadoPedidoOnline> {
  if (!import.meta.env.DEV && !apiConfigurada()) {
    return { ok: false, erro: 'api_nao_configurada' }
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    let res: Response
    try {
      res = await fetch(urlApi('/api/catalogo/pedido'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados),
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    const corpo = (await res.json()) as ResultadoPedidoOnline
    if (!res.ok || !corpo.ok) {
      return { ok: false, erro: corpo.erro ?? `http_${res.status}` }
    }
    return corpo
  } catch {
    return { ok: false, erro: 'comunicacao_falhou' }
  }
}