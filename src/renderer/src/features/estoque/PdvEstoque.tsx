import { useEffect, useMemo, useRef, useState } from 'react'
import { getDbApi, getEstoqueApi, getImagemApi, dataUrlImagem } from '../../shared/db'
import { TIPOS_POR_DIRECAO, TipoMov, labelCategoria } from './tipos'
import CampoDinheiro, { parseMoeda, formatarMoeda } from '../../shared/CampoDinheiro'

interface ProdutoLite {
  id: number
  nome: string
  marca: string | null
  codigo_barras: string | null
  codigo_interno: string | null
  preco_custo: number
  preco_venda: number
  estoque: number
  unidade: string
  controla_estoque: number
}

interface ItemEstoque {
  uid: number
  produto_id: number
  nome: string
  codigo: string
  marca: string | null
  quantidade: string
  preco: string
  lote: string
  data_validade: string
  data_fabricacao: string
}

interface Fornecedor {
  id: number
  nome: string
  cnpj: string | null
}

type UsoPreferencia =
  | 'mostrar_imagens'
  | 'remover_leitor'
  | 'produto_depois_quantidade'
  | 'quantidade_opcional'
  | 'quantidade_primeiro'
  | 'mostrar_codigo'
  | 'desativar_busca_auto'
  | 'mostrar_marca'

const PREFERENCIAS: { chave: UsoPreferencia; rotulo: string; padrao: boolean }[] = [
  { chave: 'mostrar_imagens', rotulo: 'Mostrar imagens de produtos', padrao: true },
  { chave: 'remover_leitor', rotulo: 'Remover itens usando leitor de código de barras', padrao: false },
  { chave: 'produto_depois_quantidade', rotulo: 'Começar pelo Produto e depois informar a Quantidade', padrao: true },
  { chave: 'quantidade_opcional', rotulo: 'Começar pelo Produto e Não passar pela quantidade (Quantidade Opcional)', padrao: false },
  { chave: 'quantidade_primeiro', rotulo: 'Começar pela Quantidade e depois informar o Produto', padrao: false },
  { chave: 'mostrar_codigo', rotulo: 'Mostrar Código do Produto na lista de itens', padrao: true },
  { chave: 'desativar_busca_auto', rotulo: 'Desativar busca automática de produtos', padrao: false },
  { chave: 'mostrar_marca', rotulo: 'Mostrar marca junto com o nome do produto na tela de busca', padrao: true }
]

function lerPref(chave: UsoPreferencia, padrao: boolean): boolean {
  try {
    const v = localStorage.getItem(`pdv_estoque_${chave}`)
    return v === null ? padrao : v === '1'
  } catch { return padrao }
}

