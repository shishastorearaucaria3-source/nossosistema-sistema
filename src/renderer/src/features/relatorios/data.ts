import { getDbApi } from '../../shared/db'
import { Periodo, clausulaSql } from './periodo'

export type Metrica = 'faturamento' | 'quantidade' | 'ticket' | 'lucro'

export interface LinhaHora {
  hora: string
  vendas: number
  ticketMedio: number
  lucroBruto: number
  faturamento: number
}

export const reportFilters = {
  datas: [
    { chave: 'hoje', label: 'Hoje' },
    { chave: 'ontem', label: 'Ontem' },
    { chave: 'esta_semana', label: 'Esta semana' },
    { chave: 'semana_passada', label: 'Semana passada' },
    { chave: 'este_mes', label: 'Este mês' },
    { chave: 'mes_passado', label: 'Mês passado' },
    { chave: 'ultimos_7', label: 'Últimos 7 dias' },
    { chave: 'ultimos_15', label: 'Últimos 15 dias' },
    { chave: 'ultimos_30', label: 'Últimos 30 dias' },
    { chave: 'personalizado', label: 'Personalizado' }
  ],
  tiposData: ['Data de Transação', 'Data de Venda', 'Data de Pagamento'],
  horas: ['Todas', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00']
}

// TODAS as consultas com filtro de período recebem o MESMO objeto Periodo
// (limites calculados em horário LOCAL) e geram cláusula SQL parametrizada com
// os limites convertidos para UTC — uma única fonte de verdade para todos os
// relatórios. Nada de datetime('now')/date('now') espalhado pelo código.
const V = (p: Periodo) => clausulaSql('v.created_at', p)
const C = (p: Periodo) => clausulaSql('c.aberto_em', p)

export async function carregarMetricas(p: Periodo): Promise<{ faturamento: number; quantidade: number; ticket: number; lucro: number }> {
  const db = getDbApi()
  const v = V(p)
  const res = (await db.get(
    `SELECT COUNT(*) AS vendas, COALESCE(SUM(total),0) AS faturamento
     FROM vendas v WHERE v.status='concluida'${v.sql}`,
    v.params
  )) as { vendas: number; faturamento: number }
  const lucro = (await db.get(
    `SELECT COALESCE(SUM((vi.preco_unitario - COALESCE(p.preco_custo,0)) * vi.quantidade),0) AS lucro
     FROM venda_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     LEFT JOIN produtos p ON p.id = vi.produto_id
     WHERE v.status='concluida'${v.sql}`,
    v.params
  )) as { lucro: number }
  if (res.vendas > 0) {
    return {
      faturamento: res.faturamento,
      quantidade: res.vendas,
      ticket: res.vendas > 0 ? res.faturamento / res.vendas : 0,
      lucro: lucro.lucro
    }
  }
  const c = C(p)
  const caixas = (await db.get(
    `SELECT COALESCE(SUM(total_vendas),0) AS faturamento, COALESCE(SUM(qtd_vendas),0) AS quantidade
     FROM caixas c WHERE c.aberto = 0${c.sql}`,
    c.params
  )) as { faturamento: number; quantidade: number }
  return {
    faturamento: caixas.faturamento,
    quantidade: caixas.quantidade,
    ticket: caixas.quantidade > 0 ? caixas.faturamento / caixas.quantidade : 0,
    lucro: 0
  }
}

export async function carregarVendasPorHora(p: Periodo): Promise<LinhaHora[]> {
  const db = getDbApi()
  const v = V(p)
  const vendas = (await db.all(
    `SELECT substr(v.created_at,12,2) AS hora, COUNT(*) AS vendas, COALESCE(SUM(v.total),0) AS faturamento, AVG(v.total) AS ticket
     FROM vendas v WHERE v.status='concluida'${v.sql}
     GROUP BY substr(v.created_at,12,2) ORDER BY hora`,
    v.params
  )) as unknown as { hora: string; vendas: number; faturamento: number; ticket: number }[]
  if (vendas.length > 0) {
    const lucros = (await db.all(
      `SELECT substr(v.created_at,12,2) AS hora, COALESCE(SUM((vi.preco_unitario - COALESCE(p.preco_custo,0)) * vi.quantidade),0) AS lucro
       FROM venda_itens vi
       JOIN vendas v ON v.id = vi.venda_id
       LEFT JOIN produtos p ON p.id = vi.produto_id
       WHERE v.status='concluida'${v.sql}
       GROUP BY substr(v.created_at,12,2)`,
      v.params
    )) as unknown as { hora: string; lucro: number }[]
    const lucroMap = new Map(lucros.map((l) => [l.hora, l.lucro]))
    return vendas.map((x) => ({
      hora: `${x.hora}:00`,
      vendas: x.vendas,
      ticketMedio: x.ticket || 0,
      lucroBruto: lucroMap.get(x.hora) || 0,
      faturamento: x.faturamento
    }))
  }
  const c = C(p)
  const caixas = (await db.all(
    `SELECT substr(c.aberto_em,12,2) AS hora, COALESCE(SUM(c.total_vendas),0) AS faturamento, COALESCE(SUM(c.qtd_vendas),0) AS vendas
     FROM caixas c WHERE c.aberto = 0${c.sql}
     GROUP BY substr(c.aberto_em,12,2) ORDER BY hora`,
    c.params
  )) as unknown as { hora: string; vendas: number; faturamento: number }[]
  return caixas.map((x) => ({
    hora: `${x.hora}:00`,
    vendas: x.vendas,
    ticketMedio: x.vendas > 0 ? x.faturamento / x.vendas : 0,
    lucroBruto: 0,
    faturamento: x.faturamento
  }))
}

export async function carregarMeiosPagamento(p: Periodo): Promise<{ forma: string; valor: number; qtd: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT p.forma, COUNT(*) AS qtd, SUM(p.valor) AS valor
     FROM pagamentos p
     JOIN vendas v ON v.id = p.venda_id
     WHERE v.status='concluida'${v.sql}
     GROUP BY p.forma ORDER BY valor DESC`,
    v.params
  )) as unknown as { forma: string; qtd: number; valor: number }[]
  return rows
}

export async function carregarComissaoVendedor(p: Periodo): Promise<{ vendedor: string; vendas: number; total: number; comissao: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT COALESCE(u.nome,'Sem vendedor') AS vendedor, COUNT(*) AS vendas, COALESCE(SUM(v.total),0) AS total,
            COALESCE(SUM(v.total * u.comissao_percent / 100.0),0) AS comissao
     FROM vendas v
     LEFT JOIN usuarios u ON u.id = v.vendedor_id
     WHERE v.status='concluida'${v.sql}
     GROUP BY u.nome ORDER BY total DESC`,
    v.params
  )) as unknown as { vendedor: string; vendas: number; total: number; comissao: number }[]
  return rows
}

