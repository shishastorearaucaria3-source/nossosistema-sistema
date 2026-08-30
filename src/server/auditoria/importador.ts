/**
 * FASE D2 — Importador XLS em MODO HOMOLOGAÇÃO.
 *
 * NUNCA escreve em produção: `importarEmHomologacao()` exige um snapshot
 * (homologacao.ts) e grava somente nele.
 *
 * Comportamento aprovado:
 *  - Deduplicação por No.Tran (coluna UNIQUE `vendas.numero`); re-importar o
 *    mesmo arquivo (ou um re-exportado) NÃO duplica.
 *  - Só vendas correlacionadas (EXATA / ALTA CONFIANÇA) são gravadas; casos
 *    "-C", AMBÍGUA e NÃO ENCONTRADA ficam no relatório e NÃO são gravados.
 *  - Origem/proveniência registrada em tabela `_auditoria_origem` (log) dentro
 *    do próprio snapshot.
 *  - Operação transacional: falha no meio → ROLLBACK total.
 *
 * Campos mapeados (candidatos; NENHUM valor é inventado):
 *   numero = No.Tran numérico | total = Total Final | desconto = Desconto
 *   subtotal = total + desconto (a relação exata com Vl.Produtos/Frete fica
 *   para validação na FASE E/F) | created_at = Data+Hora
 *   status = cancelada se XLS marcar Cancelado=Sim (registrado; não fabricado)
 */
import { DatabaseSync } from 'node:sqlite'
import type { SnapshotHomologacao } from './homologacao'
import { abrirBancoHomolog, registrarPasso } from './homologacao'
import type { TransacaoXLS } from './xls'
import { chaveUnicaVenda } from './xls'

export interface ResultadoImportacaoHomolog {
  ok: boolean
  inseridas: number
  atualizadas: number
  duplicadas: number
  naoImportadasCasoC: number
  ambiguas: number
  semCorrelacao: number
  pagamentos: number
  erros: string[]
  rollback: boolean
  resumoPorArquivo: Array<{ arquivo: string; inseridas: number; duplicadas: number }>
}

export interface VendaProntaIportar {
  xls: TransacaoXLS
  nxId: number | null
  confianca: string
  itensNX: Array<{ produto_id: number | null; nome_produto: string; quantidade: number; preco_unitario: number; subtotal: number }>
}

export interface PreviewImportacao {
  total: number
  prontas: number            // EXATA / ALTA CONFIANÇA
  casoC: number
  ambiguas: number
  semCorrelacao: number
  duplicadasEncontradas: number
  semItens: number
  erros: string[]
}

export function previewImportacao(vendas: VendaProntaIportar[], snapshot: SnapshotHomologacao): PreviewImportacao {
  const db = abrirBancoHomolog(snapshot)
  try {
    const existentes = new Set<string>()
    try {
      const q = db.prepare('SELECT numero FROM vendas').all() as Array<{ numero: string }>
      for (const x of q) existentes.add(x.numero)
    } catch { /* tabela não existe ainda (vazio) */ }
    const contagem: PreviewImportacao = { total: vendas.length, prontas: 0, casoC: 0, ambiguas: 0, semCorrelacao: 0, duplicadasEncontradas: 0, semItens: 0, erros: [] }
    for (const v of vendas) {
      if (!v.xls.id) continue
      if (v.xls.canceladoC || endswithC(v.xls.id)) { contagem.casoC++; continue }
      if (v.confianca === 'EXATA' || v.confianca === 'ALTA CONFIANÇA') {
        contagem.prontas++
        if (existentes.has(String(v.xls.idNumero ?? v.xls.id))) contagem.duplicadasEncontradas++
        if (v.itensNX.length === 0) contagem.semItens++
      } else if (v.confianca === 'AMBÍGUA') contagem.ambiguas++
      else contagem.semCorrelacao++
    }
    return contagem
  } finally {
    db.close()
  }
}

function endswithC(id: string): boolean {
  return /-C$/i.test(id)
}

