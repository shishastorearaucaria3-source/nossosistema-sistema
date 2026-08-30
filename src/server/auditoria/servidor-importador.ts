/**
 * CONTROLLER do importador Nex para o SERVIDOR (tela "Importação / Migração Nex").
 *
 * Reusa os módulos de auditoria aprovados (xls, nex-leitura, correlacao,
 * homologacao, importador). NUNCA escreve em produção: toda gravação acontece
 * em um SNAPSHOT (homologacao). Operações longas relatam progresso e são
 * protegidas por trava (uma por vez).
 *
 * Fluxo da tela: listar arquivos → analisar → preparar (snapshot + índices NX)
 * → preview (correlação + contagens) → importar → resultado/histórico.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getNxDir, getXlsDir, getHomologDir } from './config'
import { abrirBancoHomolog, criarSnapshotHomologacao, registrarPasso, type SnapshotHomologacao } from './homologacao'
import { lerArquivo, resumoReconstrucaoNX } from './nex-leitura'
import { lerPagEspecies } from './pagespecies'
import { lerItensMovEst } from '../nex-binary'
import { analisarXLS, chaveUnicaVenda, lerArquivoXLS, listarArquivosXLS, lerTransacoesXLS, normalizarTransacao, type AnaliseArquivo, type TransacaoXLS } from './xls'
import { correlacionar, montarIndiceNX, type Correlacao, type IndiceNX } from './correlacao'
import { importarEmHomologacao, previewImportacao, type ResultadoImportacaoHomolog, type VendaProntaIportar } from './importador'

export type ConfiancaMin = 'EXATA' | 'ALTA CONFIANÇA'

interface Preparado {
  snapshot: SnapshotHomologacao
  buffers: { tran: Buffer; mov: Buffer; pag: Buffer }
  indices: IndiceNX
  montadoEm: string
  recon: unknown
  pag: unknown
}

let preparado: Preparado | null = null
let ocupado = false

const progresso: { ativo: boolean; etapa: string; detalhe: string; iniciadoEm: number } = {
  ativo: false,
  etapa: '',
  detalhe: '',
  iniciadoEm: 0,
}

export function getProgresso() {
  const decorrido = progresso.ativo ? Math.round((Date.now() - progresso.iniciadoEm) / 1000) : 0
  return { ativo: progresso.ativo, etapa: progresso.etapa, detalhe: progresso.detalhe, decorridoS: decorrido }
}

export function estaOcupado(): boolean {
  return ocupado
}

function comOcupacao<R>(fn: () => Promise<R>): Promise<R> {
  if (ocupado) return Promise.reject(new Error('Já existe uma operação em andamento'))
  ocupado = true
  return fn().finally(() => {
    ocupado = false
  })
}

function etapa(e: string, d = ''): void {
  progresso.etapa = e
  progresso.detalhe = d
}

// ---------------------------------------------------------------------------
// Listagem / análise de arquivos
// ---------------------------------------------------------------------------

export function listarArquivos() {
  const dir = getXlsDir()
  if (!existsSync(dir)) return { dir, arquivos: [], erro: `Pasta não encontrada: ${dir}` }
  const arquivos = listarArquivosXLS(dir).map((c) => ({ nome: basename(c), caminho: c, tamanho: statSync(c).size }))
  return { dir, arquivos }
}

export interface TipoArquivo {
  tipo: 'vendas_nex' | 'por_produto' | 'financeiro' | 'clientes' | 'generico'
  motivo: string[]
}

/** Identificação do tipo de exportação (sem chutar): pelas colunas do cabeçalho. */
export function identificarTipoArquivo(a: AnaliseArquivo): TipoArquivo {
  const cols = (a.sheets[0]?.colunas || []).map((c) => c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_\-]+/g, ''))
  const tem = (rgx: RegExp) => cols.some((c) => rgx.test(c))
  const motivo: string[] = [`colunas: ${(a.sheets[0]?.colunas || []).slice(0, 8).join(', ')}${(a.sheets[0]?.colunas || []).length > 8 ? ', …' : ''}`]
  if (tem(/^notran$/) || (tem(/^tipo$/) && (tem(/^totalfinal$/) || tem(/^meiopagto$/) || tem(/^cancelado$/)))) {
    return { tipo: 'vendas_nex', motivo: ['cabeçalho de exportação de vendas do Nex (No.Tran/Tipo/Total Final)'] }
  }
  if (tem(/^produto$/) && (tem(/^quant/) || tem(/^unidade/) || tem(/^preco/))) {
    return { tipo: 'por_produto', motivo: ['relatório por produto (coluna Produto presente)'] }
  }
  if (tem(/^receita/) || tem(/^custo/) || tem(/^lucro/) || tem(/^despesa/)) {
    return { tipo: 'financeiro', motivo: ['colunas de resultado financeiro detectadas'] }
  }
  if (tem(/^nome/) && (tem(/^cpf/) || tem(/^cnpj/) || tem(/^telefone/))) {
    return { tipo: 'clientes', motivo: ['colunas de cadastro de clientes detectadas'] }
  }
  return { tipo: 'generico', motivo: ['cabeçalho não corresponde a nenhum tipo Nx conhecido'] }
}

