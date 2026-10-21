import { useEffect, useState, useCallback, useRef } from 'react'
import { getDbApi, getImagemApi, getVendasCancelApi, getAuthApi, dataUrlImagem } from '../../shared/db'
import CampoDinheiro, { parseMoeda, formatarMoeda } from '../../shared/CampoDinheiro'
import Cupom from '../../shared/Cupom'
import ConfigPdv from './ConfigPdv'
import Clientes, { type Cliente } from '../clientes/Clientes'

interface Produto {
  id: number
  nome: string
  marca: string | null
  categoria: string | null
  codigo_barras: string | null
  preco_venda: number
  preco_atacado1: number | null
  preco_atacado2: number | null
  qtd_min_atacado1: number | null
  qtd_min_atacado2: number | null
  estoque: number
  estoque_minimo: number
  controla_estoque: number
}

interface ItemCarrinho {
  uid: number
  produto_id: number
  nome: string
  quantidade: number
  preco_unitario: number
  desconto_tipo?: 'percent' | 'valor'
  desconto?: number
  observacao?: string
}

interface FormaPagamento {
  forma: string
  valor: number
}

interface FormaCadastrada {
  id: number
  nome: string
  tipo: string
  permite_troco: number
  permite_parcelas: number
  max_parcelas: number
  taxa: number
  dias_receber: number
  ativo: number
}

