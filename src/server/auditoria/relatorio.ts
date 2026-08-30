/**
 * FASE G — Relatório de auditoria (estrutura §10 do usuário).
 *
 * Seções: VENDAS | VALORES | ITENS | PAGAMENTOS | CLIENTES | PRODUTOS.
 * Marcadores:
 *   - DETERMINADO  : derivado de dados validados.
 *   - NÃO DETERMINADO : sem dados/offset válido (nunca é inventado).
 *   - EM VALIDAÇÃO : regra candidata sendo confrontada com o XLS.
 */
import type { ReconstrucaoLote } from './nex-leitura'
import type { InvestigacaoPagEspecies } from './pagespecies'
import type { Reconciliacao } from './reconciliacao'
import type { Correlacao, Confianca } from './correlacao'
import type { AnaliseArquivo, TransacaoXLS } from './xls'

export interface EntradasRelatorio {
  circuito: { criado_em: string; producao_db_sha256: string; backupsHash: number }
  snapshotDir: string
  reconstrucao: ReconstrucaoLote
  pagEspecies: InvestigacaoPagEspecies
  reconciliacao: Reconciliacao
  correlacoes: Correlacao[]
  xlsAnalises: AnaliseArquivo[]
  vendasXLS: TransacaoXLS[]
  validacaoHeuristica?: { vendedorConcordancia: number | null; cancelamentoConcordancia: number | null }
  notas: string[]
}