// Mapa de campos do importador → colunas candidatas (espelho do HEADERS em xls.ts).
const CAMPOS_MAPEAVEIS: Array<{ campo: string; aliases: string[] }> = [
  { campo: 'No.Tran', aliases: ['No.Tran', 'Nr', 'Numero', 'No', 'N.'] },
  { campo: 'Tipo', aliases: ['Tipo', 'Tipo Tran'] },
  { campo: 'Data', aliases: ['Data', 'Data Tran'] },
  { campo: 'Hora', aliases: ['Hora', 'Hora Tran'] },
  { campo: 'Total Final', aliases: ['Total Final', 'Total', 'Total Venda'] },
  { campo: 'Desconto', aliases: ['Desconto', 'Desc'] },
  { campo: 'Valor Pago', aliases: ['Valor Pago', 'Vlr Pago', 'Pago', 'Vl.Pago'] },
  { campo: 'Meio Pagto', aliases: ['Meio Pagto', 'Forma Pagto', 'Pagto', 'Pagamento', 'Meio'] },
  { campo: 'Cliente', aliases: ['Cliente'] },
  { campo: 'Vendedor', aliases: ['Vendedor', 'Vend'] },
  { campo: 'Cancelado', aliases: ['Cancelado', 'Venda Cancelada'] },
]

/** Mapeamento exibido na tela: campo do importador ← coluna efetivamente usada. */
export function mapearColunas(colunas: string[]): Array<{ campo: string; coluna: string | null }> {
  const norm = (c: string) => c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_\-]+/g, '').replace(/[^a-z0-9]/g, '')
  const normCols = colunas.map(norm)
  const out: Array<{ campo: string; coluna: string | null }> = []
  for (const f of CAMPOS_MAPEAVEIS) {
    let col: string | null = null
    for (const alias of f.aliases) {
      const a = norm(alias)
      const i = normCols.findIndex((c) => c === a)
      if (i >= 0) { col = colunas[i]; break }
    }
    if (col == null) {
      for (const alias of f.aliases) {
        const a = norm(alias)
        const i = normCols.findIndex((c) => c.includes(a))
        if (i >= 0) { col = colunas[i]; break }
      }
    }
    out.push({ campo: f.campo, coluna: col })
  }
  return out
}

export interface AnaliseDetalhada {
  arquivo: string
  sheets: number
  linhas: number
  analise: AnaliseArquivo
  tipo: TipoArquivo
  mapeamento: ReturnType<typeof mapearColunas>
  vendas: number
  outras: number
  invalidas: number
  duplicadas: number
  somaTotal: number
  somaPago: number
}

