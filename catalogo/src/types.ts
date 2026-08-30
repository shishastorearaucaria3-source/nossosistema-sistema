export interface LojaPublica {
  nome?: string
  whatsapp?: string
  endereco?: string
  horario?: string
}

export interface CategoriaPublica {
  id: number
  nome: string
}

export interface ProdutoPublicoV1 {
  id: number
  nome: string
  descricao: string | null
  categoria: string | null
  categoria_id: number | null
  subcategoria: string | null
  marca: string | null
  preco: number
  preco_promo: number | null
  tem_promo: boolean
  disponivel: boolean
  estoque?: number
  ordem: number
  imagem: number | null
}

export interface CatalogoPublicoV1 {
  version: 1
  generatedAt: string
  loja: LojaPublica
  categorias: CategoriaPublica[]
  produtos: ProdutoPublicoV1[]
}

export function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}