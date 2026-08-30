import { getDbApi, hasDbApi } from '../../shared/db'
import { calcularPeriodo, clausulaSql } from '../relatorios/periodo'

export interface EstoqueCritico {
  id: number
  nome: string
  estoque: number
  estoque_minimo: number
  preco_venda: number
}

export interface VendaRecente {
  numero: string
  criada_em: string
  cliente: string
  total: number
}

export interface DashboardData {
  nomeLoja: string
  vendasHoje: number
  faturamentoHoje: number
  faturamentoOntem: number
  variacaoFaturamento: number | null
  ticketMedioHoje: number
  caixaAberto: boolean
  caixaUsuario: string | null
  pedidosNovos: number
  produtosAtivos: number
  estoqueCritico: EstoqueCritico[]
  vendasRecentes: VendaRecente[]
  contasAbertas: number
  carregadoEm: string
}

export type EstadoDashboard =
  | { fase: 'carregando' }
  | { fase: 'ok'; dados: DashboardData }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'offline' }

function valor<T>(r: PromiseSettledResult<unknown>, rotulo: string): T {
  if (r.status === 'rejected') throw new Error(rotulo)
  return r.value as T
}

export async function carregarDashboard(): Promise<DashboardData> {
  const db = getDbApi()
  const hoje = calcularPeriodo('hoje')
  const ontem = calcularPeriodo('ontem')
  const vH = clausulaSql('v.created_at', hoje)
  const vO = clausulaSql('v.created_at', ontem)

  const resultados = await Promise.allSettled([
    db.get(`SELECT valor FROM config WHERE chave = 'nome_loja'`),
    db.get(
      `SELECT COUNT(*) AS vendas, COALESCE(SUM(total), 0) AS faturamento
       FROM vendas v WHERE v.status = 'concluida'${vH.sql}`,
      vH.params
    ),
    db.get(
      `SELECT COALESCE(SUM(total), 0) AS faturamento
       FROM vendas v WHERE v.status = 'concluida'${vO.sql}`,
      vO.params
    ),
    db.get(
      `SELECT u.nome AS usuario_nome
       FROM caixas c LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.aberto = 1 ORDER BY c.id DESC LIMIT 1`
    ),
    db.get(`SELECT COUNT(*) AS c FROM pedidos WHERE status = 'novo'`),
    db.get(`SELECT COUNT(*) AS c FROM produtos WHERE ativo = 1`),
    db.all(
      `SELECT id, nome, estoque, estoque_minimo, preco_venda
       FROM produtos
       WHERE ativo = 1 AND controla_estoque = 1 AND estoque <= estoque_minimo
       ORDER BY (estoque_minimo - estoque) DESC
       LIMIT 8`
    ),
    db.all(
      `SELECT v.numero, v.created_at AS criada_em, COALESCE(c.nome, 'Consumidor não identificado') AS cliente, v.total
       FROM vendas v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE v.status = 'concluida'
       ORDER BY v.created_at DESC, v.id DESC
       LIMIT 8`
    ),
    db.get(`SELECT COUNT(*) AS c FROM contas WHERE status = 'aberta'`)
  ])

  const resLoja = valor<{ valor: string | null } | undefined>(resultados[0], 'Falha ao carregar o nome da loja.')
  const resHoje = valor<{ vendas: number; faturamento: number }>(resultados[1], 'Falha ao consultar as vendas de hoje.')
  const resOntem = valor<{ faturamento: number }>(resultados[2], 'Falha ao consultar as vendas de ontem.')
  const resCaixa = valor<{ usuario_nome: string | null } | undefined>(resultados[3], 'Falha ao consultar o caixa.')
  const resPedidos = valor<{ c: number }>(resultados[4], 'Falha ao consultar os pedidos.')
  const resProdutos = valor<{ c: number }>(resultados[5], 'Falha ao consultar os produtos.')
  const resCritico = valor<EstoqueCritico[]>(resultados[6], 'Falha ao consultar o estoque crítico.')
  const resRecentes = valor<VendaRecente[]>(resultados[7], 'Falha ao consultar as vendas recentes.')
  const resContas = valor<{ c: number }>(resultados[8], 'Falha ao consultar as contas.')

  const vendasHoje = resHoje.vendas || 0
  const faturamentoHoje = resHoje.faturamento || 0
  const faturamentoOntem = resOntem.faturamento || 0
  const variacao = faturamentoOntem > 0 ? ((faturamentoHoje - faturamentoOntem) / faturamentoOntem) * 100 : null

  return {
    nomeLoja: resLoja?.valor ?? 'Minha Tabacaria',
    vendasHoje,
    faturamentoHoje,
    faturamentoOntem,
    variacaoFaturamento: variacao,
    ticketMedioHoje: vendasHoje > 0 ? faturamentoHoje / vendasHoje : 0,
    caixaAberto: !!resCaixa,
    caixaUsuario: resCaixa?.usuario_nome ?? null,
    pedidosNovos: resPedidos.c || 0,
    produtosAtivos: resProdutos.c || 0,
    estoqueCritico: resCritico ?? [],
    vendasRecentes: resRecentes ?? [],
    contasAbertas: resContas.c || 0,
    carregadoEm: new Date().toLocaleTimeString('pt-BR')
  }
}

export function estadoInicial(): EstadoDashboard {
  if (!hasDbApi()) return { fase: 'offline' }
  return { fase: 'carregando' }
}