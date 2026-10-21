export interface LojaPublica {
  nome?: string
  whatsapp?: string
  endereco?: string
  horario?: string
  manutencao_ativos?: boolean
  pedidos_ativos?: boolean
  aceita_entrega?: boolean
  aceita_retirada?: boolean
  taxa_entrega?: number
  zonas?: { id: number; nome: string; preco: number; ceps?: string[] }[]
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
  imagem: number | string | null
}

export interface CatalogoPublicoV1 {
  version: 1
  generatedAt: string
  loja: LojaPublica
  categorias: CategoriaPublica[]
  produtos: ProdutoPublicoV1[]
}

export interface ItemPedidoEnvio {
  produto_id: number
  quantidade: number
}

// Formas de pagamento oferecidas ao cliente no pedido online (sem gateway: a
// loja recebe e cobra na entrega/retirada). O backend grava a escolha.
export const FORMAS_PAGAMENTO = [
  { id: 'dinheiro', rotulo: 'Dinheiro' },
  { id: 'pix', rotulo: 'PIX' },
  { id: 'cartao_credito', rotulo: 'Cartão de crédito' },
  { id: 'cartao_debito', rotulo: 'Cartão de débito' }
] as const

export type FormaPagamentoId = (typeof FORMAS_PAGAMENTO)[number]['id']

export interface PedidoOnlineEnvio {
  cliente: { nome: string; whatsapp: string }
  modalidade: 'entrega' | 'retirada'
  endereco?: string
  cep?: string
  forma_pagamento: string
  observacao?: string
  itens: ItemPedidoEnvio[]
}

export interface ResultadoPedidoOnline {
  ok: boolean
  erro?: string
  pedido?: { id: string; numero: number; total: number; taxa_entrega: number; subtotal: number }
}

// Estado de envio exibido no checkout do catálogo.
export type EstadoEnvioPedido =
  | { fase: 'ocioso' }
  | { fase: 'enviando' }
  | { fase: 'sucesso'; numero: number | null }
  | { fase: 'erro'; mensagem: string }

export function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}