export async function carregarPorVendedor(p: Periodo): Promise<{ vendedor: string; vendas: number; total: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT COALESCE(u.nome,'Sem vendedor') AS vendedor, COUNT(*) AS vendas, COALESCE(SUM(v.total),0) AS total
     FROM vendas v LEFT JOIN usuarios u ON u.id = v.vendedor_id
     WHERE v.status='concluida'${v.sql}
     GROUP BY u.nome ORDER BY total DESC`,
    v.params
  )) as unknown as { vendedor: string; vendas: number; total: number }[]
  return rows
}

export async function carregarPorProduto(p: Periodo): Promise<{ produto: string; qtd: number; total: number; lucro: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT vi.nome_produto AS produto, SUM(vi.quantidade) AS qtd, SUM(vi.subtotal) AS total,
            SUM((vi.preco_unitario - COALESCE(p.preco_custo,0)) * vi.quantidade) AS lucro
     FROM venda_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     LEFT JOIN produtos p ON p.id = vi.produto_id
     WHERE v.status='concluida'${v.sql}
     GROUP BY vi.nome_produto ORDER BY total DESC`,
    v.params
  )) as unknown as { produto: string; qtd: number; total: number; lucro: number }[]
  return rows
}

export async function carregarCaixaAtual(): Promise<{
  id: number
  saldo_inicial: number
  total_vendas: number
  total_sangrias: number
  total_suprimentos: number
  qtd_vendas: number
  aberto_em: string
  usuario_nome: string | null
  formas: { forma: string; valor: number }[]
} | null> {
  const db = getDbApi()
  const atual = (await db.get(
    `SELECT c.*, u.nome AS usuario_nome FROM caixas c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE c.aberto = 1 ORDER BY c.id DESC LIMIT 1`
  )) as unknown as { id: number; saldo_inicial: number; total_vendas: number; total_sangrias: number; total_suprimentos: number; qtd_vendas: number; aberto_em: string; usuario_nome: string | null } | undefined
  if (!atual) return null
  const formas = (await db.all(
    `SELECT p.forma, SUM(p.valor) AS valor FROM pagamentos p
     JOIN vendas v ON v.id = p.venda_id
     WHERE v.caixa_id = ? AND v.status != 'cancelada' GROUP BY p.forma ORDER BY valor DESC`,
    [atual.id]
  )) as unknown as { forma: string; valor: number }[]
  return { ...atual, formas }
}