export default function PdvEstoque({
  usuarioId,
  tipo = 'entrada',
  categoria = 'compra',
  onFechar,
  onConcluido
}: {
  usuarioId: number
  tipo?: 'entrada' | 'saida'
  categoria?: string
  onFechar: () => void
  onConcluido: (msg: string) => void
}) {
  const tipoObj: TipoMov = (TIPOS_POR_DIRECAO[tipo] as TipoMov[]).find((t) => t.id === categoria) || {
    id: categoria,
    label: labelCategoria(categoria) || categoria,
    entrada: tipo === 'entrada'
  }

  const [prefs, setPrefs] = useState<Record<UsoPreferencia, boolean>>(() => {
    const base = {} as Record<UsoPreferencia, boolean>
    for (const p of PREFERENCIAS) base[p.chave] = lerPref(p.chave, p.padrao)
    return base
  })
  const setPref = (chave: UsoPreferencia, valor: boolean) => {
    setPrefs((prev) => ({ ...prev, [chave]: valor }))
    try { localStorage.setItem(`pdv_estoque_${chave}`, valor ? '1' : '0') } catch { /* ignore */ }
  }

  const [menuAberto, setMenuAberto] = useState(false)

  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<ProdutoLite[]>([])
  const [selResultado, setSelResultado] = useState(-1)
  const [qtdNovo, setQtdNovo] = useState('1')
  const [itens, setItens] = useState<ItemEstoque[]>([])
  const [selIdx, setSelIdx] = useState<number | null>(null)
  const [imagens, setImagens] = useState<Record<number, string>>({})
  const seqRef = useRef(0)
  const buscaRef = useRef<HTMLInputElement>(null)
  const qtdNovoRef = useRef<HTMLInputElement>(null)
  const descontoRef = useRef<HTMLInputElement>(null)

  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [fornecedorId, setFornecedorId] = useState('')
  const [modalFornecedor, setModalFornecedor] = useState(false)
  const [buscaFornecedor, setBuscaFornecedor] = useState('')
  const [novoFornecedor, setNovoFornecedor] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoCnpj, setNovoCnpj] = useState('')
  const [fornecedorErro, setFornecedorErro] = useState('')

  const [modalObs, setModalObs] = useState(false)
  const [obs, setObs] = useState('')
  const obsRef = useRef<HTMLTextAreaElement>(null)

  const [modalTransporte, setModalTransporte] = useState(false)
  const [transportadora, setTransportadora] = useState('')
  const [frete, setFrete] = useState('')
  const [placa, setPlaca] = useState('')
  const [uf, setUf] = useState('')
  const [volumes, setVolumes] = useState('')
  const [peso, setPeso] = useState('')
  const [documento, setDocumento] = useState('')

  const [descontoPct, setDescontoPct] = useState('')
  const [modalDesconto, setModalDesconto] = useState(false)

  // ---- Modal de preço unitário ----
  const [modalPreco, setModalPreco] = useState(false)
  const [precoPendente, setPrecoPendente] = useState<{ produto: ProdutoLite; qtd: string } | null>(null)
  const [precoValue, setPrecoValue] = useState('')
  const precoRef = useRef<HTMLInputElement>(null)

  const [erro, setErro] = useState('')
  const [gravando, setGravando] = useState(false)
  const [usuarioNome, setUsuarioNome] = useState('')

  // ---- Fluxo de leitura de código / quantidade ----
  const [faseLeitura, setFaseLeitura] = useState<'produto' | 'quantidade'>(
    prefs.quantidade_primeiro ? 'quantidade' : 'produto'
  )
  const [produtoPendente, setProdutoPendente] = useState<ProdutoLite | null>(null)

  useEffect(() => {
    setFaseLeitura(prefs.quantidade_primeiro ? 'quantidade' : 'produto')
  }, [prefs.quantidade_primeiro])

  useEffect(() => {
    getDbApi().all('SELECT id, nome, cnpj FROM fornecedores WHERE ativo = 1 ORDER BY nome').then((rows) => {
      setFornecedores(rows as unknown as Fornecedor[])
    }).catch(() => {})
    getDbApi().get('SELECT nome FROM usuarios WHERE id = ?', [usuarioId]).then((u) => {
      if (u) setUsuarioNome((u as { nome: string }).nome)
    }).catch(() => {})
  }, [usuarioId])

  // Busca de produto
  const buscaRefInterna = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const termo = busca.trim()
    if (buscaRefInterna.current) clearTimeout(buscaRefInterna.current)
    if (termo.length < 2) { setResultados([]); setSelResultado(-1); return }
    if (prefs.desativar_busca_auto) return
    buscaRefInterna.current = setTimeout(() => {
      getDbApi()
        .all(
          `SELECT p.id, p.nome, m.nome AS marca, p.codigo_barras, p.codigo_interno, p.preco_custo, p.preco_venda, p.estoque, p.unidade, p.controla_estoque
           FROM produtos p LEFT JOIN marcas m ON m.id = p.marca_id
           WHERE p.ativo = 1 AND (p.nome LIKE ? OR p.codigo_barras LIKE ? OR p.codigo_interno LIKE ?)
           ORDER BY p.nome LIMIT 12`,
          [`%${termo}%`, `%${termo}%`, `%${termo}%`]
        )
        .then((rows) => {
          setResultados(rows as unknown as ProdutoLite[])
          setSelResultado(rows.length ? 0 : -1)
          const ids = (rows as unknown as ProdutoLite[]).map((r) => r.id)
          if (prefs.mostrar_imagens && ids.length) {
            getImagemApi().listPorIds(ids).then(setImagens).catch(() => {})
          }
        })
        .catch(() => { setResultados([]) })
    }, 180)
    return () => { if (buscaRefInterna.current) clearTimeout(buscaRefInterna.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, prefs.desativar_busca_auto, prefs.mostrar_imagens])

  const forcarUid = (p: ProdutoLite | null, qtd: string, preco?: string) => {
    seqRef.current += 1
    const produto = p ?? produtoPendente
    if (!produto) return
    setItens((prev) => [...prev, {
      uid: seqRef.current,
      produto_id: produto.id,
      nome: produto.nome,
      codigo: produto.codigo_barras || produto.codigo_interno || '',
      marca: produto.marca,
      quantidade: qtd,
      preco: preco !== undefined ? preco : (produto.preco_custo ? String(produto.preco_custo) : ''),
      lote: '',
      data_validade: '',
      data_fabricacao: ''
    }])
  }

  const abrirModalPreco = (produto: ProdutoLite, qtd: string) => {
    setPrecoPendente({ produto, qtd })
    setPrecoValue(formatarMoeda(produto.preco_custo || 0))
    setModalPreco(true)
    setTimeout(() => { precoRef.current?.focus(); precoRef.current?.select() }, 10)
  }

  const confirmarPreco = () => {
    const pend = precoPendente
    if (!pend) return
    const preco = parseMoeda(precoValue)
    if (Number.isNaN(preco) || preco < 0) return
    forcarUid(pend.produto, pend.qtd, String(preco))
    setModalPreco(false)
    setPrecoPendente(null)
    setResultados([])
    setBusca('')
    setSelResultado(-1)
    setQtdNovo('1')
    setProdutoPendente(null)
    setFaseLeitura(prefs.quantidade_primeiro ? 'quantidade' : 'produto')
    setTimeout(() => buscaRef.current?.focus(), 0)
  }

  const cancelarPreco = () => {
    setModalPreco(false)
    setPrecoPendente(null)
    setTimeout(() => buscaRef.current?.focus(), 0)
  }

  const adicionarComQuantidade = (p: ProdutoLite) => {
    const qtd = Number(qtdNovo) > 0 ? qtdNovo : '1'
    abrirModalPreco(p, qtd)
  }

  const adicionarProdutoPendente = (p: ProdutoLite) => {
    if (prefs.quantidade_opcional) {
      adicionarComQuantidade(p)
      return
    }
    if (prefs.quantidade_primeiro) {
      const qtd = Number(qtdNovo) > 0 ? qtdNovo : '1'
      abrirModalPreco(p, qtd)
      return
    }
    // produto → depois quantidade
    setProdutoPendente(p)
    setFaseLeitura('quantidade')
    setResultados([])
    setBusca('')
    setTimeout(() => qtdNovoRef.current?.focus(), 0)
  }

  const confirmarQuantidade = () => {
    if (!produtoPendente) {
      const qtd = Number(qtdNovo) > 0 ? qtdNovo : '1'
      setQtdNovo(qtd)
      setFaseLeitura(prefs.quantidade_primeiro ? 'quantidade' : 'produto')
      setTimeout(() => buscaRef.current?.focus(), 0)
      return
    }
    const qtd = Number(qtdNovo) > 0 ? qtdNovo : '1'
    abrirModalPreco(produtoPendente, qtd)
  }

  const selecionarResultado = (p: ProdutoLite) => {
    if (prefs.remover_leitor) {
      // fluxo de remoção por leitor: produto existente na lista remove
      const existente = itens.find((i) => i.produto_id === p.id)
      if (existente) {
        setItens((prev) => prev.filter((i) => i.produto_id !== p.id))
        setResultados([])
        setBusca('')
        return
      }
    }
    adicionarProdutoPendente(p)
  }

  const onBuscaKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelResultado((prev) => Math.min(prev + 1, resultados.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelResultado((prev) => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (busca.trim() && resultados.length > 0) {
        const alvo = resultados[selResultado >= 0 ? selResultado : 0]
        selecionarResultado(alvo)
      }
    } else if (e.key === 'Escape') {
      setBusca('')
      setResultados([])
      setSelResultado(-1)
    }
  }

  const onQtdKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmarQuantidade()
    }
  }

  const subtotal = itens.reduce((s, i) => s + (Number(i.quantidade) || 0) * (Number(i.preco) || 0), 0)
  const desconto = (Number(descontoPct) || 0) > 0 ? subtotal * ((Number(descontoPct) || 0) / 100) : 0
  const total = subtotal - desconto
  const totalItens = itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0)

  const formato = useMemo(() => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [])

  // Fornecedores filtrados
  const fornecedoresFiltrados = fornecedores.filter((f) =>
    f.nome.toLowerCase().includes(buscaFornecedor.trim().toLowerCase())
  )

  const salvarNovoFornecedor = async () => {
    setFornecedorErro('')
    if (!novoNome.trim()) { setFornecedorErro('Informe o nome do fornecedor.'); return }
    try {
      const r = await getDbApi().run('INSERT INTO fornecedores (nome, cnpj, ativo) VALUES (?, ?, 1)', [novoNome.trim(), novoCnpj.trim() || null])
      const id = r.lastInsertRowid
      setFornecedores((prev) => [...prev, { id, nome: novoNome.trim(), cnpj: novoCnpj.trim() || null }].sort((a, b) => a.nome.localeCompare(b.nome)))
      setFornecedorId(String(id))
      setNovoFornecedor(false)
      setNovoNome('')
      setNovoCnpj('')
      setModalFornecedor(false)
    } catch (e) {
      setFornecedorErro(`Falha ao cadastrar fornecedor: ${(e as Error).message}`)
    }
  }

  const salvar = async () => {
    setErro('')
    if (itens.length === 0) { setErro('Adicione ao menos um produto.'); return }
    if (tipoObj.precisaFornecedor && !fornecedorId) { setErro('Selecione o fornecedor (F5).'); return }
    const itensEnviar = itens.map((i) => ({
      produto_id: i.produto_id,
      quantidade: Number(i.quantidade) > 0 ? Number(i.quantidade) : null,
      preco_custo: i.preco ? Number(i.preco) : null,
      lote: i.lote.trim() ? i.lote.trim() : null,
      data_validade: i.data_validade || null,
      data_fabricacao: i.data_fabricacao || null
    }))
    const invalido = itensEnviar.find((i) => i.quantidade == null || i.quantidade <= 0)
    if (invalido) { setErro('Quantidade deve ser maior que zero em todos os itens.'); return }
    setGravando(true)
    try {
      const transporte = [
        transportadora.trim() ? `Transportadora ${transportadora.trim()}` : '',
        frete.trim() ? `Frete R$ ${formato.format(Number(frete) || 0)}` : '',
        placa.trim() ? `Placa ${placa.trim()}` : '',
        uf.trim() ? `UF ${uf.trim()}` : '',
        volumes.trim() ? `${volumes.trim()} vol` : '',
        peso.trim() ? `${peso.trim()} kg` : ''
      ].filter(Boolean).join(' · ')
      const r = await getEstoqueApi().movimentar({
        tipo,
        categoria,
        itens: itensEnviar as { produto_id: number; quantidade: number; preco_custo?: number | null }[],
        fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
        documento: documento.trim() || undefined,
        motivo: obs.trim() || (transporte || undefined),
        origem: transporte || undefined,
        usuario_id: usuarioId
      })
      if (!r.ok) { setErro(r.erro || 'Falha ao registrar a movimentação.'); return }
      onConcluido(`${labelCategoria(categoria)} registrada (${r.documento}) — ${r.itens} item(ns), total R$ ${r.total.toFixed(2)}.`)
      onFechar()
    } catch (e) {
      setErro(`Erro: ${(e as Error).message}`)
    } finally {
      setGravando(false)
    }
  }

  const lerPesoBalanca = () => {
    setErro('Balança não configurada neste terminal.')
  }

  const abrirEdicaoItem = () => {
    if (selIdx == null) return
    const el = document.querySelector<HTMLInputElement>(`.pdv-estoque-qtd[data-idx="${selIdx}"]`)
    el?.focus()
    el?.select()
  }

  // Atalhos de teclado
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modalPreco) return
      if (modalFornecedor) return
      if (modalObs) return
      if (modalTransporte) return
      if (modalDesconto) return
      const focusable = buscaRef.current && document.activeElement === buscaRef.current
      const isInput = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA'
      if (isInput && !focusable && !['F2', 'F3', 'F4', 'F5', 'F9', 'F10', 'F12', 'F1'].includes(e.key)) return
      if (e.key === 'F1') { e.preventDefault(); lerPesoBalanca() }
      else if (e.key === 'F2') { e.preventDefault(); if (itens.length > 0 && (!tipoObj.precisaFornecedor || fornecedorId)) salvar() }
      else if (e.key === 'F3') { e.preventDefault(); setModalDesconto(true); setTimeout(() => descontoRef.current?.focus(), 30) }
      else if (e.key === 'F4') { e.preventDefault(); setModalObs(true); setTimeout(() => obsRef.current?.focus(), 30) }
      else if (e.key === 'F5') { e.preventDefault(); setModalFornecedor(true); setBuscaFornecedor('') }
      else if (e.key === 'F9') { e.preventDefault(); setModalTransporte(true) }
      else if (e.key === 'F10') { e.preventDefault(); if (selIdx != null) abrirEdicaoItem() }
      else if (e.key === 'F12') { e.preventDefault(); qtdNovoRef.current?.focus(); qtdNovoRef.current?.select() }
      else if (e.key === 'Escape') { if (menuAberto) setMenuAberto(false) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalPreco, modalFornecedor, modalObs, modalTransporte, modalDesconto, itens, fornecedorId, tipoObj.precisaFornecedor, menuAberto])

  const titulo = tipo === 'entrada'
    ? (categoria === 'compra' ? 'Compra' : labelCategoria(categoria))
    : `${labelCategoria(categoria)}`

  return (
    <div className="pdv-estoque">
      {/* ===== Cabeçalho ===== */}
      <header className="pdv-estoque-topo">
        <div className="pdv-estoque-titulo">
          <span className="pdv-estoque-tipo-btn">{tipo === 'entrada' ? '▲ Entrada de estoque' : '▼ Saída de estoque'}</span>
          <h1>{titulo}</h1>
          {tipoObj.precisaFornecedor && <span className="pdv-estoque-obrig"> *Fornecedor obrigatório</span>}
        </div>
        <div className="pdv-estoque-topo-acoes">
          <div className="pdv-estoque-menu-wrap">
            <button
              className="pdv-estoque-menu-btn"
              onClick={() => setMenuAberto((v) => !v)}
              aria-label="Configurações"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
            {menuAberto && (
              <>
                <div className="pdv-estoque-menu-backdrop" onClick={() => setMenuAberto(false)} />
                <div className="pdv-estoque-menu">
                  <div className="pdv-estoque-menu-titulo">Configurações de leitura</div>
                  {PREFERENCIAS.map((p) => (
                    <label key={p.chave} className="pdv-estoque-pref">
                      <input
                        type="checkbox"
                        checked={prefs[p.chave]}
                        onChange={(e) => setPref(p.chave, e.target.checked)}
                      />
                      <span>{p.rotulo}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ===== Corpo ===== */}
      <div className="pdv-estoque-corpo">
      {/* Esquerda/Centro — lançamento */}
        <div className="pdv-estoque-lancamento">
          <div className="pdv-estoque-barra">
            <div className="pdv-estoque-busca-wrap">
              <span className="pdv-estoque-lupa">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
              </span>
              <input
                ref={buscaRef}
                className="pdv-estoque-busca"
                autoFocus
                placeholder="Buscar por nome ou código de barras..."
                value={busca}
                onChange={(e) => { setBusca(e.target.value); setSelResultado(-1) }}
                onKeyDown={onBuscaKey}
              />
            </div>
            <label className="pdv-estoque-qtd">
              <span>Quant:</span>
              <input
                ref={qtdNovoRef}
                type="number"
                min="0"
                step="0.01"
                value={qtdNovo}
                onChange={(e) => setQtdNovo(e.target.value)}
                onKeyDown={onQtdKey}
              />
            </label>
            {faseLeitura === 'quantidade' && produtoPendente && (
              <button className="pdv-estoque-confirma-qtd" onClick={confirmarQuantidade}>
                Confirmar qtd ({produtoPendente.nome})
              </button>
            )}
            {resultados.length > 0 && (
              <div className="pdv-estoque-sugestoes">
                {resultados.map((p, idx) => (
                  <button
                    key={p.id}
                    className={`pdv-estoque-sugestao ${idx === selResultado ? 'ativo' : ''}`}
                    onClick={() => selecionarResultado(p)}
                    onMouseEnter={() => setSelResultado(idx)}
                  >
                    {prefs.mostrar_imagens && imagens[p.id] && (
                      <img className="pdv-estoque-sug-img" src={dataUrlImagem(imagens[p.id])} alt="" />
                    )}
                    <span className="pdv-estoque-sug-nome">
                      {p.nome}
                      {prefs.mostrar_marca && p.marca ? <em>{p.marca}</em> : null}
                    </span>
                    <span className="pdv-estoque-sug-info">
                      {[p.codigo_barras, p.codigo_interno].filter(Boolean).join(' · ')}
                    </span>
                    <span className="pdv-estoque-sug-estoque">est: {p.estoque} {p.unidade}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {itens.length === 0 ? (
            <div className="pdv-estoque-vazio">
              <div className="pdv-estoque-caixa">
                <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                  <path d="M3.3 7l8.7 5 8.7-5" />
                  <path d="M12 22V12" />
                </svg>
              </div>
              <h2>Nenhum item adicionado</h2>
              <p>Busque um produto pela barra acima ou use o leitor de código de barras.</p>
              <button className="pdv-estoque-link" onClick={() => setModalObs(true)}>Aprenda a lançar compras</button>
            </div>
          ) : (
            <div className="pdv-estoque-tabela-wrap">
              <table className="tabela pdv-estoque-tabela">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th className="th-centro">Qtd</th>
                    <th>Produto</th>
                    {prefs.mostrar_codigo && <th>Código</th>}
                    <th className="th-direita">Preço</th>
                    <th className="th-direita">Subtotal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i, idx) => (
                    <tr key={i.uid} className={selIdx === idx ? 'linha-selecionada' : ''} onClick={() => setSelIdx(idx)}>
                      <td className="td-centro">{i.uid}</td>
                      <td className="td-centro">
                        <input
                          className="pdv-estoque-qtd"
                          data-idx={idx}
                          type="number"
                          min="0"
                          step="0.01"
                          value={i.quantidade}
                          onChange={(e) => setItens((prev) => prev.map((x) => x.uid === i.uid ? { ...x, quantidade: e.target.value } : x))}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td>
                        <strong>{i.nome}</strong>
                        {i.marca && <div className="est-sub">{i.marca}</div>}
                      </td>
        {prefs.mostrar_codigo && <td>{i.codigo || '—'}</td>}
                      <td className="td-direita">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          style={{ width: 90, textAlign: 'right' }}
                          value={i.preco}
                          onChange={(e) => setItens((prev) => prev.map((x) => x.uid === i.uid ? { ...x, preco: e.target.value } : x))}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="td-direita">R$ {formato.format((Number(i.quantidade) || 0) * (Number(i.preco) || 0))}</td>
                      <td className="td-centro">
                        <button className="btn-mini" onClick={(e) => { e.stopPropagation(); setItens((prev) => prev.filter((x) => x.uid !== i.uid)) }}>x</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {/* Direita — atributos da movimentação */}
        <aside className="pdv-estoque-painel">
          <div className="pdv-estoque-painel-status">
            {totalItens === 0 ? 'Nenhum item' : `Quantidade: ${totalItens}`}
          </div>

          <button className={`pdv-estoque-painel-btn ${fornecedorId ? 'tem' : ''}`} onClick={() => { setModalFornecedor(true); setBuscaFornecedor('') }}>
            <span className="pdv-estoque-icone">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <span className="pdv-estoque-btn-texto">
              <strong>Fornecedor - F5</strong>
              {tipoObj.precisaFornecedor && <em className="pdv-estoque-obrig">(obrigatório)</em>}
              {fornecedorId && <small>{fornecedores.find((f) => String(f.id) === fornecedorId)?.nome}</small>}
            </span>
        {fornecedorId && <span className="pdv-estoque-setinha">✓</span>}
          </button>

          <button className="pdv-estoque-painel-btn" onClick={() => setModalTransporte(true)}>
            <span className="pdv-estoque-icone">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" rx="1" />
                <path d="M16 8h4l3 3v5h-7V8Z" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            </span>
            <span className="pdv-estoque-btn-texto">
              <strong>Dados do Transporte - F9</strong>
              <small>{transportadora || frete || 'Frete, transportadora...'}</small>
            </span>
          </button>

          <button className="pdv-estoque-painel-btn" onClick={() => setModalObs(true)}>
            <span className="pdv-estoque-icone">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span className="pdv-estoque-btn-texto">
              <strong>Observações - F4</strong>
              <small>{obs || 'Anotações da movimentação'}</small>
            </span>
          </button>

          <div className="pdv-estoque-painel-rodape">
            <button className="btn-secundario" onClick={onFechar}>Cancelar</button>
            <span className="pdv-estoque-operador">Feito por <b>{usuarioNome || `Usuário #${usuarioId}`}</b></span>
          </div>
        </aside>
      </div>

      {/* ===== Rodapé ===== */}
      <footer className="pdv-estoque-rodape">
        <button
          className="btn-primario pdv-estoque-salvar"
          onClick={salvar}
          disabled={gravando || itens.length === 0}
        >
          {gravando ? 'Salvando...' : 'SALVAR - F2'}
        </button>
        <span className="pdv-estoque-total">Total: R$ {formato.format(total)}</span>
      </footer>

      {/* ===== Modal Fornecedor (F5) ===== */}
      {modalFornecedor && (
        <div className="pdv-estoque-modal-overlay" onClick={() => setModalFornecedor(false)}>
          <div className="pdv-estoque-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pdv-estoque-modal-topo">
              <h3>Selecione um fornecedor</h3>
      <button className="modal-fechar" onClick={() => setModalFornecedor(false)} aria-label="Fechar">✕</button>
            </div>
            <div className="pdv-estoque-modal-corpo">
              {!novoFornecedor ? (
                <>
                  <div className="pdv-estoque-modaltool">
                    <button className="pdv-estoque-novo-fornecedor" onClick={() => { setNovoFornecedor(true); setNovoNome(''); setNovoCnpj(''); setFornecedorErro('') }} title="Novo fornecedor" aria-label="Novo fornecedor">+</button>
                    <input
                      className="busca"
                      placeholder="Busque pelo nome e tecle [enter]"
                      value={buscaFornecedor}
                      onChange={(e) => setBuscaFornecedor(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && fornecedoresFiltrados.length > 0) {
                          setFornecedorId(String(fornecedoresFiltrados[0].id))
                          setModalFornecedor(false)
                        }
                      }}
                      autoFocus
                    />
                  </div>
                  <div className="tabela-wrap" style={{ maxHeight: 320 }}>
                    <table className="tabela">
                      <thead>
                        <tr>
                          <th></th>
                          <th>Nome do fornecedor</th>
                          <th>Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fornecedoresFiltrados.length === 0 ? (
                          <tr><td colSpan={3} className="sem-resultado">Nenhum fornecedor encontrado.</td></tr>
                        ) : fornecedoresFiltrados.map((f) => (
                          <tr key={f.id}>
                            <td>
                              <button
                                className="btn-mini btn-primario"
                                onClick={() => { setFornecedorId(String(f.id)); setModalFornecedor(false); setBuscaFornecedor('') }}
                              >
                                Selecionar
                              </button>
                            </td>
                            <td>
                              <strong>{f.nome}</strong>
                              {f.cnpj && <div className="est-sub">{f.cnpj}</div>}
                            </td>
                            <td>
                              <button className="btn-mini" onClick={() => { setNovoFornecedor(true); setNovoNome(f.nome); setNovoCnpj(f.cnpj || ''); setFornecedorErro('') }}>Editar</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="pdv-estoque-novo-form">
                  <div className="pdv-estoque-os">Novo fornecedor</div>
                  <input className="busca" placeholder="Nome *" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} autoFocus />
                  <input className="busca" placeholder="CNPJ/CPF" value={novoCnpj} onChange={(e) => setNovoCnpj(e.target.value)} />
                  {fornecedorErro && <div className="mensagem" style={{ color: '#dc2626' }}>{fornecedorErro}</div>}
                  <div className="pdv-estoque-acoes">
                    <button className="btn-primario" onClick={salvarNovoFornecedor}>Salvar</button>
                    <button className="btn-secundario" onClick={() => setNovoFornecedor(false)}>Cancelar</button>
                  </div>
                  <div className="est-sub">O "Editar" reutiliza o cadastro de fornecedores existente.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal Observações (F4) ===== */}
      {modalObs && (
        <div className="pdv-estoque-modal-overlay" onClick={() => setModalObs(false)}>
          <div className="pdv-estoque-modal pdv-estoque-modal-obs" onClick={(e) => e.stopPropagation()}>
            <div className="pdv-estoque-modal-topo">
              <h3>Observação:</h3>
      <button className="modal-fechar" onClick={() => setModalObs(false)} aria-label="Fechar">✕</button>
            </div>
            <div className="pdv-estoque-modal-corpo">
              <textarea
                ref={obsRef}
                className="pdv-estoque-obs-textarea"
                rows={6}
                placeholder="Digite a observação da movimentação..."
                value={obs}
                onChange={(e) => setObs(e.target.value)}
              />
              <div className="pdv-estoque-modal-rodape">
                <button className="btn-primario" onClick={() => setModalObs(false)}>SALVAR - F2</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal Transporte (F9) ===== */}
      {modalTransporte && (
        <div className="pdv-estoque-modal-overlay" onClick={() => setModalTransporte(false)}>
          <div className="pdv-estoque-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pdv-estoque-modal-topo">
              <h3>Dados do Transporte - F9</h3>
      <button className="modal-fechar" onClick={() => setModalTransporte(false)} aria-label="Fechar">✕</button>
            </div>
            <div className="pdv-estoque-modal-corpo pdv-estoque-transporte">
              <label className="config-campo">Transportadora
                <input value={transportadora} onChange={(e) => setTransportadora(e.target.value)} placeholder="Nome da transportadora" />
              </label>
              <label className="config-campo">Frete (R$)
                <input type="number" min="0" step="0.01" value={frete} onChange={(e) => setFrete(e.target.value)} placeholder="0,00" />
              </label>
              <div className="pdv-estoque-transporte-grid">
                <label className="config-campo">Placa
                  <input value={placa} onChange={(e) => setPlaca(e.target.value)} placeholder="AAA-0000" />
                </label>
                <label className="config-campo">UF
                  <input value={uf} onChange={(e) => setUf(e.target.value)} placeholder="UF" />
                </label>
              </div>
              <div className="pdv-estoque-transporte-grid">
                <label className="config-campo">Volumes
                  <input type="number" min="0" value={volumes} onChange={(e) => setVolumes(e.target.value)} placeholder="0" />
                </label>
                <label className="config-campo">Peso (kg)
                  <input type="number" min="0" step="0.01" value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="0,00" />
                </label>
              </div>
              <div className="pdv-estoque-modal-rodape">
                <button className="btn-primario" onClick={() => setModalTransporte(false)}>OK</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal Desconto (F3) ===== */}
      {modalDesconto && (
        <div className="pdv-estoque-modal-overlay" onClick={() => setModalDesconto(false)}>
          <div className="pdv-estoque-modal pdv-estoque-modal-peq" onClick={(e) => e.stopPropagation()}>
            <div className="pdv-estoque-modal-topo">
              <h3>Desconto - F3</h3>
      <button className="modal-fechar" onClick={() => setModalDesconto(false)} aria-label="Fechar">✕</button>
            </div>
            <div className="pdv-estoque-modal-corpo">
              <label className="config-campo">Desconto (%)
                <input ref={descontoRef} type="number" min="0" max="100" step="0.01" value={descontoPct} onChange={(e) => setDescontoPct(e.target.value)} />
              </label>
              <div className="pdv-estoque-modal-rodape">
                <button className="btn-primario" onClick={() => setModalDesconto(false)}>Aplicar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {erro && <div className="pdv-estoque-erro">{erro}</div>}

      {/* ===== Modal Preço unitário ===== */}
      {modalPreco && precoPendente && (
        <div className="pdv-estoque-modal-overlay" onClick={cancelarPreco}>
          <div className="pdv-estoque-modal pdv-estoque-modal-preco" onClick={(e) => e.stopPropagation()}>
            <div className="pdv-estoque-modal-topo">
              <h3>Preço unitário</h3>
              <button className="modal-fechar" onClick={cancelarPreco} aria-label="Fechar">✕</button>
            </div>
            <div className="pdv-estoque-modal-corpo pdv-estoque-preco-corpo">
              <div className="pdv-estoque-preco-produto">
                <strong>{precoPendente.produto.nome}</strong>
                {precoPendente.produto.marca && <span className="est-sub">{precoPendente.produto.marca}</span>}
                <span className="pdv-estoque-preco-qtd">Quantidade: {precoPendente.qtd} {precoPendente.produto.unidade || ''}</span>
              </div>
              <label className="pdv-estoque-preco-label">Preço unitário</label>
              <div className="pdv-estoque-preco-wrap">
                <span className="pdv-estoque-preco-rs">R$</span>
                <CampoDinheiro
                  ref={precoRef}
                  value={precoValue}
                  onChange={setPrecoValue}
                  className="pdv-estoque-preco-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); confirmarPreco() }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelarPreco() }
                  }}
                />
              </div>
              <button className="pdv-estoque-preco-adicionar" onClick={confirmarPreco}>
                ADICIONAR ITEM
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
