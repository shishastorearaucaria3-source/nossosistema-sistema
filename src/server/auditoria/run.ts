/**
 * CLI de auditoria / homologação.
 *
 *   node dist/server/server/auditoria/run.js relatorio
 *   node dist/server/server/auditoria/run.js relatorio --reuse   (reutiliza último snapshot)
 *
 * NUNCA grava em produção: cria/usar um snapshot em homologacao/ e todos os
 * artefatos (JSON + relatório MD) ficam nessa pasta.
 */
import { getNxDir, getXlsDir } from './config'
import { abrirBancoHomolog, criarSnapshotHomologacao, registrarPasso, sha256Arquivo, type SnapshotHomologacao } from './homologacao'
import { lerArquivo, resumoReconstrucaoNX } from './nex-leitura'
import { lerPagEspecies } from './pagespecies'
import { lerVendasTran, lerItensMovEst } from '../nex-binary'
import { analisarXLS, lerTransacoesXLS, listarArquivosXLS, normalizarTransacao, type TransacaoXLS } from './xls'
import { correlacionar, montarIndiceNX, type Correlacao, type IndiceNX } from './correlacao'
import { reconciliar } from './reconciliacao'
import { gerarRelatorio, contagemPorConfianca } from './relatorio'
import { previewImportacao, importarEmHomologacao, type VendaProntaIportar } from './importador'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface EstadoExecucao {
  snapshot: SnapshotHomologacao
  buffers: { tran: Buffer; mov: Buffer; pag: Buffer }
  indices: IndiceNX
  correlacoes: Correlacao[]
  vendasXLS: TransacaoXLS[]
}

async function prepararSnapshots(opts: { reuse?: boolean }): Promise<SnapshotHomologacao> {
  const base = join(process.cwd(), 'homologacao')
  if (opts.reuse && existsSync(base)) {
    const snaps = readdirSync(base).filter((f) => f.startsWith('snap-')).sort().reverse()
    if (snaps.length) {
      const dir = join(base, snaps[0])
      const dbPath = join(dir, 'tabacaria.sqlite')
      if (existsSync(dbPath)) {
        // reabre estado original
        return { dir, dbPath, estadoPath: join(dir, 'homologacao.json'), circuito: { ds: 'CIRCUITO_AUDITORIA_1', criado_em: '', producao_db_sha256: '', backups_sha256: {} } }
      }
    }
  }
  return criarSnapshotHomologacao()
}

