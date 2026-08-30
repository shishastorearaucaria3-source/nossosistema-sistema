/**
 * FASE D1 — Análise e normalização dos .xls exportados do Nex.
 *
 * Apenas LEITURA dos arquivos. Produz o "mapa de colunas" (identificação),
 * preview, e a lista normalizada de transações (id, tipo, data, hora, totais,
 * pagamento, cancelamento...). A importação em si mora em importador.ts e, nesta
 * fase, só é permitida contra a cópia de homologação.
 */
import * as XLSX from 'xlsx'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ColunaIdentificada {
  col: number
  rotulo: string
  chaveNorm: string
  tipo: 'texto' | 'numero' | 'data' | 'hora' | 'sim-nao' | 'vazio'
  naoVazia: number
  total: number
}

export interface AnaliseArquivo {
  arquivo: string
  sheets: Array<{
    nome: string
    linhas: number
    colunas: string[]
    colunasDetalhe: ColunaIdentificada[]
    preview: Record<string, unknown>[]
    linhasInvalidas: number
    duplicadas: number
  }>
  arquivoLidoCom: string
}

export function chaveNorm(v: string): string {
  return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_\-]+/g, '').replace(/[^a-z0-9]/g, '')
}

export function lerArquivoXLS(caminho: string): Record<string, unknown>[] {
  const buffer = readFileSync(caminho)
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  // Normaliza chaves que venham como números (ex.: coluna "" no header)
  return linhas.map((l) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(l)) out[normalizarChaveColuna(k)] = v
    return out
  })
}

function normalizarChaveColuna(k: string): string {
  // SheetJS já dá headers legíveis; preserva espaço e dota 'não'/'sim' como está.
  return String(k).trim()
}

export function analisarXLS(caminho: string): AnaliseArquivo {
  const buffer = readFileSync(caminho)
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheets = wb.SheetNames.map((nome) => {
    const ws = wb.Sheets[nome]
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    const colunas = linhas.length ? Object.keys(linhas[0]) : []
    const colunasDetalhe = colunas.map((c, i) => {
      let naoVazia = 0
      let tipo: ColunaIdentificada['tipo'] = 'vazio'
      let temSimNao = false
      for (const l of linhas) {
        const v = l[c]
        if (v == null || v === '') continue
        naoVazia++
        const sn = String(v).trim().toLowerCase()
        if (sn === 'sim' || sn === 'não' || sn === 'nao' || sn === 'true' || sn === 'false') temSimNao = true
      }
      if (naoVazia === 0) tipo = 'vazio'
      else if (temSimNao) tipo = 'sim-nao'
      else if (colunas.some((x) => /hora|hr/i.test(x)) && i === colunas.indexOf(c)) {
        // coluna de hora detectada por cabeçalho (hora)
      }
      tipo = /hora|hr\b|horario/i.test(c) ? 'hora' : tipo
      if (tipo === 'vazio') {
        tipo = /data/i.test(c) ? 'data' : tipo
      } else if (/data/i.test(c) && !temSimNao) {
        tipo = 'data'
      }
      return { col: i, rotulo: c, chaveNorm: chaveNorm(c), tipo, naoVazia, total: linhas.length }
    })
    return {
      nome,
      linhas: linhas.length,
      colunas,
      colunasDetalhe,
      preview: linhas.slice(0, 10),
      linhasInvalidas: 0,
      duplicadas: 0,
    }
  })
  return { arquivo: caminho, sheets, arquivoLidoCom: `sheetjs (${sheets.reduce((a, s) => a + s.linhas, 0)} linhas)` }
}

export function listarArquivosXLS(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /\.xlsx?$/i.test(f))
    .sort()
    .map((f) => join(dir, f))
}

export interface TransacaoXLS {
  id: string                      // No.Tran (pode ser "0060-C")
  idNumero: number | null         // parte numérica
  canceladoC: boolean             // id termina em "-C"
  tipo: string
  dataISO: string | null
  hora: string | null
  totalFinal: number
  desconto: number
  valorPago: number
  meioPagto: string
  debitado: string
  credito: number
  cliente: string
  vendedor: string
  funcionario: string
  cancelado: string
  canceladoPor: string
  canceladoEm: string
  origemArquivo: string
}

const HEADERS = {
  id: ['No.Tran', 'Nr', 'Numero', 'No', 'N.'],
  tipo: ['Tipo', 'Tipo Tran'],
  data: ['Data', 'Data Tran'],
  hora: ['Hora', 'Hora Tran'],
  totalFinal: ['Total Final', 'Total', 'Total Venda'],
  desconto: ['Desconto', 'Desc'],
  valorPago: ['Valor Pago', 'Vlr Pago', 'Pago', 'Vl.Pago'],
  meioPagto: ['Meio Pagto', 'Forma Pagto', 'Pagto', 'Pagamento', 'Meio'],
  debito: ['Debitado'],
  credito: ['Crédito', 'Credito'],
  cliente: ['Cliente'],
  vendedor: ['Vendedor', 'Vend'],
  funcionario: ['Funcionário', 'Funcionario', 'Func'],
  cancelado: ['Cancelado', 'Venda Cancelada'],
  canceladoPor: ['Cancelado por', 'Cancelada por'],
  canceladoEm: ['Cancelado Em', 'Cancelada Em'],
}