/** Análise de UM arquivo (identificação de tipo + mapeamento + validação de linhas). */
export async function analisar(arquivo: string): Promise<AnaliseDetalhada> {
  return comOcupacao(async () => {
    progresso.ativo = true
    progresso.iniciadoEm = Date.now()
    try {
      etapa('Analisando arquivo', basename(arquivo))
      const analise = analisarXLS(arquivo)
      const tipo = identificarTipoArquivo(analise)
      const mapeamento = mapearColunas(analise.sheets[0]?.colunas || [])
      const { vendas, outras } = await lerTransacoesXLS(arquivo)
      const invalidas = vendas.filter((v) => !v.id.trim()).length
      const vistos = new Set<string>()
      let duplicadas = 0
      let somaTotal = 0
      let somaPago = 0
      for (const v of vendas) {
        if (!v.id.trim()) continue
        const chave = chaveUnicaVenda(v)
        if (vistos.has(chave)) duplicadas++
        else vistos.add(chave)
        somaTotal += v.totalFinal
        somaPago += v.valorPago
      }
      etapa('Análise concluída', '')
      return { arquivo, sheets: analise.sheets.length, linhas: analise.sheets.reduce((a, s) => a + s.linhas, 0), analise, tipo, mapeamento, vendas: vendas.length, outras: outras.length, invalidas, duplicadas, somaTotal: +somaTotal.toFixed(2), somaPago: +somaPago.toFixed(2) }
    } finally {
      progresso.ativo = false
      progresso.etapa = ''
      progresso.detalhe = ''
    }
  })
}

// ---------------------------------------------------------------------------
// Preparação (snapshot + índices NX) e preview/importação
// ---------------------------------------------------------------------------

export function getPreparado() {
  if (!preparado) return null
  return {
    snapshotDir: preparado.snapshot.dir,
    montadoEm: preparado.montadoEm,
    arquivos: ['Tran.nx1', 'MovEst.nx1', 'PagEspecies.nx1'],
  }
}

async function prepararInternoSnap(opts: { reusar?: boolean }): Promise<SnapshotHomologacao> {
  if (opts.reusar) {
    const base = getHomologDir()
    if (existsSync(base)) {
      const snaps = readdirSync(base).filter((f) => f.startsWith('snap-')).sort().reverse()
      if (snaps.length) {
        const dir = join(base, snaps[0])
        const dbPath = join(dir, 'tabacaria.sqlite')
        if (existsSync(dbPath)) {
          return { dir, dbPath, estadoPath: join(dir, 'homologacao.json'), circuito: { ds: 'CIRCUITO_AUDITORIA_1', criado_em: '', producao_db_sha256: '', backups_sha256: {} } }
        }
      }
    }
  }
  return criarSnapshotHomologacao('nex-importacao')
}

/** Cria/recicla snapshot e monta índices NX (demorado; com progresso). */
export async function preparar(opts: { reusar?: boolean } = {}): Promise<{ snapshotDir: string; montadoEm: string; recon: unknown; pag: unknown }> {
  return comOcupacao(async () => {
    progresso.ativo = true
    progresso.iniciadoEm = Date.now()
    try {
      etapa('Preparando snapshot de homologação', opts.reusar ? 'reutilizando o mais recente' : 'criando novo (VACUUM INTO de leitura)')
      const snapshot = await prepararInternoSnap(opts)
      etapa('Lendo arquivos NX', 'Tran.nx1, MovEst.nx1, PagEspecies.nx1')
      const nxDir = getNxDir()
      const buffers = {
        tran: lerArquivo(nxDir, 'Tran.nx1'),
        mov: lerArquivo(nxDir, 'MovEst.nx1'),
        pag: lerArquivo(nxDir, 'PagEspecies.nx1'),
      }
      etapa('Classificando transações', 'TranNome=Venda')
      const recon = resumoReconstrucaoNX(buffers.tran, buffers.mov, null)
      const idsVendas = new Set(recon.vendasNX.map((v) => v.id))
      const pag = lerPagEspecies(buffers.pag, idsVendas)
      const pagamentosPorVenda = new Map<number, string[]>()
      const totalPorVenda = new Map<number, number>()
      for (const it of lerItensMovEst(buffers.mov)) {
        if (idsVendas.has(it.tran)) totalPorVenda.set(it.tran, Math.round(((totalPorVenda.get(it.tran) || 0) + it.total) * 100) / 100)
      }
      for (const rec of pag.amostra) {
        if (rec.vinculadoAVenda) {
          const arr = pagamentosPorVenda.get(rec.tran) || []
          arr.push(String(rec.especie))
          pagamentosPorVenda.set(rec.tran, arr)
        }
      }
      const indices = montarIndiceNX(recon.registros, totalPorVenda, pagamentosPorVenda)
      registrarPasso(snapshot, `preparacao servidor: ${recon.vendasNX.length} vendas NX, ${pag.totalTriplasValidas} registros PagEspecies`)
      etapa('Preparação concluída', '')
      preparado = { snapshot, buffers, indices, montadoEm: new Date().toISOString(), recon: resumoRecon(recon), pag: resumoPag(pag) }
      progresso.ativo = false
      progresso.etapa = ''
      progresso.detalhe = ''
      return { snapshotDir: snapshot.dir, montadoEm: preparado.montadoEm, recon: preparado.recon, pag: preparado.pag }
    } catch (err) {
      progresso.ativo = false
      progresso.etapa = ''
      progresso.detalhe = ''
      throw err
    }
  })
}

