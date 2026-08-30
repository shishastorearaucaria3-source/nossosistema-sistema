import type { CatalogoPublicoV1 } from '../types'
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
    const res = await fetch(urlApi('/api/catalogo/publico'), { cache: 'no-store' })
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