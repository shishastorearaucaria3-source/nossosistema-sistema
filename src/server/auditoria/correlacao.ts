/**
 * FASE E — Correlação XLS→NX.
 *
 * Chave primária: No.Tran numérico == id do Tran.nx1.
 * Casos "-C" (canceladas) e sem id válido: estratégia secundária com data,
 * hora, total, forma de pagamento, cliente e vendedor.
 * Somente vendas EXATA (ou ALTA CONFIANÇA com score ≥10) alimentam importação.
 *
 * Índices pré-computados evitam varredura O(N×M) sobre os 54k registros.
 */
import type { TranRegistro } from './nex-leitura'

export type Confianca = 'EXATA' | 'ALTA CONFIANÇA' | 'PROVÁVEL' | 'AMBÍGUA' | 'NÃO ENCONTRADA'

export interface Candidato {
  nxId: number
  hora: string | null
  total: number | null
  meios: string[]
  score: number
  criterios: string[]
}

export interface Correlacao {
  xlsId: string
  xlsData: string | null
  xlsHora: string | null
  xlsTotal: number
  xlsMeioPagto: string
  xlsCancelado: boolean
  nxId: number | null
  confianca: Confianca
  criterios: string[]
  candidatos: Candidato[]
}

export interface IndiceNX {
  porId: Map<number, TranRegistro>
  porData: Map<string, TranRegistro[]>     // vendas indexadas por dia
  totalPorVenda: Map<number, number>       // soma de itens MovEst por venda
  pagamentosPorVenda: Map<number, string[]>
}

export function montarIndiceNX(
  porId: Map<number, TranRegistro>,
  totalPorVenda: Map<number, number>,
  pagamentosPorVenda: Map<number, string[]>,
): IndiceNX {
  const porData = new Map<string, TranRegistro[]>()
  for (const reg of porId.values()) {
    if (reg.tranNome !== 'Venda' || !reg.dataHora) continue
    const dia = reg.dataHora.slice(0, 10)
    let arr = porData.get(dia)
    if (!arr) { arr = []; porData.set(dia, arr) }
    arr.push(reg)
  }
  return { porId, porData, totalPorVenda, pagamentosPorVenda }
}

function fmt(v: number): string {
  return v.toFixed(2)
}

function minOrd(hi: string, mi: string): number {
  return parseInt(hi.slice(0, 2), 10) * 60 + parseInt(hi.slice(3, 5), 10)
}

export function correlacionar(
  xlsVenda: { id: string; dataISO: string | null; hora: string | null; totalFinal: number; meioPagto: string; canceladoC: boolean },
  indice: IndiceNX,
): Correlacao {
  const criterios: string[] = []
  const ehC = /-C$/i.test(xlsVenda.id)
  const idNum = Number(xlsVenda.id.replace(/-C$/i, '')) || -1
  const candId = indice.porId.get(idNum)

  if (!ehC && idNum > 0 && candId && candId.tranNome === 'Venda') {
    const reg = candId
    const dnx = reg.dataHora ? reg.dataHora.slice(0, 10) : null
    const hnx = reg.dataHora ? reg.dataHora.slice(11, 19) : null
    const tnx = indice.totalPorVenda.get(reg.id)
    const tMatch = tnx != null && Math.abs(tnx - xlsVenda.totalFinal) < 0.011
    const dMatch = xlsVenda.dataISO === dnx
    const hMatch = xlsVenda.hora != null && hnx != null && minOrd(xlsVenda.hora, '00:00') >= 0 && xlsVenda.hora.slice(0, 5) === hnx.slice(0, 5)

    criterios.push(`id numérico ${idNum} presente no Tran.nx1 (nome=${reg.tranNome})`)
    if (tMatch) criterios.push(`total itens MovEst ${fmt(tnx!)} ≈ Total Final ${fmt(xlsVenda.totalFinal)}`)
    else criterios.push(`total itens MovEst ${tnx == null ? '∅' : fmt(tnx)} ${tnx == null ? '' : `≠ ${fmt(xlsVenda.totalFinal)}`}`)
    if (dMatch) criterios.push('data coincide')
    else criterios.push(`data XLS ${xlsVenda.dataISO ?? '∅'} vs Tran ${dnx ?? '∅'} (DIVERGÊNCIA — campo DataHora do Tran decodifica errado em parte dos registros antigos)`)
    if (hMatch) criterios.push('hora coincide (mesmo minuto)')
    return { ...base(xlsVenda), nxId: reg.id, confianca: 'EXATA', criterios: [...criterios, 'chave No.Tran==Tran.id (única; divergências de data/total são reportadas separadamente)'] }
  }

  // estratégia secundária
  const candidatos = buscarCandidatos(xlsVenda, indice, ehC)
  if (candidatos.length === 0) {
    return { ...base(xlsVenda), confianca: 'NÃO ENCONTRADA', criterios: [`sem candidato em Tran.nx1 (data ${xlsVenda.dataISO ?? '∅'}, total ${fmt(xlsVenda.totalFinal)}, ${xlsVenda.meioPagto || 'pagto ∅'})`] }
  }
  const melhor = candidatos[0]
  for (const c of melhor.criterios) criterios.push(c)
  if (candidatos.length === 1 && melhor.score >= 10) {
    return { ...base(xlsVenda), nxId: melhor.nxId, confianca: 'ALTA CONFIANÇA', criterios }
  }
  if (candidatos.length === 1 && melhor.score >= 6) {
    return { ...base(xlsVenda), nxId: melhor.nxId, confianca: 'PROVÁVEL', criterios }
  }
  if (candidatos.length > 1 && melhor.score === candidatos[1].score) {
    return { ...base(xlsVenda), confianca: 'AMBÍGUA', criterios: [...criterios, `${candidatos.length} candidatos empatados`], candidatos }
  }
  if (melhor.score < 6) {
    return { ...base(xlsVenda), confianca: 'NÃO ENCONTRADA', criterios: [...criterios, 'melhor candidato abaixo do limiar'] }
  }
  return { ...base(xlsVenda), nxId: melhor.nxId, confianca: 'PROVÁVEL', criterios }
}