export default function Pdv({ usuarioId, aoConcluirVenda, aoVoltar, pedidoEdicaoId, modo = 'venda', onEditarProduto }: {
  usuarioId?: number
  aoConcluirVenda?: () => void
  aoVoltar?: () => void
  pedidoEdicaoId?: number | null
  modo?: 'venda' | 'pedido' | 'orcamento'
  onEditarProduto?: (produtoId: number) => void
}) {
  const [busca, setBusca] = useState('')
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([])
  const [pagamentos, setPagamentos] = useState<FormaPagamento[]>([])
  const [mensagem, setMensagem] = useState('')
  const [formas, setFormas] = useState<FormaCadastrada[]>([])
  const [caixaAberto, setCaixaAberto] = useState<{ id: number; saldo: number } | null>(null)
  const [pagamentoForma, setPagamentoForma] = useState('')
  const [modalPagamento, setModalPagamento] = useState(false)
  const [valorPagamento, setValorPagamento] = useState('')
  const [valoresFormas, setValoresFormas] = useState<Record<string, string>>({})
  const [formaSelIdx, setFormaSelIdx] = useState(0)
  const [posVenda, setPosVenda] = useState<{ numero: string; total: number; troco: number } | null>(null)
  const [trocoMax, setTrocoMax] = useState<number>(0)
  const [trocoAutorizado, setTrocoAutorizado] = useState(false)
  const [modalAutorizarTroco, setModalAutorizarTroco] = useState(false)
  const [senhaSupervisor, setSenhaSupervisor] = useState('')
  const [sugestaoIdx, setSugestaoIdx] = useState(-1)
  const [imagens, setImagens] = useState<Record<number, string>>({})
  const valorInputRef = useRef<HTMLInputElement>(null)
  const buscaRef = useRef<HTMLInputElement>(null)
  const [colunas, setColunas] = useState(() => Number(localStorage.getItem('pdv_colunas')) || 2)
  const [larguraResumo, setLarguraResumo] = useState(() => Number(localStorage.getItem('pdv_largura_resumo')) || 380)
  const [planoPreco, setPlanoPreco] = useState<'varejo' | 'atacado1' | 'atacado2'>(() => (localStorage.getItem('pdv_plano_preco') as 'varejo' | 'atacado1' | 'atacado2') || 'varejo')
  const [listas, setListas] = useState<{ id: number; nome: string }[]>([])
  const [listaAtivaId, setListaAtivaId] = useState<number | null>(-1)
  const [produtosListaAtiva, setProdutosListaAtiva] = useState<Set<number>>(new Set())
  const [pedidosAbertos, setPedidosAbertos] = useState<Record<number, number>>({})
  const arrastandoRef = useRef(false)
  const colunasRef = useRef(colunas)
  colunasRef.current = colunas
  const [modalNovaLista, setModalNovaLista] = useState(false)
  const [nomeNovaLista, setNomeNovaLista] = useState('')
  const [produtoEditando, setProdutoEditando] = useState<Produto | null>(null)
  const [itemEditandoIdx, setItemEditandoIdx] = useState<number | null>(null)
  const [itemEditando, setItemEditando] = useState<ItemCarrinho | null>(null)
  const [produtoSemEstoque, setProdutoSemEstoque] = useState<{ produto: Produto; qtd: number } | null>(null)
  const [permitirSemEstoque, setPermitirSemEstoque] = useState<boolean>(() => localStorage.getItem('pdv_permitir_sem_estoque') === '1')
  const [buscaAvancada, setBuscaAvancada] = useState<boolean>(() => localStorage.getItem('pdv_busca_avancada') === '1')
  const [edicaoPedido, setEdicaoPedido] = useState<{ id: number; numero: string; cliente_nome: string; cliente_telefone: string | null; cliente_endereco: string | null; observacoes: string | null } | null>(null)
  const [clientePedido, setClientePedido] = useState('')
  const [descontoTipo, setDescontoTipo] = useState<'percent' | 'valor'>('percent')
  const [descontoEntrada, setDescontoEntrada] = useState('')
  const [modalDesconto, setModalDesconto] = useState(false)
  const [modalConfig, setModalConfig] = useState(false)
  const [modoQuantidade, setModoQuantidade] = useState<'opcional' | 'produto' | 'quantidade'>(() => (localStorage.getItem('pdv_modo_quantidade') as 'opcional' | 'produto' | 'quantidade') || 'opcional')
  const [casasDecimais, setCasasDecimais] = useState<number>(() => {
    const v = localStorage.getItem('pdv_casas_decimais')
    return v === null || v === '' ? 0 : Number(v)
  })
  const [qtdPreSelecao, setQtdPreSelecao] = useState<number>(() => {
    const v = localStorage.getItem('pdv_qtd_busca')
    return v === null || v === '' ? 1 : Number(v) || 1
  })
  const [produtoQtd, setProdutoQtd] = useState<{ produto: Produto; quantidade: number } | null>(null)
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null)
  const [modalClientes, setModalClientes] = useState(false)
  const [observacaoVenda, setObservacaoVenda] = useState('')
  const [modalObs, setModalObs] = useState(false)
  const [taxaEntregaStr, setTaxaEntregaStr] = useState('')
  const [enderecoEntrega, setEnderecoEntrega] = useState('')
  const [modalEntrega, setModalEntrega] = useState(false)
  const [imprimirVenda, setImprimirVenda] = useState(false)
  const [vendedores, setVendedores] = useState<{ id: number; nome: string }[]>([])
  const [modalVendedor, setModalVendedor] = useState(false)
  const [vendedorIdx, setVendedorIdx] = useState(0)
  const [vendedorSelecionado, setVendedorSelecionado] = useState<{ id: number; nome: string } | null>(null)
  const vendedorRef = useRef<HTMLButtonElement>(null)
  const [posVendaCupom, setPosVendaCupom] = useState<{ numero: string; total: number; itens: ItemCarrinho[]; pagamentos: FormaPagamento[] } | null>(null)
  const [modalAbrirCaixa, setModalAbrirCaixa] = useState(false)
  const [saldoInicialCaixa, setSaldoInicialCaixa] = useState('')
  const descontoRef = useRef<HTMLInputElement>(null)
  const obsRef = useRef<HTMLTextAreaElement>(null)
  const entregaEndRef = useRef<HTMLInputElement>(null)
  const cardSelRef = useRef<HTMLDivElement | null>(null)
  const sugestaoSelRef = useRef<HTMLButtonElement | null>(null)
  const uidRef = useRef(1)
  const agruparIguais = () => localStorage.getItem('pdv_agrupar_iguais') !== '0'
  const [formEdicao, setFormEdicao] = useState({
    nome: '',
    preco_venda: '',
    preco_atacado1: '',
    preco_atacado2: '',
    estoque: '',
    codigo_barras: ''
  })

  const abrirEdicaoProduto = (p: Produto) => {
    setProdutoEditando(p)
    setFormEdicao({
      nome: p.nome,
      preco_venda: formatarMoeda(p.preco_venda),
      preco_atacado1: p.preco_atacado1 != null ? formatarMoeda(p.preco_atacado1) : '',
      preco_atacado2: p.preco_atacado2 != null ? formatarMoeda(p.preco_atacado2) : '',
      estoque: formatarMoeda(p.estoque),
      codigo_barras: p.codigo_barras ?? ''
    })
  }

  const salvarEdicaoProduto = async () => {
    if (!produtoEditando) return
    await getDbApi().run(
      `UPDATE produtos SET nome=?, preco_venda=?, preco_atacado1=?, preco_atacado2=?, estoque=?, codigo_barras=? WHERE id=?`,
      [
        formEdicao.nome.trim() || produtoEditando.nome,
        parseMoeda(formEdicao.preco_venda),
        formEdicao.preco_atacado1 !== '' ? parseMoeda(formEdicao.preco_atacado1) : null,
        formEdicao.preco_atacado2 !== '' ? parseMoeda(formEdicao.preco_atacado2) : null,
        parseMoeda(formEdicao.estoque),
        formEdicao.codigo_barras.trim() || null,
        produtoEditando.id
      ]
    )
    const novoNome = formEdicao.nome.trim() || produtoEditando.nome
    const novoVenda = parseMoeda(formEdicao.preco_venda)
    const novoAt1 = formEdicao.preco_atacado1 !== '' ? parseMoeda(formEdicao.preco_atacado1) : null
    const novoAt2 = formEdicao.preco_atacado2 !== '' ? parseMoeda(formEdicao.preco_atacado2) : null
    setProdutoEditando(null)
    setMensagem('Produto atualizado.')
    carregarProdutos()
    setCarrinho((prev) =>
      prev.map((i) =>
        i.produto_id === produtoEditando.id
          ? {
              ...i,
              nome: novoNome,
              preco_unitario:
                planoPreco === 'atacado1' && novoAt1 != null ? novoAt1
                : planoPreco === 'atacado2' && novoAt2 != null ? novoAt2
                : novoVenda
            }
          : i
      )
    )
  }

  const precoDe = (p: Produto): number => {
    if (planoPreco === 'atacado1' && p.preco_atacado1 != null) return p.preco_atacado1
    if (planoPreco === 'atacado2' && p.preco_atacado2 != null) return p.preco_atacado2
    return p.preco_venda
  }

  const mudarPlanoPreco = (plano: 'varejo' | 'atacado1' | 'atacado2') => {
    setPlanoPreco(plano)
    localStorage.setItem('pdv_plano_preco', plano)
    setCarrinho((prev) =>
      prev.map((i) => {
        const p = produtos.find((x) => x.id === i.produto_id)
        if (!p) return i
        const novo = plano === 'atacado1' && p.preco_atacado1 != null ? p.preco_atacado1
          : plano === 'atacado2' && p.preco_atacado2 != null ? p.preco_atacado2
          : p.preco_venda
        return { ...i, preco_unitario: novo }
      })
    )
  }

  const alternarPrecoF1 = () => {
    const ordem: ('varejo' | 'atacado1' | 'atacado2')[] = ['varejo', 'atacado1', 'atacado2']
    const idx = ordem.indexOf(planoPreco)
    mudarPlanoPreco(ordem[(idx + 1) % ordem.length])
  }

  const iniciarArrasto = (e: React.MouseEvent) => {
    e.preventDefault()
    arrastandoRef.current = true
    const onMove = (ev: MouseEvent) => {
      if (!arrastandoRef.current) return
      const max = colunasRef.current === 1 ? 980 : 760
      const novo = Math.max(260, Math.min(max, window.innerWidth - ev.clientX - 8))
      setLarguraResumo(novo)
    }
    const onUp = () => {
      arrastandoRef.current = false
      localStorage.setItem('pdv_largura_resumo', String(larguraResumo))
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const carregarListas = useCallback(async () => {
    const db = getDbApi()
    const ls = (await db.all(`SELECT id, nome FROM listas_pdv ORDER BY nome`)) as unknown as { id: number; nome: string }[]
    setListas(ls)
    setListaAtivaId((prev) => {
      if (prev === -1) return -1
      if (ls.length > 0 && prev && ls.some((l) => l.id === prev)) return prev
      return null
    })
  }, [])

  const carregarProdutosLista = useCallback(async (id: number) => {
    const rows = (await getDbApi().all(
      `SELECT produto_id FROM lista_pdv_itens WHERE lista_id = ?`,
      [id]
    )) as unknown as { produto_id: number }[]
    setProdutosListaAtiva(new Set(rows.map((r) => r.produto_id)))
  }, [])

  const criarLista = async () => {
    if (!nomeNovaLista.trim()) return
    const res = await getDbApi().run(`INSERT INTO listas_pdv (nome) VALUES (?)`, [nomeNovaLista.trim()])
    setModalNovaLista(false)
    setNomeNovaLista('')
    await carregarListas()
    setListaAtivaId(Number(res.lastInsertRowid))
    setProdutosListaAtiva(new Set())
  }

  const selecionarLista = (id: number | null) => {
    setListaAtivaId(id)
    if (id && id > 0) carregarProdutosLista(id)
    else setProdutosListaAtiva(new Set())
  }

  const estaEmEstoque = (p: Produto) => p.estoque > 0 && p.estoque > p.estoque_minimo

  const produtoVisivel = (p: Produto) => {
    const ehSelecionado = busca.trim() && sugestoes[sugestaoIdx]?.id === p.id
    if (ehSelecionado) return true
    if (listaAtivaId === -1) return estaEmEstoque(p)
    if (listaAtivaId === null) return true
    return produtosListaAtiva.has(p.id)
  }

  const alternarProdutoNaLista = async (produtoId: number) => {
    if (!listaAtivaId) {
      setMensagem('Selecione ou crie uma lista personalizada primeiro.')
      return
    }
    const db = getDbApi()
    if (produtosListaAtiva.has(produtoId)) {
      await db.run(`DELETE FROM lista_pdv_itens WHERE lista_id = ? AND produto_id = ?`, [listaAtivaId, produtoId])
      setProdutosListaAtiva((prev) => {
        const novo = new Set(prev)
        novo.delete(produtoId)
        return novo
      })
    } else {
      await db.run(
        `INSERT OR IGNORE INTO lista_pdv_itens (lista_id, produto_id) VALUES (?, ?)`,
        [listaAtivaId, produtoId]
      )
      setProdutosListaAtiva((prev) => new Set(prev).add(produtoId))
    }
  }

  const excluirLista = async (id: number) => {
    if (!confirm('Excluir esta lista?')) return
    await getDbApi().run(`DELETE FROM listas_pdv WHERE id = ?`, [id])
    if (listaAtivaId === id) {
      setListaAtivaId(null)
      setProdutosListaAtiva(new Set())
    }
    carregarListas()
  }

  const carregarProdutos = useCallback(async () => {
    const db = getDbApi()

    if (!buscaAvancada) {
      const termo = `%${busca}%`
      const rows = (await db.all(
        `SELECT p.id, p.nome, m.nome AS marca, p.codigo_barras, p.preco_venda,
                p.preco_atacado1, p.preco_atacado2, p.qtd_min_atacado1, p.qtd_min_atacado2,
                p.estoque, p.estoque_minimo, p.controla_estoque
         FROM produtos p
         LEFT JOIN marcas m ON m.id = p.marca_id
         WHERE p.ativo = 1
           AND (p.nome LIKE ? OR p.codigo_barras LIKE ? OR m.nome LIKE ? OR ? = '')
         ORDER BY (p.estoque <= 0) ASC, m.nome, p.nome
         LIMIT 200`,
        [termo, termo, termo, busca]
      )) as unknown as Produto[]
      setProdutos(rows)
      const ids = rows.map((r) => r.id)
      if (ids.length) {
        const imgs = await getImagemApi().listPorIds(ids)
        setImagens(imgs)
      } else {
        setImagens({})
      }
      const pedidos = (await db.all(
        `SELECT pi.produto_id, SUM(pi.quantidade) AS qtd
         FROM pedido_itens pi
         JOIN pedidos p ON p.id = pi.pedido_id
         WHERE p.status NOT IN ('entregue', 'cancelado')
           AND pi.produto_id IN (${ids.length ? ids.map(() => '?').join(',') : '0'})
         GROUP BY pi.produto_id`,
        ids
      )) as unknown as { produto_id: number; qtd: number }[]
      const mapa: Record<number, number> = {}
      for (const ped of pedidos) mapa[ped.produto_id] = ped.qtd
      setPedidosAbertos(mapa)
      return
    }

    // Busca avançada: divide em palavras-chave e exige TODAS presentes em qualquer campo
    const palavras = busca.trim().split(/\s+/).filter(Boolean)
    const temBusca = palavras.length > 0
    const condCampos = `(p.nome LIKE ? OR m.nome LIKE ? OR p.codigo_barras LIKE ? OR p.codigo_interno LIKE ?
                         OR p.codigo_extra LIKE ? OR p.descricao LIKE ? OR s.nome LIKE ? OR c.nome LIKE ? OR p.localizacao LIKE ?)`
    const condicoes = temBusca ? palavras.map(() => condCampos).join(' AND ') : '1=1'
    const params: unknown[] = []
    if (temBusca) {
      for (const w of palavras) {
        const like = `%${w}%`
        params.push(like, like, like, like, like, like, like, like, like)
      }
    }
    const rows = (await db.all(
      `SELECT p.id, p.nome, m.nome AS marca, p.codigo_barras, p.preco_venda,
              p.preco_atacado1, p.preco_atacado2, p.qtd_min_atacado1, p.qtd_min_atacado2,
              p.estoque, p.estoque_minimo, p.controla_estoque
       FROM produtos p
       LEFT JOIN marcas m ON m.id = p.marca_id
       LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
       LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.ativo = 1 AND (${condicoes})
       ORDER BY (p.estoque <= 0) ASC, m.nome, p.nome
       LIMIT 200`,
      params
    )) as unknown as Produto[]
    setProdutos(rows)
    const ids = rows.map((r) => r.id)
    if (ids.length) {
      const imgs = await getImagemApi().listPorIds(ids)
      setImagens(imgs)
    } else {
      setImagens({})
    }
    const pedidos = (await db.all(
      `SELECT pi.produto_id, SUM(pi.quantidade) AS qtd
       FROM pedido_itens pi
       JOIN pedidos p ON p.id = pi.pedido_id
       WHERE p.status NOT IN ('entregue', 'cancelado')
         AND pi.produto_id IN (${ids.length ? ids.map(() => '?').join(',') : '0'})
       GROUP BY pi.produto_id`,
      ids
    )) as unknown as { produto_id: number; qtd: number }[]
    const mapa: Record<number, number> = {}
    for (const ped of pedidos) mapa[ped.produto_id] = ped.qtd
    setPedidosAbertos(mapa)
  }, [busca, buscaAvancada])

  useEffect(() => {
    const db = getDbApi()
    const carregar = async () => {
      let permitido = false
      if (usuarioId) {
        const rows = (await db.all(`SELECT modulo FROM permissoes WHERE usuario_id = ?`, [usuarioId])) as unknown as { modulo: string }[]
        if (rows.some((r) => r.modulo === 'vender_sem_estoque')) permitido = true
      }
      const cfg = (await db.get(`SELECT valor FROM config WHERE chave = 'pdv_permitir_sem_estoque'`)) as { valor: string } | undefined
      if (cfg?.valor === '1') permitido = true
      setPermitirSemEstoque(permitido)
      try { localStorage.setItem('pdv_permitir_sem_estoque', permitido ? '1' : '0') } catch { /* ignore */ }
    }
    carregar().catch(() => {})
  }, [usuarioId])

  useEffect(() => {
    const db = getDbApi()
    db.all(`SELECT chave, valor FROM config WHERE chave IN ('pdv_modo_quantidade', 'pdv_casas_decimais')`)
      .then((rows) => {
        const mapa: Record<string, string> = {}
        for (const r of rows as unknown as { chave: string; valor: string }[]) mapa[r.chave] = r.valor
        if (mapa['pdv_modo_quantidade']) {
          const m = mapa['pdv_modo_quantidade']
          if (m === 'opcional' || m === 'produto' || m === 'quantidade') {
            setModoQuantidade(m)
            try { localStorage.setItem('pdv_modo_quantidade', m) } catch { /* ignore */ }
          }
        }
        if (mapa['pdv_casas_decimais'] != null) {
          const c = Number(mapa['pdv_casas_decimais'])
          if (c === 0 || c === 2) {
            setCasasDecimais(c)
            try { localStorage.setItem('pdv_casas_decimais', String(c)) } catch { /* ignore */ }
          }
        }
      })
      .catch(() => {})
  }, [])

  const stepQtd = casasDecimais === 2 ? 0.01 : 1

  const parseQtd = (v: string): number => {
    const num = Number(String(v).replace(',', '.'))
    if (!Number.isFinite(num) || num < 0) return 0
    return casasDecimais === 2 ? Math.round(num * 100) / 100 : Math.round(num)
  }

  const formatarQtd = (v: number): string => {
    return casasDecimais === 2 ? v.toFixed(2) : String(Math.round(v))
  }

  useEffect(() => {
    const t = setTimeout(() => carregarProdutos(), 250)
    return () => clearTimeout(t)
  }, [carregarProdutos])

  useEffect(() => {
    carregarListas()
  }, [carregarListas])

  useEffect(() => {
    const carregarFormasECaixa = async () => {
      const db = getDbApi()
      const f = (await db.all(
        `SELECT * FROM formas_pagamento WHERE ativo = 1 ORDER BY id`
      )) as unknown as FormaCadastrada[]
      setFormas(f)
      if (f.length > 0) setPagamentoForma((prev) => (prev && f.some((x) => x.nome === prev) ? prev : f[0].nome))
      const trocoCfg = (await db.get(`SELECT valor FROM config WHERE chave = 'vendas_troco_max'`)) as { valor: string | null } | undefined
      const tc = Number(trocoCfg?.valor || '0') || 0
      setTrocoMax(tc)
      try { localStorage.setItem('vendas_troco_max', String(tc)) } catch { /* ignore */ }
      const vendedoresDb = (await db.all(
        `SELECT id, nome FROM usuarios WHERE ativo = 1 ORDER BY nome`
      )) as unknown as { id: number; nome: string }[]
      setVendedores(vendedoresDb)
      const caixa = (await db.get(
        `SELECT id, saldo_inicial + total_vendas + total_suprimentos - total_sangrias AS saldo
         FROM caixas WHERE aberto = 1 ORDER BY id DESC LIMIT 1`
      )) as unknown as { id: number; saldo: number } | undefined
      setCaixaAberto(caixa ?? null)
    }
    carregarFormasECaixa()
  }, [usuarioId])

  useEffect(() => {
    if (!pedidoEdicaoId) return
    const carregarPedido = async () => {
      const db = getDbApi()
      const p = (await db.get(
        `SELECT id, numero, cliente_nome, cliente_telefone, cliente_endereco, observacoes, desconto FROM pedidos WHERE id = ?`,
        [pedidoEdicaoId]
      )) as unknown as { id: number; numero: string; cliente_nome: string; cliente_telefone: string | null; cliente_endereco: string | null; observacoes: string | null; desconto: number } | undefined
      if (!p) return
      setEdicaoPedido({ id: p.id, numero: p.numero, cliente_nome: p.cliente_nome, cliente_telefone: p.cliente_telefone, cliente_endereco: p.cliente_endereco, observacoes: p.observacoes })
      setClientePedido(p.cliente_nome || '')
      if (p.desconto > 0) {
        setDescontoTipo('valor')
        setDescontoEntrada(String(p.desconto))
      }
      const itens = (await db.all(
        `SELECT produto_id, nome_produto, quantidade, preco_unitario FROM pedido_itens WHERE pedido_id = ?`,
        [pedidoEdicaoId]
      )) as unknown as { produto_id: number | null; nome_produto: string; quantidade: number; preco_unitario: number }[]
      const carrinhoPedido: ItemCarrinho[] = itens
        .filter((i) => i.produto_id != null)
        .map((i) => ({ uid: uidRef.current++, produto_id: i.produto_id!, nome: i.nome_produto, quantidade: i.quantidade, preco_unitario: i.preco_unitario }))
      setCarrinho(carrinhoPedido)
      setPagamentos([])
    }
    carregarPedido()
  }, [pedidoEdicaoId])

  const subtotal = carrinho.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0)
  const subtotalLiquido = carrinho.reduce((s, i) => {
    const sub = i.preco_unitario * i.quantidade
    if (!i.desconto) return s + sub
    const desc = i.desconto_tipo === 'percent' ? sub * (i.desconto / 100) : i.desconto
    return s + Math.max(0, sub - Math.min(sub, desc))
  }, 0)
  const descontoValor =
    descontoTipo === 'percent'
      ? (Number(descontoEntrada) || 0) > 0
        ? Math.min(subtotalLiquido, subtotalLiquido * ((Number(descontoEntrada) || 0) / 100))
        : 0
      : Math.min(subtotalLiquido, Number(descontoEntrada) || 0)
  const taxaEntrega = Math.max(0, parseMoeda(taxaEntregaStr))
  const totalVenda = Math.max(0, subtotalLiquido - descontoValor + taxaEntrega)
  const totalPago = pagamentos.reduce((s, p) => s + p.valor, 0)
  const valorEmDigitacao = Object.values(valoresFormas).reduce((s, v) => s + (Number(v?.replace(/\./g, '').replace(',', '.')) || 0), 0)
  const falta = totalVenda - totalPago
  const faltaComDigitacao = totalVenda - totalPago - valorEmDigitacao
  const troco = Math.max(-faltaComDigitacao, 0)
  const trocoExcedeLimite = trocoMax > 0 && troco > trocoMax

  const forcarAdicionar = (p: Produto, quantidade = 1) => {
    const qtd = quantidade > 0 ? quantidade : 1
    setCarrinho((prev) => {
      if (agruparIguais()) {
        const existente = prev.find((i) => i.produto_id === p.id)
        if (existente) {
          return prev.map((i) =>
            i.produto_id === p.id ? { ...i, quantidade: i.quantidade + qtd } : i
          )
        }
      }
      const uid = uidRef.current++
      return [...prev, { uid, produto_id: p.id, nome: p.nome, quantidade: qtd, preco_unitario: precoDe(p) }]
    })
    setMensagem('')
  }

  const adicionarAoCarrinho = useCallback((p: Produto, quantidade = 1) => {
    const qtd = quantidade > 0 ? quantidade : 1
    if (p.controla_estoque === 1 && p.estoque < qtd) {
      setProdutoSemEstoque({ produto: p, qtd })
      return
    }
    forcarAdicionar(p, qtd)
  }, [planoPreco, produtos])

  const adicionarProduto = (p: Produto) => {
    if (modoQuantidade === 'produto') {
      setProdutoQtd({ produto: p, quantidade: qtdPreSelecao > 0 ? qtdPreSelecao : 1 })
      return
    }
    const qtd = modoQuantidade === 'quantidade' && qtdPreSelecao > 0 ? qtdPreSelecao : 1
    adicionarAoCarrinho(p, qtd)
    if (modoQuantidade === 'quantidade') {
      setQtdPreSelecao(1)
      try { localStorage.setItem('pdv_qtd_busca', '1') } catch { /* ignore */ }
    }
  }

  const mudarQuantidade = (uid: number, delta: number) => {
    setCarrinho((prev) =>
      prev
        .map((i) => (i.uid === uid ? { ...i, quantidade: i.quantidade + delta } : i))
        .filter((i) => i.quantidade > 0)
    )
  }

  const removerItem = (uid: number) => {
    setCarrinho((prev) => prev.filter((i) => i.uid !== uid))
  }

  const abrirEdicaoItem = (idx: number) => {
    const item = carrinho[idx]
    if (!item) return
    setItemEditandoIdx(idx)
    setItemEditando({ ...item })
  }

  const salvarEdicaoItem = () => {
    if (itemEditandoIdx == null || !itemEditando) return
    setCarrinho((prev) => prev.map((i, idx) => (idx === itemEditandoIdx ? itemEditando : i)))
    setItemEditando(null)
    setItemEditandoIdx(null)
  }

  const itemDescontoValor = (item: ItemCarrinho) => {
    const sub = item.preco_unitario * item.quantidade
    if (!item.desconto) return 0
    return item.desconto_tipo === 'percent'
      ? Math.min(sub, sub * (item.desconto / 100))
      : Math.min(sub, item.desconto)
  }

  const itemTotalFinal = (item: ItemCarrinho) => {
    const sub = item.preco_unitario * item.quantidade
    return Math.max(0, sub - itemDescontoValor(item))
  }

  const formaSelecionada = formas.find((f) => f.nome === pagamentoForma)

  const iconForma = (nome: string) => {
    const n = nome.toLowerCase()
    if (n.includes('dinheiro')) return '💵'
    if (n.includes('pix')) return '⚡'
    if (n.includes('crédito') || n.includes('credito')) return '💳'
    if (n.includes('débito') || n.includes('debito')) return '💳'
    if (n.includes('fiado')) return '📒'
    if (n.includes('vale')) return '🎁'
    return '💠'
  }

  const adicionarPagamentoDigitado = (entradaBruta?: string) => {
    if (!formaSelecionada) return
    const entrada = (entradaBruta ?? valorPagamento).trim()
    if (!entrada) return
    const valor = Number(entrada.replace(/x.*$/i, '').replace(',', '.'))
    if (valor <= 0) return
    const parcelasMatch = entrada.match(/(\d+)\s*x/i)
    const parcelas =
      formaSelecionada.permite_parcelas && parcelasMatch
        ? Math.min(Number(parcelasMatch[1]), formaSelecionada.max_parcelas)
        : 1
    const nomeComParcela = parcelas > 1 ? `${pagamentoForma} ${parcelas}x` : pagamentoForma
    setPagamentos((prev) => [...prev, { forma: nomeComParcela, valor }])
    setValorPagamento('')
    valorInputRef.current?.focus()
  }

  const adicionarValorComMais = () => {
    const forma = formas[formaSelIdx]?.nome
    if (!forma) return
    const atual = (valoresFormas[forma] ?? '').trim()
    if (atual) {
      lancarForma(forma, formas[formaSelIdx], atual)
    } else {
      const valor = Math.max(0, faltaComDigitacao > 0 ? faltaComDigitacao : totalVenda)
      setValoresFormas((prev) => ({ ...prev, [forma]: formatarMoeda(valor) }))
      valorInputRef.current?.focus()
    }
  }

  const removerPagamento = (idx: number) => {
    setPagamentos((prev) => prev.filter((_, i) => i !== idx))
  }

  const somarForma = (forma: string, delta: number) => {
    const atual = Number(valoresFormas[forma]?.replace(',', '.')) || 0
    const novo = Math.max(0, atual + delta)
    setValoresFormas((prev) => ({ ...prev, [forma]: novo > 0 ? String(novo) : '' }))
  }

  const formatarMoedaDigitos = (v: string) => {
    const digitos = v.replace(/\D/g, '').slice(0, 12)
    if (!digitos) return ''
    const valor = Number(digitos) / 100
    return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const lancarForma = (forma: string, f?: FormaCadastrada, valorBruto?: string) => {
    const entrada = (valorBruto ?? valoresFormas[forma] ?? '').trim()
    if (!entrada) return
    const valor = Number(entrada.replace(/x.*$/i, '').replace(/\./g, '').replace(',', '.'))
    if (valor <= 0) return
    const parcelasMatch = entrada.match(/(\d+)\s*x/i)
    const parcelas = f?.permite_parcelas && parcelasMatch ? Math.min(Number(parcelasMatch[1]), f.max_parcelas) : 1
    const nomeComParcela = parcelas > 1 ? `${forma} ${parcelas}x` : forma
    setPagamentos((prev) => [...prev, { forma: nomeComParcela, valor }])
    setValoresFormas((prev) => ({ ...prev, [forma]: '' }))
  }

  const digitadosComoPagamentos = (): FormaPagamento[] => {
    const lista: FormaPagamento[] = []
    for (const [forma, v] of Object.entries(valoresFormas)) {
      if (!String(v).trim()) continue
      const valor = Number(String(v).replace(/\./g, '').replace(',', '.'))
      if (valor > 0) lista.push({ forma, valor })
    }
    return lista
  }

  const selecionarClienteDaVenda = (c: Cliente) => {
    setClienteSel(c)
    if (modo === 'pedido' || modo === 'orcamento') {
      setClientePedido(c.nome)
    }
    setEnderecoEntrega((prev) => prev || (c.endereco || ''))
    setModalClientes(false)
    setTimeout(() => buscaRef.current?.focus(), 0)
  }

  const limparVenda = () => {
    setCarrinho([])
    setPagamentos([])
    setBusca('')
    setValorPagamento('')
    setValoresFormas({})
    setModalPagamento(false)
    setEdicaoPedido(null)
    setClientePedido('')
    setDescontoEntrada('')
    setClienteSel(null)
    setObservacaoVenda('')
    setTaxaEntregaStr('')
    setEnderecoEntrega('')
    setTrocoAutorizado(false)
  }

  const finalizarComoPedido = async () => {
    if (carrinho.length === 0) return
    try {
      const db = getDbApi()
      if (edicaoPedido) {
        const pedidoId = edicaoPedido.id
        await db.run(
          `UPDATE pedidos SET cliente_nome = ?, subtotal = ?, desconto = ?, taxa_entrega = 0, total = ?, vendedor_id = ? WHERE id = ?`,
          [clientePedido || null, subtotal, descontoValor, totalVenda, usuarioId ?? null, pedidoId]
        )
        await db.run(`DELETE FROM pedido_itens WHERE pedido_id = ?`, [pedidoId])
        for (const item of carrinho) {
          await db.run(
            `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal, desconto, observacao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [pedidoId, item.produto_id, item.nome, item.quantidade, item.preco_unitario, item.quantidade * item.preco_unitario, itemDescontoValor(item), item.observacao ?? null]
          )
        }
        const numero = edicaoPedido.numero
        limparVenda()
        setPosVenda({ numero, total: totalVenda, troco: 0 })
        return
      }
      const seq = (await db.get(
        `INSERT INTO sequencias (chave, valor) VALUES ('pedido_online', 1) ON CONFLICT(chave) DO UPDATE SET valor = valor + 1 RETURNING valor`
      )) as { valor: number }
      const numero = `C-${String(seq.valor).padStart(4, '0')}`
      const agora = new Date().toISOString().slice(0, 19).replace('T', ' ')
      const res = await db.run(
        `INSERT INTO pedidos (numero, cliente_nome, cliente_telefone, cliente_endereco, observacoes, subtotal, desconto, taxa_entrega, total, status, vendedor_id, criado_em)
         VALUES (?, ?, NULL, NULL, NULL, ?, ?, 0, ?, 'aceito', ?, ?)`,
        [numero, clientePedido, subtotal, descontoValor, totalVenda, usuarioId ?? null, agora]
      )
      const pedidoId = Number(res.lastInsertRowid)
      for (const item of carrinho) {
        await db.run(
          `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [pedidoId, item.produto_id, item.nome, item.quantidade, item.preco_unitario, item.quantidade * item.preco_unitario]
        )
      }
      limparVenda()
      setPosVenda({ numero, total: totalVenda, troco: 0 })
    } catch (err) {
      setMensagem(`Erro ao salvar pedido: ${(err as Error).message}`)
    }
  }

  const autorizarTrocoComSenha = async () => {
    if (!senhaSupervisor.trim()) {
      setMensagem('Informe a senha do supervisor para autorizar o troco.')
      return
    }
    try {
      const res = await getAuthApi().verificarSenhaSupervisor(senhaSupervisor)
      if (res.ok && res.autorizado) {
        setTrocoAutorizado(true)
        setModalAutorizarTroco(false)
        setSenhaSupervisor('')
        setMensagem('Troco acima do limite autorizado pelo supervisor.')
      } else {
        setMensagem(res.erro ?? 'Senha de supervisor inválida.')
      }
    } catch (err) {
      setMensagem(`Erro ao validar supervisor: ${(err as Error).message}`)
    }
  }

  const abrirCaixaDoPdv = async () => {
    const valor = parseMoeda(saldoInicialCaixa)
    if (isNaN(valor)) {
      setMensagem('Informe um valor válido para abertura do caixa.')
      return
    }
    setMensagem('')
    try {
      const db = getDbApi()
      await db.run(
        `INSERT INTO caixas (usuario_id, saldo_inicial, aberto) VALUES (?, ?, 1)`,
        [usuarioId, valor]
      )
      setModalAbrirCaixa(false)
      setSaldoInicialCaixa('')
      // Recarregar estado do caixa
      const caixa = (await db.get(
        `SELECT id, saldo_inicial + total_vendas + total_suprimentos - total_sangrias AS saldo
         FROM caixas WHERE aberto = 1 ORDER BY id DESC LIMIT 1`
      )) as unknown as { id: number; saldo: number } | undefined
      setCaixaAberto(caixa ?? null)
      setMensagem('Caixa aberto. Pode finalizar a venda.')
    } catch (e) {
      setMensagem(`Erro ao abrir caixa: ${(e as Error).message}`)
    }
  }

  const finalizarVenda = async () => {
    if (carrinho.length === 0) return
    const digitados = digitadosComoPagamentos()
    const pagamentosFinais = [...pagamentos, ...digitados]
    if (modo !== 'pedido' && modo !== 'orcamento' && !caixaAberto && !edicaoPedido) {
      setModalAbrirCaixa(true)
      setSaldoInicialCaixa('0,00')
      return
    }
    if (modo === 'venda' && !edicaoPedido && faltaComDigitacao > 0) {
      setMensagem(`Faltam R$ ${faltaComDigitacao.toFixed(2)}. Complete o pagamento.`)
      return
    }
    if (modo === 'venda' && !edicaoPedido && trocoExcedeLimite && !trocoAutorizado) {
      setModalAutorizarTroco(true)
      setSenhaSupervisor('')
      setModalPagamento(false)
      return
    }
    try {
      const db = getDbApi()
      if (edicaoPedido) {
        const pedidoId = edicaoPedido.id
        await db.run(
          `UPDATE pedidos SET subtotal = ?, desconto = ?, total = ?, taxa_entrega = ?, cliente_telefone = ?, cliente_endereco = ?, observacoes = ? WHERE id = ?`,
          [subtotal, descontoValor, totalVenda, taxaEntrega, clienteSel?.telefone ?? null, enderecoEntrega || null, observacaoVenda || null, pedidoId]
        )
        await db.run(`DELETE FROM pedido_itens WHERE pedido_id = ?`, [pedidoId])
        for (const item of carrinho) {
          await db.run(
            `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal, desconto, observacao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [pedidoId, item.produto_id, item.nome, item.quantidade, item.preco_unitario, item.quantidade * item.preco_unitario, itemDescontoValor(item), item.observacao ?? null]
          )
        }
        const trocoExibido = troco
        const numeroPedido = edicaoPedido.numero
        limparVenda()
        setPosVenda({ numero: numeroPedido, total: subtotal, troco: trocoExibido })
        return
      }
      if (modo === 'pedido') {
        const seq = (await db.get(
          `INSERT INTO sequencias (chave, valor) VALUES ('pedido_online', 1) ON CONFLICT(chave) DO UPDATE SET valor = valor + 1 RETURNING valor`
        )) as { valor: number }
        const numero = `C-${String(seq.valor).padStart(4, '0')}`
        const agora = new Date().toISOString().slice(0, 19).replace('T', ' ')
        const res = await db.run(
          `INSERT INTO pedidos (numero, cliente_nome, cliente_telefone, cliente_endereco, observacoes, subtotal, desconto, taxa_entrega, total, status, vendedor_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aceito', ?, ?)`,
          [numero, clientePedido, clienteSel?.telefone ?? null, enderecoEntrega || null, observacaoVenda || null, subtotal, descontoValor, taxaEntrega, totalVenda, usuarioId ?? null, agora]
        )
        const pedidoId = Number(res.lastInsertRowid)
        for (const item of carrinho) {
          await db.run(
            `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal, desconto, observacao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [pedidoId, item.produto_id, item.nome, item.quantidade, item.preco_unitario, item.quantidade * item.preco_unitario, itemDescontoValor(item), item.observacao ?? null]
          )
        }
        const trocoExibido = troco
        limparVenda()
        setPosVenda({ numero, total: totalVenda, troco: trocoExibido })
        return
      }
      if (modo === 'orcamento') {
        const seq = (await db.get(
          `INSERT INTO sequencias (chave, valor) VALUES ('orcamento', 1) ON CONFLICT(chave) DO UPDATE SET valor = valor + 1 RETURNING valor`
        )) as { valor: number }
        const numero = `P-${String(seq.valor).padStart(4, '0')}`
        const agora = new Date().toISOString().slice(0, 19).replace('T', ' ')
        const res = await db.run(
          `INSERT INTO orcamentos (numero, cliente_nome, cliente_telefone, cliente_endereco, observacoes, subtotal, desconto, taxa_entrega, total, status, vendedor_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'orcamento', ?, ?)`,
          [numero, clientePedido, clienteSel?.telefone ?? null, enderecoEntrega || null, observacaoVenda || null, subtotal, descontoValor, taxaEntrega, totalVenda, usuarioId ?? null, agora]
        )
        const orcId = Number(res.lastInsertRowid)
        for (const item of carrinho) {
          await db.run(
            `INSERT INTO orcamento_itens (orcamento_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal, desconto, observacao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [orcId, item.produto_id, item.nome, item.quantidade, item.preco_unitario, item.quantidade * item.preco_unitario, itemDescontoValor(item), item.observacao ?? null]
          )
        }
        const trocoExibido = troco
        limparVenda()
        setPosVenda({ numero, total: totalVenda, troco: trocoExibido })
        return
      }
      // Venda ATÔMICA no servidor: venda + itens + estoque + movimentações +
      // pagamentos + caixa em uma única transação. Regras de estoque aplicadas
      // server-side (config pdv_permitir_sem_estoque / permissão vender_sem_estoque).
      const res = await getVendasCancelApi().finalizar({
        itens: carrinho.map((item) => ({
          produto_id: item.produto_id,
          nome: item.nome,
          quantidade: item.quantidade,
          preco_unitario: item.preco_unitario,
          desconto: itemDescontoValor(item),
          observacao: item.observacao ?? null
        })),
        pagamentos: pagamentosFinais,
        subtotal,
        desconto: descontoValor,
        total: totalVenda,
        vendedor_id: vendedorSelecionado?.id ?? null,
        caixa_id: caixaAberto?.id ?? null,
        usuario_id: usuarioId ?? null,
        cliente_id: clienteSel?.id ?? null,
        observacoes: observacaoVenda || null,
        taxa_entrega: taxaEntrega,
        cliente_endereco: enderecoEntrega || null
      })
      if (!res.ok) {
        setMensagem(res.erro ?? 'Erro ao finalizar a venda.')
        return
      }
      const numero = res.numero
      const trocoExibido = troco
      const itensVenda = carrinho
      const pagVenda = pagamentosFinais
      limparVenda()
      setPosVenda({ numero, total: totalVenda, troco: trocoExibido })
      if (imprimirVenda) {
        setPosVendaCupom({ numero, total: totalVenda, itens: itensVenda, pagamentos: pagVenda })
      }
    } catch (err) {
      setMensagem(`Erro ao finalizar: ${(err as Error).message}`)
    }
  }

  const fecharPosVenda = () => {
    setPosVenda(null)
    aoConcluirVenda?.()
  }

  const novaVenda = () => {
    setPosVenda(null)
    setTimeout(() => buscaRef.current?.focus(), 0)
  }

  const usarCodigoBarras = (codigo: string) => {
    const p = produtos.find((x) => x.codigo_barras === codigo)
    if (p) adicionarProduto(p)
  }

  const confirmarVendedor = () => {
    const v = vendedores[vendedorIdx]
    if (!v) return
    setVendedorSelecionado(v)
    setModalVendedor(false)
    setModalPagamento(true)
    setMensagem('')
    setTimeout(() => valorInputRef.current?.focus(), 100)
  }

  const abrirPagamento = () => {
    if (vendedores.length > 0 && !vendedorSelecionado) {
      setVendedorIdx(Math.max(0, vendedores.findIndex((v) => v.id === usuarioId)))
      setModalVendedor(true)
      setTimeout(() => vendedorRef.current?.focus(), 30)
      return
    }
    setModalPagamento(true)
    setMensagem('')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        if (posVenda) {
          novaVenda()
          return
        }
        if (modalDesconto) {
          setModalDesconto(false)
          return
        }
        if (modalPagamento) {
          if (faltaComDigitacao <= 0) finalizarVenda()
          return
        }
        if (modalVendedor) {
          confirmarVendedor()
          return
        }
        if (carrinho.length === 0) return
        if (modo === 'pedido' || modo === 'orcamento') {
          finalizarVenda()
          return
        }
        abrirPagamento()
      }
      if (e.key === 'ArrowDown' && modalVendedor) {
        e.preventDefault()
        setVendedorIdx((prev) => Math.min(prev + 1, vendedores.length - 1))
        return
      }
      if (e.key === 'ArrowUp' && modalVendedor) {
        e.preventDefault()
        setVendedorIdx((prev) => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Enter' && modalVendedor) {
        e.preventDefault()
        confirmarVendedor()
        return
      }
      if (e.key === 'F6') {
        e.preventDefault()
        if (posVenda || modalPagamento) return
        if (vendedores.length === 0) {
          setMensagem('Nenhum vendedor ativo cadastrado.')
          return
        }
        setVendedorIdx(Math.max(0, vendedores.findIndex((v) => v.id === (vendedorSelecionado?.id ?? usuarioId))))
        setModalVendedor(true)
        setTimeout(() => vendedorRef.current?.focus(), 30)
      }
      if (e.key === 'F11') {
        e.preventDefault()
        if (carrinho.length > 0) {
          finalizarComoPedido()
        }
      }
      if (e.key === 'F3') {
        e.preventDefault()
        if (carrinho.length === 0) return
        setModalDesconto(true)
        setTimeout(() => descontoRef.current?.focus(), 30)
      }
      if (e.key === 'F1') {
        e.preventDefault()
        alternarPrecoF1()
        setMensagem(`Preço: ${planoPreco === 'varejo' ? 'Atacado 1' : planoPreco === 'atacado1' ? 'Atacado 2' : 'Varejo'}`)
      }
      if (e.key === 'F4') {
        e.preventDefault()
        setModalObs(true)
        setTimeout(() => obsRef.current?.focus(), 30)
      }
      if (e.key === 'F5') {
        e.preventDefault()
        setModalClientes(true)
      }
      if (e.key === 'F9') {
        e.preventDefault()
        setModalEntrega(true)
        setTimeout(() => { entregaEndRef.current?.focus() }, 30)
      }
      if (e.key === 'Escape') {
        if (posVenda) {
          fecharPosVenda()
          return
        }
        if (modalDesconto) {
          setModalDesconto(false)
          if (modalPagamento) {
            setTimeout(() => valorInputRef.current?.focus(), 60)
          }
          return
        }
        if (modalPagamento) {
          setModalPagamento(false)
          setTimeout(() => buscaRef.current?.focus(), 0)
          return
        }
        if (modalVendedor) {
          setModalVendedor(false)
          setTimeout(() => buscaRef.current?.focus(), 0)
          return
        }
        if (modalClientes) {
          setModalClientes(false)
          setTimeout(() => buscaRef.current?.focus(), 0)
          return
        }
        if (modalObs) {
          setModalObs(false)
          setTimeout(() => buscaRef.current?.focus(), 0)
          return
        }
        if (modalEntrega) {
          setModalEntrega(false)
          setTimeout(() => buscaRef.current?.focus(), 0)
          return
        }
        if (itemEditando) {
          setItemEditando(null)
          setItemEditandoIdx(null)
          return
        }
        if (busca.trim()) {
          setBusca('')
          setSugestaoIdx(-1)
          return
        }
        if (edicaoPedido) {
          if (!confirm('Descartar as alterações do pedido e voltar?')) return
          limparVenda()
          aoVoltar?.()
          return
        }
        if (carrinho.length > 0) {
          if (!confirm('Descartar a venda atual?')) return
          limparVenda()
          return
        }
        aoVoltar?.()
      }
      if (e.key === '+' && modalPagamento) {
        const alvo = e.target as HTMLElement
        if (alvo.tagName === 'INPUT') return
        e.preventDefault()
        adicionarValorComMais()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [posVenda, modalPagamento, modalDesconto, modalVendedor, itemEditando, modalClientes, modalObs, modalEntrega, carrinho.length, falta, valorPagamento, pagamentoForma, busca, aoVoltar, planoPreco, edicaoPedido, descontoEntrada, vendedores, vendedorIdx])

  useEffect(() => {
    if (modalPagamento) {
      setFormaSelIdx(0)
      setTimeout(() => valorInputRef.current?.focus(), 100)
    }
  }, [modalPagamento])

  useEffect(() => {
    if (modalPagamento) setTimeout(() => valorInputRef.current?.focus(), 60)
  }, [formaSelIdx, modalPagamento])

  useEffect(() => {
    if (sugestaoIdx >= 0) {
      if (cardSelRef.current) cardSelRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      if (sugestaoSelRef.current) sugestaoSelRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [sugestaoIdx])

  useEffect(() => {
    if (modalVendedor && vendedorRef.current) {
      vendedorRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [vendedorIdx, modalVendedor])

  const temModalAberto =
    modalPagamento || modalDesconto || modalVendedor || itemEditando || posVenda ||
    modalNovaLista || produtoEditando || produtoSemEstoque || modalConfig || produtoQtd ||
    modalClientes || modalObs || modalEntrega

  useEffect(() => {
    const restaurar = () => {
      const ativo = document.activeElement
      if (ativo !== document.body && ativo !== null) return
      if (temModalAberto) return
      if (buscaRef.current) buscaRef.current.focus()
    }
    const onWinFocus = () => setTimeout(restaurar, 60)
    window.addEventListener('focus', onWinFocus)
    const iv = window.setInterval(restaurar, 2000)
    return () => {
      window.removeEventListener('focus', onWinFocus)
      window.clearInterval(iv)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temModalAberto])
  const categoriasPdv = [...new Set(produtos.map((p) => p.categoria ?? 'Sem categoria'))]
  const sugestoes = busca.trim() ? produtos : []

  const selecionarSugestao = (p: Produto) => {
    adicionarProduto(p)
    setBusca('')
    setSugestaoIdx(-1)
    buscaRef.current?.focus()
  }

  const buscarPrimeiroDireto = async (termo: string) => {
    const db = getDbApi()
    const rows = (await db.all(
      `SELECT p.id, p.nome, m.nome AS marca, p.codigo_barras, p.preco_venda,
              p.preco_atacado1, p.preco_atacado2, p.qtd_min_atacado1, p.qtd_min_atacado2,
              p.estoque, p.estoque_minimo, p.controla_estoque
       FROM produtos p
       LEFT JOIN marcas m ON m.id = p.marca_id
       WHERE p.ativo = 1 AND (p.nome LIKE ? OR p.codigo_barras LIKE ? OR m.nome LIKE ?)
       ORDER BY (p.estoque <= 0) ASC, m.nome, p.nome
       LIMIT 1`,
      [`%${termo}%`, `%${termo}%`, `%${termo}%`]
    )) as unknown as Produto[]
    if (rows.length > 0) selecionarSugestao(rows[0])
  }

  const onBuscaKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSugestaoIdx((prev) => (sugestoes.length ? Math.min(prev + 1, sugestoes.length - 1) : -1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSugestaoIdx((prev) => Math.max(prev - 1, -1))
      return
    }
    if (e.key === 'Enter') {
      if (sugestoes.length > 0) {
        const alvo = sugestaoIdx >= 0 && sugestoes[sugestaoIdx] ? sugestoes[sugestaoIdx] : sugestoes[0]
        selecionarSugestao(alvo)
        return
      }
      if (busca.trim()) {
        const exato = produtos.find(
          (p) => p.codigo_barras === busca.trim() || p.nome.toLowerCase() === busca.trim().toLowerCase()
        )
        if (exato) {
          selecionarSugestao(exato)
        } else {
          buscarPrimeiroDireto(busca.trim())
        }
      }
    }
    if (e.key === 'Escape') {
      setSugestaoIdx(-1)
      setBusca('')
    }
  }

  return (
    <div className="pdv">
    <div className="pdv-topo">
      <div className="pdv-topo-linha pdv-topo-busca">
        <div className="pdv-busca-wrap">
          <div className="busca-pdv-caixa">
            <input
              ref={buscaRef}
              className="busca-pdv"
              autoFocus
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                setSugestaoIdx(-1)
              }}
              onKeyDown={onBuscaKey}
              placeholder={buscaAvancada ? 'Busca avançada: nome, marca, código, categoria, obs...' : 'Buscar por nome, marca ou código de barras...'}
            />
            <button
              className={`pdv-busca-avancada ${buscaAvancada ? 'ativo' : ''}`}
              onClick={() => {
                const novo = !buscaAvancada
                setBuscaAvancada(novo)
                try { localStorage.setItem('pdv_busca_avancada', novo ? '1' : '0') } catch { /* ignore */ }
                setBusca('')
              }}
              title={buscaAvancada ? 'Busca avançada ativa — clique para desativar' : 'Ativar busca avançada (busca em mais campos)'}
            >
              Avançada {buscaAvancada ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="pdv-quant-wrap" title="Quantidade a ser adicionada ao selecionar o produto">
            <span className="pdv-quant-label">Quant</span>
            <button
              className="pdv-quant-btn"
              onClick={() => {
                const novo = Math.max(0, qtdPreSelecao - stepQtd)
                setQtdPreSelecao(casasDecimais === 2 ? Math.round(novo * 100) / 100 : Math.round(novo))
                try { localStorage.setItem('pdv_qtd_busca', formatarQtd(novo)) } catch { /* ignore */ }
              }}
            >
              −
            </button>
            <input
              className="pdv-quant-input"
              inputMode="decimal"
              value={formatarQtd(qtdPreSelecao)}
              onChange={(e) => {
                const n = parseQtd(e.target.value)
                setQtdPreSelecao(n)
                try { localStorage.setItem('pdv_qtd_busca', formatarQtd(n)) } catch { /* ignore */ }
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button
              className="pdv-quant-btn"
              onClick={() => {
                const novo = qtdPreSelecao + stepQtd
                setQtdPreSelecao(casasDecimais === 2 ? Math.round(novo * 100) / 100 : Math.round(novo))
                try { localStorage.setItem('pdv_qtd_busca', formatarQtd(novo)) } catch { /* ignore */ }
              }}
            >
              +
            </button>
          </div>
          {sugestoes.length > 0 && (
            <div className="pdv-sugestoes">
              {sugestoes.map((p, idx) => (
                <button
                  key={p.id}
                  ref={idx === sugestaoIdx ? sugestaoSelRef : undefined}
                  className={`pdv-sugestao ${idx === sugestaoIdx ? 'ativo' : ''}`}
                  onMouseEnter={() => setSugestaoIdx(idx)}
                  onClick={() => selecionarSugestao(p)}
                >
                  {imagens[p.id] && <img className="ps-imagem" src={dataUrlImagem(imagens[p.id])} alt="" />}
                  <span className="ps-texto">
                    <span className="ps-nome">{p.nome}</span>
                    <span className="ps-info">
                      {p.marca ? `${p.marca} • ` : ''}R$ {precoDe(p).toFixed(2)}
                      {p.codigo_barras ? ` • ${p.codigo_barras}` : ''}
                    </span>
                    <span className={`ps-estoque ${p.estoque <= 0 ? 'zero' : ''}`}>
                      Estoque: {p.estoque}
                      {(pedidosAbertos[p.id] ?? 0) > 0 && (
                        <span className="ps-pedidos"> • {pedidosAbertos[p.id]} em pedido</span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          </div>
        <button
          className="btn-gear"
          onClick={() => setModalConfig(true)}
          title="Configurações do PDV"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
      <div className="pdv-topo-linha pdv-topo-acoes">
        <div className="pdv-controles">
          <div className="pdv-controle-grupo" title="Plano de preço da venda (F1 alterna)">
            <span>Preço:</span>
            <div className="segmented pdv-plano-topo">
              <button className={planoPreco === 'varejo' ? 'ativo' : ''} onClick={() => mudarPlanoPreco('varejo')}>Varejo</button>
              <button className={planoPreco === 'atacado1' ? 'ativo' : ''} onClick={() => mudarPlanoPreco('atacado1')}>Atacado 1</button>
              <button className={planoPreco === 'atacado2' ? 'ativo' : ''} onClick={() => mudarPlanoPreco('atacado2')}>Atacado 2</button>
            </div>
            <span className="pdv-f5-hint">F1</span>
          </div>
          <button
            className={`pdv-vendedor-btn ${vendedorSelecionado ? 'tem' : ''}`}
            onClick={() => {
              if (vendedores.length === 0) return
              setVendedorIdx(Math.max(0, vendedores.findIndex((v) => v.id === (vendedorSelecionado?.id ?? usuarioId))))
              setModalVendedor(true)
              setTimeout(() => vendedorRef.current?.focus(), 30)
            }}
            title="Selecionar vendedor (F6)"
          >
            <span className="pdv-vendedor-icone">👤</span>
            <span className="pdv-vendedor-nome">{vendedorSelecionado?.nome ?? 'Vendedor'}</span>
            <span className="pdv-f6-hint">F6</span>
          </button>
          <button
            className={`pdv-cliente-btn ${clienteSel ? 'tem' : ''}`}
            onClick={() => setModalClientes(true)}
            title="Selecionar cliente (F5)"
          >
            <span className="pdv-cliente-icone">👥</span>
            <span className="pdv-cliente-nome">{clienteSel ? clienteSel.nome : 'Cliente'}</span>
            <span className="pdv-f5-hint">F5</span>
          </button>
          {clienteSel && (
            <button className="pdv-cliente-limpar" title="Remover cliente da venda" onClick={() => { setClienteSel(null); setEnderecoEntrega((prev) => clienteSel ? '' : prev) }}>
              ×
            </button>
          )}
          <button
            className={`pdv-entrega-btn ${taxaEntrega > 0 || enderecoEntrega ? 'tem' : ''}`}
            onClick={() => setModalEntrega(true)}
            title="Configurar entrega (F9)"
          >
            <span className="pdv-entrega-icone">🚚</span>
            <span className="pdv-entrega-nome">{taxaEntrega > 0 ? `Entrega R$ ${formatarMoeda(taxaEntrega)}` : 'Entrega'}</span>
            <span className="pdv-f9-hint">F9</span>
          </button>
          <button
            className={`pdv-obs-btn ${observacaoVenda.trim() ? 'tem' : ''}`}
            onClick={() => setModalObs(true)}
            title="Observação da venda (F4)"
          >
            <span className="pdv-obs-icone">📝</span>
            <span className="pdv-obs-nome">{observacaoVenda.trim() ? 'Obs' : 'Obs.'}</span>
            <span className="pdv-f4-hint">F4</span>
          </button>
        </div>
        <span className="pdv-f3">F2: Pagamento • F3: Desconto • F1: Preço • F6: Vendedor</span>
      </div>
      </div>

      <div className="pdv-corpo">
        {colunas === 0 && (
          <button
            className="pdv-mostrar-cards"
            onClick={() => {
              setColunas(2)
              localStorage.setItem('pdv_colunas', '2')
            }}
          >
            ⇔ Mostrar cards
          </button>
        )}
        <div className={`mosaico colunas-${colunas} ${colunas === 0 ? 'oculto' : ''}`}>
          <div className="pdv-listas">
            <button
              className={`pdv-lista-chip ${listaAtivaId === -1 ? 'ativo' : ''}`}
              onClick={() => selecionarLista(-1)}
              title="Mostrar apenas produtos com estoque acima do mínimo"
            >
              Em estoque ({produtos.filter(estaEmEstoque).length})
            </button>
            <button
              className={`pdv-lista-chip ${listaAtivaId === null ? 'ativo' : ''}`}
              onClick={() => selecionarLista(null)}
            >
              Lista completa
            </button>
            {listas.map((l) => (
              <span key={l.id} className={`pdv-lista-chip-wrap ${listaAtivaId === l.id ? 'ativo' : ''}`}>
                <button className="pdv-lista-chip" onClick={() => selecionarLista(l.id)}>
                  {l.nome} ({l.id === listaAtivaId ? produtosListaAtiva.size : ''})
                </button>
                <button className="pdv-lista-remover" title="Excluir lista" onClick={() => excluirLista(l.id)}>x</button>
              </span>
            ))}
            <button className="pdv-lista-chip nova" onClick={() => setModalNovaLista(true)}>+ Nova lista</button>
            <div className="pdv-lista-colunas" title="Quantidade de cards por linha">
              <span>Cards:</span>
              <select
                value={colunas}
                onChange={(e) => {
                  const c = Number(e.target.value)
                  setColunas(c)
                  localStorage.setItem('pdv_colunas', String(c))
                }}
              >
                <option value={0}>0 (ocultar)</option>
                <option value={1}>1 card</option>
                <option value={2}>2 cards</option>
                <option value={3}>3 cards</option>
              </select>
              <button
                className="btn-mini"
                title={colunas === 0 ? 'Mostrar cards' : 'Ocultar cards'}
                onClick={() => {
                  const novo = colunas === 0 ? 2 : 0
                  setColunas(novo)
                  localStorage.setItem('pdv_colunas', String(novo))
                }}
              >
                {colunas === 0 ? 'Mostrar' : 'Ocultar'}
              </button>
            </div>
          </div>

          {produtos.length === 0 && (
            <p className="vazio-mosaico">
              {busca ? 'Nenhum produto encontrado.' : 'Cadastre produtos na aba Produtos para começar.'}
            </p>
          )}
          {colunas === 0 && produtos.length > 0 && (
            <p className="vazio-mosaico">Cards ocultos. Use o botão "Mostrar" acima para exibir os produtos.</p>
          )}
          {colunas !== 0 && categoriasPdv.map((cat) => (
            <div key={cat} className="marca-grupo">
              <h3 className="marca-titulo">{cat}</h3>
              <div className="mosaico-grid">
                {produtos
                  .filter((p) => (p.categoria ?? 'Sem categoria') === cat)
                  .filter(produtoVisivel)
                  .map((p) => {
                    const naLista = produtosListaAtiva.has(p.id)
                    const ehSelecionado = busca.trim() && sugestoes[sugestaoIdx]?.id === p.id
                    return (
                      <div
                        key={p.id}
                        ref={ehSelecionado ? cardSelRef : undefined}
                        className={`card-produto-wrap ${ehSelecionado ? 'selecionado' : ''}`}
                      >
                        <div className={`card-produto ${p.estoque <= 0 ? 'sem-estoque' : ''}`} onClick={() => adicionarProduto(p)}>
                          {imagens[p.id] && <img className="card-imagem" src={dataUrlImagem(imagens[p.id])} alt="" />}
                          <span
                            className="card-nome"
                            title="Duplo clique no nome: editar produto"
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => { e.stopPropagation(); onEditarProduto?.(p.id) }}
                          >
                            {p.nome}
                          </span>
                          <span className="card-preco">
                            R$ {precoDe(p).toFixed(2)}
                          </span>
                          <span className="card-estoque">
                            {p.estoque <= 0 ? 'Esgotado' : `${p.estoque} disp.`}
                            {(pedidosAbertos[p.id] ?? 0) > 0 && (
                              <span className="card-pedidos"> • {pedidosAbertos[p.id]} ped.</span>
                            )}
                          </span>
                        </div>
                        <button
                          className={`card-lista-btn ${naLista ? 'na-lista' : ''}`}
                          title={naLista ? 'Remover da lista' : 'Adicionar à lista'}
                          onClick={() => alternarProdutoNaLista(p.id)}
                        >
                          {naLista ? '✓' : '+'}
                        </button>
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>

        <div className="pdv-resize" onMouseDown={iniciarArrasto} title="Arraste para ajustar o painel">
          <div className="pdv-resize-grip" />
        </div>

        <aside className={`resumo ${colunas === 0 ? 'expandido' : ''}`} style={{ width: colunas === 0 ? undefined : larguraResumo }}>
          <h2>Venda</h2>
          {carrinho.length === 0 && <p className="vazio">Carrinho vazio. Clique num produto.</p>}
          <div className="carrinho-itens">
            {carrinho.map((item) => {
              const produto = produtos.find((x) => x.id === item.produto_id)
              return (
                <div
                  key={item.uid}
                  className="carrinho-item"
                  title="Duplo clique ou botão direito: editar produto"
                  onDoubleClick={() => produto && abrirEdicaoProduto(produto)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (produto) abrirEdicaoProduto(produto)
                  }}
                >
                  <div className="ci-info">
                    <strong>{item.nome}</strong>
                    <span>R$ {item.preco_unitario.toFixed(2)}{item.desconto ? ` • -R$ ${itemDescontoValor(item).toFixed(2)}` : ''}</span>
                    {item.observacao && <small className="ci-obs">{item.observacao}</small>}
                  </div>
                  <div className="item-acoes">
                    <button onClick={() => mudarQuantidade(item.uid, -1)}>-</button>
                    <span>{item.quantidade}</span>
                    <button onClick={() => mudarQuantidade(item.uid, 1)}>+</button>
                    <button className="remover" onClick={() => removerItem(item.uid)}>x</button>
                    <button
                      className="editar"
                      title="Editar item da venda"
                      onClick={() => {
                        const idx = carrinho.findIndex((c) => c.uid === item.uid)
                        if (idx >= 0) abrirEdicaoItem(idx)
                      }}
                    >
                      ✎
                    </button>
                  </div>
                  <strong>R$ {itemTotalFinal(item).toFixed(2)}</strong>
                </div>
              )
            })}
          </div>

          {(modo === 'orcamento' || edicaoPedido) && (
            <div className="pdv-cliente-input">
              <span>{modo === 'orcamento' ? 'Cliente (orçamento):' : 'Cliente:'}</span>
              <input
                value={clientePedido}
                onChange={(e) => setClientePedido(e.target.value)}
                placeholder="Nome do cliente"
              />
            </div>
          )}

          <div className="resumo-valores">
            <div className="linha"><span>Subtotal</span><strong>R$ {subtotal.toFixed(2)}</strong></div>
            {descontoValor > 0 && (
              <div className="linha desconto"><span>Desconto</span><strong className="texto-vermelho">- R$ {descontoValor.toFixed(2)}</strong></div>
            )}
            <button className="linha pdv-entrega-resumo" onClick={() => setModalEntrega(true)}>
              <span>Entrega</span>
              <strong>{taxaEntrega > 0 ? `R$ ${taxaEntrega.toFixed(2)}` : '-'}</strong>
            </button>
            {observacaoVenda.trim() && (
              <div className="linha pdv-resumo-obs">
                <span>Obs.</span>
                <strong>{observacaoVenda}</strong>
              </div>
            )}
            <div className="linha total"><strong>R$ {totalVenda.toFixed(2)}</strong></div>
          </div>

          {!caixaAberto && (
            <p className="mensagem pdv-caixa-aviso">
              Caixa fechado. Abra o caixa na aba Caixa para as vendas entrarem no fluxo.
            </p>
          )}

          {edicaoPedido && (
            <p className="mensagem pdv-edicao-aviso">
              Editando pedido <strong>{edicaoPedido.numero}</strong> — ao concluir, o pedido original será atualizado.
            </p>
          )}

          <button
            className="finalizar"
            onClick={() => (modo === 'pedido' || modo === 'orcamento') ? finalizarVenda() : abrirPagamento()}
            disabled={carrinho.length === 0 || (!caixaAberto && !edicaoPedido && modo === 'venda')}
          >
            {modo === 'pedido' ? 'Salvar Pedido (F2)' : modo === 'orcamento' ? 'Salvar Orçamento (F2)' : 'Pagamento (F2)'}
          </button>
          {mensagem && <p className="mensagem">{mensagem}</p>}
        </aside>
      </div>

      {posVenda && (
        <div className="modal-overlay">
          <div className="modal modal-pagamento">
            <h3>{modo === 'pedido' ? `Pedido ${posVenda.numero} salvo!` : modo === 'orcamento' ? `Orçamento ${posVenda.numero} salvo!` : `Venda ${posVenda.numero} concluída!`}</h3>
            <div className="pagamento-total">
              <span>Total</span>
              <strong>R$ {posVenda.total.toFixed(2)}</strong>
            </div>
            {posVenda.troco > 0 && (
              <div className="pagamento-falta ok">
                <span>Troco</span>
                <strong>R$ {posVenda.troco.toFixed(2)}</strong>
              </div>
            )}
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={fecharPosVenda}>Fechar (Esc)</button>
              <button className="btn-primario" onClick={novaVenda}>Nova venda (F2)</button>
            </div>
          </div>
        </div>
      )}

      {modalNovaLista && (
        <div className="modal-overlay" onClick={() => setModalNovaLista(false)}>
          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>Nova lista personalizada</h3>
            <div className="form-grid">
              <label>Nome da lista
                <input
                  autoFocus
                  value={nomeNovaLista}
                  onChange={(e) => setNomeNovaLista(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') criarLista() }}
                  placeholder="Ex: Mais vendidos, Promoção, Combos..."
                />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalNovaLista(false)}>Cancelar</button>
              <button className="btn-primario" onClick={criarLista}>Criar</button>
            </div>
          </div>
        </div>
      )}

      {modalVendedor && (
        <div className="modal-overlay" onClick={() => setModalVendedor(false)}>
          <div className="modal modal-vendedor">
            <h3>Selecione o vendedor</h3>
            <p className="pgto-f2-ajuda" style={{ marginTop: -4 }}>Setas ↑↓: navegar • Enter: confirmar • Esc: voltar</p>
            <div className="vendedor-lista">
              {vendedores.map((v, idx) => (
                <button
                  key={v.id}
                  ref={idx === vendedorIdx ? vendedorRef : undefined}
                  className={`vendedor-item ${idx === vendedorIdx ? 'ativo' : ''}`}
                  onMouseEnter={() => setVendedorIdx(idx)}
                  onClick={() => { setVendedorIdx(idx); confirmarVendedor() }}
                >
                  <span className="vendedor-icone">👤</span>
                  <span className="vendedor-nome">{v.nome}</span>
                  {v.id === usuarioId && <span className="vendedor-atual">atual</span>}
                </button>
              ))}
              {vendedores.length === 0 && <p className="sem-resultado">Nenhum vendedor ativo cadastrado.</p>}
            </div>
          </div>
        </div>
      )}

      {modalClientes && (
        <div className="modal-overlay" onClick={() => setModalClientes(false)}>
          <div className="modal modal-clientes-pdv" onClick={(e) => e.stopPropagation()}>
            <Clientes onSelecionar={selecionarClienteDaVenda} onFechar={() => setModalClientes(false)} />
          </div>
        </div>
      )}

      {modalObs && (
        <div className="modal-overlay" onClick={() => setModalObs(false)}>
          <div className="modal modal-obs" onClick={(e) => e.stopPropagation()}>
            <h3>Observação da venda</h3>
            <p className="pgto-f2-ajuda" style={{ marginTop: -4 }}>Texto interno/observações desta venda.</p>
            <textarea
              ref={obsRef}
              className="obs-textarea"
              rows={4}
              value={observacaoVenda}
              onChange={(e) => setObservacaoVenda(e.target.value)}
              placeholder="Ex.: troca de produto, observação do cliente, etc."
            />
            <div className="modal-acoes">
              <button className="btn-primario" onClick={() => setModalObs(false)}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {modalEntrega && (
        <div className="modal-overlay" onClick={() => setModalEntrega(false)}>
          <div className="modal modal-entrega" onClick={(e) => e.stopPropagation()}>
            <h3>Entrega</h3>
            {modo === 'venda' && (
              <p className="pgto-f2-ajuda" style={{ marginTop: -4 }}>A entrega com taxa e endereço é registrada junto à venda.Atente para o valor no total.</p>
            )}
            <div className="form-grid">
              <label style={{ gridColumn: '1 / -1' }}>Taxa de entrega (R$)
                <CampoDinheiro
                  value={taxaEntregaStr}
                  onChange={setTaxaEntregaStr}
                  placeholder="0,00"
                />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>Endereço de entrega
                <input
                  ref={entregaEndRef}
                  value={enderecoEntrega}
                  onChange={(e) => setEnderecoEntrega(e.target.value)}
                  placeholder="Rua, número, bairro, cidade"
                />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => { setTaxaEntregaStr(''); setEnderecoEntrega('') }}>Limpar</button>
              <button className="btn-primario" onClick={() => setModalEntrega(false)}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {modalPagamento && (
        <div className="modal-overlay">
          <div className="modal modal-pgto-f2">
            <div className="pgto-f2-topo">
              <div className="pgto-f2-total">
                <span>Total</span>
                <strong>R$ {totalVenda.toFixed(2)}</strong>
              </div>
              <div className="pgto-f2-topo-dir">
                <span className="pgto-f2-desconto-hint">F3 DESCONTO</span>
                <button className="btn-icone" onClick={() => setModalPagamento(false)} title="Fechar (Esc)">✕</button>
              </div>
            </div>

            <div className="pgto-f2-pagos">
              {pagamentos.map((p, idx) => (
                <div key={idx} className="pgto-f2-pago">
                  <span>{iconForma(p.forma)} {p.forma}</span>
                  <span>R$ {p.valor.toFixed(2)}</span>
                  <button className="btn-mini" onClick={() => removerPagamento(idx)}>x</button>
                </div>
              ))}
              {pagamentos.length === 0 && <p className="pgto-f2-sem-pgto">Nenhum pagamento lançado ainda.</p>}
            </div>

            <div className={`pgto-f2-falta ${faltaComDigitacao <= 0 ? 'ok' : ''}`}>
              <span>{faltaComDigitacao > 0 ? 'Restante' : 'Pagamento completo'}</span>
              <strong>{faltaComDigitacao > 0 ? `R$ ${faltaComDigitacao.toFixed(2)}` : `Troco R$ ${troco.toFixed(2)}`}</strong>
            </div>

            <div className="pgto-f2-formas">
              {formas.map((f, idx) => {
                const focada = idx === formaSelIdx
                return (
                  <div key={f.id} className={`pgto-f2-forma-linha ${focada ? 'foco' : ''} ${(valoresFormas[f.nome] ?? '') || pagamentos.some((p) => p.forma === f.nome || p.forma.startsWith(f.nome)) ? 'tem' : ''}`} onClick={() => setFormaSelIdx(idx)}>
                    <span className="pgto-f2-forma-icone">{iconForma(f.nome)}</span>
                    <span className="pgto-f2-forma-nome">
                      {f.nome}
                      {f.permite_parcelas ? ` (${f.max_parcelas}x)` : ''}
                    </span>
                    <div className="pgto-f2-forma-inputs">
                      <CampoDinheiro
                        ref={idx === formaSelIdx ? valorInputRef : undefined}
                        value={valoresFormas[f.nome] ?? ''}
                        onChange={(v) => setValoresFormas((prev) => ({ ...prev, [f.nome]: v }))}
                        className={`pgto-f2-valor-input${focada ? ' foco' : ''}`}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') { e.preventDefault(); setFormaSelIdx((idx + 1) % formas.length); return }
                          if (e.key === 'ArrowUp') { e.preventDefault(); setFormaSelIdx((idx - 1 + formas.length) % formas.length); return }
                          if (e.key === 'Enter') { e.preventDefault(); lancarForma(f.nome, f, e.currentTarget.value); return }
                          if (e.key === '+') { e.preventDefault(); lancarForma(f.nome, f, e.currentTarget.value); return }
                          if (/^\d$/.test(e.key)) {
                            e.preventDefault()
                            const novo = e.currentTarget.value.replace(/\D/g, '') + e.key
                            const formatado = formatarMoedaDigitos(novo)
                            setValoresFormas((prev) => ({ ...prev, [f.nome]: formatado }))
                          }
                          if (e.key === 'Backspace') {
                            e.preventDefault()
                            const semPonto = e.currentTarget.value.replace(/\./g, '')
                            const digitos = semPonto.replace(/\D/g, '').slice(0, -1)
                            setValoresFormas((prev) => ({ ...prev, [f.nome]: formatarMoedaDigitos(digitos) }))
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="pgto-f2-ajuda">Setas ↑↓: navegar forma • Digite só números e Enter/+: lançar</p>

            <div className="pgto-f2-opcoes">
              <label><input type="checkbox" checked={imprimirVenda} onChange={(e) => setImprimirVenda(e.target.checked)} /> Imprimir</label>
              <label><input type="checkbox" /> Fiado (pagar depois)</label>
            </div>

            <button className="pgto-f2-concluir" onClick={finalizarVenda} disabled={faltaComDigitacao > 0}>
              {faltaComDigitacao > 0 ? `Falta R$ ${faltaComDigitacao.toFixed(2)}` : 'F2 CONCLUIR'}
            </button>
          </div>
        </div>
      )}

      {modalAutorizarTroco && (
        <div className="modal-overlay" onClick={() => setModalAutorizarTroco(false)}>
          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>Troco acima do limite</h3>
            <div className="modal-resumo">
              <div className="linha"><span>Troco desta venda</span><strong>R$ {troco.toFixed(2)}</strong></div>
              <div className="linha"><span>Troco máximo permitido</span><strong>R$ {trocoMax.toFixed(2)}</strong></div>
              <div className="linha total-periodo"><span>Excedente</span><strong className="texto-vermelho">R$ {Math.max(0, troco - trocoMax).toFixed(2)}</strong></div>
            </div>
            <p className="nota-config">O troco está acima do limite configurado (item 38 das Configurações de Vendas). Para concluir, é necessária a autorização de um supervisor (admin ou gerente).</p>
            <div className="form-grid">
              <label>Senha do supervisor
                <input
                  type="password"
                  autoFocus
                  value={senhaSupervisor}
                  onChange={(e) => setSenhaSupervisor(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') autorizarTrocoComSenha() }}
                  placeholder="Senha"
                />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalAutorizarTroco(false)}>Cancelar</button>
              <button className="btn-primario" onClick={autorizarTrocoComSenha}>Autorizar e concluir</button>
            </div>
          </div>
        </div>
      )}

      {modalDesconto && (
        <div className="modal-overlay" onClick={() => setModalDesconto(false)}>          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>Desconto</h3>
            <div className="modal-resumo">
              <div className="linha"><span>Subtotal</span><strong>R$ {subtotal.toFixed(2)}</strong></div>
              <div className="linha"><span>Desconto</span><strong className="texto-vermelho">- R$ {descontoValor.toFixed(2)}</strong></div>
              <div className="linha total-periodo"><span>Total com desconto</span><strong>R$ {totalVenda.toFixed(2)}</strong></div>
            </div>
            <div className="pdv-desconto-cab" style={{ marginBottom: 8 }}>
              <span>Tipo</span>
              <div className="segmented pdv-desconto-tipo">
                <button className={descontoTipo === 'percent' ? 'ativo' : ''} onClick={() => setDescontoTipo('percent')}>%</button>
                <button className={descontoTipo === 'valor' ? 'ativo' : ''} onClick={() => setDescontoTipo('valor')}>R$</button>
              </div>
            </div>
            <div className="pdv-desconto-linha" style={{ marginBottom: 10 }}>
              <input
                ref={descontoRef}
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={descontoEntrada}
                onChange={(e) => setDescontoEntrada(e.target.value)}
                placeholder={descontoTipo === 'percent' ? 'Ex: 10' : 'Ex: 5,00'}
              />
              <span>
                {descontoTipo === 'percent'
                  ? descontoEntrada ? `R$ ${descontoValor.toFixed(2)}` : '—'
                  : descontoEntrada ? `${((descontoValor / (subtotal || 1)) * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalDesconto(false)}>Fechar (Esc)</button>
              <button className="btn-primario" onClick={() => setModalDesconto(false)}>Aplicar</button>
            </div>
          </div>
        </div>
      )}

      {itemEditando && (
        <div className="modal-overlay" onClick={() => { setItemEditando(null); setItemEditandoIdx(null) }}>
          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>Editar item: {itemEditando.nome}</h3>
            <div className="form-grid">
              <label>Preço unitário (R$)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={itemEditando.preco_unitario}
                  onChange={(e) => setItemEditando({ ...itemEditando, preco_unitario: Number(e.target.value) || 0 })}
                />
              </label>
              <label>Quantidade
                <div className="editar-item-qtd">
                  <button onClick={() => setItemEditando({ ...itemEditando, quantidade: Math.max(0, itemEditando.quantidade - 1) })}>−</button>
                  <span>{itemEditando.quantidade}</span>
                  <button onClick={() => setItemEditando({ ...itemEditando, quantidade: itemEditando.quantidade + 1 })}>+</button>
                </div>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>Desconto do item
                <div className="pdv-desconto-tipo">
                  <select
                    value={itemEditando.desconto_tipo ?? 'valor'}
                    onChange={(e) => setItemEditando({ ...itemEditando, desconto_tipo: e.target.value as 'percent' | 'valor' })}
                  >
                    <option value="valor">R$</option>
                    <option value="percent">%</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemEditando.desconto ?? ''}
                    onChange={(e) => setItemEditando({ ...itemEditando, desconto: Number(e.target.value) || 0 })}
                    placeholder={itemEditando.desconto_tipo === 'percent' ? 'Ex: 10' : 'Ex: 5,00'}
                  />
                </div>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>Observação do item
                <input
                  value={itemEditando.observacao ?? ''}
                  onChange={(e) => setItemEditando({ ...itemEditando, observacao: e.target.value })}
                  placeholder="Ex: sem cebola, cor azul..."
                />
              </label>
            </div>
            <div className="modal-resumo">
              <div className="linha"><span>Subtotal do item</span><strong>R$ {(itemEditando.preco_unitario * itemEditando.quantidade).toFixed(2)}</strong></div>
              {itemDescontoValor(itemEditando) > 0 && (
                <div className="linha"><span>Desconto</span><strong className="texto-vermelho">- R$ {itemDescontoValor(itemEditando).toFixed(2)}</strong></div>
              )}
              <div className="linha total-periodo"><span>Total final</span><strong>R$ {itemTotalFinal(itemEditando).toFixed(2)}</strong></div>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => { setItemEditando(null); setItemEditandoIdx(null) }}>Cancelar (Esc)</button>
              <button className="btn-primario" onClick={salvarEdicaoItem}>Aplicar</button>
            </div>
          </div>
        </div>
      )}

      {produtoSemEstoque && (
        <div className="modal-overlay" onClick={() => setProdutoSemEstoque(null)}>
          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>{produtoSemEstoque.produto.estoque < produtoSemEstoque.qtd ? 'Estoque insuficiente' : 'Produto sem estoque'}</h3>
            <p className="sem-resultado">
              O produto <strong>{produtoSemEstoque.produto.nome}</strong> tem estoque disponível de {produtoSemEstoque.produto.estoque}, mas a quantidade informada é {produtoSemEstoque.qtd}.
              {permitirSemEstoque
                ? ' Confirma a venda mesmo assim?'
                : ' A venda sem estoque está desativada. Para liberar, ative abaixo.'}
            </p>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setProdutoSemEstoque(null)}>Cancelar</button>
              <button
                className="btn-primario"
                onClick={() => {
                  const alvo = produtoSemEstoque
                  setProdutoSemEstoque(null)
                  forcarAdicionar(alvo.produto, alvo.qtd)
                }}
              >
                Adicionar mesmo assim
              </button>
              {!permitirSemEstoque && (
                <button
                  className="btn-secundario"
                  onClick={() => {
                    getDbApi().run(
                      `INSERT INTO config (chave, valor) VALUES ('pdv_permitir_sem_estoque', '1')
                       ON CONFLICT(chave) DO UPDATE SET valor = '1'`
                    ).catch(() => {})
                    setPermitirSemEstoque(true)
                    try { localStorage.setItem('pdv_permitir_sem_estoque', '1') } catch { /* ignore */ }
                    const alvo = produtoSemEstoque
                    setProdutoSemEstoque(null)
                    forcarAdicionar(alvo.produto, alvo.qtd)
                  }}
                >
                  Permitir sempre
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {produtoEditando && (
        <div className="modal-overlay" onClick={() => setProdutoEditando(null)}>
          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>Editar produto</h3>
            <div className="form-grid">
              <label style={{ gridColumn: '1 / -1' }}>Nome
                <input autoFocus value={formEdicao.nome} onChange={(e) => setFormEdicao({ ...formEdicao, nome: e.target.value })} />
              </label>
              <label>Código de barras
                <input value={formEdicao.codigo_barras} onChange={(e) => setFormEdicao({ ...formEdicao, codigo_barras: e.target.value })} />
              </label>
              <label>Estoque
                <input type="number" step="0.01" value={formEdicao.estoque} onChange={(e) => setFormEdicao({ ...formEdicao, estoque: e.target.value })} />
              </label>
              <label>Preço de venda (R$)
                <CampoDinheiro value={formEdicao.preco_venda} onChange={(v) => setFormEdicao({ ...formEdicao, preco_venda: v })} />
              </label>
              <label>Preço atacado 1 (R$)
                <CampoDinheiro value={formEdicao.preco_atacado1} onChange={(v) => setFormEdicao({ ...formEdicao, preco_atacado1: v })} />
              </label>
              <label>Preço atacado 2 (R$)
                <CampoDinheiro value={formEdicao.preco_atacado2} onChange={(v) => setFormEdicao({ ...formEdicao, preco_atacado2: v })} />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setProdutoEditando(null)}>Cancelar</button>
              <button className="btn-primario" onClick={salvarEdicaoProduto}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {posVendaCupom && (
        <Cupom
          numero={posVendaCupom.numero}
          cliente={clientePedido || undefined}
          itens={posVendaCupom.itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, preco: i.preco_unitario }))}
          subtotal={posVendaCupom.total}
          desconto={descontoValor}
          total={posVendaCupom.total}
          pagamentos={posVendaCupom.pagamentos}
          onFechar={() => setPosVendaCupom(null)}
        />
      )}

      {produtoQtd && (
        <div className="modal-overlay" onClick={() => setProdutoQtd(null)}>
          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>Quantidade: {produtoQtd.produto.nome}</h3>
            <div className="editar-item-qtd" style={{ justifyContent: 'center', margin: '14px 0' }}>
              <button
                onClick={() => {
                  const novo = Math.max(0, produtoQtd.quantidade - stepQtd)
                  setProdutoQtd({ ...produtoQtd, quantidade: casasDecimais === 2 ? Math.round(novo * 100) / 100 : Math.round(novo) })
                }}
              >
                −
              </button>
              <input
                autoFocus
                className="pdv-quant-input"
                inputMode="decimal"
                style={{ width: 90, textAlign: 'center', fontSize: 18 }}
                value={formatarQtd(produtoQtd.quantidade)}
                onChange={(e) => setProdutoQtd({ ...produtoQtd, quantidade: parseQtd(e.target.value) })}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    adicionarAoCarrinho(produtoQtd.produto, produtoQtd.quantidade)
                    setProdutoQtd(null)
                    buscaRef.current?.focus()
                  }
                }}
              />
              <button
                onClick={() => {
                  const novo = produtoQtd.quantidade + stepQtd
                  setProdutoQtd({ ...produtoQtd, quantidade: casasDecimais === 2 ? Math.round(novo * 100) / 100 : Math.round(novo) })
                }}
              >
                +
              </button>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setProdutoQtd(null)}>Cancelar</button>
              <button
                className="btn-primario"
                onClick={() => {
                  adicionarAoCarrinho(produtoQtd.produto, produtoQtd.quantidade)
                  setProdutoQtd(null)
                  buscaRef.current?.focus()
                }}
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalConfig && <ConfigPdv onFechar={() => setModalConfig(false)} />}
      {modalAbrirCaixa && (
        <div className="modal-overlay" onClick={() => { setModalAbrirCaixa(false); setSaldoInicialCaixa('') }}>
          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>Abrir Caixa</h3>
            <p className="nota-config">O caixa está fechado. Informe o saldo inicial para abri-lo e continuar a venda.</p>
            <label className="config-campo">
              Saldo inicial (R$)
              <input
                autoFocus
                value={saldoInicialCaixa}
                onChange={(e) => setSaldoInicialCaixa(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </label>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => { setModalAbrirCaixa(false); setSaldoInicialCaixa('') }}>Cancelar</button>
              <button className="btn-primario" onClick={abrirCaixaDoPdv}>Abrir e continuar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