export function resumoRecon(recon: ReturnType<typeof resumoReconstrucaoNX>) {
  return {
    vendasNX: recon.vendasNX.length,
    totalRegistrosTran: recon.totalRegistrosTran,
    porTipo: recon.porTipo,
    porAno: recon.porAno,
    idsComItem: recon.idsComItem,
    itensTotais: recon.itensTotais,
    itensSemVenda: recon.itensSemVenda,
    somaValorMovEst: recon.somaValorMovEst,
  }
}

function resumoPag(pag: ReturnType<typeof lerPagEspecies>) {
  return {
    totalTriplasValidas: pag.totalTriplasValidas,
    vinculadasAVenda: pag.vinculadasAVenda,
    naoVinculadas: pag.naoVinculadas,
    formas: pag.formas,
  }
}

export function montarPendentes(vendasXLS: TransacaoXLS[], correlacoes: Correlacao[], confiancaMin: ConfiancaMin): VendaProntaIportar[] {
  const pendentes: VendaProntaIportar[] = []
  for (let i = 0; i < vendasXLS.length; i++) {
    const c = correlacoes[i]
    if (!c) continue
    if (c.confianca === 'AMBÍGUA' || c.confianca === 'NÃO ENCONTRADA' || c.xlsData == null) continue
    if (confiancaMin === 'EXATA' && c.confianca !== 'EXATA') continue
    if (confiancaMin === 'ALTA CONFIANÇA' && c.confianca !== 'EXATA' && c.confianca !== 'ALTA CONFIANÇA') continue
    pendentes.push({ xls: vendasXLS[i], nxId: c.nxId, confianca: c.confianca, itensNX: [] })
  }
  return pendentes
}

function contagemPorConfiancaLocal(cs: Correlacao[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of cs) out[c.confianca] = (out[c.confianca] || 0) + 1
  return out
}

function exigirPreparado(): Preparado {
  if (!preparado) throw new Error('Preparação não realizada. Execute "Preparar base" primeiro.')
  return preparado
}

export interface PreviewServidor {
  arquivo: string
  confiancaMin: ConfiancaMin
  porConfianca: Record<string, number>
  pendentes: number
  preview: ReturnType<typeof previewImportacao>
  amostra: Array<{ xlsId: string; nxId: number | null; confianca: string; criterios: string[] }>
}