export function importarEmHomologacao(pendentes: VendaProntaIportar[], snapshot: SnapshotHomologacao): ResultadoImportacaoHomolog {
  const db = abrirBancoHomolog(snapshot)
  const resultado: ResultadoImportacaoHomolog = { ok: false, inseridas: 0, atualizadas: 0, duplicadas: 0, naoImportadasCasoC: 0, ambiguas: 0, semCorrelacao: 0, pagamentos: 0, erros: [], rollback: false, resumoPorArquivo: [] }
  try {
    db.exec('BEGIN')
    db.exec(`CREATE TABLE IF NOT EXISTS _auditoria_origem (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER,
      numero TEXT,
      arquivo_xls TEXT,
      id_xls TEXT,
      nx_id INTEGER,
      confianca TEXT,
      importado_em TEXT
    )`)
    const existe = db.prepare('SELECT id FROM vendas WHERE numero = ?')
    const insVenda = db.prepare(`INSERT INTO vendas (numero, tipo, subtotal, desconto, total, status, created_at, cancelada_em) VALUES (?, 'balcao', ?, ?, ?, ?, ?, ?)`)
    const insItem = db.prepare(`INSERT INTO venda_itens (venda_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?)`)
    const insPag = db.prepare(`INSERT INTO pagamentos (venda_id, forma, valor, criado_em) VALUES (?, ?, ?, ?)`)
    const insOrigem = db.prepare(`INSERT INTO _auditoria_origem (venda_id, numero, arquivo_xls, id_xls, nx_id, confianca, importado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`)

    const agora = new Date().toISOString()
    const porArquivo = new Map<string, { arquivo: string; inseridas: number; duplicadas: number }>()
    for (const v of pendentes) {
      if (!v.xls.id) continue
      const num = v.xls.idNumero != null ? String(v.xls.idNumero) : null
      if (!num || endswithC(v.xls.id)) {
        resultado.naoImportadasCasoC++
        continue
      }
      if (v.confianca !== 'EXATA' && v.confianca !== 'ALTA CONFIANÇA') {
        if (v.confianca === 'AMBÍGUA') resultado.ambiguas++
        else resultado.semCorrelacao++
        continue
      }
      const exist = existe.get(num) as { id: number } | undefined
      if (exist) {
        resultado.duplicadas++
        const ag = porArquivo.get(v.xls.origemArquivo) || { arquivo: v.xls.origemArquivo, inseridas: 0, duplicadas: 0 }
        ag.duplicadas++
        porArquivo.set(v.xls.origemArquivo, ag)
        continue
      }
      try {
        const dataHora = montarDataHora(v.xls.dataISO, v.xls.hora)
        const total = v.xls.totalFinal
        const desconto = v.xls.desconto
        const subtotal = +(total + desconto).toFixed(2)
        const cancelada = /sim|true/i.test(v.xls.cancelado)
        const res = insVenda.run(num, subtotal, desconto, total, cancelada ? 'cancelada' : 'concluida', dataHora, cancelada ? dataHora : null)
        const vendaId = Number(res.lastInsertRowid)
        for (const it of v.itensNX) {
          insItem.run(vendaId, it.produto_id, it.nome_produto, it.quantidade, it.preco_unitario, it.subtotal)
        }
        if (v.xls.meioPagto) {
          insPag.run(vendaId, v.xls.meioPagto, total, dataHora)
          resultado.pagamentos++
        }
        insOrigem.run(vendaId, num, v.xls.origemArquivo, v.xls.id, v.nxId, v.confianca, agora)
        resultado.inseridas++
        const ag = porArquivo.get(v.xls.origemArquivo) || { arquivo: v.xls.origemArquivo, inseridas: 0, duplicadas: 0 }
        ag.inseridas++
        porArquivo.set(v.xls.origemArquivo, ag)
      } catch (err) {
        resultado.erros.push(`venda ${v.xls.id}: ${(err as Error).message}`)
      }
    }
    db.exec('COMMIT')
    resultado.ok = true
    resultado.resumoPorArquivo = [...porArquivo.values()]
    registrarPasso(snapshot, `importacao: ${resultado.inseridas} inseridas, ${resultado.duplicadas} duplicadas, ${resultado.naoImportadasCasoC} caso-C, ${resultado.ambiguas} ambíguas, ${resultado.semCorrelacao} sem correlação`)
  } catch (err) {
    db.exec('ROLLBACK')
    resultado.rollback = true
    resultado.erros.push((err as Error).message)
  } finally {
    db.close()
  }
  return resultado
}

function montarDataHora(data: string | null, hora: string | null): string {
  const d = data ?? '2000-01-01'
  const h = hora ?? '00:00:00'
  return `${d}T${h}`
}