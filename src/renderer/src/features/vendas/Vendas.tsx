import { useEffect, useState, useCallback, useRef } from 'react'
import { getDbApi, getAuthApi, getVendasCancelApi } from '../../shared/db'
import Delivery from '../delivery/Delivery'
import EditarPedido from '../delivery/EditarPedido'
import PainelPedido from './PainelPedido'
import PainelVenda from './PainelVenda'
import ConfigVendas from '../pdv/ConfigVendas'

interface Venda {
  id: number
  numero: string
  tipo: string
  subtotal: number
  desconto: number
  total: number
  status: string
  created_at: string
  caixa_id: number | null
  observacoes: string | null
  cliente_nome: string | null
  cliente_telefone: string | null
  pagamentos: string | null
  vendedor_nome: string | null
  itens: string | null
}

interface VendaDetalhe {
  nome_produto: string
  quantidade: number
  preco_unitario: number
  subtotal: number
}

interface Pedido {
  id: number
  numero: string
  cliente_nome: string
  cliente_telefone: string | null
  cliente_endereco: string | null
  observacoes: string | null
  subtotal: number
  taxa_entrega: number
  total: number
  status: string
  criado_em: string
  vendedor_nome?: string | null
  desconto?: number | null
  itens?: { nome: string; quantidade: number }[]
}

interface Orcamento {
  id: number
  numero: string
  cliente_nome: string | null
  total: number
  status: string
  criado_em: string
}

type Aba = 'historico' | 'aberto' | 'aceitar' | 'orcamentos' | 'delivery'
type Visualizacao = 'resumida' | 'produto'
type Periodo = 'recentes' | 'hoje' | 'ontem' | 'semana' | 'mes' | 'ano' | 'caixa_atual'

const COLUNAS_PEDIDO: { chave: string; label: string }[] = [
  { chave: 'numero', label: 'Número' },
  { chave: 'cliente', label: 'Cliente' },
  { chave: 'itens', label: 'Itens' },
  { chave: 'total', label: 'Total' },
  { chave: 'status', label: 'Status' },
  { chave: 'data', label: 'Data' },
  { chave: 'hora', label: 'Hora' },
  { chave: 'contato', label: 'Contato do cliente' },
  { chave: 'observacoes', label: 'Observações' },
  { chave: 'endereco', label: 'Endereço para entrega' },
  { chave: 'taxa', label: 'Taxa de entrega' },
  { chave: 'desconto', label: 'Desconto' },
  { chave: 'total_final', label: 'Total final' },
  { chave: 'data_hora', label: 'Data/Hora' },
  { chave: 'vendedor', label: 'Vendedor' }
]

const COLUNAS_PEDIDO_PADRAO: Record<string, boolean> = {
  numero: true,
  cliente: true,
  itens: true,
  total: true,
  status: true,
  data: true,
  hora: true,
  contato: true,
  observacoes: true,
  endereco: true,
  taxa: true,
  desconto: true,
  total_final: true,
  data_hora: true,
  vendedor: true
}