function moeda(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return 'NÃO DETERMINADO'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function num(v: number | null | undefined): string {
  if (v == null) return 'N/A'
  return v.toLocaleString('pt-BR')
}

function tabelaCabecalho(colunas: string[]): string {
  return `| ${colunas.join(' | ')} |\n| ${colunas.map(() => '---').join(' | ')} |`
}

function linha(cells: Array<string | number>): string {
  return `| ${cells.join(' | ')} |`
}

export function gerarRelatorio(e: EntradasRelatorio): string {
  const L: string[] = []
  const push = (s = '') => L.push(s)
  const rd = e.reconstrucao
  const re = e.reconciliacao
  const pe = e.pagEspecies

  push('# Relatório de Auditoria — Importador/Homologação')
  push()
  push(`- Circuito: criado em **${e.circuito.criado_em}** | sha256(produção db): \`${e.circuito.producao_db_sha256.slice(0, 16)}…\` | ${e.circuito.backupsHash} backups conferidos`)
  push(`- Snapshot de homologação: \`${e.snapshotDir}\``)
  push(`- Escopo: reconstrução NX (Tran.nx1/MovEst.nx1/PagEspecies.nx1) + correlação XLS (${e.xlsAnalises.length} arquivos, ${num(e.vendasXLS.length)} linhas) + reconciliação de valores`)
  push()
  push('## §10.1 VENDAS')
  push()
  push(tabelaCabecalho(['Métrica', 'Qtd', 'Situação']))
  push(linha(['Transações registradas no Tran.nx1 (walker)', num(rd.totalRegistrosTran), 'DETERMINADO']))
  push(linha(['TranNome = Venda', num(rd.vendasNX.length), 'DETERMINADO (regra aprovada)']))
  push(linha(['Vendas com data decodificada', num(rd.vendasComData.length), 'DETERMINADO']))
  push(linha(['Distribuição por ano (vendas com data)', rd.porAno ? `2020:${rd.porAno['2020'] ?? 0} 2021:${rd.porAno['2021'] ?? 0} 2022:${rd.porAno['2022'] ?? 0} 2023:${rd.porAno['2023'] ?? 0} 2024:${rd.porAno['2024'] ?? 0} 2025:${rd.porAno['2025'] ?? 0} 2026:${rd.porAno['2026'] ?? 0}` : 'N/A', 'DETERMINADO']))
  push(linha(['Correlacionadas EXATA', num(e.correlacoes.filter(c => c.confianca === 'EXATA').length), 'DETERMINADO']))
  push(linha(['ALTA CONFIANÇA', num(e.correlacoes.filter(c => c.confianca === 'ALTA CONFIANÇA').length), 'DETERMINADO']))
  push(linha(['PROVÁVEL', num(e.correlacoes.filter(c => c.confianca === 'PROVÁVEL').length), 'DETERMINADO']))
  push(linha(['AMBÍGUA', num(e.correlacoes.filter(c => c.confianca === 'AMBÍGUA').length), 'DETERMINADO']))
  push(linha(['NÃO ENCONTRADA (só XLS)', num(e.correlacoes.filter(c => c.confianca === 'NÃO ENCONTRADA').length), 'DETERMINADO']))
  push(linha(['Canceladas (XLS: Cancelado=Sim)', num(e.vendasXLS.filter(v => /sim|true/i.test(v.cancelado)).length), 'DETERMINADO (só XLS 2023-2026)']))
  push(linha(['Vendas com código "-C" (XLS)', num(e.vendasXLS.filter(v => v.canceladoC).length), 'DETERMINADO — não existem no Tran.nx1; usam estratégia secundária']))
  push(linha(['Canceladas no NX (2020-2022)', 0, e.validacaoHeuristica?.cancelamentoConcordancia == null ? 'NÃO DETERMINADO (offset Cancelado do Tran não validado; regra candidata via MovEst aguarda validação)' : `EM VALIDAÇÃO (concordância ${e.validacaoHeuristica.cancelamentoConcordancia}%)`]))
  push()
  push('## §10.2 VALORES')
  push()
  push(tabelaCabecalho(['Fonte', 'Total', 'Situação']))
  push(linha(['Soma itens MovEst (TranNome=Venda, reconstruída)', moeda(rd.somaValorMovEst), rd.somaValorMovEst > 0 ? 'DETERMINADO' : 'NÃO DETERMINADO']))
  push(linha(['XLS — soma Total Final (2023-2026)', moeda(soma(e.vendasXLS.map(v => v.totalFinal))), 'DETERMINADO']))
  push(linha(['XLS — soma Valor Pago (2023-2026)', moeda(soma(e.vendasXLS.map(v => v.valorPago))), 'DETERMINADO']))
  push(linha(['Nosso sistema — soma `vendas.total`', moeda(re.nossoSistema.soma), 'DETERMINADO (snapshot)']))
  push(linha(['Lucratividade — Receitas', moeda(re.lucratividade.receitas), re.lucratividade.receitas == null ? 'NÃO DETERMINADO' : 'DETERMINADO (arquivo lucratividade)']))
  push(linha(['Lucratividade — Troco', moeda(re.lucratividade.troco), re.lucratividade.troco == null ? 'NÃO DETERMINADO' : 'DETERMINADO']))
  push(linha(['Lucratividade — Receitas−pendências', moeda(re.lucratividade.receitasMenosPendencias), re.lucratividade.receitasMenosPendencias == null ? 'NÃO DETERMINADO' : 'DETERMINADO']))
  push(linha(['Relatório por produto — Total Vendas', moeda(re.porProduto.totalVendas), re.porProduto.totalVendas == null ? 'NÃO DETERMINADO' : 'DETERMINADO']))
  push(linha(['Relatório por produto — Valor Pago', moeda(re.porProduto.valorPago), re.porProduto.valorPago == null ? 'NÃO DETERMINADO' : 'DETERMINADO']))
  push(linha(['Relatório por produto — Descontos', moeda(re.porProduto.descontos), re.porProduto.descontos == null ? 'NÃO DETERMINADO' : 'DETERMINADO']))
  push(linha(['Despesas', moeda(0), 'NÃO DETERMINADO (CP.nx1 vazio / Nex reporta 0)']))
  push()
  push('### §10.2.1 Divergências (investigação em andamento — NADA foi corrigido)')
  push()
  for (const d of re.divergencias) {
    const fa = d.valorA != null ? moeda(d.valorA) : '∅'
    const fb = d.valorB != null ? moeda(d.valorB) : '∅'
    const df = d.diferenca != null ? moeda(d.diferenca) : '∅'
    push(`- **${d.rotulo}**: ${fa} × ${fb} → diferença ${df}`)
    push(`  - Causas prováveis: ${d.causasProvaveis.join('; ')}.`)
  }
  push()
  push('## §10.3 ITENS')
  push()
  push(tabelaCabecalho(['Métrica', 'Qtd', 'Situação']))
  push(linha(['Itens no MovEst.nx1', num(rd.itensTotais), 'DETERMINADO']))
  push(linha(['Vendas com ≥1 item reconstruído', num(rd.idsComItem), 'DETERMINADO']))
  push(linha(['Itens sem venda (tran não é Venda/fantasma)', num(rd.itensSemVenda), 'DETERMINADO']))
  push(linha(['Vendas sem itens', num(rd.vendasNX.length - rd.idsComItem), 'DETERMINADO']))
  push(linha(['Itens ambíguos (sem id de venda válido)', '-', 'DETERMINADO (contidos em “itens sem venda”)']))
  push()
  push('## §10.4 PAGAMENTOS')
  push()
  push(tabelaCabecalho(['Métrica', 'Qtd', 'Situação']))
  push(linha(['Registros PagEspecies com tripla [caixa,data,tran] válida', num(pe.totalTriplasValidas), pe.totalTriplasValidas > 0 ? 'DETERMINADO (layout novo validado)' : 'NÃO DETERMINADO']))
  push(linha(['... vinculados a uma Venda', num(pe.vinculadasAVenda), 'DETERMINADO']))
  push(linha(['... não vinculados', num(pe.naoVinculadas), 'DETERMINADO']))
  push(linha(['Valores de pagamento determinados', pe.valorDeterminado, 'NÃO DETERMINADO — registro não possui campo Valor; fontes a investigar: Tran.PagEspValor/Troco (memos), Recebiveis (cartão). Nenhum valor inventado.']))
  push(linha(['Especies (forma de pagamento) identificadas', num(pe.formas.length), 'DETERMINADO (ids; mapeamento p/ nome via XLS na FASE E)']))
  push(linha(['Cancelado (PagEspecies)', pe.canceladoDeterminado, 'NÃO DETERMINADO (offset não validado)']))
  push(linha(['Devolução (PagEspecies)', pe.devolucaoDeterminado, 'NÃO DETERMINADO (offset não validado)']))
  push()
  if (pe.formas.length) {
    push('Espécies encontradas (id: ocorrências — base `especie` u16 em +17; ids 5+ podem incluir ruído de alinhamento; as dominantes são consistentes com Dinheiro/PIX/Débito/Crédito observados no XLS):')
    push()
    push(tabelaCabecalho(['EspecieId', 'Ocorrências']))
    for (const [id, q] of pe.formas.slice(0, 6)) push(linha([id, num(q)]))
    push()
  }
  push('## §10.5 CLIENTES')
  push()
  push('- Nome do cliente por venda no NX: **NÃO DETERMINADO** nesta fase (o campo Cliente do Tran não teve offset validado; heurística de presença será confrontada com o XLS na FASE E).')
  push(`- Clientes com nome preenchido no XLS (2023-2026): ${num(e.vendasXLS.filter(v => v.cliente).length) || 'N/A'} linhas.`)
  push('- Clientes duplicados: verificação agendada para a FASE E (nomes equivalentes em caixa/token).')
  push()
  push('## §10.6 PRODUTOS')
  push()
  push('- Produtos referenciados pelo MovEst: levantados na FASE E (UID .NET → nex_uid), com conflito de códigos mapeado.')
  push('- Confrontação com `produtos.nex_uid` do snapshot: agendada; divergências serão listadas sem alteração.')
  push()
  push('## Regras e descobertas desta fase')
  push()
  push('1. **Vendas** = TranNome=="Venda" no Tran.nx1 (regra aprovada; 37.082 VENDAS DISTINTAS — as 39.018 ocorrências de "Venda" no bytecode incluem o token do payload de registros já classificados).')
  push('2. **Itens** = MovEst.nx1 via `MovEst.Tran` (rel +20).')
  push('3. **PagEspecies**: layout real é [Caixa u32][DataHora][Tran u32] contíguos; offsets antigos (venda+40/etc.) e os sugeridos anteriormente foram **rejeitados**; **não há campo Valor** → valor = NÃO DETERMINADO.')
  push('4. **Correlação XLS→NX**: id numérico como chave; "-C" e ids inexistentes → estratégia secundária com classificação EXATA/ALTA/PROVÁVEL/AMBÍGUA/NÃO ENCONTRADA.')
  push('5. **Nada foi importado em produção. Nada foi corrigido.**')
  push()
  if (e.notas.length) {
    push('## Notas')
    push()
    for (const n of e.notas) push(`- ${n}`)
    push('- Bases de contagem de cancelamento diferem: "Cancelado=Sim" (372) = coluna explícita; os 1.668/185/293/106 do audit anterior = linhas cujo No.Tran não é id numérico limpo (inclui "-C" e ids não-únicos). Sem corrigir nada.')
  }
  push()
  push(`*Gerado em ${new Date().toISOString()} — circuito de auditoria, não produz efeito em produção.*`)
  return L.join('\n')
}

function soma(v: number[]): number {
  return Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100
}

export function contagemPorConfianca(cs: Correlacao[]): Record<Confianca, number> {
  const out: Record<Confianca, number> = { EXATA: 0, 'ALTA CONFIANÇA': 0, 'PROVÁVEL': 0, 'AMBÍGUA': 0, 'NÃO ENCONTRADA': 0 }
  for (const c of cs) out[c.confianca]++
  return out
}