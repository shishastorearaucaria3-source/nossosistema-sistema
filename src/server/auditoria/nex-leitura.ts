/**
 * FASE B — Biblioteca de reconstrução NX (somente leitura).
 *
 * Regras fundadoras (validadas em separado na FASE E):
 *  - Vendas reais = tran id cujo TranNome == "Venda" (NUNCA "total > 0").
 *  - Itens = MovEst.nx1 (produto/quant/preço por venda), associados por
 *    `MovEst.Tran == Tran.id` (rel +20 validado 7/7 em investigação prévia).
 *  - Nenhuma associação por data/hora é usada como chave primária.
 *
 * Todos os decodificadores operam sobre buffers já lidos; nenhum arquivo é
 * modificado.
 */
import { lerVendasTran, lerItensMovEst, type ItemMovEst, type VendaTran } from '../nex-binary'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const EPOCA_NET = 62135596800000

/** .NET date/time (double, ticks desde 0001-01-01) -> "YYYY-MM-DD HH:MM:SS" (UTC). */
export function converterDataNex(v: number): string | null {
  if (!v || !isFinite(v)) return null
  const m = v - EPOCA_NET
  if (!(m > 0 && m < 4102444800000)) return null
  const d = new Date(m)
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

export function diaDe(dt: string | null): string | null {
  return dt ? dt.slice(0, 10) : null
}

export function decodificarUtf16(buf: Buffer, off: number, maxBytes: number): string {
  let s = ''
  const fim = Math.min(buf.length, off + maxBytes)
  for (let i = off; i + 1 < fim; i += 2) {
    const c = buf[i] | (buf[i + 1] << 8)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

export interface TranRegistro {
  id: number
  caixa: number
  guidOff: number
  tranNome: string | null
  dataHora: string | null
}

const TRAN_NOMES = [
  'Venda',
  'Compra',
  'Sangria de Caixa',
  'Suprimento de Caixa',
  'Ajuste de Estoque +',
  'Ajuste de Estoque -',
  'Ajuste de Custo',
  'Pagamento Débito',
  'Uso e Consumo',
  'Devolução ao Fornecedor',
  'Devolução do Cliente',
  'Correção Crédito -',
  'Bonificação',
  'Correção Fidelidade',
  'Remessa para Conserto',
  'Retorno de Remessa de Conserto',
]

/**
 * Enumera o VOCABULÁRIO de nomes de transação presentes no arquivo: qualquer
 * string UTF-16 larga imediatamente precedida por 0x04. Isso revela nomes que
 * não estavam na lista inicial (ex.: forma real de gravar vendas canceladas),
 * sem adivinhar strings.
 */
export function enumerarTranNomes(buf: Buffer, max = 80): Array<{ nome: string; qtd: number }> {
  const cont = new Map<string, number>()
  const lim = buf.length - 1
  for (let i = 1; i < lim; i++) {
    if (buf[i - 1] !== 0x04) continue
    const b = buf[i]
    if (!((b >= 0x41 && b < 0x7b) || (b >= 0xc0 && b <= 0xff))) continue
    // expande para trás até o fim do nome (não-letra) até 60 chars
    let inicio = i
    let rec = 0
    while (inicio - 2 >= 0 && rec < 60) {
      const cb = buf[inicio - 2] | (buf[inicio - 1] << 8)
      if (cb === 0 || ((cb >= 0x41 && cb < 0x7b) || (cb >= 0xc0 && cb <= 0xff))) {
        inicio -= 2
        rec++
      } else break
    }
    let fim = i
    let fwd = 0
    const ch: number[] = []
    while (fim + 1 < lim && fwd < 60) {
      const c = buf[fim] | (buf[fim + 1] << 8)
      if (c === 0 || ((c >= 0x41 && c < 0x7b) || (c >= 0xc0 && c <= 0xff))) {
        ch.push(c)
        fim += 2
        fwd++
        if (ch.length > 40) break
      } else break
    }
    if (fwd < 2) continue
    const nome = String.fromCharCode(...ch)
    if (!/^[A-Za-zà-úÀ-Ú0-9 .+/'-]*$/u.test(nome)) continue
    cont.set(nome, (cont.get(nome) || 0) + 1)
  }
  return [...cont.entries()].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, max)
}

// Usuários reais identificados nos backups (logs/relatórios anteriores).
const USUARIOS_CONHECIDOS = ['maciel', 'admin', 'mario', 'nany', 'yt', 'colab', 'balcao', 'shisha1', 'mariorener', 'admin2']

/** Slot-walk do Tran com offsets + âncoras de TranNome/data (validação: ids do walker original). */
export function classificarTransacoes(buf: Buffer): { registros: Map<number, TranRegistro>; porIdVisto: number } {
  const base = lerVendasTran(buf) as (VendaTran & { offset?: number })[]
  const porId = new Map<number, TranRegistro>()
  // re-caminha slots para capturar guidOff + caixa (idempotente com lerVendasTran)
  const BLOCK = 4096
  const stride = 1280
  const first = 256
  const slots = 3
  const totalBlocks = Math.floor(buf.length / BLOCK)
  for (let blk = 8; blk < totalBlocks; blk++) {
    const b0 = blk * BLOCK
    for (let s = 0; s < slots; s++) {
      const gp = b0 + first + s * stride
      if (gp + 16 > buf.length) continue
      if ((buf[gp + 7] >>> 4) !== 4 || (buf[gp + 8] & 0xc0) !== 0x80) continue
      const id = buf.readInt32LE(gp - 4)
      if (!(id > 0 && id < 5e8)) continue
      let ascii = ''
      for (let k = gp + 32; k < gp + 44; k++) {
        const c = buf[k]
        if (c === 0) break
        ascii += String.fromCharCode(c)
      }
      if (ascii !== String(id)) continue
      porId.set(id, { id, caixa: buf.readInt32LE(gp + 451), guidOff: gp, tranNome: null, dataHora: null })
    }
  }
  // âncoras de TranNome em UMA passada: [0x04] + string UTF-16 larga. O dono de
  // cada nome é o registro cujo GUID precede o nome (o id fica em guidOff-4).
  const gpList = [...porId.values()].map((r) => r.guidOff).sort((a, b) => a - b)
  const porOff = new Map<number, number>()
  for (const r of porId.values()) if (!porOff.has(r.guidOff)) porOff.set(r.guidOff, r.id)
  const donoDoNome = (pos: number): number => {
    let lo = 0, hi = gpList.length - 1, best = -1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      if (gpList[m] < pos) { best = gpList[m]; lo = m + 1 } else hi = m - 1
    }
    return best
  }
  const ehLetraIni = (b: number) => ((b >= 0x41 && b < 0x7b) || (b >= 0xc0 && b <= 0xff))
  const ehLetra = (c: number) => ((c >= 0x41 && c < 0x7b) || (c >= 0xc0 && c <= 0xff) || (c >= 0x30 && c <= 0x39) || c === 0x20)
  const limBuf = buf.length - 1
  for (let i = 1; i < limBuf; i++) {
    if (buf[i - 1] !== 0x04) continue
    if (!ehLetraIni(buf[i])) continue
    let fim = i
    const ch: number[] = []
    while (fim + 1 < limBuf && ch.length < 40) {
      const c = buf[fim] | (buf[fim + 1] << 8)
      if (c === 0 || !ehLetra(c)) break
      ch.push(c)
      fim += 2
    }
    if (ch.length < 4) continue
    const nome = String.fromCharCode(...ch)
    if (nome !== 'Venda') continue
    const gp = donoDoNome(i)
    if (gp < 0) continue
    const id = porOff.get(gp)
    if (id == null) continue
    const reg = porId.get(id)
    if (!reg || reg.tranNome) continue
    reg.tranNome = nome
    let data: string | null = null
    for (const rel of [-13, -14, -12, -39, -40, -38]) {
      const o = i + rel
      if (o >= 0 && o + 8 <= buf.length) {
        const d = converterDataNex(buf.readDoubleLE(o))
        if (d && /^20(1[5-9]|2[0-7])/.test(d)) { data = d; break }
      }
    }
    reg.dataHora = data
  }
  return { registros: porId, porIdVisto: base.length }
}

export interface ReconstrucaoLote {
  registros: Map<number, TranRegistro>
  totalRegistrosTran: number
  vendasNX: TranRegistro[]          // tranNome == 'Venda' (data ou não)
  vendasComData: TranRegistro[]
  porTipo: Record<string, number>
  porAno: Record<string, number>    // vendas com data por ano
  porCaixa: number
  idsComItem: number
  itensTotais: number
  itensSemVenda: number             // itens cujo tran não é uma venda (ou inexistente)
  somaValorMovEst: number
  somaValorMovEstPorAno: Record<string, number>
  vendasComPagEspecies: number
  pagEspeciesTotais: number
}

export function resumoReconstrucaoNX(
  tranBuf: Buffer,
  movBuf: Buffer,
  pagRecs: { tran: number }[] | null,
  pagVendas?: Set<number>,
): ReconstrucaoLote {
  const { registros, porIdVisto } = classificarTransacoes(tranBuf)
  const vendasNX: TranRegistro[] = []
  for (const r of registros.values()) if (r.tranNome === 'Venda') vendasNX.push(r)
  const idsVendas = new Set(vendasNX.map((v) => v.id))
  const porTipo: Record<string, number> = {}
  for (const r of registros.values()) {
    const t = r.tranNome || 'SEM_TRANNOME'
    porTipo[t] = (porTipo[t] || 0) + 1
  }
  const porAno: Record<string, number> = {}
  const idsComItem = new Set<number>()
  const somaPorAno: Record<string, number> = {}
  let itensTotais = 0
  let itensSemVenda = 0
  let somaValor = 0
  const itens = lerItensMovEst(movBuf)
  for (const it of itens) {
    itensTotais++
    const ano = anoDeVenda(registros.get(it.tran))
    if (!idsVendas.has(it.tran)) {
      itensSemVenda++
    } else {
      idsComItem.add(it.tran)
      const somaPorAnoAtual = somaPorAno[ano] || 0
      somaPorAno[ano] = +(somaPorAnoAtual + it.total).toFixed(2)
    }
    somaValor += it.total
  }
  for (const v of vendasNX) {
    if (v.dataHora) {
      const a = v.dataHora.slice(0, 4)
      porAno[a] = (porAno[a] || 0) + 1
    }
  }
  let vendasComPag = 0
  let pagTotais = 0
  if (pagRecs) {
    pagTotais = pagRecs.length
    const set = pagVendas || new Set(pagRecs.map((p) => p.tran))
    vendasComPag = set.size
  }
  return {
    registros,
    totalRegistrosTran: porIdVisto,
    vendasNX,
    vendasComData: vendasNX.filter((v) => v.dataHora),
    porTipo,
    porAno,
    porCaixa: new Set([...registros.values()].map((r) => r.caixa)).size,
    idsComItem: idsComItem.size,
    itensTotais,
    itensSemVenda,
    somaValorMovEst: Math.round(somaValor * 100) / 100,
    somaValorMovEstPorAno: somaPorAno,
    vendasComPagEspecies: vendasComPag,
    pagEspeciesTotais: pagTotais,
  }
}

function anoDeVenda(reg: TranRegistro | undefined): string {
  if (reg && reg.tranNome === 'Venda' && reg.dataHora) return reg.dataHora.slice(0, 4)
  return 'SEM_ANO'
}

/**
 * Heurística de vendedor presente no registro Tran (para vendas 2020-2022,
 * onde não há XLS). REGRA PROPOSTA: existir token UTF-16 igual a um login de
 * usuário conhecido entre o GUID da venda e a âncora do TranNome.
 * A concordância desta heurística com o XLS (2023-2026) é medida e relatada.
 */
export function vendedorPresente(buf: Buffer, reg: TranRegistro): boolean {
  const fimBusca = Math.min(buf.length - 1, reg.guidOff + 1500)
  const inicio = reg.guidOff + 24
  const alvo = new Map<string, string[]>()
  for (const u of USUARIOS_CONHECIDOS) alvo.set(u, [])
  const nomes = Object.fromEntries(USUARIOS_CONHECIDOS.map((u) => [u, false]))
  for (let i = inicio; i + 1 < fimBusca; i += 2) {
    const c = buf[i] | (buf[i + 1] << 8)
    if ((c >= 0x41 && c < 0x7a) || (c >= 0xc0 && c <= 0xff)) {
      let j = i
      const ch: number[] = []
      while (j + 1 < fimBusca) {
        const x = buf[j] | (buf[j + 1] << 8)
        if ((x >= 0x41 && x < 0x7a) || (x >= 0xc0 && x <= 0xff)) {
          ch.push(x)
          j += 2
          if (ch.length > 12) break
        } else break
      }
      if (ch.length >= 2) {
        const palavra = String.fromCharCode(...ch).toLowerCase()
        if (nomes[palavra] === false) nomes[palavra] = true
        else if (nomes[palavra]) {
          // já marcado
        }
        for (const u of USUARIOS_CONHECIDOS) if (palavra.startsWith(u) || u.startsWith(palavra)) nomes[u] = true
      }
      i = j - 1
    }
  }
  return USUARIOS_CONHECIDOS.some((u) => nomes[u])
}

export function lerArquivo(dir: string, nome: string): Buffer {
  return readFileSync(join(dir, nome))
}

/** Indisponível (marker para NÃO DETERMINADO quando não há decoder/offset validado). */
export const NAO_DETERMINADO = 'NÃO DETERMINADO'