export async function carregarCaixasAnteriores(): Promise<{
  id: number
  aberto_em: string
  fechado_em: string | null
  usuario_nome: string | null
  total_vendas: number
  qtd_vendas: number
  saldo_final: number
}[]> {
  const db = getDbApi()
  const rows = (await db.all(
    `SELECT c.id, c.aberto_em, c.fechado_em, c.total_vendas, c.qtd_vendas, c.saldo_inicial, c.total_sangrias, c.total_suprimentos,
            u.nome AS usuario_nome
     FROM caixas c LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE c.aberto = 0 ORDER BY COALESCE(c.aberto_em, c.fechado_em, '') DESC, c.id DESC LIMIT 30`
  )) as unknown as { id: number; aberto_em: string; fechado_em: string | null; total_vendas: number; qtd_vendas: number; saldo_inicial: number; total_sangrias: number; total_suprimentos: number; usuario_nome: string | null }[]
  return rows.map((r) => ({
    id: r.id,
    aberto_em: r.aberto_em,
    fechado_em: r.fechado_em,
    usuario_nome: r.usuario_nome,
    total_vendas: r.total_vendas,
    qtd_vendas: r.qtd_vendas,
    saldo_final: r.saldo_inicial + r.total_vendas + r.total_suprimentos - r.total_sangrias
  }))
}

