export interface TipoMov {
  id: string
  label: string
  entrada: boolean
  precisaFornecedor?: boolean
  precisaCliente?: boolean
  origem?: boolean
  destino?: boolean
  usaCusto?: boolean
  requerMotivo?: boolean
}

export const TIPOS_MOVIMENTACAO: TipoMov[] = [
  { id: 'compra', label: 'Compra', entrada: true, precisaFornecedor: true, usaCusto: true },
  { id: 'devolucao_cliente', label: 'Devolução do Cliente', entrada: true, precisaCliente: true },
  { id: 'transferencia_entrada', label: 'Transferência entre Lojas (entrada)', entrada: true, origem: true },
  { id: 'retorno_remessa', label: 'Retorno de Remessa', entrada: true, origem: true },
  { id: 'ajuste_entrada', label: 'Ajuste de Estoque (+)', entrada: true, requerMotivo: true },
  { id: 'outras_entradas', label: 'Outras Entradas', entrada: true },
  { id: 'devolucao_fornecedor', label: 'Devolução ao Fornecedor', entrada: false, precisaFornecedor: true },
  { id: 'transferencia_saida', label: 'Transferência entre Lojas (saída)', entrada: false, destino: true },
  { id: 'uso_interno', label: 'Uso e Consumo Interno', entrada: false, requerMotivo: true },
  { id: 'remessa_conserto', label: 'Remessa para Conserto', entrada: false, destino: true },
  { id: 'remessa_demonstracao', label: 'Remessa para Demonstração', entrada: false, destino: true },
  { id: 'ajuste_saida', label: 'Ajuste de Estoque (−)', entrada: false, requerMotivo: true },
  { id: 'outras_saidas', label: 'Outras Saídas', entrada: false },
  { id: 'bonificacao', label: 'Bonificação', entrada: false }
]

export const TIPOS_POR_DIRECAO: Record<'entrada' | 'saida', TipoMov[]> = {
  entrada: TIPOS_MOVIMENTACAO.filter((t) => t.entrada),
  saida: TIPOS_MOVIMENTACAO.filter((t) => !t.entrada)
}

export function labelCategoria(id: string | null | undefined): string {
  if (!id) return ''
  const t = TIPOS_MOVIMENTACAO.find((x) => x.id === id)
  return t ? t.label : id
}