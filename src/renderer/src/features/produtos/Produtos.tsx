import { useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { getDbApi, getImagemApi, DbApi, dataUrlImagem } from '../../shared/db'
import CampoDinheiro, { parseMoeda, formatarMoeda } from '../../shared/CampoDinheiro'
import ImportarProdutos from './ImportarProdutos'
import Fornecedores from '../fornecedores/Fornecedores'

interface Produto {
  id: number
  nome: string
  codigo_barras: string | null
  codigo_interno: string | null
  codigo_extra: string | null
  categoria_id: number | null
  categoria_nome: string | null
  subcategoria_id: number | null
  marca_id: number | null
  marca_nome: string | null
  fornecedor_id: number | null
  preco_custo: number
  preco_venda: number
  preco_promo: number | null
  preco_atacado1: number | null
  preco_atacado2: number | null
  qtd_min_atacado1: number | null
  qtd_min_atacado2: number | null
  estoque: number
  estoque_minimo: number
  estoque_maximo: number | null
  unidade: string
  ativo: number
  imagem: string | null
  promocional: number
  controla_estoque: number
  permite_fracionado: number
  localizacao: string | null
  peso_liq: number | null
  peso_bruto: number | null
  observacoes: string | null
  preco_automatico: number
  preco_alteravel: number
  subcategoria_nome: string | null
  fornecedor_nome: string | null
  ncm: string | null
  cest: string | null
  exportar_balanca: number
  descricao: string | null
  publicado: number
  catalogo_publicado: number
  catalogo_ordem: number
  criado_em: string
}

interface Categoria {
  id: number
  nome: string
}

interface Subcategoria {
  id: number
  categoria_id: number
  nome: string
}

interface Marca {
  id: number
  nome: string
}

type AbaProduto = 'cadastro' | 'combo' | 'tributacao' | 'fornecedores' | 'opcoes' | 'validade' | 'transacoes'

const produtoVazio = {
  nome: '',
  codigo_barras: '',
  codigo_interno: '',
  codigo_extra: '',
  codigo_automatico: 1,
  categoria_id: '' as string,
  subcategoria_id: '' as string,
  marca_id: '' as string,
  fornecedor_id: '' as string,
  preco_custo: '',
  preco_venda: '',
  preco_promo: '',
  preco_atacado1: '',
  preco_atacado2: '',
  qtd_min_atacado1: '',
  qtd_min_atacado2: '',
  preco_automatico: 0,
  preco_alteravel: 1,
  promocional: 0,
  estoque: '',
  estoque_minimo: '',
  estoque_maximo: '',
  controla_estoque: 1,
  permite_fracionado: 0,
  unidade: 'un',
  localizacao: '',
  peso_liq: '',
  peso_bruto: '',
  observacoes: '',
  ativo: 1,
  catalogo_publicado: 1,
  catalogo_ordem: ''
}

const LIMITES_ESTOQUE = ['Padrão', 'Mínimo e máximo', 'Somente mínimo', 'Não controlar limites']

export default function Produtos({ produtoEdicaoId, pedirConfig }: { produtoEdicaoId?: number | null; pedirConfig?: number }) {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [subcategorias, setSubcategorias] = useState<Subcategoria[]>([])
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState({ ...produtoVazio })
  const formOriginalRef = useRef({ ...produtoVazio })
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [formAberto, setFormAberto] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [erros, setErros] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<{ tipo: 'ok' | 'erro' | 'info'; texto: string } | null>(null)
  const [imagemPreview, setImagemPreview] = useState<string | null>(null)
  const [aba, setAba] = useState<AbaProduto>('cadastro')
  const [limiteEstoque, setLimiteEstoque] = useState('Padrão')
  const nomeRef = useRef<HTMLInputElement>(null)
  const obsAberto = useRef(false)
  const wrapProdRef = useRef<HTMLDivElement>(null)
  const scrollbarProdRef = useRef<HTMLDivElement>(null)
  const sincronizarScrollbarProd = () => {
    const wrap = wrapProdRef.current
    const sb = scrollbarProdRef.current
    if (!wrap || !sb) return
    const temScroll = wrap.scrollWidth > wrap.clientWidth
    sb.style.display = temScroll ? 'block' : 'none'
    if (temScroll) {
      const fill = sb.querySelector('.tabela-scrollbar-fixo-fill') as HTMLElement | null
      if (fill) fill.style.width = `${wrap.scrollWidth}px`
      sb.scrollLeft = wrap.scrollLeft
    }
  }
  const onScrollbarProd = () => {
    const wrap = wrapProdRef.current
    const sb = scrollbarProdRef.current
    if (wrap && sb) wrap.scrollLeft = sb.scrollLeft
  }
  const [modo, setModo] = useState<'lista' | 'importar' | 'fornecedores' | 'etiquetas' | 'tributacao'>('lista')
  const [limite, setLimite] = useState(50)
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [buscaAvancada, setBuscaAvancada] = useState(false)
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativos' | 'inativos'>('ativos')
  const [filtroEspecial, setFiltroEspecial] = useState<'nenhum' | 'abaixo_min' | 'pedidos_abertos'>('nenhum')
  const [categoriaSel, setCategoriaSel] = useState<number | null>(null)
  const [subcategoriaSel, setSubcategoriaSel] = useState<number | null>(null)
  const [categoriasLateralAberta, setCategoriasLateralAberta] = useState(true)
  const [categoriasExpandidas, setCategoriasExpandidas] = useState<Record<number, boolean>>({})
  const [gerenciarCats, setGerenciarCats] = useState(false)
  const [novaCat, setNovaCat] = useState('')
  const [novaSub, setNovaSub] = useState<Record<number, string>>({})
  const [editandoCat, setEditandoCat] = useState<number | null>(null)
  const [edicaoCatNome, setEdicaoCatNome] = useState('')
  const [editandoSub, setEditandoSub] = useState<number | null>(null)
  const [edicaoSubNome, setEdicaoSubNome] = useState('')
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [menuLayout, setMenuLayout] = useState(false)
  const [modalConfig, setModalConfig] = useState(false)

  const ultimoPedirConfig = useRef(pedirConfig ?? 0)
  useEffect(() => {
    if ((pedirConfig ?? 0) > ultimoPedirConfig.current) {
      setModalConfig(true)
      ultimoPedirConfig.current = pedirConfig ?? 0
    }
  }, [pedirConfig])

  const [digitosCodigo, setDigitosCodigo] = useState(() => Number(localStorage.getItem('produtos_digitos_codigo')) || 6)
  const [proximoCodigo, setProximoCodigo] = useState<string | null>(null)
  const [ordemColunas, setOrdemColunas] = useState<string[]>(() => {
    const padrao = ['acoes', 'imagem', 'nome', 'codigo', 'marca', 'venda', 'estoque', 'status']
    try {
      const salvo = localStorage.getItem('produtos_colunas')
      if (salvo) {
        const arr = JSON.parse(salvo)
        if (Array.isArray(arr) && arr.length <= 12 && arr.includes('acoes')) return arr
      }
    } catch {}
    return padrao
  })
  const [colunaArrastando, setColunaArrastando] = useState<string | null>(null)
  const [ordem, setOrdem] = useState<{ chave: string; dir: 'asc' | 'desc' } | null>(null)
  const [colunasAbertas, setColunasAbertas] = useState(false)
  const [largurasColunas, setLargurasColunas] = useState<Record<string, number>>(() => {
    try {
      const s = localStorage.getItem('produtos_larguras')
      return s ? JSON.parse(s) : {}
    } catch {
      return {}
    }
  })
  const redimProdRef = useRef<{ chave: string; startX: number; startW: number } | null>(null)
  const produtosExibidos = produtos.slice((paginaAtual - 1) * limite, paginaAtual * limite)
  const [imagensMap, setImagensMap] = useState<Record<number, string>>({})

  const TODAS_COLUNAS: { chave: string; label: string; tipo: 'texto' | 'numero' }[] = [
    { chave: 'acoes', label: 'Ações', tipo: 'texto' },
    { chave: 'imagem', label: 'Imagem', tipo: 'texto' },
    { chave: 'nome', label: 'Nome', tipo: 'texto' },
    { chave: 'codigo', label: 'Código', tipo: 'texto' },
    { chave: 'codigo_extra', label: 'Código extra', tipo: 'texto' },
    { chave: 'marca', label: 'Marca', tipo: 'texto' },
    { chave: 'categoria', label: 'Categoria', tipo: 'texto' },
    { chave: 'subcategoria', label: 'Subcategoria', tipo: 'texto' },
    { chave: 'fornecedor', label: 'Fornecedor', tipo: 'texto' },
    { chave: 'unidade', label: 'Unidade', tipo: 'texto' },
    { chave: 'custo', label: 'Custo', tipo: 'numero' },
    { chave: 'venda', label: 'Venda', tipo: 'numero' },
    { chave: 'promo', label: 'Promo', tipo: 'numero' },
    { chave: 'atacado1', label: 'Atacado 1', tipo: 'numero' },
    { chave: 'atacado2', label: 'Atacado 2', tipo: 'numero' },
    { chave: 'qtdmin1', label: 'Qtd mín 1', tipo: 'numero' },
    { chave: 'qtdmin2', label: 'Qtd mín 2', tipo: 'numero' },
    { chave: 'estoque', label: 'Estoque', tipo: 'numero' },
    { chave: 'estoque_min', label: 'Estoque mín', tipo: 'numero' },
    { chave: 'estoque_max', label: 'Estoque máx', tipo: 'numero' },
    { chave: 'peso_liq', label: 'Peso líq', tipo: 'numero' },
    { chave: 'peso_bruto', label: 'Peso bruto', tipo: 'numero' },
    { chave: 'localizacao', label: 'Localização', tipo: 'texto' },
    { chave: 'ncm', label: 'NCM', tipo: 'texto' },
    { chave: 'cest', label: 'CEST', tipo: 'texto' },
    { chave: 'observacoes', label: 'Obs', tipo: 'texto' },
    { chave: 'status', label: 'Status', tipo: 'texto' },
    { chave: 'publicado', label: 'Publicado', tipo: 'texto' }
  ]

  const legendaColuna = (chave: string) => TODAS_COLUNAS.find((c) => c.chave === chave)?.label ?? chave

  const LARGURAS_PADRAO: Record<string, number> = {
    acoes: 100,
    imagem: 70,
    nome: 180,
    codigo: 110,
    codigo_extra: 100,
    marca: 110,
    categoria: 130,
    subcategoria: 120,
    fornecedor: 120,
    unidade: 70,
    custo: 90,
    venda: 90,
    promo: 90,
    atacado1: 90,
    atacado2: 90,
    qtdmin1: 80,
    qtdmin2: 80,
    estoque: 80,
    estoque_min: 90,
    estoque_max: 90,
    peso_liq: 80,
    peso_bruto: 90,
    localizacao: 110,
    ncm: 90,
    cest: 90,
    observacoes: 150,
    status: 80,
    publicado: 90
  }

  const larguraCol = (chave: string) => largurasColunas[chave] ?? LARGURAS_PADRAO[chave]

  const moverColuna = (origem: string, destino: string) => {
    if (origem === destino) return
    setOrdemColunas((prev) => {
      const novo = [...prev]
      const idxO = novo.indexOf(origem)
      const idxD = novo.indexOf(destino)
      if (idxO === -1 || idxD === -1) return prev
      novo.splice(idxO, 1)
      novo.splice(idxD, 0, origem)
      localStorage.setItem('produtos_colunas', JSON.stringify(novo))
      return novo
    })
  }

  const COLUNAS_PADRAO_PRODUTOS = ['acoes', 'imagem', 'nome', 'codigo', 'marca', 'categoria', 'custo', 'venda', 'estoque', 'status']

  const restaurarColunas = () => {
    setOrdemColunas([...COLUNAS_PADRAO_PRODUTOS])
    setLargurasColunas({})
    try {
      localStorage.setItem('produtos_colunas', JSON.stringify(COLUNAS_PADRAO_PRODUTOS))
      localStorage.setItem('produtos_larguras', JSON.stringify({}))
    } catch {
      // ignore
    }
    setMensagem('Colunas restauradas ao padrão.')
  }

  const alternarColuna = (chave: string) => {
    if (chave === 'acoes') return
    setOrdemColunas((prev) => {
      const novo = prev.includes(chave) ? prev.filter((c) => c !== chave) : [...prev, chave]
      localStorage.setItem('produtos_colunas', JSON.stringify(novo))
      return novo
    })
  }

  const ordenar = (chave: string) => {
    setOrdem((prev) => {
      if (prev && prev.chave === chave) {
        return prev.dir === 'asc' ? { chave, dir: 'desc' } : null
      }
      return { chave, dir: 'asc' }
    })
  }

  const ordenarProdutos = (lista: Produto[]) => {
    if (!ordem || ordem.chave === 'acoes' || ordem.chave === 'imagem') return lista
    const { chave, dir } = ordem
    const mult = dir === 'asc' ? 1 : -1
    return [...lista].sort((a, b) => {
      const va = valorColuna(a, chave)
      const vb = valorColuna(b, chave)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult
      return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR') * mult
    })
  }
  const produtosOrdenados = ordenarProdutos(produtosExibidos)

  useEffect(() => {
    const visiveis = produtosExibidos.map((p) => p.id)
    if (!visiveis.length) return
    let cancelado = false
    const carregarLote = async (inicio: number) => {
      const fim = Math.min(inicio + 15, visiveis.length)
      const lote = visiveis.slice(inicio, fim)
      if (!lote.length || cancelado) return
      try {
        const imgs = await getImagemApi().listPorIds(lote)
        if (cancelado) return
        setImagensMap((prev) => {
          const novo = { ...prev }
          for (const [k, v] of Object.entries(imgs)) if (v) novo[Number(k)] = v
          return novo
        })
      } catch { /* ignore */ }
      if (!cancelado && fim < visiveis.length) {
        setTimeout(() => carregarLote(fim), 15)
      }
    }
    carregarLote(0)
    return () => { cancelado = true }
  }, [busca, limite, paginaAtual, produtos.length])

  const carregar = useCallback(async () => {
    const db = getDbApi()
    const condicoes: string[] = []
    const params: unknown[] = []
    if (filtroStatus === 'ativos') condicoes.push(`p.ativo = 1`)
    if (filtroStatus === 'inativos') condicoes.push(`p.ativo = 0`)
    if (filtroEspecial === 'abaixo_min') condicoes.push(`p.controla_estoque = 1 AND p.estoque <= p.estoque_minimo`)
    if (filtroEspecial === 'pedidos_abertos') {
      condicoes.push(`EXISTS (
        SELECT 1 FROM pedido_itens pi2
        JOIN pedidos p2 ON p2.id = pi2.pedido_id
        WHERE pi2.produto_id = p.id AND p2.status NOT IN ('entregue', 'cancelado')
      )`)
    }
    if (categoriaSel != null) condicoes.push(`p.categoria_id = ?`)
    if (categoriaSel != null) params.push(categoriaSel)
    if (subcategoriaSel != null) condicoes.push(`p.subcategoria_id = ?`)
    if (subcategoriaSel != null) params.push(subcategoriaSel)
    const termo = busca.trim()
    if (termo) {
      if (buscaAvancada) {
        const palavras = termo.split(/\s+/).filter(Boolean)
        const condCampos = `(p.nome LIKE ? OR m.nome LIKE ? OR p.codigo_barras LIKE ? OR p.codigo_interno LIKE ?
                             OR p.codigo_extra LIKE ? OR p.descricao LIKE ? OR s.nome LIKE ? OR c.nome LIKE ? OR p.localizacao LIKE ?)`
        for (const w of palavras) {
          condicoes.push(condCampos)
          const like = `%${w}%`
          params.push(like, like, like, like, like, like, like, like, like)
        }
      } else {
        condicoes.push(`(p.nome LIKE ? OR p.codigo_barras LIKE ? OR m.nome LIKE ? OR c.nome LIKE ?)`)
        const like = `%${termo}%`
        params.push(like, like, like, like)
      }
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''
    const rows = (await db.all(
      `SELECT p.id, p.nome, p.codigo_barras, p.codigo_interno, p.codigo_extra, p.categoria_id, p.subcategoria_id,
              p.marca_id, p.fornecedor_id, p.preco_custo, p.preco_venda, p.preco_promo, p.preco_atacado1,
              p.preco_atacado2, p.qtd_min_atacado1, p.qtd_min_atacado2, p.estoque, p.estoque_minimo,
              p.estoque_maximo, p.unidade, p.ativo, p.promocional, p.controla_estoque, p.permite_fracionado,
              p.localizacao, p.peso_liq, p.peso_bruto, p.observacoes, p.preco_automatico, p.preco_alteravel,
              p.ncm, p.cest, p.exportar_balanca, p.descricao, p.publicado, p.catalogo_publicado, p.catalogo_ordem, p.criado_em,
              c.nome AS categoria_nome, m.nome AS marca_nome, s.nome AS subcategoria_nome, f.nome AS fornecedor_nome
       FROM produtos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN marcas m ON m.id = p.marca_id
       LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
       LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
       ${where}
       ORDER BY p.nome`,
      params
    )) as unknown as Produto[]
    const lista = rows.map((p) => ({ ...p, imagem: null }))
    setProdutos(lista)
    setPaginaAtual(1)
  }, [busca, buscaAvancada, filtroStatus, filtroEspecial, categoriaSel, subcategoriaSel])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    const fechar = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement
      if (!alvo.closest('.dropdown-filtro')) { setFiltrosAbertos(false); setMenuLayout(false) }
    }
    window.addEventListener('mousedown', fechar)
    return () => window.removeEventListener('mousedown', fechar)
  }, [])

  useEffect(() => {
    if (wrapProdRef.current) wrapProdRef.current.scrollTop = 0
  }, [paginaAtual, limite])

  useEffect(() => {
    getDbApi().all('SELECT id, nome FROM categorias ORDER BY nome').then((rows) => {
      setCategorias(rows as unknown as Categoria[])
    })
    getDbApi().all('SELECT id, categoria_id, nome FROM subcategorias ORDER BY nome').then((rows) => {
      setSubcategorias(rows as unknown as Subcategoria[])
    })
    getDbApi().all('SELECT id, nome FROM marcas ORDER BY nome').then((rows) => {
      setMarcas(rows as unknown as Marca[])
    })
  }, [])

  const recarregarCategorias = useCallback(() => {
    getDbApi().all('SELECT id, nome FROM categorias ORDER BY nome').then((rows) => {
      setCategorias(rows as unknown as Categoria[])
    })
    getDbApi().all('SELECT id, categoria_id, nome FROM subcategorias ORDER BY nome').then((rows) => {
      setSubcategorias(rows as unknown as Subcategoria[])
    })
  }, [])

  const adicionarCategoria = async () => {
    const nome = novaCat.trim()
    if (!nome) return
    try {
      await getDbApi().run('INSERT INTO categorias (nome) VALUES (?)', [nome])
      setNovaCat('')
      setEditandoCat(null)
      setEdicaoCatNome('')
      setMensagem(`Categoria "${nome}" adicionada.`)
      recarregarCategorias()
    } catch (e) {
      setMensagem(`Erro ao adicionar categoria: ${(e as Error).message}`)
    }
  }

  const salvarCategoria = async (id: number) => {
    const nome = edicaoCatNome.trim()
    if (!nome) return
    try {
      await getDbApi().run('UPDATE categorias SET nome = ? WHERE id = ?', [nome, id])
      setEditandoCat(null)
      setEdicaoCatNome('')
      setMensagem('Categoria atualizada.')
      recarregarCategorias()
    } catch (e) {
      setMensagem(`Erro ao atualizar categoria: ${(e as Error).message}`)
    }
  }

  const excluirCategoria = async (id: number, nome: string) => {
    if (!window.confirm(`Excluir a categoria "${nome}"? Os produtos ficarão sem categoria e as subcategorias serão removidas.`)) return
    try {
      await getDbApi().run('UPDATE produtos SET categoria_id = NULL, subcategoria_id = NULL WHERE categoria_id = ?', [id])
      await getDbApi().run('DELETE FROM subcategorias WHERE categoria_id = ?', [id])
      await getDbApi().run('DELETE FROM categorias WHERE id = ?', [id])
      setMensagem('Categoria excluída.')
      recarregarCategorias()
    } catch (e) {
      setMensagem(`Erro ao excluir categoria: ${(e as Error).message}`)
    }
  }

  const adicionarSubcategoria = async (categoriaId: number) => {
    const nome = (novaSub[categoriaId] ?? '').trim()
    if (!nome) return
    try {
      await getDbApi().run('INSERT INTO subcategorias (categoria_id, nome) VALUES (?, ?)', [categoriaId, nome])
      setNovaSub((p) => ({ ...p, [categoriaId]: '' }))
      setMensagem(`Subcategoria "${nome}" adicionada.`)
      recarregarCategorias()
    } catch (e) {
      setMensagem(`Erro ao adicionar subcategoria: ${(e as Error).message}`)
    }
  }

  const salvarSubcategoria = async (id: number) => {
    const nome = edicaoSubNome.trim()
    if (!nome) return
    try {
      await getDbApi().run('UPDATE subcategorias SET nome = ? WHERE id = ?', [nome, id])
      setEditandoSub(null)
      setEdicaoSubNome('')
      recarregarCategorias()
    } catch (e) {
      setMensagem(`Erro ao atualizar subcategoria: ${(e as Error).message}`)
    }
  }

  const excluirSubcategoria = async (id: number, nome: string) => {
    if (!window.confirm(`Excluir a subcategoria "${nome}"?`)) return
    try {
      await getDbApi().run('UPDATE produtos SET subcategoria_id = NULL WHERE subcategoria_id = ?', [id])
      await getDbApi().run('DELETE FROM subcategorias WHERE id = ?', [id])
      recarregarCategorias()
    } catch (e) {
      setMensagem(`Erro ao excluir subcategoria: ${(e as Error).message}`)
    }
  }

  useEffect(() => {
    if (formAberto) {
      setAba('cadastro')
      setTimeout(() => nomeRef.current?.focus(), 50)
    }
  }, [formAberto])

  useEffect(() => {
    const t = setTimeout(() => sincronizarScrollbarProd(), 200)
    return () => clearTimeout(t)
  }, [produtos.length, limite, ordemColunas])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = redimProdRef.current
      if (!r) return
      const nova = Math.max(60, r.startW + (e.clientX - r.startX))
      setLargurasColunas((prev) => {
        const novo = { ...prev, [r.chave]: nova }
        try { localStorage.setItem('produtos_larguras', JSON.stringify(novo)) } catch { /* ignore */ }
        return novo
      })
    }
    const onUp = () => {
      redimProdRef.current = null
      document.body.classList.remove('resizing-cols')
      setTimeout(() => sincronizarScrollbarProd(), 50)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const iniciarRedim = (chave: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const atual = largurasColunas[chave] ?? LARGURAS_PADRAO[chave] ?? 120
    redimProdRef.current = { chave, startX: e.clientX, startW: atual }
    document.body.classList.add('resizing-cols')
  }

  const abrirNovo = () => {
    setForm({ ...produtoVazio })
    formOriginalRef.current = { ...produtoVazio }
    setEditandoId(null)
    setErros({})
    setImagemPreview(null)
    setLimiteEstoque('Padrão')
    setFormAberto(true)
    setMensagem('')
    setToast(null)
    atualizarProximoCodigo()
  }

  const abrirEdicao = async (p: Produto) => {
    const img = await getImagemApi().get(p.id)
    setForm({
      nome: p.nome,
      codigo_barras: p.codigo_barras ?? '',
      codigo_interno: p.codigo_interno ?? '',
      codigo_extra: p.codigo_extra ?? '',
      codigo_automatico: p.codigo_interno ? 0 : 1,
      categoria_id: p.categoria_id ? String(p.categoria_id) : '',
      subcategoria_id: p.subcategoria_id ? String(p.subcategoria_id) : '',
      marca_id: p.marca_id ? String(p.marca_id) : '',
      fornecedor_id: p.fornecedor_id ? String(p.fornecedor_id) : '',
      preco_custo: formatarMoeda(p.preco_custo),
      preco_venda: formatarMoeda(p.preco_venda),
      preco_promo: p.preco_promo != null ? formatarMoeda(p.preco_promo) : '',
      preco_atacado1: p.preco_atacado1 != null ? formatarMoeda(p.preco_atacado1) : '',
      preco_atacado2: p.preco_atacado2 != null ? formatarMoeda(p.preco_atacado2) : '',
      qtd_min_atacado1: p.qtd_min_atacado1 != null ? String(p.qtd_min_atacado1) : '',
      qtd_min_atacado2: p.qtd_min_atacado2 != null ? String(p.qtd_min_atacado2) : '',
      preco_automatico: p.preco_automatico,
      preco_alteravel: p.preco_alteravel,
      promocional: p.promocional,
      estoque: String(p.estoque),
      estoque_minimo: String(p.estoque_minimo),
      estoque_maximo: p.estoque_maximo != null ? String(p.estoque_maximo) : '',
      controla_estoque: p.controla_estoque,
      permite_fracionado: p.permite_fracionado,
      unidade: p.unidade,
      localizacao: p.localizacao ?? '',
      peso_liq: p.peso_liq != null ? String(p.peso_liq) : '',
      peso_bruto: p.peso_bruto != null ? String(p.peso_bruto) : '',
      observacoes: p.observacoes ?? '',
      ativo: p.ativo,
      catalogo_publicado: p.catalogo_publicado ?? 1,
      catalogo_ordem: p.catalogo_ordem != null ? String(p.catalogo_ordem) : ''
    })
    formOriginalRef.current = {
      nome: p.nome,
      codigo_barras: p.codigo_barras ?? '',
      codigo_interno: p.codigo_interno ?? '',
      codigo_extra: p.codigo_extra ?? '',
      codigo_automatico: p.codigo_interno ? 0 : 1,
      categoria_id: p.categoria_id ? String(p.categoria_id) : '',
      subcategoria_id: p.subcategoria_id ? String(p.subcategoria_id) : '',
      marca_id: p.marca_id ? String(p.marca_id) : '',
      fornecedor_id: p.fornecedor_id ? String(p.fornecedor_id) : '',
      preco_custo: formatarMoeda(p.preco_custo),
      preco_venda: formatarMoeda(p.preco_venda),
      preco_promo: p.preco_promo != null ? formatarMoeda(p.preco_promo) : '',
      preco_atacado1: p.preco_atacado1 != null ? formatarMoeda(p.preco_atacado1) : '',
      preco_atacado2: p.preco_atacado2 != null ? formatarMoeda(p.preco_atacado2) : '',
      qtd_min_atacado1: p.qtd_min_atacado1 != null ? String(p.qtd_min_atacado1) : '',
      qtd_min_atacado2: p.qtd_min_atacado2 != null ? String(p.qtd_min_atacado2) : '',
      preco_automatico: p.preco_automatico,
      preco_alteravel: p.preco_alteravel,
      promocional: p.promocional,
      estoque: String(p.estoque),
      estoque_minimo: String(p.estoque_minimo),
      estoque_maximo: p.estoque_maximo != null ? String(p.estoque_maximo) : '',
      controla_estoque: p.controla_estoque,
      permite_fracionado: p.permite_fracionado,
      unidade: p.unidade,
      localizacao: p.localizacao ?? '',
      peso_liq: p.peso_liq != null ? String(p.peso_liq) : '',
      peso_bruto: p.peso_bruto != null ? String(p.peso_bruto) : '',
      observacoes: p.observacoes ?? '',
      ativo: p.ativo,
      catalogo_publicado: p.catalogo_publicado ?? 1,
      catalogo_ordem: p.catalogo_ordem != null ? String(p.catalogo_ordem) : ''
    }
    setImagemPreview(img)
    setEditandoId(p.id)
    setErros({})
    setFormAberto(true)
    setMensagem('')
  }

  useEffect(() => {
    if (!produtoEdicaoId) return
    const abrir = async () => {
      const row = (await getDbApi().get(
        `SELECT p.*, c.nome AS categoria_nome, m.nome AS marca_nome, s.nome AS subcategoria_nome, f.nome AS fornecedor_nome
         FROM produtos p
         LEFT JOIN categorias c ON c.id = p.categoria_id
         LEFT JOIN marcas m ON m.id = p.marca_id
         LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
         LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
         WHERE p.id = ?`,
        [produtoEdicaoId]
      )) as unknown as Produto | undefined
      if (row) await abrirEdicao(row)
    }
    abrir()
  }, [produtoEdicaoId])

  const atualizarProximoCodigo = async () => {
    try {
      const db = getDbApi()
      const v = (await db.get(`SELECT valor FROM sequencias WHERE chave = 'produto_codigo'`)) as { valor: number } | null | undefined
      let base: number
      if (v && v.valor != null && String(v.valor) !== '') {
        base = Number(v.valor)
      } else {
        const mx = (await db.get(
          `SELECT COALESCE(MAX(CAST(codigo_interno AS INTEGER)), 0) AS m FROM produtos
           WHERE codigo_interno IS NOT NULL AND TRIM(codigo_interno) GLOB '[0-9]*'`
        )) as { m: number }
        base = Number(mx.m) || 0
      }
      const digitos = Math.max(1, Math.min(30, digitosCodigo))
      setProximoCodigo(String(base + 1).padStart(digitos, '0'))
    } catch {
      setProximoCodigo(null)
    }
  }

  const obterProximoCodigo = async (db: DbApi): Promise<string> => {
    const mx = (await db.get(
      `SELECT COALESCE(MAX(CAST(codigo_interno AS INTEGER)), 0) AS m FROM produtos
       WHERE codigo_interno IS NOT NULL AND TRIM(codigo_interno) GLOB '[0-9]*'`
    )) as { m: number }
    await db.run(`INSERT OR IGNORE INTO sequencias (chave, valor) VALUES ('produto_codigo', ?)`, [Number(mx.m) || 0])
    await db.run(`UPDATE sequencias SET valor = valor + 1 WHERE chave = 'produto_codigo'`)
    const v = (await db.get(`SELECT valor FROM sequencias WHERE chave = 'produto_codigo'`)) as { valor: number }
    const digitos = Math.max(1, Math.min(30, digitosCodigo))
    return String(Number(v.valor)).padStart(digitos, '0')
  }

  const mostrarToast = (tipo: 'ok' | 'erro' | 'info', texto: string) => {
    setToast({ tipo, texto })
    window.setTimeout(() => setToast(null), 3500)
  }

  const validarForm = (): boolean => {
    const novosErros: Record<string, string> = {}
    if (!form.nome.trim()) novosErros.nome = 'Informe o nome do produto.'
    const pv = parseMoeda(form.preco_venda)
    if (isNaN(pv) || pv <= 0) novosErros.preco_venda = 'Informe um preço de venda válido.'
    if (!form.controla_estoque && parseMoeda(form.estoque) !== 0) {
      novosErros.estoque = 'O estoque atual só pode ser definido com controle de estoque ativo.'
    }
    if (form.promocional && parseMoeda(form.preco_promo) <= 0) {
      novosErros.preco_promo = 'Informe o preço promocional (maior que zero).'
    }
    const pesoL = form.peso_liq !== '' ? parseMoeda(form.peso_liq) : 0
    if (pesoL < 0) novosErros.peso_liq = 'Peso líquido não pode ser negativo.'
    const pesoB = form.peso_bruto !== '' ? parseMoeda(form.peso_bruto) : 0
    if (pesoB < 0) novosErros.peso_bruto = 'Peso bruto não pode ser negativo.'
    setErros(novosErros)
    return Object.keys(novosErros).length === 0
  }

  const salvar = async () => {
    if (salvando) return
    if (!validarForm()) {
      if (!form.nome.trim()) nomeRef.current?.focus()
      mostrarToast('erro', 'Corrija os campos destacados antes de salvar.')
      return
    }
    const precoVenda = parseMoeda(form.preco_venda)
    setSalvando(true)
    try {
    const db = getDbApi()
    const codigoInterno = form.codigo_automatico ? await obterProximoCodigo(db) : form.codigo_interno.trim()
    const params = [
      form.nome.trim(),
      form.codigo_barras.trim() || null,
      codigoInterno || null,
      form.codigo_extra.trim() || null,
      form.categoria_id ? Number(form.categoria_id) : null,
      form.subcategoria_id && form.categoria_id ? Number(form.subcategoria_id) : null,
      form.marca_id ? Number(form.marca_id) : null,
      form.fornecedor_id ? Number(form.fornecedor_id) : null,
      parseMoeda(form.preco_custo),
      precoVenda,
      form.preco_promo !== '' ? parseMoeda(form.preco_promo) : null,
      form.promocional,
      form.preco_automatico,
      form.preco_alteravel,
      form.controla_estoque,
      form.controla_estoque ? parseMoeda(form.estoque) : 0,
      form.controla_estoque ? parseMoeda(form.estoque_minimo) : 0,
      form.controla_estoque && form.estoque_maximo !== '' ? parseMoeda(form.estoque_maximo) : null,
      form.unidade || 'un',
      form.permite_fracionado,
      form.localizacao.trim() || null,
      form.peso_liq !== '' ? parseMoeda(form.peso_liq) : null,
      form.peso_bruto !== '' ? parseMoeda(form.peso_bruto) : null,
      form.preco_atacado1 !== '' ? parseMoeda(form.preco_atacado1) : null,
      form.preco_atacado2 !== '' ? parseMoeda(form.preco_atacado2) : null,
      form.qtd_min_atacado1 !== '' ? Number(form.qtd_min_atacado1) : 0,
      form.qtd_min_atacado2 !== '' ? Number(form.qtd_min_atacado2) : 0,
      form.observacoes.trim() || null,
      form.ativo,
      form.catalogo_publicado,
      form.catalogo_ordem !== '' ? Number(form.catalogo_ordem) || 0 : 0
    ]
    let id: number
    if (editandoId) {
      await db.run(
        `UPDATE produtos SET
           nome=?, codigo_barras=?, codigo_interno=?, codigo_extra=?, categoria_id=?, subcategoria_id=?,
           marca_id=?, fornecedor_id=?, preco_custo=?, preco_venda=?, preco_promo=?, promocional=?,
           preco_automatico=?, preco_alteravel=?, controla_estoque=?, estoque=?, estoque_minimo=?,
           estoque_maximo=?, unidade=?, permite_fracionado=?, localizacao=?, peso_liq=?, peso_bruto=?,
           preco_atacado1=?, preco_atacado2=?, qtd_min_atacado1=?, qtd_min_atacado2=?,
           observacoes=?, ativo=?, catalogo_publicado=?, catalogo_ordem=?
         WHERE id=?`,
        [...params, editandoId]
      )
      id = editandoId
    } else {
      const res = await db.run(
        `INSERT INTO produtos (nome, codigo_barras, codigo_interno, codigo_extra, categoria_id, subcategoria_id,
           marca_id, fornecedor_id, preco_custo, preco_venda, preco_promo, promocional,
           preco_automatico, preco_alteravel, controla_estoque, estoque, estoque_minimo,
           estoque_maximo, unidade, permite_fracionado, localizacao, peso_liq, peso_bruto,
           preco_atacado1, preco_atacado2, qtd_min_atacado1, qtd_min_atacado2,
           observacoes, ativo, catalogo_publicado, catalogo_ordem)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      )
      id = Number(res.lastInsertRowid)
    }
    if (imagemPreview && !(await getImagemApi().get(id))) {
      setMensagem('Produto salvo. A imagem será definida pela lista de produtos.')
    }
    setFormAberto(false)
    setErros({})
    setMensagem(editandoId ? 'Produto atualizado!' : `Produto criado! (código ${codigoInterno})`)
    mostrarToast('ok', editandoId ? 'Produto atualizado com sucesso!' : `Produto criado com sucesso! (código ${codigoInterno})`)
    formOriginalRef.current = { ...form }
    atualizarProximoCodigo()
    carregar()
    } catch (e) {
      setMensagem(`Erro ao salvar produto: ${(e as Error).message}`)
      mostrarToast('erro', `Não foi possível salvar: ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  const clonarProduto = async () => {
    if (!editandoId) return
    const db = getDbApi()
    const p = (await db.get(`SELECT * FROM produtos WHERE id = ?`, [editandoId])) as Produto & { nome: string } | undefined
    if (!p) return
    const novo = `CÓPIA - ${p.nome}`
    const cod = `${p.codigo_interno ?? ''}-C`
    await db.run(
      `INSERT INTO produtos (nome, codigo_barras, codigo_interno, categoria_id, subcategoria_id, marca_id, fornecedor_id,
         preco_custo, preco_venda, preco_promo, preco_atacado1, preco_atacado2, qtd_min_atacado1, qtd_min_atacado2,
         estoque, estoque_minimo, unidade, ativo, promocional, controla_estoque, permite_fracionado, localizacao,
         preco_automatico, preco_alteravel, ncm, cest, publicado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, 1, ?, ?, ?, ?, ?, ?, 1)`,
      [novo, p.codigo_barras ?? null, cod, p.categoria_id, p.subcategoria_id, p.marca_id, p.fornecedor_id,
       p.preco_custo, p.preco_venda, p.preco_promo, p.preco_atacado1, p.preco_atacado2, p.qtd_min_atacado1, p.qtd_min_atacado2,
       p.estoque_minimo, p.unidade, p.promocional, p.permite_fracionado, p.localizacao, p.preco_automatico, p.preco_alteravel, p.ncm, p.cest]
    )
    setMensagem(`Produto clonado como "${novo}".`)
    setFormAberto(false)
    carregar()
  }

  const excluirProduto = async () => {
    if (!editandoId) return
    if (!confirm(`Excluir o produto "${form.nome}"? Esta ação não pode ser desfeita.`)) return
    await getDbApi().run(`DELETE FROM produtos WHERE id = ?`, [editandoId])
    setMensagem('Produto excluído.')
    setFormAberto(false)
    mostrarToast('ok', 'Produto excluído.')
    carregar()
  }

  const escolherImagemForm = async () => {
    if (!editandoId) {
      setMensagem('Salve o produto primeiro e depois adicione a imagem na lista.')
      return
    }
    const img = await getImagemApi().definir(editandoId)
    if (img) setImagemPreview(img)
  }

  const cancelar = () => {
    const alterado = (Object.keys(form) as (keyof typeof form)[]).some(
      (k) => JSON.stringify(form[k]) !== JSON.stringify(formOriginalRef.current[k])
    )
    if (alterado) {
      if (!confirm('Cancelar e descartar as alterações?')) return
    }
    setFormAberto(false)
    setImagemPreview(null)
    setErros({})
    setToast(null)
  }

  const toggleObservacao = () => {
    obsAberto.current = !obsAberto.current
    setMensagem(obsAberto.current ? 'Observação aberta (F4 para fechar).' : '')
  }

  const salvarF2 = () => {
    if (formAberto) salvar()
  }

  const atalhosKey = (e: KeyboardEvent) => {
    if (!formAberto) return
    if (e.key === 'F2') {
      e.preventDefault()
      salvarF2()
    }
    if (e.key === 'F3') {
      e.preventDefault()
      if (editandoId) clonarProduto()
    }
    if (e.key === 'F4') {
      e.preventDefault()
      toggleObservacao()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setFormAberto(false)
    }
  }

  useEffect(() => {
    window.addEventListener('keydown', atalhosKey)
    return () => window.removeEventListener('keydown', atalhosKey)
  }, [formAberto, form, editandoId])

  const subcategoriasDaCategoria = subcategorias.filter(
    (s) => form.categoria_id && s.categoria_id === Number(form.categoria_id)
  )

  const limites = LIMITES_ESTOQUE

  return (
    <div className="page">
      <div className="page-header">
        <h2>Produtos</h2>
        <div className="page-acoes">
          {modo === 'lista' && (
            <button className="btn-primario" onClick={abrirNovo}>+ Novo Produto</button>
          )}
        </div>
      </div>

      <div className="abas-vendas">
        <button className={`aba ${modo === 'lista' ? 'ativa' : ''}`} onClick={() => setModo('lista')}>Produtos</button>
        <button className={`aba ${modo === 'fornecedores' ? 'ativa' : ''}`} onClick={() => setModo('fornecedores')}>Fornecedores</button>
        <button className={`aba ${modo === 'etiquetas' ? 'ativa' : ''}`} onClick={() => setModo('etiquetas')}>Etiquetas</button>
        <button className={`aba ${modo === 'tributacao' ? 'ativa' : ''}`} onClick={() => setModo('tributacao')}>Tributação</button>
        <button className={`aba ${modo === 'importar' ? 'ativa' : ''}`} onClick={() => setModo('importar')}>Importar</button>
      </div>

      {modo === 'lista' && (
        <div className="filtros-vendas produtos-filtros">
          <button
            className={`btn-secundario btn-categorias-lateral ${categoriasLateralAberta ? 'ativo' : ''}`}
            onClick={() => setCategoriasLateralAberta((v) => !v)}
            title="Mostrar/esconder categorias"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />
            </svg>
            Categorias
          </button>

          <button
            className="btn-secundario"
            onClick={() => { setGerenciarCats(true); setCategoriasLateralAberta(true) }}
            title="Criar, editar ou apagar categorias"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Gerenciar Categorias
          </button>

          <div className="busca-pdv-caixa produtos-busca-pdv">
            <input
              className="busca-pdv"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={buscaAvancada ? 'Busca avançada: nome, marca, código, categoria, obs...' : 'Filtrar por nome, código, marca...'}
            />
            <button
              className={`pdv-busca-avancada ${buscaAvancada ? 'ativo' : ''}`}
              onClick={() => { setBuscaAvancada((v) => !v); setBusca('') }}
              title={buscaAvancada ? 'Busca avançada ativa — clique para desativar' : 'Ativar busca avançada (busca em mais campos)'}
            >
              Avançada {buscaAvancada ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="dropdown-filtro produtos-filtro-menu">
            <button
              className={`btn-secundario btn-funil ${filtrosAbertos ? 'ativo' : ''}`}
              onClick={() => setFiltrosAbertos((v) => !v)}
              title="Filtros"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filtros
            </button>
            {filtrosAbertos && (
              <div className="dropdown-colunas-menu produtos-filtros-drop">
                <div className="dropdown-colunas-titulo">Filtros de produtos</div>
                <label className="dropdown-colunas-item">
                  Status
                  <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as 'todos' | 'ativos' | 'inativos')}>
                    <option value="ativos">Produtos ativos</option>
                    <option value="inativos">Produtos inativos</option>
                    <option value="todos">Todos os produtos</option>
                  </select>
                </label>
                <label className="dropdown-colunas-item">
                  Condição
                  <select value={filtroEspecial} onChange={(e) => setFiltroEspecial(e.target.value as 'nenhum' | 'abaixo_min' | 'pedidos_abertos')}>
                    <option value="nenhum">Sem filtro especial</option>
                    <option value="abaixo_min">Estoque abaixo do mínimo</option>
                    <option value="pedidos_abertos">Com pedidos em aberto</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {modo === 'importar' && (
        <ImportarProdutos onConcluido={() => { carregar(); setModo('lista') }} />
      )}

      {modo === 'fornecedores' && (
        <Fornecedores onConcluido={() => carregar()} />
      )}

      {modo === 'etiquetas' && (
        <div className="page">
          <h3>Categorias / Etiquetas</h3>
          <p className="sem-resultado">Impressão de etiquetas por categoria — em breve.</p>
        </div>
      )}

      {modo === 'tributacao' && (
        <div className="page">
          <h3>Tributação dos produtos</h3>
          <p className="sem-resultado">Configuração tributária dos produtos — em breve.</p>
        </div>
      )}

      {modo === 'lista' && (
        <div className="produtos-lista-area">
      {formAberto && (
        <div className="modal-overlay" onClick={cancelar}>
          <div className="modal modal-produto" onClick={(e) => e.stopPropagation()}>
            <div className="modal-produto-topo">
              <div className="modal-produto-cab">
                <div className="modal-produto-titulos">
                  <h3 className="modal-produto-titulo">{editandoId ? 'Editar Produto' : 'Novo Produto'}</h3>
                  <p className="modal-produto-sub">
                    {editandoId
                      ? (form.nome ? `Editando "${form.nome}" — preencha os campos e salve.` : 'Editando produto — preencha os campos e salve.')
                      : 'Cadastre um novo produto no sistema.'}
                  </p>
                </div>
                <span className={`badge-status ${form.ativo ? 'badge-ativo' : 'badge-inativo'}`}>
                  {form.ativo ? 'Ativo' : 'Inativo'}
                </span>
                <button className="modal-fechar" onClick={cancelar} title="Fechar">✕</button>
              </div>
              <div className="abas-produto">
                {(['cadastro', 'transacoes', 'combo', 'tributacao', 'fornecedores', 'opcoes', 'validade'] as AbaProduto[]).map((a) => (
                  <button
                    key={a}
                    className={`aba-produto ${aba === a ? 'ativa' : ''}`}
                    onClick={() => setAba(a)}
                  >
                    {a === 'cadastro' ? 'Cadastro' : a === 'transacoes' ? 'Transações' : a === 'combo' ? 'Kit / Combo' : a === 'tributacao' ? 'Tributação' : a === 'fornecedores' ? 'Fornecedores' : a === 'opcoes' ? 'Opções' : 'Controle de validade'}
                  </button>
                ))}
              </div>
            </div>

            {toast && (
              <div className={`prod-toast prod-toast-${toast.tipo}`} role="status">
                <span className="prod-toast-icone">
                  {toast.tipo === 'ok' ? '✓' : toast.tipo === 'erro' ? '✕' : 'ℹ'}
                </span>
                <span className="prod-toast-texto">{toast.texto}</span>
              </div>
            )}

            {aba === 'cadastro' && (
              <div className="modal-produto-corpo">
                <div className="prod-resumo-barra">
                  <div className="prod-resumo-item">
                    <span>Preço de venda</span>
                    <strong className="resumo-venda">R$ {parseMoeda(form.preco_venda).toFixed(2).replace('.', ',')}</strong>
                  </div>
                  {!!form.promocional && (
                    <div className="prod-resumo-item">
                      <span>Promocional</span>
                      <strong className="resumo-promo">R$ {parseMoeda(form.preco_promo).toFixed(2).replace('.', ',')}</strong>
                    </div>
                  )}
                  <div className="prod-resumo-item">
                    <span>Estoque</span>
                    <strong className={`resumo-estoque ${!!form.controla_estoque && parseMoeda(form.estoque) <= parseMoeda(form.estoque_minimo) ? 'est-baixo' : ''}`}>
                      {form.controla_estoque ? `${parseMoeda(form.estoque)} ${form.unidade}` : 'Não controla'}
                    </strong>
                  </div>
                  <div className="prod-resumo-item prod-resumo-pub">
                    <span>Catálogo</span>
                    <strong className={form.catalogo_publicado ? 'resumo-pub-ok' : 'resumo-pub-off'}>
                      {form.catalogo_publicado ? 'Publicado' : 'Não publicado'}
                    </strong>
                  </div>
                </div>
                <div className="prod-detalhe-col">
                  <section className="prod-secao">
                    <header className="prod-secao-titulo">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                      Dados Gerais
                    </header>
                    <div className="prod-secao-corpo">
                      <label className={`prod-campo prod-campo-full ${erros.nome ? 'tem-erro' : ''}`}>Nome do produto *
                        <input
                          ref={nomeRef}
                          value={form.nome}
                          onChange={(e) => { setForm({ ...form, nome: e.target.value }); if (erros.nome) setErros((p) => ({ ...p, nome: '' })) }}
                          placeholder="Ex: Isqueiro, Essência 10ml, Cigarro..."
                        />
                        {erros.nome && <span className="prod-erro-texto">{erros.nome}</span>}
                      </label>
                      <div className="prod-grid-3">
                        <label className="prod-campo">Código interno
                          <input
                            value={form.codigo_interno}
                            disabled={!!form.codigo_automatico}
                            onChange={(e) => setForm({ ...form, codigo_interno: e.target.value })}
                            placeholder={form.codigo_automatico ? (proximoCodigo ? `Próximo: ${proximoCodigo}` : 'Automático') : ''}
                          />
                        </label>
                        <label className="prod-campo">Código extra
                          <input
                            value={form.codigo_extra}
                            onChange={(e) => setForm({ ...form, codigo_extra: e.target.value })}
                            placeholder="Código auxiliar"
                          />
                        </label>
                        <label className="prod-campo">EAN / GTIN
                          <input
                            value={form.codigo_barras}
                            onChange={(e) => setForm({ ...form, codigo_barras: e.target.value })}
                            placeholder="Código de barras"
                          />
                        </label>
                      </div>
                      <label className="check-inline prod-check prod-check-badge">
                        <input
                          type="checkbox"
                          checked={!!form.codigo_automatico}
                          onChange={(e) => { setForm({ ...form, codigo_automatico: e.target.checked ? 1 : 0 }); if (e.target.checked) atualizarProximoCodigo() }}
                        />
                        Gerar código automaticamente
                      </label>
                      {form.codigo_automatico && proximoCodigo && (
                        <small className="prod-codigo-prev">Será criado com o código <b>{proximoCodigo}</b></small>
                      )}
                    </div>
                  </section>

                  <section className="prod-secao">
                    <header className="prod-secao-titulo">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54z" /></svg>
                      Classificação
                    </header>
                    <div className="prod-secao-corpo">
                      <div className="prod-grid-3">
                        <label className="prod-campo">Categoria
                          <select
                            value={form.categoria_id}
                            onChange={(e) => setForm({ ...form, categoria_id: e.target.value, subcategoria_id: '' })}
                          >
                            <option value="">Selecione</option>
                            {categorias.map((c) => (
                              <option key={c.id} value={c.id}>{c.nome}</option>
                            ))}
                          </select>
                        </label>
                        <label className="prod-campo">Subcategoria
                          <select
                            value={form.subcategoria_id}
                            disabled={!form.categoria_id}
                            onChange={(e) => setForm({ ...form, subcategoria_id: e.target.value })}
                          >
                            <option value="">{form.categoria_id ? 'Selecione' : 'Escolha a categoria'}</option>
                            {subcategoriasDaCategoria.map((s) => (
                              <option key={s.id} value={s.id}>{s.nome}</option>
                            ))}
                          </select>
                        </label>
                        <label className="prod-campo">Marca
                          <select
                            value={form.marca_id}
                            onChange={(e) => setForm({ ...form, marca_id: e.target.value })}
                          >
                            <option value="">Selecione</option>
                            {marcas.map((m) => (
                              <option key={m.id} value={m.id}>{m.nome}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="prod-grid-3">
                        <label className="prod-campo">Peso Líquido (g)
                          <input
                            type="number"
                            step="0.001"
                            value={form.peso_liq}
                            onChange={(e) => setForm({ ...form, peso_liq: e.target.value })}
                          />
                        </label>
                        <label className="prod-campo">Peso Bruto (g)
                          <input
                            type="number"
                            step="0.001"
                            value={form.peso_bruto}
                            onChange={(e) => setForm({ ...form, peso_bruto: e.target.value })}
                          />
                        </label>
                        <label className="prod-campo">Localização
                          <input
                            value={form.localizacao}
                            onChange={(e) => setForm({ ...form, localizacao: e.target.value })}
                            placeholder="Ex: prateleira A2"
                          />
                        </label>
                      </div>
                    </div>
                  </section>

                  <section className="prod-secao">
                    <header className="prod-secao-titulo">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                      Preços
                    </header>
                    <div className="prod-secao-corpo">
                      <div className="prod-grid-3">
                        <label className={`prod-campo ${erros.preco_venda ? 'tem-erro' : ''}`}>Preço de venda (R$) *
                          <CampoDinheiro value={form.preco_venda} onChange={(v) => { setForm({ ...form, preco_venda: v }); if (erros.preco_venda) setErros((p) => ({ ...p, preco_venda: '' })) }} />
                          {erros.preco_venda && <span className="prod-erro-texto">{erros.preco_venda}</span>}
                        </label>
                        <label className="prod-campo">Preço de custo (R$)
                          <CampoDinheiro value={form.preco_custo} onChange={(v) => setForm({ ...form, preco_custo: v })} />
                        </label>
                        <label className="prod-campo">Preço promocional (R$)
                          <CampoDinheiro value={form.preco_promo} onChange={(v) => { setForm({ ...form, preco_promo: v }); if (erros.preco_promo) setErros((p) => ({ ...p, preco_promo: '' })) }} />
                          {erros.preco_promo && <span className="prod-erro-texto">{erros.preco_promo}</span>}
                        </label>
                      </div>
                      <div className="prod-grid-4">
                        <label className="prod-campo">Atacado 1 (R$)
                          <CampoDinheiro value={form.preco_atacado1} onChange={(v) => setForm({ ...form, preco_atacado1: v })} />
                        </label>
                        <label className="prod-campo">Qtd mín. Atacado 1
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.qtd_min_atacado1}
                            onChange={(e) => setForm({ ...form, qtd_min_atacado1: e.target.value.replace(',', '.') })}
                            placeholder="Ex: 10"
                          />
                        </label>
                        <label className="prod-campo">Atacado 2 (R$)
                          <CampoDinheiro value={form.preco_atacado2} onChange={(v) => setForm({ ...form, preco_atacado2: v })} />
                        </label>
                        <label className="prod-campo">Qtd mín. Atacado 2
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.qtd_min_atacado2}
                            onChange={(e) => setForm({ ...form, qtd_min_atacado2: e.target.value.replace(',', '.') })}
                            placeholder="Ex: 50"
                          />
                        </label>
                      </div>
                      <div className="prod-check-row">
                        <label className="check-inline prod-check-badge">
                          <input
                            type="checkbox"
                            checked={!!form.preco_automatico}
                            onChange={(e) => setForm({ ...form, preco_automatico: e.target.checked ? 1 : 0 })}
                          />
                          Preço automático
                        </label>
                        <label className="check-inline prod-check-badge">
                          <input
                            type="checkbox"
                            checked={!!form.preco_alteravel}
                            onChange={(e) => setForm({ ...form, preco_alteravel: e.target.checked ? 1 : 0 })}
                          />
                          Preço alterável na venda
                        </label>
                      </div>
                    </div>
                  </section>

                  <section className={`prod-secao prod-secao-promo ${form.promocional ? 'ativa' : ''}`}>
                    <header className="prod-secao-titulo">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
                      Promoção
                    </header>
                    <div className="prod-secao-corpo">
                      <div className="linha-controle-estoque">
                        <span>Produto promocional</span>
                        <button
                          className={`switch ${form.promocional ? 'ativo' : ''}`}
                          onClick={() => setForm({ ...form, promocional: form.promocional ? 0 : 1 })}
                          role="switch"
                          aria-checked={!!form.promocional}
                        >
                          <span className="switch-bola" />
                        </button>
                      </div>
                      {!!form.promocional && (
                        <div className="prod-promo-info">
                          <p>
                            {parseMoeda(form.preco_promo) > 0 && parseMoeda(form.preco_venda) > 0
                              ? `Economia de ${((1 - parseMoeda(form.preco_promo) / parseMoeda(form.preco_venda)) * 100).toFixed(0)}% sobre o preço de venda.`
                              : 'Defina o preço promocional acima para ativar o desconto.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="prod-secao">
                    <header className="prod-secao-titulo">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96 12 12.01l8.73-5.05" /><path d="M12 22.08V12" /></svg>
                      Estoque
                    </header>
                    <div className="prod-secao-corpo">
                      <div className="linha-controle-estoque">
                        <span>Controlar estoque</span>
                        <button
                          className={`switch ${form.controla_estoque ? 'ativo' : ''}`}
                          onClick={() => setForm({ ...form, controla_estoque: form.controla_estoque ? 0 : 1 })}
                          role="switch"
                          aria-checked={!!form.controla_estoque}
                        >
                          <span className="switch-bola" />
                        </button>
                      </div>
                      {!!form.controla_estoque && (
                        <>
                          <div className="prod-grid-4">
                            <label className={`prod-campo ${erros.estoque ? 'tem-erro' : ''}`}>Estoque atual
                              <input
                                type="number"
                                step="0.01"
                                value={form.estoque}
                                onChange={(e) => { setForm({ ...form, estoque: e.target.value }); if (erros.estoque) setErros((p) => ({ ...p, estoque: '' })) }}
                              />
                              {erros.estoque && <span className="prod-erro-texto">{erros.estoque}</span>}
                            </label>
                            <label className="prod-campo">Estoque mínimo
                              <input
                                type="number"
                                step="0.01"
                                value={form.estoque_minimo}
                                onChange={(e) => setForm({ ...form, estoque_minimo: e.target.value })}
                              />
                            </label>
                            <label className="prod-campo">Estoque máximo
                              <input
                                type="number"
                                step="0.01"
                                value={form.estoque_maximo}
                                onChange={(e) => setForm({ ...form, estoque_maximo: e.target.value })}
                              />
                            </label>
                            <label className="prod-campo">Unidade
                              <select
                                value={form.unidade}
                                onChange={(e) => setForm({ ...form, unidade: e.target.value })}
                              >
                                <option value="un">un</option>
                                <option value="pct">pct</option>
                                <option value="g">g</option>
                                <option value="kg">kg</option>
                                <option value="ml">ml</option>
                                <option value="l">L</option>
                              </select>
                            </label>
                          </div>
                          <label className="check-inline prod-check prod-check-badge fracionado">
                            <input
                              type="checkbox"
                              checked={!!form.permite_fracionado}
                              onChange={(e) => setForm({ ...form, permite_fracionado: e.target.checked ? 1 : 0 })}
                            />
                            Permite fracionamento (Ex: venda por peso/kg)
                          </label>
                        </>
                      )}
                    </div>
                  </section>
                </div>

                <div className="prod-foto-col">
                  <section className="prod-secao prod-foto-card">
                    <header className="prod-secao-titulo">Foto do produto</header>
                    <div
                      className={`produto-imagem-box ${imagemPreview ? 'tem-imagem' : ''}`}
                      onClick={escolherImagemForm}
                      title={imagemPreview ? 'Clique para trocar a imagem' : 'Clique para adicionar imagem'}
                    >
                      {imagemPreview ? (
                        <img src={dataUrlImagem(imagemPreview)} alt="Produto" />
                      ) : (
                        <div className="produto-imagem-vazio">
                          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 6h5l2-2h2l2 2h5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
                            <path d="M12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                          </svg>
                          <span>Adicionar imagem</span>
                        </div>
                      )}
                    </div>
                    <div className="prod-foto-acoes">
                      <button className="btn-secundario btn-adicionar-foto" onClick={escolherImagemForm}>
                        {imagemPreview ? 'Trocar foto' : '+ Adicionar foto'}
                      </button>
                      {imagemPreview && (
                        <button className="btn-mini btn-remover-foto" onClick={async () => { await getImagemApi().remover(editandoId!); setImagemPreview(null); }}>
                          Remover
                        </button>
                      )}
                    </div>
                  </section>

                  <section className={`prod-secao prod-foto-card prod-pub-card ${form.catalogo_publicado ? 'ativa' : ''}`}>
                    <header className="prod-secao-titulo">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                      Publicação no catálogo
                    </header>
                    <div className="prod-secao-corpo">
                      <div className="linha-controle-estoque">
                        <span>Publicar no catálogo online</span>
                        <button
                          className={`switch ${form.catalogo_publicado ? 'ativo' : ''}`}
                          onClick={() => setForm({ ...form, catalogo_publicado: form.catalogo_publicado ? 0 : 1 })}
                          role="switch"
                          aria-checked={!!form.catalogo_publicado}
                        >
                          <span className="switch-bola" />
                        </button>
                      </div>
                      <span className={`badge-status ${form.catalogo_publicado ? 'badge-ativo' : 'badge-inativo'}`}>
                        {form.catalogo_publicado ? 'Publicado' : 'Não publicado'}
                      </span>
                      <label className="prod-campo">Ordem de exibição no catálogo
                        <input type="number" value={form.catalogo_ordem} onChange={(e) => setForm({ ...form, catalogo_ordem: e.target.value })} placeholder="0" />
                      </label>
                      <label className="check-inline prod-check prod-check-badge">
                        <input
                          type="checkbox"
                          checked={!!form.ativo}
                          onChange={(e) => setForm({ ...form, ativo: e.target.checked ? 1 : 0 })}
                        />
                        Produto ativo
                      </label>
                      <p className="nota-config prod-pub-nota">
                        Produtos marcados como "Publicar" são enviados ao site público. Os demais ficam só no sistema.
                      </p>
                    </div>
                  </section>

                  <section className="prod-secao prod-foto-card">
                    <header className="prod-secao-titulo">
                      Observações
                      <button className="link-observacao" onClick={toggleObservacao}>
                        {obsAberto.current ? 'Ocultar' : 'Editar'} <kbd>F4</kbd>
                      </button>
                    </header>
                    {!obsAberto.current && !form.observacoes && (
                      <p className="prod-obs-vazio">Nenhuma observação registrada.</p>
                    )}
                    {obsAberto.current && (
                      <textarea
                        className="observacao-textarea"
                        rows={4}
                        value={form.observacoes}
                        onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                        placeholder="Observações sobre o produto..."
                      />
                    )}
                  </section>

                  <button className="btn-secundario prod-opcoes-btn" onClick={() => setAba('opcoes')}>
                    Configurações de venda e catálogo <span>›</span>
                  </button>
                </div>
              </div>
            )}

            {aba === 'combo' && <EmBreveAba titulo="Kit / Combo" />}
            {aba === 'transacoes' && <TransacoesProduto produtoId={editandoId} />}
            {aba === 'tributacao' && <EmBreveAba titulo="Tributação" />}
            {aba === 'fornecedores' && (
              <div className="aba-conteudo">
                <h4>Fornecedores</h4>
                <p className="sem-resultado">Associação de fornecedores ao produto (em breve).</p>
              </div>
            )}
            {aba === 'opcoes' && (
              <div className="aba-conteudo">
                <h4>Opções</h4>
                <div className="form-grid">
                  <label className="check-inline">
                    <input type="checkbox" checked={!!form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked ? 1 : 0 })} />
                    Produto ativo
                  </label>
                  <label className="check-inline">
                    <input type="checkbox" checked={!!form.catalogo_publicado} onChange={(e) => setForm({ ...form, catalogo_publicado: e.target.checked ? 1 : 0 })} />
                    Publicar no catálogo online
                  </label>
                  <label>Ordem de exibição no catálogo
                    <input type="number" value={form.catalogo_ordem} onChange={(e) => setForm({ ...form, catalogo_ordem: e.target.value })} placeholder="0" />
                  </label>
                </div>
                <p className="nota-config">Produtos com "Publicar no catálogo" marcado são enviados ao site público. Os demais ficam só no sistema.</p>
              </div>
            )}
            {aba === 'validade' && <EmBreveAba titulo="Controle de validade" />}

            <div className="modal-produto-rodape">
              <button className="btn-primario" onClick={salvar} disabled={salvando}>
                {salvando ? 'SALVANDO...' : 'SALVAR'} <kbd>F2</kbd>
              </button>
              <button className="btn-secundario" onClick={cancelar} disabled={salvando}>CANCELAR</button>
              <div className="modal-acoes-direita">
                {editandoId && (
                  <>
                    <button className="forn-link-inativar" onClick={() => setForm({ ...form, ativo: form.ativo ? 0 : 1 })}>
                      {form.ativo ? 'Inativar Produto' : 'Ativar Produto'}
                    </button>
                    <button className="forn-link-inativar" onClick={clonarProduto}>Clonar <kbd>F3</kbd></button>
                    <button className="forn-link-excluir" onClick={excluirProduto}>🗑 Excluir Produto</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <aside className={`produtos-lateral-categorias ${categoriasLateralAberta ? 'aberta' : ''}`}>
        <div className="produtos-lateral-titulo">
          <strong>Categorias</strong>
          {categoriaSel != null && (
            <button className="btn-mini" onClick={() => { setCategoriaSel(null); setSubcategoriaSel(null) }}>Limpar</button>
          )}
        </div>
        <button
          className={`produtos-cat-item ${categoriaSel == null ? 'ativo' : ''}`}
          onClick={() => { setCategoriaSel(null); setSubcategoriaSel(null) }}
        >
          Todas as categorias
        </button>
        {categorias.map((cat) => {
          const subs = subcategorias.filter((s) => s.categoria_id === cat.id)
          const expandida = !!categoriasExpandidas[cat.id] || categoriaSel === cat.id
          return (
            <div key={cat.id} className="produtos-cat-grupo">
              <div className={`produtos-cat-item ${categoriaSel === cat.id ? 'ativo' : ''}`}>
                {subs.length > 0 && (
                  <button
                    className="produtos-cat-seta"
                    onClick={() => setCategoriasExpandidas((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                  >
                    {expandida ? '−' : '+'}
                  </button>
                )}
                <button
                  className="produtos-cat-nome"
                  onClick={() => { setCategoriaSel(cat.id); setSubcategoriaSel(null) }}
                >
                  {cat.nome}
                </button>
              </div>
              {expandida && subs.length > 0 && (
                <div className="produtos-subcat-lista">
                  {subs.map((s) => (
                    <button
                      key={s.id}
                      className={`produtos-subcat-item ${subcategoriaSel === s.id ? 'ativo' : ''}`}
                      onClick={() => { setCategoriaSel(cat.id); setSubcategoriaSel(s.id) }}
                    >
                      {s.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {categorias.length === 0 && <p className="sem-resultado">Nenhuma categoria.</p>}
      </aside>

      <div className="produtos-lista-conteudo">
      <div className="produtos-lista-toolbar">
        <button className="btn-secundario" onClick={() => setColunasAbertas((v) => !v)}>
          Colunas ({ordemColunas.length})
        </button>
        <div className="dropdown-filtro produtos-layout-menu">
          <button className="btn-secundario" onClick={() => setMenuLayout((v) => !v)} title="Layout e configurações">⋯</button>
          {menuLayout && (
            <div className="dropdown-colunas-menu">
              <div className="dropdown-colunas-titulo">Layout e configurações</div>
              <button className="dropdown-colunas-item" onClick={() => {
                try {
                  localStorage.setItem('produtos_colunas', JSON.stringify(ordemColunas))
                  localStorage.setItem('produtos_larguras', JSON.stringify(largurasColunas))
                } catch { /* ignore */ }
                setMenuLayout(false)
                setMensagem('Layout das colunas salvo para sempre.')
              }}>
                💾 Salvar layout das colunas
              </button>
              <button className="dropdown-colunas-item" onClick={() => { setMenuLayout(false); setModalConfig(true) }}>
                ⚙ Código do produto
              </button>
            </div>
          )}
        </div>
        {colunasAbertas && (
          <div className="colunas-seletor">
            <div className="colunas-seletor-toolbar">
              <span className="nota-config">Arraste os cabeçalhos para reordenar • Clique para ordenar</span>
              <button className="btn-mini" onClick={restaurarColunas}>↺ Restaurar padrão</button>
            </div>
            <div className="colunas-seletor-lista">
              {TODAS_COLUNAS.map((c) => (
                <label key={c.chave} className="check-inline">
                  <input
                    type="checkbox"
                    checked={ordemColunas.includes(c.chave)}
                    disabled={c.chave === 'acoes'}
                    onChange={() => alternarColuna(c.chave)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        )}
        <span className="nota-config">Arraste os cabeçalhos para reordenar • Clique para ordenar</span>
      </div>

      <div className="tabela-wrap" ref={wrapProdRef} onScroll={sincronizarScrollbarProd}>
      <table className="tabela tabela-produtos">
        <thead>
          <tr>
            {ordemColunas.map((col) => (
              <th
                key={col}
                className="col-drag"
                draggable
                style={{ width: larguraCol(col) }}
                onDragStart={() => setColunaArrastando(col)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (colunaArrastando) moverColuna(colunaArrastando, col); setColunaArrastando(null) }}
                onClick={() => ordenar(col)}
                title="Arraste para reordenar • Clique para ordenar"
              >
                {legendaColuna(col)}
                {ordem?.chave === col && (ordem.dir === 'asc' ? ' ▲' : ' ▼')}
                <span className="col-resizer" onMouseDown={(e) => iniciarRedim(col, e)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {produtosOrdenados.map((p) => (
            <tr key={p.id}>
              {ordemColunas.map((col) => (
                <td key={col} className={`col-${col} ${col === 'acoes' ? 'td-acoes' : col === 'imagem' ? 'td-imagem' : ''}`}>
                  {col === 'acoes' ? (
                    <>
                      <button className="btn-editar-produto" onClick={() => abrirEdicao(p)} title="Abrir para editar (inclusive a foto)">
                        ✏️ Editar
                      </button>
                    </>
                  ) : col === 'imagem' ? (
                    imagensMap[p.id] ? (
                      <img className="prod-imagem" loading="lazy" src={dataUrlImagem(imagensMap[p.id])} alt={p.nome} />
                    ) : (
                      <span className="sem-imagem">-</span>
                    )
                  ) : (
                    renderCelula(p, col)
                  )}
                </td>
              ))}
            </tr>
          ))}
          {produtos.length === 0 && (
            <tr><td colSpan={ordemColunas.length} className="sem-resultado">Nenhum produto encontrado.</td></tr>
          )}
        </tbody>
      </table>
      </div>
      <div className="tabela-scrollbar-fixo" ref={scrollbarProdRef} onScroll={onScrollbarProd}>
        <div className="tabela-scrollbar-fixo-fill" />
      </div>
      <div className="produtos-rodape-lista">
        <div className="produtos-qtd-select">
          <span className="nota-config">Exibir:</span>
          <select value={limite} onChange={(e) => { setLimite(Number(e.target.value)); setPaginaAtual(1) }}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="500">500</option>
            <option value="100000">Todos</option>
          </select>
          <span className="nota-config">({produtos.length} encontrados)</span>
        </div>
        {(() => {
          const totalPaginas = Math.max(1, Math.ceil(produtos.length / limite))
          const paginas: (number | '...')[] = []
          const atual = Math.min(paginaAtual, totalPaginas)
          if (totalPaginas <= 7) {
            for (let i = 1; i <= totalPaginas; i++) paginas.push(i)
          } else {
            paginas.push(1)
            if (atual > 3) paginas.push('...')
            for (let i = Math.max(2, atual - 1); i <= Math.min(totalPaginas - 1, atual + 1); i++) paginas.push(i)
            if (atual < totalPaginas - 2) paginas.push('...')
            paginas.push(totalPaginas)
          }
          return (
            <div className="produtos-paginacao">
              <button className="btn-mini" disabled={paginaAtual <= 1} onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}>‹</button>
              {paginas.map((pg, i) =>
                pg === '...' ? <span key={`e${i}`} className="produtos-paginacao-elipse">…</span> : (
                  <button key={pg} className={`btn-mini ${paginaAtual === pg ? 'ativo' : ''}`} onClick={() => setPaginaAtual(pg)}>{pg}</button>
                )
              )}
              <button className="btn-mini" disabled={paginaAtual >= totalPaginas} onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}>›</button>
            </div>
          )
        })()}
      </div>
      </div>
      </div>
      )}

      {modalConfig && (
        <div className="modal-overlay" onClick={() => setModalConfig(false)}>
          <div className="modal modal-tela-cheia" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Configurações de Produtos</h3>
              <button className="btn-icone" onClick={() => setModalConfig(false)}>✕</button>
            </div>
            <div className="modal-corpo">
              <div className="form-grid">
                <label style={{ gridColumn: '1 / -1' }}>Dígitos do código do produto
                  <div className="produto-digitos-codigo">
                    <button className="btn-secundario" onClick={() => setDigitosCodigo((v) => Math.min(30, v + 1))} title="Aumentar">+</button>
                    <strong>{digitosCodigo} dígitos</strong>
                    <button className="btn-secundario" onClick={() => setDigitosCodigo((v) => Math.max(1, v - 1))} title="Diminuir">−</button>
                  </div>
                  <small className="nota-config">Os códigos gerados automaticamente terão entre 1 e 30 dígitos. Padrão: 6.</small>
                </label>
              </div>
            </div>
            <div className="modal-rodape">
              <div className="modal-acoes-direita">
                <button className="btn-secundario" onClick={() => setModalConfig(false)}>Cancelar</button>
                <button className="btn-primario" onClick={() => {
                  try { localStorage.setItem('produtos_digitos_codigo', String(digitosCodigo)) } catch { /* ignore */ }
                  setModalConfig(false)
                  atualizarProximoCodigo()
                  setMensagem(`Configuração salva: código com ${digitosCodigo} dígitos.`)
                }}>Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {gerenciarCats && (
        <div className="modal-overlay" onClick={() => setGerenciarCats(false)}>
          <div className="modal modal-produto" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Gerenciar Categorias</h3>
              <button className="btn-icone" onClick={() => setGerenciarCats(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label style={{ gridColumn: '1 / -1' }}>Nova categoria
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={novaCat} onChange={(e) => setNovaCat(e.target.value)} placeholder="Nome da categoria" />
                  <button className="btn-primario" onClick={adicionarCategoria}>Adicionar</button>
                </div>
              </label>
            </div>
            <div className="config-pdv-lista">
              {categorias.length === 0 && <p className="sem-resultado">Nenhuma categoria cadastrada.</p>}
              {categorias.map((cat) => {
                const subs = subcategorias.filter((s) => s.categoria_id === cat.id)
                return (
                  <div key={cat.id} className="config-pdv-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                      {editandoCat === cat.id ? (
                        <>
                          <input value={edicaoCatNome} onChange={(e) => setEdicaoCatNome(e.target.value)} placeholder="Novo nome" />
                          <button className="btn-primario" onClick={() => salvarCategoria(cat.id)}>Salvar</button>
                          <button className="btn-secundario" onClick={() => setEditandoCat(null)}>Cancelar</button>
                        </>
                      ) : (
                        <>
                          <div className="config-pdv-info"><strong>{cat.nome}</strong></div>
                          <button className="btn-mini" onClick={() => { setEditandoCat(cat.id); setEdicaoCatNome(cat.nome) }}>Editar</button>
                          <button className="btn-mini" onClick={() => excluirCategoria(cat.id, cat.nome)}>Apagar</button>
                        </>
                      )}
                    </div>
                    <div style={{ paddingLeft: 18, marginTop: 6 }}>
                      {subs.map((s) => (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                          {editandoSub === s.id ? (
                            <>
                              <input value={edicaoSubNome} onChange={(e) => setEdicaoSubNome(e.target.value)} placeholder="Novo nome" />
                              <button className="btn-mini" onClick={() => salvarSubcategoria(s.id)}>Salvar</button>
                              <button className="btn-mini" onClick={() => setEditandoSub(null)}>Cancelar</button>
                            </>
                          ) : (
                            <>
                              <div className="config-pdv-info"><span>{s.nome}</span></div>
                              <button className="btn-mini" onClick={() => { setEditandoSub(s.id); setEdicaoSubNome(s.nome) }}>Editar</button>
                              <button className="btn-mini" onClick={() => excluirSubcategoria(s.id, s.nome)}>Apagar</button>
                            </>
                          )}
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                        <input value={novaSub[cat.id] ?? ''} onChange={(e) => setNovaSub((p) => ({ ...p, [cat.id]: e.target.value }))} placeholder="Nova subcategoria" style={{ flex: 1 }} />
                        <button className="btn-mini" onClick={() => adicionarSubcategoria(cat.id)}>+</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="modal-acoes"><button className="btn-primario" onClick={() => setGerenciarCats(false)}>Fechar</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function valorColuna(p: Produto, chave: string): string | number {
  switch (chave) {
    case 'nome': return p.nome
    case 'codigo': return p.codigo_barras ?? p.codigo_interno ?? ''
    case 'codigo_extra': return p.codigo_extra ?? ''
    case 'marca': return p.marca_nome ?? ''
    case 'categoria': return p.categoria_nome ?? ''
    case 'subcategoria': return p.subcategoria_nome ?? ''
    case 'fornecedor': return p.fornecedor_nome ?? ''
    case 'unidade': return p.unidade
    case 'custo': return p.preco_custo
    case 'venda': return p.preco_venda
    case 'promo': return p.preco_promo ?? 0
    case 'atacado1': return p.preco_atacado1 ?? 0
    case 'atacado2': return p.preco_atacado2 ?? 0
    case 'qtdmin1': return p.qtd_min_atacado1 ?? 0
    case 'qtdmin2': return p.qtd_min_atacado2 ?? 0
    case 'estoque': return p.estoque
    case 'estoque_min': return p.estoque_minimo
    case 'estoque_max': return p.estoque_maximo ?? 0
    case 'peso_liq': return p.peso_liq ?? 0
    case 'peso_bruto': return p.peso_bruto ?? 0
    case 'localizacao': return p.localizacao ?? ''
    case 'ncm': return p.ncm ?? ''
    case 'cest': return p.cest ?? ''
    case 'observacoes': return p.observacoes ?? ''
    case 'status': return p.ativo ? 'Ativo' : 'Inativo'
    case 'publicado': return p.publicado ? 'Sim' : 'Não'
    default: return ''
  }
}

function renderCelula(p: Produto, chave: string): ReactNode {
  switch (chave) {
    case 'nome': return <span className="celula-nome">{p.nome}</span>
    case 'custo': return p.preco_custo > 0 ? <span className="celula-moeda">R$ {p.preco_custo.toFixed(2)}</span> : <span className="celula-acinzentado">-</span>
    case 'venda': return <span className="celula-moeda celula-venda">R$ {p.preco_venda.toFixed(2)}</span>
    case 'promo': return p.preco_promo ? <span className="celula-moeda">R$ {p.preco_promo.toFixed(2)}</span> : <span className="celula-acinzentado">-</span>
    case 'atacado1': return p.preco_atacado1 ? <span className="celula-moeda">R$ {p.preco_atacado1.toFixed(2)}</span> : <span className="celula-acinzentado">-</span>
    case 'atacado2': return p.preco_atacado2 ? <span className="celula-moeda">R$ {p.preco_atacado2.toFixed(2)}</span> : <span className="celula-acinzentado">-</span>
    case 'qtdmin1': return p.qtd_min_atacado1 ? String(p.qtd_min_atacado1) : <span className="celula-acinzentado">-</span>
    case 'qtdmin2': return p.qtd_min_atacado2 ? String(p.qtd_min_atacado2) : <span className="celula-acinzentado">-</span>
    case 'estoque':
      return (
        <span className={`celula-estoque ${p.estoque <= p.estoque_minimo ? 'est-baixo' : ''}`}>
          <strong>{p.estoque}</strong> <span className="celula-unid">{p.unidade}</span>
        </span>
      )
    case 'estoque_min': return String(p.estoque_minimo)
    case 'estoque_max': return p.estoque_maximo != null ? String(p.estoque_maximo) : <span className="celula-acinzentado">-</span>
    case 'peso_liq': return p.peso_liq ? `${p.peso_liq} g` : <span className="celula-acinzentado">-</span>
    case 'peso_bruto': return p.peso_bruto ? `${p.peso_bruto} g` : <span className="celula-acinzentado">-</span>
    case 'status': return <span className={`badge-status ${p.ativo ? 'badge-ativo' : 'badge-inativo'}`}>{p.ativo ? 'Ativo' : 'Inativo'}</span>
    case 'publicado': return <span className={`badge-status ${p.publicado ? 'badge-ativo' : 'badge-inativo'}`}>{p.publicado ? 'Sim' : 'Não'}</span>
    default: {
      const v = valorColuna(p, chave)
      return v === '' || v == null ? <span className="celula-acinzentado">-</span> : String(v)
    }
  }
}

function EmBreveAba({ titulo }: { titulo: string }) {  return (
    <div className="aba-conteudo">
      <h4>{titulo}</h4>
      <p className="sem-resultado">Este recurso estará disponível em breve.</p>
    </div>
  )
}

interface Transacao {
  tran_no: number
  criado_em: string
  tipo: string
  categoria: string | null
  quantidade: number
  motivo: string | null
  venda_id: number | null
  venda_numero: string | null
  pedido_id: number | null
  pedido_numero: string | null
  compra_id: number | null
  cliente_fornecedor: string | null
  usuario_nome: string | null
  preco: number | null
  subtotal: number | null
  documento: string | null
  origem: string | null
  destino: string | null
  lote: string | null
  data_validade: string | null
}

function TransacoesProduto({ produtoId }: { produtoId: number | null }) {
  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [carregou, setCarregou] = useState(false)
  const [mostrarCanceladas, setMostrarCanceladas] = useState(false)
  const [detalhe, setDetalhe] = useState<Transacao | null>(null)

  useEffect(() => {
    if (!produtoId) return
    setCarregou(false)
    setDetalhe(null)
    const canceladas = mostrarCanceladas ? '' : `AND m.tipo != 'cancelamento'`
    getDbApi().all(
      `SELECT m.id AS tran_no, m.criado_em, m.tipo, m.categoria, m.quantidade, m.motivo, m.venda_id,
              v.numero AS venda_numero,
              u.nome AS usuario_nome,
              COALESCE(c.nome, v.tipo) AS cliente_fornecedor,
              (SELECT vi.preco_unitario FROM venda_itens vi WHERE vi.venda_id = m.venda_id AND vi.produto_id = m.produto_id LIMIT 1) AS preco,
              (SELECT vi.subtotal FROM venda_itens vi WHERE vi.venda_id = m.venda_id AND vi.produto_id = m.produto_id LIMIT 1) AS subtotal,
              m.documento, m.origem, m.destino,
              p.lote, p.data_validade
       FROM movimentacoes m
       LEFT JOIN produtos p ON p.id = m.produto_id
       LEFT JOIN vendas v ON v.id = m.venda_id
       LEFT JOIN clientes c ON c.id = v.cliente_id
       LEFT JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.produto_id = ? ${canceladas}
       ORDER BY m.criado_em DESC
       LIMIT 500`,
      [produtoId]
    ).then((rows) => {
      setTransacoes(rows as unknown as Transacao[])
      setCarregou(true)
    }).catch(() => setCarregou(true))
  }, [produtoId, mostrarCanceladas])

  const labelTipo = (t: Transacao) => {
    if (t.categoria) {
      const mapa: Record<string, string> = {
        compra: 'Compra',
        devolucao_cliente: 'Devolução do Cliente',
        transferencia_entrada: 'Transferência (entrada)',
        retorno_remessa: 'Retorno de Remessa',
        ajuste_entrada: 'Ajuste de Estoque +',
        outras_entradas: 'Outras Entradas',
        devolucao_fornecedor: 'Devolução ao Fornecedor',
        transferencia_saida: 'Transferência (saída)',
        uso_interno: 'Uso Interno',
        remessa_conserto: 'Remessa para Conserto',
        ajuste_saida: 'Ajuste de Estoque -',
        outras_saidas: 'Outras Saídas',
        bonificacao: 'Bonificação'
      }
      return mapa[t.categoria] || t.categoria
    }
    switch (t.tipo) {
      case 'saida': return 'Venda'
      case 'entrada': return 'Ajuste de Estoque +'
      case 'cancelamento': return 'Cancelamento'
      case 'ajuste': return 'Ajuste de Estoque -'
      default: return t.tipo
    }
  }

  const fmtDataHora = (dt: string) => {
    const d = new Date(dt)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const exportarCSV = () => {
    const cab = ['Tran. No.', 'Data/Hora', 'Tipo', 'Vl. Unitário', 'Valor Total', 'Quantidade', 'Cliente/Fornecedor', 'Funcionário']
    const linhas = transacoes.map((t) => [
      t.tran_no, t.criado_em, labelTipo(t),
      t.preco != null ? t.preco.toFixed(2) : '',
      t.subtotal != null ? t.subtotal.toFixed(2) : '',
      t.quantidade, t.cliente_fornecedor ?? '', t.usuario_nome ?? ''
    ])
    const csv = [cab, ...linhas].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `transacoes_produto_${produtoId}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const imprimir = () => {
    window.print()
  }

  return (
    <div className="aba-conteudo">
      <div className="transacoes-barra">
        <button className="btn-secundario" onClick={imprimir}>🖨 Imprimir</button>
        <button className="btn-secundario" onClick={exportarCSV}>⭳ Exportar</button>
        <label className="check-inline">
          <input type="checkbox" checked={mostrarCanceladas} onChange={(e) => setMostrarCanceladas(e.target.checked)} />
          Mostrar transações canceladas
        </label>
      </div>
      {!carregou ? (
        <p className="sem-resultado">Carregando...</p>
      ) : transacoes.length === 0 ? (
        <p className="sem-resultado">Nenhuma transação para este produto ainda.</p>
      ) : (
        <div className="tabela-wrap" style={{ maxHeight: 420 }}>
          <table className="tabela tabela-transacoes">
            <thead>
              <tr>
                <th>Ação</th>
                <th>Tran. No.</th>
                <th>Data/Hora</th>
                <th>Tipo de Transação</th>
                <th className="th-direita">Vl. Unitário</th>
                <th className="th-direita">Valor Total</th>
                <th className="th-centro">Quantidade</th>
                <th>Cliente / Fornecedor</th>
                <th className="th-centro">Cancelado</th>
                <th className="th-centro">Cancelado Em</th>
                <th>Funcionário</th>
              </tr>
            </thead>
            <tbody>
              {transacoes.map((t, i) => (
                <tr key={i} className={t.tipo === 'cancelamento' ? 'linha-cancelada' : ''}>
                  <td><button className="btn-mini" onClick={() => setDetalhe(t)}>Abrir</button></td>
                  <td>{t.tran_no}</td>
                  <td>{fmtDataHora(t.criado_em)}</td>
                  <td className="texto-negrito">{labelTipo(t)}</td>
                  <td className="td-direita">{t.preco != null ? `R$ ${t.preco.toFixed(2)}` : 'R$ 0,00'}</td>
                  <td className="td-direita texto-negrito">{t.subtotal != null ? `R$ ${t.subtotal.toFixed(2)}` : 'R$ 0,00'}</td>
                  <td className="td-centro texto-negrito">{t.quantidade}</td>
                  <td>{t.cliente_fornecedor ?? ''}</td>
                  <td className="td-centro">{t.tipo === 'cancelamento' ? 'Sim' : 'Não'}</td>
                  <td className="td-centro">{t.tipo === 'cancelamento' ? fmtDataHora(t.criado_em) : ''}</td>
                  <td>{t.usuario_nome ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detalhe && (
        <div className="modal-overlay" onClick={() => setDetalhe(null)}>
          <div className="modal modal-estoque" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Transação #{detalhe.tran_no}</h3>
              <button className="modal-fechar" onClick={() => setDetalhe(null)} aria-label="Fechar">✕</button>
            </div>
            <div className="est-detalhe-meta">
              <div className="linha"><span>Tipo</span><strong>{labelTipo(detalhe)}</strong></div>
              <div className="linha"><span>Data/hora</span><strong>{fmtDataHora(detalhe.criado_em)}</strong></div>
              {detalhe.venda_numero && <div className="linha"><span>Venda</span><strong>#{detalhe.venda_numero}</strong></div>}
              {detalhe.cliente_fornecedor && <div className="linha"><span>Cliente / Fornecedor</span><strong>{detalhe.cliente_fornecedor}</strong></div>}
              {detalhe.usuario_nome && <div className="linha"><span>Funcionário</span><strong>{detalhe.usuario_nome}</strong></div>}
              <div className="linha"><span>Quantidade</span><strong>{detalhe.quantidade}</strong></div>
              <div className="linha"><span>Valor unitário</span><strong>R$ {(detalhe.preco ?? 0).toFixed(2)}</strong></div>
              <div className="linha"><span>Valor total</span><strong>R$ {(detalhe.subtotal ?? 0).toFixed(2)}</strong></div>
              {detalhe.categoria && <div className="linha"><span>Categoria</span><strong>{detalhe.categoria}</strong></div>}
              {detalhe.documento && <div className="linha"><span>Documento</span><strong>{detalhe.documento}</strong></div>}
              {detalhe.origem && <div className="linha"><span>Origem</span><strong>{detalhe.origem}</strong></div>}
              {detalhe.destino && <div className="linha"><span>Destino</span><strong>{detalhe.destino}</strong></div>}
              {detalhe.lote && <div className="linha"><span>Lote</span><strong>{detalhe.lote}</strong></div>}
              {detalhe.data_validade && <div className="linha"><span>Validade</span><strong>{detalhe.data_validade}</strong></div>}
              {detalhe.motivo && <div className="linha"><span>Observação</span><strong>{detalhe.motivo}</strong></div>}
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setDetalhe(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
