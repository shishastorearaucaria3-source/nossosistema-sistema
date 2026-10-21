export interface Ponto {
  lat: number
  lng: number
}

export interface Zona {
  id: number
  nome: string
  preco: number
  poligono: string
  ativo: number
}

export function pontoEmPoligono(ponto: Ponto, poligono: Ponto[]): boolean {
  let dentro = false
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const xi = poligono[i].lat
    const yi = poligono[i].lng
    const xj = poligono[j].lat
    const yj = poligono[j].lng
    const cruza = yi > ponto.lng !== yj > ponto.lng && ponto.lat < ((xj - xi) * (ponto.lng - yi)) / (yj - yi) + xi
    if (cruza) dentro = !dentro
  }
  return dentro
}

export function encontrarZona(ponto: Ponto, zonas: Zona[]): Zona | null {
  for (const z of zonas) {
    if (!z.ativo) continue
    try {
      const poly = JSON.parse(z.poligono) as Ponto[]
      if (pontoEmPoligono(ponto, poly)) return z
    } catch {
      continue
    }
  }
  return null
}

export function zonaParaPonto(ponto: Ponto, zonas: Zona[]): Zona | null {
  return encontrarZona(ponto, zonas)
}

// Normaliza um CEP informado: remove pontuação/espaços, mantém só dígitos.
export function normalizarCep(valor: string): string {
  return (valor || '').replace(/\D/g, '')
}

// Determina se um CEP pertence a uma lista de entradas de zona.
// Cada entrada pode ser um prefixo (ex.: "01310", casa qualquer CEP que
// comece com esses dígitos) ou um CEP completo (8 dígitos, casa exata).
export function cepPertenceZona(cep: string, ceps: unknown[] | null | undefined): boolean {
  if (!cep) return false
  if (!ceps || !Array.isArray(ceps) || ceps.length === 0) return false
  const cepLimpo = normalizarCep(cep)
  if (cepLimpo.length < 3) return false
  return ceps.some((c) => {
    const entrada = normalizarCep(String(c ?? ''))
    if (!entrada || entrada.length < 3) return false
    const tamanho = Math.min(entrada.length, 8, cepLimpo.length)
    return cepLimpo.slice(0, tamanho) === entrada.slice(0, tamanho)
  })
}

// Encontra a zona ativa cuja lista de CEPs contém o CEP informado,
// respeitando a ordem (primeira correspondência vence).
export function zonaPorCep(cep: string, zonas: (Zona & { ceps?: unknown[] })[]): (Zona & { ceps?: unknown[] }) | null {
  if (!cep) return null
  const cepLimpo = normalizarCep(cep)
  if (cepLimpo.length < 3) return null
  for (const z of zonas) {
    if (!z.ativo) continue
    if (cepPertenceZona(cepLimpo, z.ceps)) return z
  }
  return null
}