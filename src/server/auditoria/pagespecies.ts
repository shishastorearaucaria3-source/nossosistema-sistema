/**
 * FASE C — Nova investigação de PagEspecies.nx1.
 *
 * Descobertas desta fase (a partir da leitura byte-a-byte dos registros):
 *  1. O layout real de um registro PagEspecies é CONTÍGUO:
 *         [UID do registro (16B)] [Caixa: u32] [DataHora: .NET date 8B] [Tran: u32] ...
 *     caixa/date/tran aparecem em sequência (padrão validado com vendas reais,
 *     ex. venda 57053 no caixa 1700).
 *  2. Os offsets antigos do sistema (venda+40/forma+44/valor+48/troco+56) e os
 *     sugeridos anteriormente (venda+34/tipo+39/valor+42/troco+50) NÃO batem
 *     com este layout — rejeitados definitivamente.
 *  3. NÃO existe campo "Valor" (nem equivalente) no registro PagEspecies.
 *     Consequência arquitetural: o valor efetivamente pago não reside aqui.
 *     Fontes alternativas possíveis: Tran.PagEspValor/Troco (memos), Recebiveis
 *     (cartão), e a soma dos itens do MovEst (total da venda).
 *  4. Quando o valor não for determinável com segurança -> valor = NÃO DETERMINADO.
 */
import { decodificarUtf16, converterDataNex, EPOCA_NET } from './nex-leitura'

export interface PagEspeciesRec {
  caixa: number
  tran: number
  dataHora: string | null
  tipoTran: number
  especie: number
  tipo: number
  troco: string | null
  valor: number | null // sempre NÃO DETERMINADO nesta fase (não inventar)
  vinculadoAVenda: boolean
}

export interface InvestigacaoPagEspecies {
  totalTriplasValidas: number
  vinculadasAVenda: number
  naoVinculadas: number
  valorDeterminado: number // sempre 0 nesta fase
  especiePorTran: Map<number, number[]> // tran -> especies (proporcao pela contagem)
  formas: Array<[number, number]>
  canceladoDeterminado: number // 0 — sem offset validado
  devolucaoDeterminado: number // 0 — sem offset validado
  amostra: PagEspeciesRec[]
}

/** Escaneia o .nx1 por triplas [Caixa u32][DataHora .NET][Tran u32] (leitura, nunca escreve). */
export function lerPagEspecies(buf: Buffer, idsVendas: ReadonlySet<number>): InvestigacaoPagEspecies {
  const vinculo = new Map<number, number>()
  const formas = new Map<number, number>()
  const especiePorTran = new Map<number, number[]>()
  const amostra: PagEspeciesRec[] = []
  let total = 0
  let vinc = 0
  let naoVinc = 0
  const seen = new Set<string>()
  const lim = buf.length - 128
  for (let o = 0; o < lim; o++) {
    const caixa = buf.readUInt32LE(o)
    if (!(caixa >= 1 && caixa <= 9000)) continue
    const data = converterDataNex(buf.readDoubleLE(o + 4))
    if (!data || !/^20(1[5-9]|2[0-7])/.test(data)) continue
    const tran = buf.readUInt32LE(o + 12)
    if (!(tran > 0 && tran < 5e8)) continue
    const especie = buf.readUInt16LE(o + 17)
    const tipo = buf[o + 19]
    if (!(especie >= 1 && especie <= 300)) continue // ids de forma pequenos; evita ruído binário
    let troco: string | null = null
    {
      const t = decodificarUtf16Nulo(buf, o + 20, 60)
      if (t && /^[A-Za-z0-9 ,.$%-]*$/.test(t) && t.length >= 1) troco = t
    }
    const key = `${caixa}|${tran}|${data}|${buf[o + 16]}|${especie}|${tipo}`
    if (seen.has(key)) continue
    const tipoTran = buf[o + 16]
    seen.add(key)
    total++
    const vinculada = idsVendas.has(tran)
    if (vinculada) {
      vinc++
      vinculo.set(tran, (vinculo.get(tran) || 0) + 1)
      const arr = especiePorTran.get(tran) || []
      arr.push(especie)
      especiePorTran.set(tran, arr)
    } else {
      naoVinc++
    }
    formas.set(especie, (formas.get(especie) || 0) + 1)
    if (amostra.length < 30) amostra.push({ caixa, tran, dataHora: data, tipoTran, especie, tipo, troco, valor: null, vinculadoAVenda: vinculada })
  }
  return {
    totalTriplasValidas: total,
    vinculadasAVenda: vinc,
    naoVinculadas: naoVinc,
    valorDeterminado: 0,
    especiePorTran,
    formas: [...formas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    canceladoDeterminado: 0,
    devolucaoDeterminado: 0,
    amostra,
  }
}

function decodificarUtf16Nulo(buf: Buffer, off: number, maxBytes: number): string | null {
  const s = decodificarUtf16(buf, off, maxBytes)
  return s.replace(/^\u0000+/, '').length ? s.replace(/\u0000/g, '').trim() : null
}

export function vendaValorDeterminado(totaisMovEst: Map<number, number>, tran: number): number | null {
  // Nesta fase NENHUM valor de pagamento é inventado. A soma de itens do MovEst
  // é usada apenas como "total da venda reconstruído", nunca como valor pago.
  void totaisMovEst
  void tran
  return null
}

export const PAG_VALOR_NAO_DETERMINADO = 'NÃO DETERMINADO'
export { EPOCA_NET }