function achar(l: Record<string, unknown>, chaves: string[], excluir: string[] = []): unknown {
  // 1º prioridade: igualdade do nome normalizado; 2º: contenção (evitando excluídos).
  const cols = Object.entries(l)
  const normKey = (k: string) => chaveNorm(k)
  function isExcl(k: string): boolean {
    const nk = normKey(k)
    return excluir.some((x) => nk.includes(chaveNorm(x)))
  }
  for (const chave of chaves) {
    const alvo = chaveNorm(chave)
    for (const [k, v] of cols) {
      const n = normKey(k)
      if (n === alvo && String(v).trim() !== '' && !isExcl(k)) return v
    }
  }
  for (const chave of chaves) {
    const alvo = chaveNorm(chave)
    for (const [k, v] of cols) {
      const n = normKey(k)
      if (n.includes(alvo) && String(v).trim() !== '' && !isExcl(k)) return v
    }
  }
  return ''
}

const EXCL_CANCEL = ['cancel', 'prev', 'venc', 'debito', 'cred', 'edit', 'criado', 'pago']

export function paraNumero(v: unknown): number {
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  if (v == null) return 0
  let s = String(v).replace('R$', '').replace(/[^\d,.-]/g, '').trim()
  if (!s) return 0
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes('.')) {
    const partes = s.split('.')
    if (partes.length > 2) s = partes.slice(0, -1).join('') + '.' + partes[partes.length - 1]
  }
  const n = Number(s)
  return isNaN(n) ? 0 : n
}

// SheetJS lê datas como números seriais desde 1899-12-30; horas são frações do dia.
const SERIAL_1899 = Date.UTC(1899, 11, 30) / 1000

export function paraDataISO(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
  }
  if (typeof v === 'number') {
    const s = SERIAL_1899 + v * 86400
    const d = new Date(s * 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  }
  const s = String(v).trim()
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(s)) {
    const [d, m, a] = s.split(/[/-]/)
    return `${a.length === 2 ? '20' + a : a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

export function paraHora(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && v < 1) {
    const s = Math.floor(v * 86400)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const seg = s % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(seg).padStart(2, '0')}`
  }
  const s = String(v).trim()
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`
  return null
}

export function normalizarTransacao(linha: Record<string, unknown>, arquivo: string): TransacaoXLS {
  const id = String(achar(linha, HEADERS.id)).trim() || String(linha['No.Tran'] ?? '').trim()
  const canceladoC = /-C$/i.test(id)
  const idNumerico = (id.replace(/-C$/i, '').match(/\d+/) || [''])[0]
  const totalFinal = paraNumero(achar(linha, HEADERS.totalFinal))
  const desconto = paraNumero(achar(linha, HEADERS.desconto))
  const valorPago = paraNumero(achar(linha, HEADERS.valorPago))
  const credito = paraNumero(achar(linha, HEADERS.credito))
  return {
    id,
    idNumero: idNumerico ? Number(idNumerico) : null,
    canceladoC,
    tipo: String(achar(linha, HEADERS.tipo)).trim(),
    dataISO: paraDataISO(achar(linha, HEADERS.data, EXCL_CANCEL)) || paraDataISO(achar(linha, ['Data Tran'], EXCL_CANCEL)),
    hora: paraHora(achar(linha, HEADERS.hora, EXCL_CANCEL)),
    totalFinal,
    desconto,
    valorPago,
    meioPagto: String(achar(linha, HEADERS.meioPagto)).trim(),
    debitado: String(achar(linha, HEADERS.debito)).trim(),
    credito,
    cliente: String(achar(linha, HEADERS.cliente)).trim(),
    vendedor: String(achar(linha, HEADERS.vendedor)).trim(),
    funcionario: String(achar(linha, HEADERS.funcionario)).trim(),
    cancelado: String(achar(linha, HEADERS.cancelado)).trim(),
    canceladoPor: String(achar(linha, HEADERS.canceladoPor)).trim(),
    canceladoEm: String(achar(linha, HEADERS.canceladoEm)).trim(),
    origemArquivo: arquivo,
  }
}

export function lerTransacoesXLS(caminho: string): { vendas: TransacaoXLS[]; outras: TransacaoXLS[] } {
  const linhas = lerArquivoXLS(caminho)
  const vendas: TransacaoXLS[] = []
  const outras: TransacaoXLS[] = []
  for (const l of linhas) {
    const t = normalizarTransacao(l, caminho)
    const ehVenda = /venda/i.test(t.tipo)
    ;(ehVenda ? vendas : outras).push(t)
  }
  return { vendas, outras }
}

// Chave de deduplicação de venda no importador (usada na fase homolog para não inserir 2x).
export function chaveUnicaVenda(t: TransacaoXLS): string {
  return `${t.dataISO ?? '?'}|${t.hora ?? '?'}|${t.totalFinal.toFixed(2)}|${t.valorPago.toFixed(2)}|${t.meioPagto}|${t.cliente.trim()}`
}