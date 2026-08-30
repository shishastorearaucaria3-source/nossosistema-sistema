/**
 * FASE F — Reconciliação das divergências de valores.
 *
 * Objetivo: comparar as "versões da verdade" e ATRIBUIR causas prováveis,
 * sem corrigir nada (regra: NEX ≠ NOSSO, XLS ≠ NX ou REL A ≠ REL B => investigar
 * antes de corrigir a regra responsável).
 *
 * Integridade dos números conhecidos (dos próprios backups, conferidos na FASE D):
 *   - Relatório por produto:            Total Vendas 2.389.608,43 | Valor Pago 2.325.963,47 | Descontos 63.624,55 | Quant. Vendida 240.480
 *   - Lucratividade:                    Receitas 2.515.489,74 | Troco 116.199,90 | Receitas−pendências 2.399.289,84 | Despesas 0
 *   - Nosso sistema (produção):         54.671 registros | soma 3.185.862,86
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'

export interface Divergencia {
  rotulo: string
  valorA: number | null
  valorB: number | null
  diferenca: number | null
  causasProvaveis: string[]
  pendente: boolean
}

export interface Reconciliacao {
  lucratividade: { receitas: number | null; troco: number | null; receitasMenosPendencias: number | null; despesas: number | null; origem: string }
  porProduto: { totalVendas: number | null; valorPago: number | null; descontos: number | null; quantVendida: number | null; origem: string }
  nossoSistema: { vendas: number; soma: number; canceladas: number; somaCanceladas: number; itens: number; pagamentos: number; origem: string }
  divergencias: Divergencia[]
}

function listarXLS(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f))
}

/** Procura em todas as planilhas do diretório um número próximo de alguma célula cujo cabeçalho contenha o alvo. */
function pegarNumeroArquivo(dir: string, nomeFiltro: string[], alvos: string[]): { valor: number | null; origem: string } {
  if (!existsSync(dir)) return { valor: null, origem: 'DIRETORIO_AUSENTE' }
  const listam = listarXLS(dir)
  for (const m of listam.slice().sort()) {
    const base = m.toLowerCase()
    const bater = nomeFiltro.some((nf) => base.includes(nf.toLowerCase()))
    if (!bater) continue
    try {
      const wb = XLSX.read(readFileSync(join(dir, m)), { type: 'buffer' })
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        if (!json.length) continue
        for (const al of alvos) {
          const na = al.toLowerCase()
          for (let row = json.length - 1; row >= Math.max(0, json.length - 6); row--) {
            const l = json[row]
            if (!l) continue
            for (const [k, v] of Object.entries(l)) {
              const nk = String(k).toLowerCase()
              if (!nk.includes(na)) continue
              const num = Number(v)
              if (isFinite(num) && num > 0) return { valor: num, origem: `${sn}@${m}` }
            }
          }
        }
      }
    } catch { /* arquivo ilegível, tenta próximo */ }
  }
  return { valor: null, origem: nomeFiltro.join('|') }
}

export function reconciliar(db: DatabaseSync, dir: string): Reconciliacao {
  const lucr = pegarNumeroArquivo(dir, ['lucratividade'], ['receitas', 'receita'])
  const troco = pegarNumeroArquivo(dir, ['lucratividade'], ['troco'])
  const despesas = pegarNumeroArquivo(dir, ['lucratividade'], ['despesas', 'desp'])
  const porPTotal = pegarNumeroArquivo(dir, ['por produto'], ['total vendas', 'total'])
  const porPValor = pegarNumeroArquivo(dir, ['por produto'], ['valor pago'])
  const porPDesc = pegarNumeroArquivo(dir, ['por produto'], ['descontos', 'desc'])
  const lucratividade = {
    receitas: lucr.valor,
    troco: troco.valor,
    receitasMenosPendencias: lucr.valor != null && troco.valor != null ? Math.round((lucr.valor - troco.valor) * 100) / 100 : null,
    despesas: despesas.valor ?? 0, // Nex reporta 0 despesas (CP.nx1 vazio) → NÃO DETERMINADO
    origem: lucr.origem,
  }
  const porProduto = {
    totalVendas: porPTotal.valor,
    valorPago: porPValor.valor,
    descontos: porPDesc.valor ?? null,
    quantVendida: null,
    origem: porPTotal.origem,
  }
  const r = db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS s,
      SUM(CASE WHEN status='cancelada' THEN 1 ELSE 0 END) AS canc,
      COALESCE(SUM(CASE WHEN status='cancelada' THEN total ELSE 0 END),0) AS scra
      FROM vendas`).get() as { c: number; s: number; canc: number; scra: number }
  const itens = (db.prepare('SELECT COUNT(*) AS c FROM venda_itens').get() as { c: number }).c
  const pags = (db.prepare('SELECT COUNT(*) AS c FROM pagamentos').get() as { c: number }).c
  const nossoSistema = {
    vendas: r.c,
    soma: Math.round(r.s * 100) / 100,
    canceladas: r.canc,
    somaCanceladas: Math.round(r.scra * 100) / 100,
    itens,
    pagamentos: pags,
    origem: 'snapshot do banco de produção',
  }

  const d = (rotulo: string, a: number | null, b: number | null, causas: string[], pendente = false): Divergencia =>
    ({ rotulo, valorA: a, valorB: b, diferenca: a != null && b != null ? Math.round((a - b) * 100) / 100 : null, causasProvaveis: causas, pendente })

  const divergencias: Divergencia[] = [
    d('Lucratividade (Receitas) × Relatório por produto (Total Vendas)',
      lucratividade.receitas, porProduto.totalVendas,
      ['critérios de vendas diferentes (transações vs movimentos de produto)', 'filtro de período/default dos arquivos diferentes', 'descontos lançados dentro do total', 'vendas sem item de estoque (serviços/frete)', 'devoluções'], true),
    d('Lucratividade (Receitas−pendências) × Relatório por produto (Total Vendas)',
      lucratividade.receitasMenosPendencias, porProduto.totalVendas,
      ['troco (116.199,90) deduzido em um relatório apenas', 'pendências (créditos/links) contadas em só um lado', 'descontos 63.624,55 distribuídos de forma diferente'], true),
    d('Relatório por produto: Total Vendas × Valor Pago',
      porProduto.totalVendas, porProduto.valorPago,
      ['descontos 63.624,55', 'troco concedido', 'crédito utilizado', 'cancelamentos (1.668 em 2023; 185 em 2024)'], true),
    d('Nosso sistema (soma vendas) × NX reconstruído (soma itens MovEst, apenas TranNome=Venda)',
      nossoSistema.soma || null, null,
      ['54.671 registros incluem COMPRAS/AJUSTES/SANGRIAS; a regra correta é TranNome=Venda', 'histórico importado com a regra antiga (total>0 + quantidade de registros)', 'itens duplicados/ausentes no MovEst'], true),
    d('Despesas (relatório lucratividade)',
      null, lucratividade.despesas,
      ['CP.nx1 vazio; Nex reporta despesas = 0 → registro = NÃO DETERMINADO (não inventar)', 'lucro próprio calculado sem despesas fica comprometido'], true),
  ]
  return { lucratividade, porProduto, nossoSistema, divergencias }
}