export async function executar(opts: { reuse?: boolean; importar?: boolean; confiancaMin?: 'EXATA' | 'ALTA CONFIANÇA' }): Promise<EstadoExecucao> {
  const snapshot = await prepararSnapshots(opts)
  registrarPasso(snapshot, `inicio pipeline (reuse=${!!opts.reuse})`)
  console.log('✔ snapshot de homologação:', snapshot.dir)

  const nxDir = getNxDir()
  const xlsDir = getXlsDir()
  const buffers = {
    tran: await lerArquivo(nxDir, 'Tran.nx1'),
    mov: await lerArquivo(nxDir, 'MovEst.nx1'),
    pag: await lerArquivo(nxDir, 'PagEspecies.nx1'),
  }
  console.log('✔ arquivos lidos (Tran, MovEst, PagEspecies)')

  // FASE B + C
  const recon = resumoReconstrucaoNX(buffers.tran, buffers.mov, null)
  const idsVendas = new Set(recon.vendasNX.map((v) => v.id))
  const pag = lerPagEspecies(buffers.pag, idsVendas)
  console.log(`✔ reconstrução NX: ${recon.vendasNX.length} vendas (TranNome=Venda), soma itens ${recon.somaValorMovEst}`)
  console.log(`✔ PagEspecies: ${pag.totalTriplasValidas} registros, ${pag.vinculadasAVenda} vinculados a venda`)

  const pagamentosPorVenda = new Map<number, string[]>()
  const totalPorVenda = new Map<number, number>()
  for (const it of lerItensMovEst(buffers.mov)) {
    if (idsVendas.has(it.tran)) {
      totalPorVenda.set(it.tran, Math.round(((totalPorVenda.get(it.tran) || 0) + it.total) * 100) / 100)
    }
  }
  for (const rec of pag.amostra) {
    if (rec.vinculadoAVenda) {
      const arr = pagamentosPorVenda.get(rec.tran) || []
      arr.push(String(rec.especie))
      pagamentosPorVenda.set(rec.tran, arr)
    }
  }
  const indices = montarIndiceNX(recon.registros, totalPorVenda, pagamentosPorVenda)

  // FASE D (análise + transações XLS)
  const arquivosXLS = listarArquivosXLS(xlsDir)
  const xlsAnalises = arquivosXLS.slice(0, 4).map((f) => analisarXLS(f))
  const vendasXLS: TransacaoXLS[] = []
  const linhasXLS = arquivosXLS.map((f) => lerTransacoesXLS(f)).flat()
  for (const g of linhasXLS) vendasXLS.push(...g.vendas)
  console.log(`✔ XLS: ${arquivosXLS.length} arquivos, ${vendasXLS.length} linhas de venda`)

  // FASE E — correlação XLS→NX
  const correlacoes: Correlacao[] = vendasXLS.map((v) => correlacionar(v, indices))
  const porConfianca = contagemPorConfianca(correlacoes)
  console.log('✔ correlação:', JSON.stringify(porConfianca))

  // FASE F — reconciliação de valores
  const db = abrirBancoHomolog(snapshot)
  const reconcile = reconciliar(db, xlsDir)
  db.close()

  // Persistência dos artefatos
  const artefato = {
    recon: {
      totalRegistrosTran: recon.totalRegistrosTran,
      vendasNX: recon.vendasNX.length,
      porTipo: recon.porTipo,
      porAno: recon.porAno,
      idsComItem: recon.idsComItem,
      itensTotais: recon.itensTotais,
      itensSemVenda: recon.itensSemVenda,
      somaValorMovEst: recon.somaValorMovEst,
      porAnoValor: recon.somaValorMovEstPorAno,
    },
    pagEspecies: {
      totalTriplasValidas: pag.totalTriplasValidas,
      vinculadasAVenda: pag.vinculadasAVenda,
      naoVinculadas: pag.naoVinculadas,
      formas: pag.formas,
    },
    correlacao: porConfianca,
    xls: { arquivos: arquivosXLS, linhas: vendasXLS.length },
    reconciliacao: reconcile,
    correlacoes: correlacoes.slice(0, 500).map((c) => ({ id: c.xlsId, nx: c.nxId, conf: c.confianca, criterios: c.criterios })),
  }
  const jsonPath = join(snapshot.dir, 'artefatos-auditoria.json')
  writeFileSync(jsonPath, JSON.stringify(artefato, null, 2), 'utf-8')

  const relatorio = gerarRelatorio({
    circuito: {
      criado_em: new Date().toISOString(),
      producao_db_sha256: (await sha256Arquivo(snapshot.dbPath)).slice(0, 64),
      backupsHash: Object.keys(snapshot.circuito.backups_sha256 || {}).length,
    },
    snapshotDir: snapshot.dir,
    reconstrucao: recon,
    pagEspecies: pag,
    reconciliacao: reconcile,
    correlacoes,
    xlsAnalises,
    vendasXLS,
    notas: [
      'Valores de PagEspecies ficam NÃO DETERMINADO até validar a fonte (PagEspValor/Troco memos ou Recebiveis).',
      'Casos "-C" e AMBÍGUAS/NÃO ENCONTRADAS não são importados automaticamente.',
      'Importação em produção é proibida nesta fase.',
    ],
  })
  const relPath = join(snapshot.dir, 'relatorio-auditoria.md')
  writeFileSync(relPath, relatorio, 'utf-8')
  console.log('✔ relatório:', relPath)

  // FASE D2 — importação homolog (opcional)
  if (opts.importar) {
    const confiancaMin = opts.confiancaMin ?? 'ALTA CONFIANÇA'
    const pendentes: VendaProntaIportar[] = []
    for (let i = 0; i < vendasXLS.length; i++) {
      const c = correlacoes[i]
      if (!c) continue
      if (c.confianca === 'AMBÍGUA' || c.confianca === 'NÃO ENCONTRADA' || c.xlsData == null) continue
      if (confiancaMin === 'ALTA CONFIANÇA' && c.confianca !== 'EXATA' && c.confianca !== 'ALTA CONFIANÇA') continue
      if (confiancaMin === 'EXATA' && c.confianca !== 'EXATA') continue
      pendentes.push({ xls: vendasXLS[i], nxId: c.nxId, confianca: c.confianca, itensNX: [] })
    }
    const preview = previewImportacao(pendentes, snapshot)
    console.log('preview: prontas', preview.prontas, 'casoC', preview.casoC, 'ambiguas', preview.ambiguas, 'semCorrelacao', preview.semCorrelacao)
    const r = importarEmHomologacao(pendentes, snapshot)
    console.log('importação (homolog):', JSON.stringify(r.resumoPorArquivo), 'erros', r.erros.length)
  }
  registrarPasso(snapshot, 'pipeline concluído')
  return { snapshot, buffers, indices, correlacoes, vendasXLS }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const reuse = args.includes('--reuse')
  const importar = args.includes('--importar')
  const confMin = args.includes('--exata') ? 'EXATA' as const : 'ALTA CONFIANÇA' as const
  try {
    await executar({ reuse, importar, confiancaMin: confMin })
  } catch (err) {
    console.error('FALHA:', (err as Error).message)
    process.exit(1)
  }
}

void main()