export default function Vendas({ onNovaVenda, onEditarPedido, onNovoPedido, onNovoOrcamento, pedirConfig }: { onNovaVenda?: () => void; onEditarPedido?: (pedidoId: number) => void; onNovoPedido?: () => void; onNovoOrcamento?: () => void; pedirConfig?: number }) {
  const [aba, setAba] = useState<Aba>('historico')
  const [visualizacao, setVisualizacao] = useState<Visualizacao>('resumida')
  const [periodo, setPeriodo] = useState<Periodo>('caixa_atual')
  const [menuPeriodo, setMenuPeriodo] = useState(false)
  const [vendas, setVendas] = useState<Venda[]>([])
  const [pedidosAbertos, setPedidosAbertos] = useState<Pedido[]>([])
  const [pedidosAceitar, setPedidosAceitar] = useState<Pedido[]>([])
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([])
  const [caixaAberto, setCaixaAberto] = useState<boolean | null>(null)
  const [selecionadaId, setSelecionadaId] = useState<number | null>(null)
  const [detalhe, setDetalhe] = useState<VendaDetalhe[]>([])
  const [detalheVenda, setDetalheVenda] = useState<Venda | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [totalPeriodo, setTotalPeriodo] = useState(0)
  const [editandoPedidoId, setEditandoPedidoId] = useState<number | null>(null)
  const [pedidoPainelId, setPedidoPainelId] = useState<number | null>(null)
  const [vendaPainelId, setVendaPainelId] = useState<number | null>(null)
  const [modalConfigPdv, setModalConfigPdv] = useState(false)
  const ultimoPedirConfig = useRef(pedirConfig ?? 0)
  useEffect(() => {
    if ((pedirConfig ?? 0) > ultimoPedirConfig.current) {
      setModalConfigPdv(true)
      ultimoPedirConfig.current = pedirConfig ?? 0
    }
  }, [pedirConfig])
  const [ordemPedido, setOrdemPedido] = useState<{ chave: string; dir: 'asc' | 'desc' } | null>(null)
  const [menuColunas, setMenuColunas] = useState(false)
  const [colunasPedido, setColunasPedido] = useState<Record<string, boolean>>(() => {
    try {
      const s = localStorage.getItem('pdv_colunas_pedido')
      return s ? JSON.parse(s) : {}
    } catch {
      return {}
    }
  })
  const [limiteItensPedido, setLimiteItensPedido] = useState<number>(() => {
    const s = Number(localStorage.getItem('pdv_limite_itens_pedido'))
    return s > 0 ? s : 2
  })
  const [expansaoPedidos, setExpansaoPedidos] = useState<Record<number, boolean>>({})
  const [largurasColunas, setLargurasColunas] = useState<Record<string, number>>(() => {
    try {
      const s = localStorage.getItem('pdv_larguras_colunas')
      return s ? JSON.parse(s) : {}
    } catch {
      return {}
    }
  })
  const redimensionandoRef = useRef<{ chave: string; startX: number; startW: number } | null>(null)
  const tabelaRef = useRef<HTMLTableElement>(null)
  const wrapAbertoRef = useRef<HTMLDivElement>(null)
  const scrollbarAbertoRef = useRef<HTMLDivElement>(null)
  const wrapHistRef = useRef<HTMLDivElement>(null)
  const scrollbarHistRef = useRef<HTMLDivElement>(null)

  const carregar = useCallback(async () => {
    const db = getDbApi()

    const caixaAtualDb = (await db.get(
      `SELECT id FROM caixas WHERE aberto = 1 ORDER BY id DESC LIMIT 1`
    )) as { id: number } | undefined
    setCaixaAberto(!!caixaAtualDb)

    let periodoFiltro = ''
    let periodoParams: string[] = []
    const agora = new Date()
    const ano = String(agora.getFullYear()).padStart(4, '0')
    const mes = String(agora.getMonth() + 1).padStart(2, '0')
    const dia = String(agora.getDate()).padStart(2, '0')
    const hoje = `${ano}-${mes}-${dia}`

    if (periodo === 'caixa_atual') {
      if (caixaAtualDb) {
        periodoFiltro = `AND v.caixa_id = ?`
        periodoParams = [String(caixaAtualDb.id)]
      } else {
        periodoFiltro = `AND 1 = 0`
        periodoParams = []
      }
    } else if (periodo === 'recentes') {
      const inicio = new Date(agora)
      inicio.setDate(inicio.getDate() - 30)
      const inicioStr = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-${String(inicio.getDate()).padStart(2, '0')}`
      periodoFiltro = `AND date(v.created_at) >= ?`
      periodoParams = [inicioStr]
    } else if (periodo === 'hoje') {
      periodoFiltro = `AND date(v.created_at) = ?`
      periodoParams = [hoje]
    } else if (periodo === 'ontem') {
      const ontem = new Date(agora)
      ontem.setDate(ontem.getDate() - 1)
      const ontemStr = `${ontem.getFullYear()}-${String(ontem.getMonth() + 1).padStart(2, '0')}-${String(ontem.getDate()).padStart(2, '0')}`
      periodoFiltro = `AND date(v.created_at) = ?`
      periodoParams = [ontemStr]
    } else if (periodo === 'semana') {
      const inicio = new Date(agora)
      const diaSemana = inicio.getDay()
      inicio.setDate(inicio.getDate() - diaSemana)
      const inicioStr = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-${String(inicio.getDate()).padStart(2, '0')}`
      periodoFiltro = `AND date(v.created_at) >= ?`
      periodoParams = [inicioStr]
    } else if (periodo === 'mes') {
      periodoFiltro = `AND date(v.created_at) >= ?`
      periodoParams = [`${ano}-${mes}-01`]
    } else if (periodo === 'ano') {
      periodoFiltro = `AND date(v.created_at) >= ?`
      periodoParams = [`${ano}-01-01`]
    }

    const rows = (await db.all(
      `SELECT v.*,
         c.nome AS cliente_nome,
         COALESCE(c.celular, c.telefone) AS cliente_telefone,
         u.nome AS vendedor_nome,
         (SELECT GROUP_CONCAT(p.forma || '|' || p.valor, ', ') FROM pagamentos p WHERE p.venda_id = v.id) AS pagamentos,
         (SELECT GROUP_CONCAT(vi.nome_produto || '|' || vi.quantidade, '~') FROM venda_itens vi WHERE vi.venda_id = v.id) AS itens
       FROM vendas v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       LEFT JOIN usuarios u ON u.id = v.vendedor_id
       WHERE 1=1 ${periodoFiltro}
       ORDER BY CAST(v.numero AS INTEGER) DESC
       LIMIT 500`,
      [...periodoParams]
    )) as unknown as Venda[]
    setVendas(rows)

    const total = (await db.get(
      `SELECT COALESCE(SUM(total), 0) AS t FROM vendas v WHERE v.status = 'concluida' ${periodoFiltro}`,
      periodoParams
    )) as { t: number }
    setTotalPeriodo(total.t)

    const abertos = (await db.all(
      `SELECT p.*, u.nome AS vendedor_nome
       FROM pedidos p
       LEFT JOIN usuarios u ON u.id = p.vendedor_id
       WHERE p.status IN ('aceito', 'em_preparo', 'saiu_entrega') ORDER BY p.id DESC LIMIT 50`
    )) as unknown as Pedido[]
    for (const p of abertos) {
      p.itens = (await db.all(
        `SELECT nome_produto AS nome, quantidade FROM pedido_itens WHERE pedido_id = ?`,
        [p.id]
      )) as unknown as { nome: string; quantidade: number }[]
    }
    setPedidosAbertos(abertos)

    const aceitar = (await db.all(
      `SELECT * FROM pedidos
       WHERE status = 'novo' ORDER BY id DESC LIMIT 50`
    )) as unknown as Pedido[]
    setPedidosAceitar(aceitar)

    const orcs = (await db.all(
      `SELECT id, numero, cliente_nome, total, status, criado_em FROM orcamentos ORDER BY id DESC LIMIT 100`
    )) as unknown as Orcamento[]
    setOrcamentos(orcs)
  }, [periodo])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    const t = setInterval(() => carregar(), 8000)
    return () => clearInterval(t)
  }, [carregar])

  useEffect(() => {
    const fechar = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement
      if (!alvo.closest('.dropdown-periodo')) setMenuPeriodo(false)
      if (!alvo.closest('.dropdown-filtro') && !alvo.closest('.dropdown-colunas-menu')) setMenuColunas(false)
    }
    window.addEventListener('mousedown', fechar)
    return () => window.removeEventListener('mousedown', fechar)
  }, [])

  const verDetalhe = async (v: Venda) => {
    setVendaPainelId(v.id)
  }

  const aceitarPedido = async (p: Pedido) => {
    if (!confirm(`Aceitar o pedido ${p.numero} do cliente ${p.cliente_nome} (R$ ${p.total.toFixed(2)})?`)) return
    await getDbApi().run(`UPDATE pedidos SET status = 'aceito' WHERE id = ?`, [p.id])
    setMensagem(`Pedido ${p.numero} aceito e enviado para o delivery.`)
    carregar()
  }

  const recusarPedido = async (p: Pedido) => {
    if (!confirm(`Recusar o pedido ${p.numero} do cliente ${p.cliente_nome} (R$ ${p.total.toFixed(2)})?`)) return
    await getDbApi().run(`UPDATE pedidos SET status = 'cancelado' WHERE id = ?`, [p.id])
    setMensagem(`Pedido ${p.numero} recusado.`)
    carregar()
  }

  const aprovarOrcamento = async (o: Orcamento) => {
    if (!confirm(`Aprovar o orçamento ${o.numero} (R$ ${o.total.toFixed(2)})? Ele será convertido em pedido em aberto.`)) return
    const db = getDbApi()
    const seq = (await db.get(
      `INSERT INTO sequencias (chave, valor) VALUES ('pedido_online', 1) ON CONFLICT(chave) DO UPDATE SET valor = valor + 1 RETURNING valor`
    )) as { valor: number }
    const numeroPedido = `C-${String(seq.valor).padStart(4, '0')}`
    const agora = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const dados = (await db.get(
      `SELECT cliente_nome, cliente_telefone, cliente_endereco, observacoes, subtotal, taxa_entrega, total, vendedor_id FROM orcamentos WHERE id = ?`,
      [o.id]
    )) as { cliente_nome: string | null; cliente_telefone: string | null; cliente_endereco: string | null; observacoes: string | null; subtotal: number; taxa_entrega: number; total: number; vendedor_id: number | null }
    const res = await db.run(
      `INSERT INTO pedidos (numero, cliente_nome, cliente_telefone, cliente_endereco, observacoes, subtotal, taxa_entrega, total, status, vendedor_id, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aceito', ?, ?)`,
      [numeroPedido, dados.cliente_nome, dados.cliente_telefone, dados.cliente_endereco, dados.observacoes, dados.subtotal, dados.taxa_entrega, dados.total, dados.vendedor_id, agora]
    )
    const pedidoId = Number(res.lastInsertRowid)
    const itens = (await db.all(
      `SELECT produto_id, nome_produto, quantidade, preco_unitario FROM orcamento_itens WHERE orcamento_id = ?`,
      [o.id]
    )) as unknown as { produto_id: number | null; nome_produto: string; quantidade: number; preco_unitario: number }[]
    for (const it of itens) {
      await db.run(
        `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [pedidoId, it.produto_id, it.nome_produto, it.quantidade, it.preco_unitario, it.quantidade * it.preco_unitario]
      )
    }
    await db.run(`UPDATE orcamentos SET status = 'aprovado' WHERE id = ?`, [o.id])
    setMensagem(`Orçamento ${o.numero} aprovado → pedido ${numeroPedido} em aberto.`)
    carregar()
  }

  const cancelarVenda = async (v: Venda) => {
    if (!confirm(`Cancelar a venda ${v.numero} de R$ ${v.total.toFixed(2)}?`)) return
    const sessao = await getAuthApi().session()
    if (!sessao) {
      setMensagem('Sessão expirada. Faça login novamente.')
      return
    }
    try {
      // Cancelamento transacional no servidor: devolve estoque e ajusta o caixa
      // (total_vendas/qtd_vendas/cancelamentos). Restrito a admin/gerente.
      const res = await getVendasCancelApi().cancelar(v.id, sessao.id)
      if (!res.ok) {
        setMensagem(res.erro ?? 'Não foi possível cancelar a venda.')
        return
      }
      setMensagem(`Venda ${res.numero} cancelada, estoque devolvido (${res.itens_devolvidos ?? 0} itens). Caixa ajustado.`)
      setVendaPainelId(null)
      carregar()
    } catch (err) {
      setMensagem(`Erro ao cancelar: ${(err as Error).message}`)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' && selecionadaId !== null) {
        e.preventDefault()
        const v = vendas.find((x) => x.id === selecionadaId)
        if (v) verDetalhe(v)
      }
      if (e.key === 'F4') {
        e.preventDefault()
        setAba('aberto')
      }
      if (e.key === 'F5') {
        e.preventDefault()
        setAba('orcamentos')
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const alvo = e.target as HTMLElement
        if (alvo.tagName === 'INPUT' || alvo.tagName === 'SELECT' || alvo.tagName === 'TEXTAREA') return
        e.preventDefault()
        setSelecionadaId((prev) => {
          const idx = vendas.findIndex((x) => x.id === prev)
          if (idx === -1) return vendas[0]?.id ?? null
          const novo = e.key === 'ArrowDown' ? Math.min(idx + 1, vendas.length - 1) : Math.max(idx - 1, 0)
          return vendas[novo]?.id ?? null
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecionadaId, vendas])

  const fmt = (dt: string | null) => (dt ? dt.replace('T', ' ').slice(0, 16) : '-')
  const fmtData = (dt: string | null) => (dt ? dt.slice(0, 10).split('-').reverse().join('/') : '-')
  const fmtHora = (dt: string | null) => (dt ? dt.slice(11, 16) : '-')

  const pedidosAbertosOrdenados = [...pedidosAbertos].sort((a, b) => {
    if (!ordemPedido) return 0
    const mult = ordemPedido.dir === 'asc' ? 1 : -1
    const chave = ordemPedido.chave
    const valor = (p: Pedido): string | number => {
      switch (chave) {
        case 'numero': return parseInt(p.numero.replace(/\D/g, ''), 10)
        case 'cliente': return p.cliente_nome ?? ''
        case 'itens': return p.itens?.length ?? 0
        case 'total': case 'total_final': return p.total
        case 'taxa': return p.taxa_entrega
        case 'desconto': return p.desconto ?? 0
        case 'contato': return p.cliente_telefone ?? ''
        case 'observacoes': return p.observacoes ?? ''
        case 'endereco': return p.cliente_endereco ?? ''
        case 'data': case 'hora': case 'data_hora': return p.criado_em
        case 'vendedor': return p.vendedor_nome ?? ''
        default: return p.status
      }
    }
    const va = valor(a)
    const vb = valor(b)
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult
    return String(va ?? '').localeCompare(String(vb ?? '')) * mult
  })

  const ordenarPedidos = (chave: string) => {
    setOrdemPedido((prev) => {
      if (prev?.chave === chave) return { chave, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      return { chave, dir: 'asc' }
    })
  }

  const colunasPedidoAtivas = COLUNAS_PEDIDO.map((c) => c.chave).filter((c) => colunasPedido[c] !== false)

  useEffect(() => {
    const t = setTimeout(() => {
      sincronizarScrollbarAberto()
      sincronizarScrollbarHist()
    }, 150)
    return () => clearTimeout(t)
  }, [pedidosAbertos.length, colunasPedidoAtivas.length, limiteItensPedido, vendas.length])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = redimensionandoRef.current
      if (!r) return
      const th = (e.target as HTMLElement).closest('th') as HTMLElement
      gravarLargura(r.chave, r.startW + (e.clientX - r.startX))
      if (th) th.style.width = `${r.startW + (e.clientX - r.startX)}px`
    }
    const onUp = () => {
      redimensionandoRef.current = null
      document.body.classList.remove('resizing-cols')
      setTimeout(() => sincronizarScrollbarAberto(), 50)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [largurasColunas])

  const alternarColunaPedido = (chave: string) => {
    const novo = { ...colunasPedido, [chave]: colunasPedido[chave] === false }
    setColunasPedido(novo)
    try {
      localStorage.setItem('pdv_colunas_pedido', JSON.stringify(novo))
    } catch {
      // ignore
    }
  }

  const iniciarRedimensionar = (chave: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement
    redimensionandoRef.current = { chave, startX: e.clientX, startW: th.offsetWidth }
  }

  const larguraColuna = (chave: string): number | undefined => largurasColunas[chave]

  const gravarLargura = (chave: string, w: number) => {
    const novo = { ...largurasColunas, [chave]: Math.max(60, w) }
    setLargurasColunas(novo)
    try {
      localStorage.setItem('pdv_larguras_colunas', JSON.stringify(novo))
    } catch {
      // ignore
    }
  }

  const mudarLimiteItens = (lim: number) => {
    setLimiteItensPedido(lim)
    try {
      localStorage.setItem('pdv_limite_itens_pedido', String(lim))
    } catch {
      // ignore
    }
  }

  const sincronizarScrollbarAberto = () => {
    const wrap = wrapAbertoRef.current
    const sb = scrollbarAbertoRef.current
    const tabela = tabelaRef.current
    if (!wrap || !sb || !tabela) return
    const temScroll = wrap.scrollWidth > wrap.clientWidth
    sb.style.display = temScroll ? 'block' : 'none'
    if (temScroll) {
      const fill = sb.querySelector('.tabela-scrollbar-fixo-fill') as HTMLElement | null
      if (fill) fill.style.width = `${wrap.scrollWidth}px`
      sb.scrollLeft = wrap.scrollLeft
    }
  }

  const onScrollbarAberto = () => {
    const wrap = wrapAbertoRef.current
    const sb = scrollbarAbertoRef.current
    if (wrap && sb) wrap.scrollLeft = sb.scrollLeft
  }

  const sincronizarScrollbarHist = () => {
    const wrap = wrapHistRef.current
    const sb = scrollbarHistRef.current
    if (!wrap || !sb) return
    const temScroll = wrap.scrollWidth > wrap.clientWidth
    sb.style.display = temScroll ? 'block' : 'none'
    if (temScroll) {
      const fill = sb.querySelector('.tabela-scrollbar-fixo-fill') as HTMLElement | null
      if (fill) fill.style.width = `${wrap.scrollWidth}px`
      sb.scrollLeft = wrap.scrollLeft
    }
  }

  const onScrollbarHist = () => {
    const wrap = wrapHistRef.current
    const sb = scrollbarHistRef.current
    if (wrap && sb) wrap.scrollLeft = sb.scrollLeft
  }

  const celulaPedido = (p: Pedido, chave: string) => {
    switch (chave) {
      case 'numero':
        return <span>#{p.numero.replace(/^C-/, '')}</span>
      case 'cliente':
        return <span>{p.cliente_nome || '-'}</span>
      case 'itens':
        return <span>{p.itens?.length ?? 0} itens</span>
      case 'total':
        return <span>R$ {p.total.toFixed(2)}</span>
      case 'status':
        return <span>{p.status}</span>
      case 'data':
        return <span>{fmtData(p.criado_em)}</span>
      case 'hora':
        return <span>{fmtHora(p.criado_em)}</span>
      case 'contato':
        return <span>{p.cliente_telefone || '-'}</span>
      case 'observacoes':
        return <span>{p.observacoes || '-'}</span>
      case 'endereco':
        return <span>{p.cliente_endereco || 'Não se aplica'}</span>
      case 'taxa':
        return <span>R$ {p.taxa_entrega.toFixed(2)}</span>
      case 'desconto':
        return <span>R$ {(p.desconto ?? 0).toFixed(2)}</span>
      case 'total_final':
        return <span>R$ {(p.total).toFixed(2)}</span>
      case 'data_hora':
        return <span>{fmtData(p.criado_em)} {fmtHora(p.criado_em)}</span>
      case 'vendedor':
        return <span>{p.vendedor_nome || '-'}</span>
      default:
        return '-'
    }
  }

  const ROTULO_PERIODO: Record<Periodo, string> = {
    recentes: 'Vendas recentes',
    hoje: 'Hoje',
    ontem: 'Ontem',
    semana: 'Esta semana (dom a dom)',
    mes: 'Este mês',
    ano: 'Este ano',
    caixa_atual: 'Caixa atual'
  }

  const OPCOES_PERIODO: { chave: Periodo; rotulo: string }[] = [
    { chave: 'caixa_atual', rotulo: 'Vendas do caixa atual' },
    { chave: 'recentes', rotulo: 'Vendas recentes' },
    { chave: 'hoje', rotulo: 'Hoje' },
    { chave: 'ontem', rotulo: 'Ontem' },
    { chave: 'semana', rotulo: 'Esta semana (dom a dom)' },
    { chave: 'mes', rotulo: 'Este mês' },
    { chave: 'ano', rotulo: 'Este ano' }
  ]

  const celulaVenda = (v: Venda, chave: string) => {
    const itensV = itensArray(v)
    switch (chave) {
      case 'numero':
        return <span>{vendaNumero(v)}</span>
      case 'cliente':
        return <span>{v.cliente_nome || '-'}</span>
      case 'itens':
        return <span>{itensV.length} itens</span>
      case 'total':
        return <span>R$ {v.total.toFixed(2)}</span>
      case 'status':
        return <span>{v.status === 'cancelada' ? 'Cancelada' : v.status}</span>
      case 'data':
        return <span>{fmtData(v.created_at)}</span>
      case 'hora':
        return <span>{fmtHora(v.created_at)}</span>
      case 'contato':
        return <span>{v.cliente_telefone || '-'}</span>
      case 'observacoes':
        return <span>{v.observacoes || '-'}</span>
      case 'endereco':
        return <span>Local</span>
      case 'taxa':
        return <span>R$ 0,00</span>
      case 'desconto':
        return <span>R$ {v.desconto.toFixed(2)}</span>
      case 'total_final':
        return <span>R$ {v.total.toFixed(2)}</span>
      case 'data_hora':
        return <span>{fmtData(v.created_at)} {fmtHora(v.created_at)}</span>
      case 'vendedor':
        return <span>{v.vendedor_nome || '-'}</span>
      default:
        return '-'
    }
  }

  const itensArray = (v: Venda) => {
    if (!v.itens) return []
    return v.itens.split('~').map((parte) => {
      const [nome, qtd] = parte.split('|')
      return { nome: nome ?? '', qtd: Number(qtd) || 1 }
    })
  }

  const vendaNumero = (v: Venda) => v.numero.replace(/\D/g, '')
  const selecionar = (id: number) => {
    setSelecionadaId((prev) => (prev === id ? null : id))
  }

  const porProduto = () => {
    const mapa = new Map<string, { nome: string; qtd: number; total: number }>()
    for (const v of vendas) {
      if (v.status === 'cancelada') continue
      for (const it of itensArray(v)) {
        const at = mapa.get(it.nome) ?? { nome: it.nome, qtd: 0, total: 0 }
        at.qtd += it.qtd
        mapa.set(it.nome, at)
      }
    }
    return [...mapa.values()].sort((a, b) => b.qtd - a.qtd)
  }

  return (
    <div className="page page-vendas">
      <div className="page-header">
        <h2>Vendas</h2>
        <div className="page-acoes">
          <button className="btn-primario btn-acao-venda" onClick={onNovaVenda}>
            Nova Venda <kbd>F3</kbd>
          </button>
          <button className="btn-secundario" onClick={onNovoPedido}>
            Novo Pedido <kbd>F4</kbd>
          </button>
          <button className="btn-secundario" onClick={onNovoOrcamento}>
            Novo Orçamento <kbd>F5</kbd>
          </button>
          <button className="btn-secundario" onClick={() => setMensagem('Troca ou devolução estará disponível em breve.')}>
            Troca ou Devolução
          </button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      <div className="abas-vendas">
        <button className={`aba ${aba === 'historico' ? 'ativa' : ''}`} onClick={() => setAba('historico')}>
          Histórico
        </button>
        <button className={`aba ${aba === 'aberto' ? 'ativa' : ''}`} onClick={() => setAba('aberto')}>
          {pedidosAbertos.length > 0 ? `${pedidosAbertos.length} Pedido${pedidosAbertos.length > 1 ? 's' : ''} em Aberto` : 'Pedidos em Aberto'}
        </button>
        <button className={`aba ${aba === 'aceitar' ? 'ativa' : ''}`} onClick={() => setAba('aceitar')}>
          {pedidosAceitar.length > 0 ? `${pedidosAceitar.length} Pedido${pedidosAceitar.length > 1 ? 's' : ''} a Aceitar` : 'Pedidos a Aceitar'}
        </button>
        <button className={`aba ${aba === 'orcamentos' ? 'ativa' : ''}`} onClick={() => setAba('orcamentos')}>
          Orçamentos
        </button>
        <button className={`aba ${aba === 'delivery' ? 'ativa' : ''}`} onClick={() => setAba('delivery')}>
          Delivery
        </button>
      </div>

      {aba === 'historico' && (
        <>
          <div className="filtros-vendas">
            <div className="filtro-grupo">
              <span>Visualização:</span>
              <div className="segmented">
                <button className={visualizacao === 'resumida' ? 'ativo' : ''} onClick={() => setVisualizacao('resumida')}>
                  Resumida
                </button>
                <button className={visualizacao === 'produto' ? 'ativo' : ''} onClick={() => setVisualizacao('produto')}>
                  por Produto
                </button>
              </div>
            </div>
            <div className="dropdown-periodo">
              <button className="btn-secundario dropdown-periodo-btn" onClick={() => setMenuPeriodo((m) => !m)}>
                {ROTULO_PERIODO[periodo]} <span className="seta-dropdown">▼</span>
              </button>
              {menuPeriodo && (
                <div className="dropdown-periodo-menu">
                  {OPCOES_PERIODO.map((op) => (
                    <button
                      key={op.chave}
                      className={`dropdown-periodo-item ${periodo === op.chave ? 'ativo' : ''}`}
                      onClick={() => {
                        setPeriodo(op.chave)
                        setMenuPeriodo(false)
                      }}
                    >
                      {op.rotulo}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="total-periodo">Total: <strong>R$ {totalPeriodo.toFixed(2)}</strong></span>
          </div>

          {periodo === 'caixa_atual' && caixaAberto === false && (
            <div className="caixa-fechado-aviso">
              <strong>Caixa fechado</strong>
              <span>Nenhuma venda pode ser lançada. Abra o caixa para registrar as transações do caixa atual.</span>
            </div>
          )}

          <div className="rel-cabecalho">
            <div className="pedido-config-barra">
              <div className="dropdown-filtro">
                <button className="btn-secundario dropdown-periodo-btn" onClick={() => setMenuColunas((v) => !v)}>
                  Colunas ⋯
                </button>
                {menuColunas && (
                  <div className="dropdown-colunas-menu">
                    <div className="dropdown-colunas-titulo">Adicionar ou remover colunas</div>
                    <button className="dropdown-colunas-item" disabled>
                      Ação <span className="dropdown-colunas-lock">🔒</span>
                    </button>
                    {COLUNAS_PEDIDO.map((c) => (
                      <label key={c.chave} className="dropdown-colunas-item">
                        <input
                          type="checkbox"
                          checked={colunasPedido[c.chave] !== false}
                          onChange={() => alternarColunaPedido(c.chave)}
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="tabela-wrap" ref={wrapHistRef} onScroll={sincronizarScrollbarHist}>
            <table className="tabela tabela-vendas" ref={tabelaRef}>
              <thead>
                <tr>
                  <th className="th-acao-fixa">
                    Ação
                    <span className="col-resizer" onMouseDown={(e) => iniciarRedimensionar('acao', e)} />
                  </th>
                  {colunasPedidoAtivas.map((chave) => {
                    const col = COLUNAS_PEDIDO.find((c) => c.chave === chave)
                    const largura = larguraColuna(chave)
                    return (
                      <th key={chave} onClick={() => ordenarPedidos(chave)} className="th-ordena" style={largura ? { width: largura } : undefined}>
                        {col?.label} {ordemPedido?.chave === chave ? (ordemPedido.dir === 'asc' ? '▲' : '▼') : ''}
                        <span className="col-resizer" onMouseDown={(e) => iniciarRedimensionar(chave, e)} />
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visualizacao === 'resumida' &&
                  vendas.map((v) => {
                    const selecionada = selecionadaId === v.id
                    const itens = itensArray(v)
                    return (
                      <tr
                        key={v.id}
                        className={`${v.status === 'cancelada' ? 'linha-cancelada' : ''} ${selecionada ? 'linha-selecionada' : ''}`}
                        onClick={() => selecionar(v.id)}
                        onDoubleClick={() => verDetalhe(v)}
                      >
                        <td className="td-acoes">
                          <button className="btn-abrir-pedido" onClick={(e) => { e.stopPropagation(); verDetalhe(v) }}>
                            Abrir
                          </button>
                        </td>
                        {colunasPedidoAtivas.map((chave) => (
                          <td key={chave} className={chave === 'itens' && itens.length ? 'coluna-itens' : undefined}>
                            {chave === 'itens' && itens.length > 0 ? (
                              <div className="pedido-itens-lista">
                                {itens.slice(0, limiteItensPedido === 0 ? itens.length : limiteItensPedido).map((it, i) => (
                                  <div key={i} className="item-linha">{it.qtd > 1 ? `${it.qtd}x ` : ''}{it.nome}</div>
                                ))}
                                {itens.length > limiteItensPedido && limiteItensPedido > 0 && (
                                  <button className="btn-mini" onClick={(e) => { e.stopPropagation(); verDetalhe(v) }}>
                                    +{itens.length - limiteItensPedido} mais
                                  </button>
                                )}
                              </div>
                            ) : (
                              celulaVenda(v, chave)
                            )}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                {visualizacao === 'produto' &&
                  porProduto().map((p, i) => (
                    <tr key={i}>
                      <td className="td-acoes"></td>
                      {colunasPedidoAtivas.map((chave) =>
                        chave === 'itens' ? (
                          <td key={chave} className="coluna-itens"><strong>{p.qtd}x {p.nome}</strong></td>
                        ) : (
                          <td key={chave}></td>
                        )
                      )}
                    </tr>
                  ))}
                {visualizacao === 'resumida' && vendas.length === 0 && (
                  <tr><td colSpan={colunasPedidoAtivas.length + 1} className="sem-resultado">Nenhuma venda.</td></tr>
                )}
                {visualizacao === 'produto' && porProduto().length === 0 && (
                  <tr><td colSpan={colunasPedidoAtivas.length + 1} className="sem-resultado">Nenhuma venda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="tabela-scrollbar-fixo" ref={scrollbarHistRef} onScroll={onScrollbarHist}>
            <div className="tabela-scrollbar-fixo-fill" />
          </div>
        </>
      )}

      {aba === 'aberto' && (
        <div className="rel-painel">
          <div className="rel-cabecalho">
            <h3>Pedidos em aberto</h3>
            <div className="pedido-config-barra">
              <span className="pedido-config-label">Itens exibidos por pedido:</span>
              <select
                className="pedido-config-select"
                value={String(limiteItensPedido)}
                onChange={(e) => mudarLimiteItens(Number(e.target.value))}
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="0">Todos</option>
              </select>
              <div className="dropdown-filtro">
                <button className="btn-secundario dropdown-periodo-btn" onClick={() => setMenuColunas((v) => !v)}>
                  ⋯
                </button>
                {menuColunas && (
                  <div className="dropdown-colunas-menu">
                    <div className="dropdown-colunas-titulo">Adicionar ou remover colunas</div>
                    <button className="dropdown-colunas-item" onClick={() => { setMenuColunas(false); setOrdemPedido(null) }} disabled>
                      Ação <span className="dropdown-colunas-lock">🔒</span>
                    </button>
                    {COLUNAS_PEDIDO.map((c) => (
                      <label key={c.chave} className="dropdown-colunas-item">
                        <input
                          type="checkbox"
                          checked={colunasPedido[c.chave] !== false}
                          onChange={() => alternarColunaPedido(c.chave)}
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="tabela-wrap" ref={wrapAbertoRef} onScroll={sincronizarScrollbarAberto}>
            <table className="tabela" ref={tabelaRef}>
              <thead>
                <tr>
                  <th className="th-acao-fixa">
                    Ação
                    <span className="col-resizer" onMouseDown={(e) => iniciarRedimensionar('acao', e)} />
                  </th>
                  {colunasPedidoAtivas.map((chave) => {
                    const col = COLUNAS_PEDIDO.find((c) => c.chave === chave)
                    const largura = larguraColuna(chave)
                    return (
                      <th key={chave} onClick={() => ordenarPedidos(chave)} className="th-ordena" style={largura ? { width: largura } : undefined}>
                        {col?.label} {ordemPedido?.chave === chave ? (ordemPedido.dir === 'asc' ? '▲' : '▼') : ''}
                        <span className="col-resizer" onMouseDown={(e) => iniciarRedimensionar(chave, e)} />
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {pedidosAbertosOrdenados.map((p) => {
                  const itens = p.itens ?? []
                  const expandido = expansaoPedidos[p.id]
                  const itensVisiveis = limiteItensPedido === 0 || expandido ? itens : itens.slice(0, limiteItensPedido)
                  const temMais = itens.length > limiteItensPedido && limiteItensPedido > 0
                  return (
                    <tr key={p.id}>
                      <td className="td-acoes">
                        <button className="btn-abrir-pedido" onClick={() => setPedidoPainelId(p.id)}>Abrir</button>
                      </td>
                      {colunasPedidoAtivas.map((chave) => (
                        <td key={chave} className={chave === 'itens' && itens.length ? 'coluna-itens' : undefined}>
                          {chave === 'cliente' ? (
                            <span>{p.cliente_nome || '-'}</span>
                          ) : chave === 'itens' && itens.length > 0 ? (
                            <div className="pedido-itens-lista">
                              {itensVisiveis.map((it, i) => (
                                <div key={i} className="item-linha">{it.quantidade} {it.nome}</div>
                              ))}
                              {temMais && (
                                <button
                                  className="btn-mini"
                                  onClick={() => setExpansaoPedidos((prev) => ({ ...prev, [p.id]: !expandido }))}
                                >
                                  {expandido ? 'Ocultar itens ▲' : `+ ${itens.length - limiteItensPedido} itens ▼`}
                                </button>
                              )}
                            </div>
                          ) : (
                            celulaPedido(p, chave)
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {pedidosAbertos.length === 0 && (
                  <tr><td colSpan={colunasPedidoAtivas.length + 1} className="sem-resultado">Nenhum pedido em aberto.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="tabela-scrollbar-fixo" ref={scrollbarAbertoRef} onScroll={onScrollbarAberto}>
            <div className="tabela-scrollbar-fixo-fill" />
          </div>
        </div>
      )}

      {aba === 'aceitar' && (
        <div className="rel-painel">
          <h3>Pedidos a aceitar</h3>
          <table className="tabela">
            <thead>
              <tr><th>Número</th><th>Cliente</th><th>Total</th><th>Status</th><th>Data</th><th></th></tr>
            </thead>
            <tbody>
              {pedidosAceitar.map((p) => (
                <tr key={p.id}>
                  <td>{p.numero} <button className="btn-mini" onClick={() => setEditandoPedidoId(p.id)}>Editar</button></td>
                  <td>{p.cliente_nome}</td>
                  <td>R$ {p.total.toFixed(2)}</td>
                  <td>Novo</td>
                  <td>{fmt(p.criado_em)}</td>
                  <td className="td-acoes">
                    <button className="btn-primario" onClick={() => aceitarPedido(p)}>Aceitar</button>
                    <button className="btn-danger" onClick={() => recusarPedido(p)}>Recusar</button>
                  </td>
                </tr>
              ))}
              {pedidosAceitar.length === 0 && (
                <tr><td colSpan={6} className="sem-resultado">Nenhum pedido a aceitar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'orcamentos' && (
        <div className="rel-painel">
          <div className="rel-cabecalho">
            <h3>Orçamentos</h3>
            {onNovoOrcamento && (
              <button className="btn-primario" onClick={onNovoOrcamento}>Novo Orçamento <kbd>F5</kbd></button>
            )}
          </div>
          <table className="tabela">
            <thead>
              <tr><th>Número</th><th>Cliente</th><th>Total</th><th>Status</th><th>Data</th><th></th></tr>
            </thead>
            <tbody>
              {orcamentos.map((o) => (
                <tr key={o.id}>
                  <td>{o.numero}</td>
                  <td>{o.cliente_nome || '-'}</td>
                  <td>R$ {o.total.toFixed(2)}</td>
                  <td>{o.status}</td>
                  <td>{fmt(o.criado_em)}</td>
                  <td className="td-acoes">
                    {o.status !== 'aprovado' && (
                      <button className="btn-primario" onClick={() => aprovarOrcamento(o)}>Aprovar</button>
                    )}
                  </td>
                </tr>
              ))}
              {orcamentos.length === 0 && (
                <tr><td colSpan={6} className="sem-resultado">Nenhum orçamento criado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'delivery' && (
        <Delivery />
      )}

      {detalheVenda && (
        <div className="modal-overlay">
          <div className="modal modal-venda">
            <h3>{detalheVenda.tipo === 'debito' ? 'Pagamento de Débito' : 'Venda'} {detalheVenda.numero}</h3>
            <p className="modal-data">
              {fmtData(detalheVenda.created_at)} às {fmtHora(detalheVenda.created_at)} •{' '}
              {detalheVenda.tipo === 'delivery' ? 'Delivery' : detalheVenda.tipo === 'debito' ? 'Fiado' : 'Local'}
              {detalheVenda.vendedor_nome ? ` • Vendedor: ${detalheVenda.vendedor_nome}` : ''}
              {detalheVenda.cliente_nome ? ` • Cliente: ${detalheVenda.cliente_nome}` : ''}
            </p>
            <table className="tabela">
              <thead>
                <tr><th>Produto</th><th>Qtd</th><th>Preço</th><th>Total</th></tr>
              </thead>
              <tbody>
                {detalhe.map((d, i) => (
                  <tr key={i}>
                    <td>{d.nome_produto}</td>
                    <td>{d.quantidade}</td>
                    <td>R$ {d.preco_unitario.toFixed(2)}</td>
                    <td>R$ {d.subtotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-resumo">
              <div className="linha"><span>Subtotal</span><strong>R$ {detalheVenda.subtotal.toFixed(2)}</strong></div>
              {detalheVenda.desconto > 0 && (
                <div className="linha"><span>Desconto</span><strong>- R$ {detalheVenda.desconto.toFixed(2)}</strong></div>
              )}
              <div className="linha"><span>Total</span><strong>R$ {detalheVenda.total.toFixed(2)}</strong></div>
              {detalheVenda.pagamentos && (
                <div className="linha">
                  <span>Pagamentos</span>
                  <span>{detalheVenda.pagamentos.split(', ').map((p) => {
                    const [forma, valor] = p.split('|')
                    return `${forma} R$ ${Number(valor).toFixed(2)}`
                  }).join(' • ')}</span>
                </div>
              )}
              {detalheVenda.observacoes && (
                <div className="linha"><span>Observações</span><span>{detalheVenda.observacoes}</span></div>
              )}
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setDetalheVenda(null)}>Fechar (Esc)</button>
              {detalheVenda.status === 'concluida' && (
                <button className="btn-secundario" onClick={() => cancelarVenda(detalheVenda)}>Cancelar venda</button>
              )}
            </div>
          </div>
        </div>
      )}

      {editandoPedidoId != null && (
        <EditarPedido pedidoId={editandoPedidoId} onFechar={() => setEditandoPedidoId(null)} onSalvo={() => carregar()} />
      )}

      {pedidoPainelId != null && onEditarPedido && (
        <PainelPedido
          pedidoId={pedidoPainelId}
          onFechar={() => setPedidoPainelId(null)}
          onEditar={(id) => {
            setPedidoPainelId(null)
            setEditandoPedidoId(id)
          }}
          onPagar={(id) => {
            setPedidoPainelId(null)
            onEditarPedido(id)
          }}
        />
      )}
      {pedidoPainelId != null && !onEditarPedido && (
        <PainelPedido
          pedidoId={pedidoPainelId}
          onFechar={() => setPedidoPainelId(null)}
          onEditar={(id) => { setPedidoPainelId(null); setEditandoPedidoId(id) }}
        />
      )}

      {vendaPainelId != null && (
        <PainelVenda
          vendaId={vendaPainelId}
          onFechar={() => { setVendaPainelId(null); setDetalheVenda(null) }}
          onCancelar={(v) => cancelarVenda(v as unknown as Venda)}
        />
      )}

      {modalConfigPdv && <ConfigVendas onFechar={() => setModalConfigPdv(false)} />}
    </div>
  )
}