export async function carregarEstoqueProdutoVendido(p: Periodo): Promise<{ produto: string; vendidos: number; estoque_atual: number; disponivel: number; total_vendido: number; lucro: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT p.nome AS produto,
            COALESCE(SUM(vi.quantidade),0) AS vendidos,
            COALESCE(p.estoque,0) AS estoque_atual,
            COALESCE(p.estoque,0) AS disponivel,
            COALESCE(SUM(vi.subtotal),0) AS total_vendido,
            COALESCE(SUM((vi.preco_unitario - COALESCE(p.preco_custo,0)) * vi.quantidade),0) AS lucro
     FROM venda_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     JOIN produtos p ON p.id = vi.produto_id
     WHERE v.status='concluida'${v.sql}
     GROUP BY p.id, p.nome, p.estoque, p.preco_custo
     ORDER BY vendidos DESC`,
    v.params
  )) as unknown as { produto: string; vendidos: number; estoque_atual: number; disponivel: number; total_vendido: number; lucro: number }[]
  return rows
}

export async function carregarFornecedorProduto(): Promise<{ fornecedor: string; produtos: number; valor_estoque: number; preco_venda_estoque: number }[]> {
  const db = getDbApi()
  const rows = (await db.all(
    `SELECT COALESCE(f.nome,'Sem fornecedor') AS fornecedor,
            COUNT(DISTINCT p.id) AS produtos,
            COALESCE(SUM(p.estoque * p.preco_custo),0) AS valor_estoque,
            COALESCE(SUM(p.estoque * p.preco_venda),0) AS preco_venda_estoque
     FROM produtos p
     LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
     WHERE p.ativo = 1
     GROUP BY f.nome
     ORDER BY valor_estoque DESC`
  )) as unknown as { fornecedor: string; produtos: number; valor_estoque: number; preco_venda_estoque: number }[]
  return rows
}

export async function carregarVendasAnalitico(p: Periodo): Promise<{ numero: string; data: string; vendedor: string; cliente: string; itens: number; total: number; formas: string }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT v.numero AS numero, v.created_at AS data,
            COALESCE(u.nome,'-') AS vendedor,
            COALESCE(c.nome,'Consumidor não identificado') AS cliente,
            (SELECT COUNT(*) FROM venda_itens vi2 WHERE vi2.venda_id = v.id) AS itens,
            v.total AS total,
            (SELECT GROUP_CONCAT(p.forma, ', ') FROM pagamentos p WHERE p.venda_id = v.id) AS formas
     FROM vendas v
     LEFT JOIN usuarios u ON u.id = v.vendedor_id
     LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE v.status='concluida'${v.sql}
     ORDER BY v.created_at DESC
     LIMIT 500`,
    v.params
  )) as unknown as { numero: string; data: string; vendedor: string; cliente: string; itens: number; total: number; formas: string | null }[]
  return rows.map((r) => ({ ...r, formas: r.formas ?? '-' }))
}

export async function carregarVendasSintetico(p: Periodo): Promise<{ data: string; vendas: number; itens: number; faturamento: number; ticket: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT date(v.created_at) AS data,
            COUNT(*) AS vendas,
            (SELECT COUNT(*) FROM venda_itens vi2 WHERE vi2.venda_id = v.id) AS itens,
            SUM(v.total) AS faturamento,
            AVG(v.total) AS ticket
     FROM vendas v
     WHERE v.status='concluida'${v.sql}
     GROUP BY date(v.created_at)
     ORDER BY data DESC`,
    v.params
  )) as unknown as { data: string; vendas: number; itens: number; faturamento: number; ticket: number }[]
  return rows
}

export async function carregarPorCategoriaProduto(p: Periodo): Promise<{ categoria: string; produto: string; qtd: number; total: number; lucro: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT COALESCE(cat.nome,'Sem categoria') AS categoria,
            vi.nome_produto AS produto,
            SUM(vi.quantidade) AS qtd,
            SUM(vi.subtotal) AS total,
            SUM((vi.preco_unitario - COALESCE(p.preco_custo,0)) * vi.quantidade) AS lucro
     FROM venda_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     LEFT JOIN produtos p ON p.id = vi.produto_id
     LEFT JOIN categorias cat ON cat.id = p.categoria_id
     WHERE v.status='concluida'${v.sql}
     GROUP BY cat.nome, vi.nome_produto
     ORDER BY total DESC`,
    v.params
  )) as unknown as { categoria: string; produto: string; qtd: number; total: number; lucro: number }[]
  return rows
}

export async function carregarPorClienteCategoria(p: Periodo): Promise<{ cliente: string; categoria: string; vendas: number; total: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT COALESCE(c.nome,'Consumidor não identificado') AS cliente,
            COALESCE(cat.nome,'Sem categoria') AS categoria,
            COUNT(DISTINCT v.id) AS vendas,
            SUM(v.total) AS total
     FROM vendas v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN venda_itens vi ON vi.venda_id = v.id
     LEFT JOIN produtos p ON p.id = vi.produto_id
     LEFT JOIN categorias cat ON cat.id = p.categoria_id
     WHERE v.status='concluida'${v.sql}
     GROUP BY c.nome, cat.nome
     ORDER BY total DESC`,
    v.params
  )) as unknown as { cliente: string; categoria: string; vendas: number; total: number }[]
  return rows
}

export async function carregarPorClienteProduto(p: Periodo): Promise<{ cliente: string; produto: string; qtd: number; total: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT COALESCE(c.nome,'Consumidor não identificado') AS cliente,
            vi.nome_produto AS produto,
            SUM(vi.quantidade) AS qtd,
            SUM(vi.subtotal) AS total
     FROM venda_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE v.status='concluida'${v.sql}
     GROUP BY c.nome, vi.nome_produto
     ORDER BY total DESC`,
    v.params
  )) as unknown as { cliente: string; produto: string; qtd: number; total: number }[]
  return rows
}

