import { apiConfigurada, urlApi } from '../config'

// Camada única de imagens do catálogo.
// Em produção as imagens são servidas como bytes crus pelo Worker de catálogo
// (Fase 7) em `/api/catalogo/imagem/:id`; aqui convertemos em URL de blob.
// Para trocar por Cloudflare/CDN/R2 no futuro basta alterar esta função —
// nenhum componente faz fetch de imagem direto.
const cacheImagens = new Map<number, string>()

export async function obterImagem(id: number): Promise<string | null> {
  // Produção sem API configurada: sem chamadas para caminhos relativos/locais.
  if (!import.meta.env.DEV && !apiConfigurada()) return null
  const emCache = cacheImagens.get(id)
  if (emCache !== undefined) return emCache || null
  try {
    const res = await fetch(urlApi(`/api/catalogo/imagem/${id}`))
    if (!res.ok) {
      cacheImagens.set(id, '')
      return null
    }
    const blob = await res.blob()
    const src = URL.createObjectURL(blob)
    cacheImagens.set(id, src)
    return src
  } catch {
    return null
  }
}