/** Correlaciona as vendas do arquivo contra os índices NX e mostra o preview. */
export async function preview(arquivo: string, confiancaMin: ConfiancaMin = 'EXATA'): Promise<PreviewServidor> {
  return comOcupacao(async () => {
    progresso.ativo = true
    progresso.iniciadoEm = Date.now()
    try {
      const p = exigirPreparado()
      etapa('Correlacionando vendas XLS→NX', basename(arquivo))
      const { vendas } = await lerTransacoesXLS(arquivo)
      const correlacoes: Correlacao[] = vendas.map((v) => correlacionar(v, p.indices))
      const porConfianca = contagemPorConfiancaLocal(correlacoes)
      const pendentes = montarPendentes(vendas, correlacoes, confiancaMin)
      etapa('Consultando duplicidades no snapshot', '')
      const prev = previewImportacao(pendentes, p.snapshot)
      etapa('Preview concluído', '')
      return { arquivo, confiancaMin, porConfianca, pendentes: pendentes.length, preview: prev, amostra: correlacoes.slice(0, 30).map((c) => ({ xlsId: c.xlsId, nxId: c.nxId, confianca: c.confianca, criterios: c.criterios.slice(0, 3) })) }
    } finally {
      progresso.ativo = false
      progresso.etapa = ''
      progresso.detalhe = ''
    }
  })
}

export interface ResultadoServidor {
  arquivo: string
  confiancaMin: ConfiancaMin
  snapshotDir: string
  resultado: ResultadoImportacaoHomolog
}

/** Importa para o snapshot de homologação (transacional, com dedup + origem). */
export async function importar(arquivo: string, confiancaMin: ConfiancaMin = 'EXATA'): Promise<ResultadoServidor> {
  return comOcupacao(async () => {
    progresso.ativo = true
    progresso.iniciadoEm = Date.now()
    try {
      const p = exigirPreparado()
      etapa('Correlacionando e importando', basename(arquivo))
      const { vendas } = await lerTransacoesXLS(arquivo)
      const correlacoes: Correlacao[] = vendas.map((v) => correlacionar(v, p.indices))
      const pendentes = montarPendentes(vendas, correlacoes, confiancaMin)
      etapa('Importando (transação no snapshot)', `${pendentes.length} pendentes`)
      const resultado = importarEmHomologacao(pendentes, p.snapshot)
      etapa('Importação concluída', '')
      return { arquivo, confiancaMin, snapshotDir: p.snapshot.dir, resultado }
    } finally {
      progresso.ativo = false
      progresso.etapa = ''
      progresso.detalhe = ''
    }
  })
}

// ---------------------------------------------------------------------------
// Histórico (snapshots) e liberação de memória
// ---------------------------------------------------------------------------

export function historico() {
  const base = getHomologDir()
  if (!existsSync(base)) return []
  const snaps = readdirSync(base).filter((f) => f.startsWith('snap-')).sort().reverse()
  return snaps.slice(0, 20).map((f) => {
    const dir = join(base, f)
    const estadoPath = join(dir, 'homologacao.json')
    let estado: any = null
    try { estado = JSON.parse(readFileSync(estadoPath, 'utf-8')) } catch { /* sem estado */ }
    const dbPath = join(dir, 'tabacaria.sqlite')
    let contagem = { vendas: 0, origens: 0 }
    if (existsSync(dbPath)) {
      try {
        const db = new DatabaseSync(dbPath, { readOnly: true })
        try {
          contagem.vendas = (db.prepare('SELECT COUNT(*) AS n FROM vendas').get() as { n: number }).n
          try { contagem.origens = (db.prepare('SELECT COUNT(*) AS n FROM _auditoria_origem').get() as { n: number }).n } catch { /* tabela só existe após importação */ }
        } finally { db.close() }
      } catch { /* base corrompida/parcial */ }
    }
    return {
      dir,
      nome: f,
      criado_em: estado?.criado_em || estado?.snapshot?.criado_por_snapshot || null,
      criado_por_snapshot: estado?.snapshot?.criado_por_snapshot || null,
      passos: Array.isArray(estado?.passos) ? estado.passos : [],
      ultimo_passo_em: estado?.ultimo_passo_em || null,
      producao_db_sha256: estado?.producao_db_sha256 || null,
      bytes: (() => { try { return statSync(dbPath).size } catch { return 0 } })(),
      vendas: contagem.vendas,
      origens: contagem.origens,
    }
  })
}

export function liberar() {
  preparado = null
  return { ok: true }
}

// Reexport para diagnóstico simples na tela (sem depender de relatorio.ts).
export { lerTransacoesXLS, normalizarTransacao, lerArquivoXLS }