export async function carregarPorMarca(p: Periodo): Promise<{ marca: string; produto: string; qtd: number; total: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT COALESCE(m.nome,'Sem marca') AS marca,
            vi.nome_produto AS produto,
            SUM(vi.quantidade) AS qtd,
            SUM(vi.subtotal) AS total
     FROM venda_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     LEFT JOIN produtos p ON p.id = vi.produto_id
     LEFT JOIN marcas m ON m.id = p.marca_id
     WHERE v.status='concluida'${v.sql}
     GROUP BY m.nome, vi.nome_produto
     ORDER BY total DESC`,
    v.params
  )) as unknown as { marca: string; produto: string; qtd: number; total: number }[]
  return rows
}

export async function carregarCombo(p: Periodo): Promise<{ nome: string; vendas: number; total: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT vi.nome_produto AS nome, COUNT(DISTINCT v.id) AS vendas, SUM(vi.subtotal) AS total
     FROM venda_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     WHERE v.status='concluida'${v.sql}
     GROUP BY vi.nome_produto
     ORDER BY total DESC
     LIMIT 50`,
    v.params
  )) as unknown as { nome: string; vendas: number; total: number }[]
  return rows
}

export async function carregarRetencao(p: Periodo): Promise<{ periodo: string; clientes_novos: number; clientes_recorrentes: number; recorrencia_pct: number }[]> {
  const db = getDbApi()
  const v = V(p)
  const rows = (await db.all(
    `SELECT date(v.created_at) AS periodo,
            COUNT(DISTINCT v.cliente_id) AS total_clientes
     FROM vendas v
     WHERE v.status='concluida' AND v.cliente_id IS NOT NULL${v.sql}
     GROUP BY date(v.created_at) ORDER BY periodo DESC LIMIT 30`,
    v.params
  )) as unknown as { periodo: string; total_clientes: number }[]
  return rows.map((r) => ({ periodo: r.periodo, clientes_novos: r.total_clientes, clientes_recorrentes: 0, recorrencia_pct: 0 }))
}

export async function carregarMovimentacaoEstoque(p: Periodo): Promise<{ produto: string; entradas: number; saidas: number; saldo: number }[]> {
  const db = getDbApi()
  const m = clausulaSql('m.criado_em', p)
  const rows = (await db.all(
    `SELECT p.nome AS produto,
            COALESCE(SUM(CASE WHEN m.tipo='entrada' THEN m.quantidade ELSE 0 END),0) AS entradas,
            COALESCE(SUM(CASE WHEN m.tipo='saida' THEN m.quantidade ELSE 0 END),0) AS saidas,
            COALESCE(p.estoque,0) AS saldo
     FROM movimentacoes m
     JOIN produtos p ON p.id = m.produto_id
     WHERE 1=1${m.sql}
     GROUP BY p.id, p.nome, p.estoque
     ORDER BY saidas DESC
     LIMIT 200`,
    m.params
  )) as unknown as { produto: string; entradas: number; saidas: number; saldo: number }[]
  return rows
}

export function valorPorMetrica(m: Metrica, linha: LinhaHora): number {
  switch (m) {
    case 'faturamento': return linha.faturamento
    case 'quantidade': return linha.vendas
    case 'ticket': return linha.ticketMedio
    case 'lucro': return linha.lucroBruto
  }
}

export function formatarBRL(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatarCompacto(v: number): string {
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`
  return `R$ ${v.toFixed(0)}`
}