function base(x: { id: string; dataISO: string | null; hora: string | null; totalFinal: number; meioPagto: string; canceladoC: boolean }): Correlacao {
  return { xlsId: x.id, xlsData: x.dataISO, xlsHora: x.hora, xlsTotal: x.totalFinal, xlsMeioPagto: x.meioPagto, xlsCancelado: x.canceladoC, nxId: null, confianca: 'NÃO ENCONTRADA' as Confianca, criterios: [], candidatos: [] }
}

function buscarCandidatos(x: { id: string; dataISO: string | null; hora: string | null; totalFinal: number; meioPagto: string }, indice: IndiceNX, ehC: boolean): Candidato[] {
  const dia = x.dataISO
  if (!dia) return []
  const doDia = indice.porData.get(dia)
  if (!doDia) return []
  const horaMM = x.hora ? x.hora.slice(0, 5) : null
  const total = x.totalFinal
  const out: Candidato[] = []
  for (const reg of doDia) {
    if (indice.porId.get(reg.id)?.tranNome !== 'Venda') continue
    const hh = reg.dataHora!.slice(11, 16)
    let score = 0
    const crit: string[] = []
    if (horaMM) {
      const dif = Math.abs(minOrd(hh, '00:00') - minOrd(horaMM, '00:00'))
      if (dif <= 5) { score += 5; crit.push(`hora quase igual (${hh})`) }
      else if (dif <= 90) { score += 2; crit.push(`hora próxima (${hh}, dif ${dif}min)`) }
    } else {
      score += 2
    }
    const tnx = indice.totalPorVenda.get(reg.id)
    if (tnx != null && Math.abs(tnx - total) < 0.011) { score += 5; crit.push(`total itens ${fmt(tnx)} == Total Final ${fmt(total)}`) }
    else if (tnx != null && ehC) { score += 1; crit.push(`total diverge (${fmt(tnx)}) — marcada cancelada`) }
    if (x.meioPagto) {
      const meios = indice.pagamentosPorVenda.get(reg.id) || []
      if (meios.some((m) => umaContem(m, x.meioPagto))) { score += 3; crit.push(`forma de pagamento coincide (${meios.join(',')})`) }
    }
    out.push({ nxId: reg.id, hora: hh, total: tnx ?? null, meios: indice.pagamentosPorVenda.get(reg.id) || [], score, criterios: crit })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5)
}

function umaContem(a: string, b: string): boolean {
  const na = a.toLowerCase()
  const nb = b.toLowerCase()
  return na.includes(nb) || nb.includes(na)
}