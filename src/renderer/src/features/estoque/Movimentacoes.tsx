import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDbApi, getEstoqueApi } from '../../shared/db'
import { TIPOS_POR_DIRECAO, TipoMov, labelCategoria } from './tipos'

interface ProdutoLite {
  id: number
  nome: string
  codigo_barras: string | null
  preco_custo: number
  preco_venda: number
  estoque: number
  unidade: string
}

interface ItemMov {
  produto_id: number
  nome: string
  quantidade: string
  preco_custo: string
  lote: string
  data_validade: string
}

interface GrupoTransacao {
  chave: string
  documento: string | null
  criado_em: string
  tipo: string
  categoria: string | null
  motivo: string | null
  venda_id: number | null
  compra_id: number | null
  usuario_nome: string | null
  fornecedor_nome: string | null
  cliente_nome: string | null
  origem: string | null
  destino: string | null
  qtd_itens: number
  quantidade_total: number
  valor_total: number
  canceladas: number
}

interface DetalheTransacao {
  id: number
  produto_id: number
  produto_nome: string
  tipo: string
  categoria: string | null
  quantidade: number
  valor: number
  motivo: string | null
  documento: string | null
  origem: string | null
  destino: string | null
  lote: string | null
  data_validade: string | null
  estoque_anterior: number | null
  estoque_posterior: number | null
  criado_em: string
}

export function MovimentoModal({
  usuarioId,
  tipoInicial,
  categoriaInicial,
  produtoInicialId,
  onFechar,
  onConcluido
}: {
  usuarioId: number
  tipoInicial: 'entrada' | 'saida'
  categoriaInicial?: string
  produtoInicialId?: number
  onFechar: () => void
  onConcluido: (msg: string) => void
}) {
  const [categoria] = useState(categoriaInicial ?? '')
  const tipoObj: TipoMov | undefined = TIPOS_POR_DIRECAO[tipoInicial].find((t) => t.id === categoria)

  const [fornecedores, setFornecedores] = useState<{ id: number; nome: string }[]>([])
  const [clientes, setClientes] = useState<{ id: number; nome: string }[]>([])
  const [fornecedorId, setFornecedorId] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [origem, setOrigem] = useState('')
  const [destino, setDestino] = useState('')
  const [documento, setDocumento] = useState('')
  const [data, setData] = useState('')
  const [motivo, setMotivo] = useState('')
  const [itens, setItens] = useState<ItemMov[]>([])
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<ProdutoLite[]>([])
  const [erro, setErro] = useState('')
  const [gravando, setGravando] = useState(false)
  const buscaRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getDbApi().all('SELECT id, nome FROM fornecedores WHERE ativo = 1 ORDER BY nome').then((rows) => {
      setFornecedores(rows as unknown as { id: number; nome: string }[])
    }).catch(() => {})
    getDbApi().all('SELECT id, nome FROM clientes ORDER BY nome').then((rows) => {
      setClientes(rows as unknown as { id: number; nome: string }[])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!produtoInicialId) return
    getDbApi().get(`SELECT id, nome, codigo_barras, preco_custo, preco_venda, estoque, unidade FROM produtos WHERE id = ?`, [produtoInicialId])
      .then((p) => {
        if (p) adicionar(p as unknown as ProdutoLite)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoInicialId])

  useEffect(() => {
    const termo = busca.trim()
    if (termo.length < 2) {
      setResultados([])
      return
    }
    const t = setTimeout(() => {
      getDbApi()
        .all(
          `SELECT id, nome, codigo_barras, preco_custo, preco_venda, estoque, unidade FROM produtos
           WHERE ativo = 1 AND (nome LIKE ? OR codigo_barras LIKE ? OR codigo_interno LIKE ?)
           ORDER BY nome LIMIT 10`,
          [`%${termo}%`, `%${termo}%`, `%${termo}%`]
        )
        .then((rows) => setResultados(rows as unknown as ProdutoLite[]))
        .catch(() => setResultados([]))
    }, 200)
    return () => clearTimeout(t)
  }, [busca])

  const adicionar = (p: ProdutoLite) => {
    setItens((prev) => {
      if (prev.some((i) => i.produto_id === p.id)) return prev
      return [...prev, { produto_id: p.id, nome: p.nome, quantidade: '1', preco_custo: p.preco_custo ? String(p.preco_custo) : '', lote: '', data_validade: '' }]
    })
    setResultados([])
    setBusca('')
    buscaRef.current?.focus()
  }

  const totalCusto = itens.reduce((s, i) => s + (Number(i.quantidade) || 0) * (Number(i.preco_custo) || 0), 0)
  const totalItens = itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0)

  const confirmar = async () => {
    setErro('')
    if (itens.length === 0) {
      setErro('Adicione ao menos um produto.')
      return
    }
    if (!tipoObj) {
      setErro('Selecione o tipo de movimentação.')
      return
    }
    if (tipoObj.precisaFornecedor && !fornecedorId) {
      setErro('Selecione o fornecedor.')
      return
    }
    if (tipoObj.precisaCliente && !clienteId) {
      setErro('Selecione o cliente.')
      return
    }
    if (tipoObj.requerMotivo && !motivo.trim()) {
      setErro('Informe o motivo da movimentação.')
      return
    }
    const itensEnviar = itens.map((i) => ({
      produto_id: i.produto_id,
      quantidade: Number(i.quantidade),
      preco_custo: i.preco_custo ? Number(i.preco_custo) : null,
      lote: i.lote.trim() ? i.lote.trim() : null,
      data_validade: i.data_validade || null
    }))
    setGravando(true)
    try {
      const r = await getEstoqueApi().movimentar({
        tipo: tipoInicial,
        categoria: categoria as string,
        itens: itensEnviar,
        fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
        cliente_id: clienteId ? Number(clienteId) : null,
        origem: origem.trim() || undefined,
        destino: destino.trim() || undefined,
        documento: documento.trim() || undefined,
        motivo: motivo.trim() || undefined,
        data: data || undefined,
        usuario_id: usuarioId
      })
      if (!r.ok) {
        setErro(r.erro || 'Falha ao registrar a movimentação.')
        return
      }
      onConcluido(`Movimentação registrada (${r.documento}) — ${r.itens} item(ns), total R$ ${r.total.toFixed(2)}.`)
      onFechar()
    } catch (e) {
      setErro(`Erro: ${(e as Error).message}`)
    } finally {
      setGravando(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !gravando && onFechar()}>
      <div className="modal modal-tela-cheia modal-estoque" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <h3>{tipoInicial === 'entrada' ? 'Entrada de estoque' : 'Saída de estoque'} — {labelCategoria(categoria)}</h3>
          <button className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="est-mov-corpo">
          {tipoObj?.precisaFornecedor && (
            <label className="config-campo">Fornecedor
              <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                <option value="">— selecione —</option>
                {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>
          )}
          {tipoObj?.precisaCliente && (
            <label className="config-campo">Cliente
              <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                <option value="">— selecione —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
          )}
          {tipoObj?.origem && (
            <label className="config-campo">Origem
              <input value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="Loja / depósito de origem" />
            </label>
          )}
          {tipoObj?.destino && (
            <label className="config-campo">Destino
              <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Loja / local de destino" />
            </label>
          )}

          <div className="est-mov-cabecalho">
            <label className="config-campo">Documento (opcional)
              <input value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="NF, número, referência..." />
            </label>
            <label className="config-campo">Data (opcional)
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </label>
          </div>
          <label className="config-campo">Observação / motivo
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipoObj?.requerMotivo ? 'Obrigatório para este tipo' : 'Opcional'} />
          </label>

          <div className="est-mov-produtos">
            <div className="est-mov-busca">
              <input
                ref={buscaRef}
                className="busca"
                placeholder="Buscar produto por nome ou código..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              {resultados.length > 0 && (
                <div className="resultados-inline">
                  {resultados.map((p) => (
                    <button key={p.id} type="button" onClick={() => adicionar(p)}>
                      {p.nome} — est: {p.estoque} {p.unidade}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {itens.length === 0 ? (
              <p className="sem-resultado">Nenhum produto adicionado.</p>
            ) : (
              <div className="tabela-wrap" style={{ maxHeight: 240 }}>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th className="th-centro">Qtd</th>
                      {tipoObj?.usaCusto && <th className="th-centro">Custo</th>}
                      <th className="th-centro">Lote</th>
                      <th className="th-centro">Validade</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((i) => (
                      <tr key={i.produto_id}>
                        <td>{i.nome}</td>
                        <td className="td-centro">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            style={{ width: 80 }}
                            value={i.quantidade}
                            onChange={(e) => setItens((prev) => prev.map((x) => x.produto_id === i.produto_id ? { ...x, quantidade: e.target.value } : x))}
                          />
                        </td>
                        {tipoObj?.usaCusto && (
                          <td className="td-centro">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              style={{ width: 90 }}
                              value={i.preco_custo}
                              onChange={(e) => setItens((prev) => prev.map((x) => x.produto_id === i.produto_id ? { ...x, preco_custo: e.target.value } : x))}
                            />
                          </td>
                        )}
                        <td className="td-centro">
                          <input
                            style={{ width: 90 }}
                            value={i.lote}
                            onChange={(e) => setItens((prev) => prev.map((x) => x.produto_id === i.produto_id ? { ...x, lote: e.target.value } : x))}
                          />
                        </td>
                        <td className="td-centro">
                          <input
                            type="date"
                            style={{ width: 130 }}
                            value={i.data_validade}
                            onChange={(e) => setItens((prev) => prev.map((x) => x.produto_id === i.produto_id ? { ...x, data_validade: e.target.value } : x))}
                          />
                        </td>
                        <td className="td-centro">
                          <button className="btn-mini" onClick={() => setItens((prev) => prev.filter((x) => x.produto_id !== i.produto_id))}>x</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {erro && <div className="mensagem" style={{ color: '#dc2626' }}>{erro}</div>}
        </div>
        <div className="modal-rodape est-mov-rodape">
          <div className="est-mov-totais">
            <span><b>{itens.length}</b> produto(s) · <b>{totalItens}</b> unidade(s)</span>
            {tipoObj?.usaCusto && <strong>Custo total: R$ {totalCusto.toFixed(2)}</strong>}
          </div>
          <button className="btn-primario" onClick={confirmar} disabled={gravando}>
            {gravando ? 'Registrando...' : 'Registrar movimentação'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Movimentacoes({
  usuarioId,
  produtoFiltro,
  onLimparFiltro,
  onNova
}: {
  usuarioId: number
  produtoFiltro: number | null
  onLimparFiltro: () => void
  onNova: (tipo: 'entrada' | 'saida', categoria?: string) => void
}) {
  const [grupos, setGrupos] = useState<GrupoTransacao[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'entrada' | 'saida'>('todos')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [filtroFornecedor, setFiltroFornecedor] = useState('')
  const [exibirVendas, setExibirVendas] = useState(true)
  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [menuTipo, setMenuTipo] = useState<'entrada' | 'saida' | null>(null)
  const [clientes, setClientes] = useState<{ id: number; nome: string }[]>([])
  const [fornecedores, setFornecedores] = useState<{ id: number; nome: string }[]>([])
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState<{ documento: string | null; venda_id: number | null; compra_id: number | null; id: number } | null>(null)
  const [detalheItens, setDetalheItens] = useState<DetalheTransacao[]>([])
  const [detalheMeta, setDetalheMeta] = useState<GrupoTransacao | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [estornando, setEstornando] = useState(false)
  const [compraCancelada, setCompraCancelada] = useState(false)
  const POR_PAGINA = 25

  useEffect(() => {
    getDbApi().all('SELECT id, nome FROM clientes ORDER BY nome').then((rows) => {
      setClientes(rows as unknown as { id: number; nome: string }[])
    }).catch(() => {})
    getDbApi().all('SELECT id, nome FROM fornecedores WHERE ativo = 1 ORDER BY nome').then((rows) => {
      setFornecedores(rows as unknown as { id: number; nome: string }[])
    }).catch(() => {})
  }, [])

  const abrirFichaSelecionada = () => {
    const alvo = grupos.find((g) => g.chave === selecionado) ?? grupos[0]
    if (alvo) abrirDetalhe(alvo)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); abrirFichaSelecionada() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, selecionado])

  const carregar = useCallback(async () => {
    setCarregando(true)
    const conds: string[] = []
    const params: unknown[] = []
    if (filtroTipo === 'entrada') conds.push(`m.tipo = 'entrada'`)
    if (filtroTipo === 'saida') conds.push(`m.tipo = 'saida'`)
    if (filtroCategoria) { conds.push(`m.categoria = ?`); params.push(filtroCategoria) }
    const termo = busca.trim()
    if (termo) {
      conds.push(`(m.documento LIKE ? OR m.motivo LIKE ? OR EXISTS (
        SELECT 1 FROM movimentacoes mx JOIN produtos px ON px.id = mx.produto_id
        WHERE ((mx.documento IS NOT NULL AND mx.documento = m.documento) OR (mx.documento IS NULL AND mx.venda_id = m.venda_id AND m.documento IS NULL))
        AND px.nome LIKE ?))`)
      const like = `%${termo}%`
      params.push(like, like, like)
    }
    if (produtoFiltro != null) {
      conds.push(`EXISTS (
        SELECT 1 FROM movimentacoes mx WHERE mx.produto_id = ?
        AND ((mx.documento IS NOT NULL AND mx.documento = m.documento) OR (mx.documento IS NULL AND mx.venda_id = m.venda_id AND m.documento IS NULL))
      )`)
      params.push(produtoFiltro)
    }
    if (filtroCliente) { conds.push(`m.cliente_id = ?`); params.push(Number(filtroCliente)) }
    if (filtroFornecedor) { conds.push(`m.fornecedor_id = ?`); params.push(Number(filtroFornecedor)) }
    if (!exibirVendas) {
      conds.push(`m.venda_id IS NULL AND m.tipo != 'cancelamento' AND m.categoria NOT IN ('devolucao_cliente', 'devolucao_fornecedor')`)
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    const base = `
      SELECT
        COALESCE(m.documento, CASE WHEN m.venda_id IS NOT NULL THEN 'V-'||m.venda_id ELSE 'M-'||m.id END) AS chave,
        MAX(m.documento) AS documento,
        MAX(m.criado_em) AS criado_em,
        MAX(m.tipo) AS tipo,
        MAX(m.categoria) AS categoria,
        MAX(m.motivo) AS motivo,
        MAX(m.venda_id) AS venda_id,
        MAX(m.compra_id) AS compra_id,
        MAX(u.nome) AS usuario_nome,
        MAX(f.nome) AS fornecedor_nome,
        MAX(c.nome) AS cliente_nome,
        MAX(m.origem) AS origem,
        MAX(m.destino) AS destino,
        COUNT(*) AS qtd_itens,
        SUM(m.quantidade) AS quantidade_total,
        SUM(m.valor) + COALESCE(SUM(CASE WHEN m.venda_id IS NOT NULL THEN
          (SELECT vi.subtotal FROM venda_itens vi WHERE vi.venda_id = m.venda_id AND vi.produto_id = m.produto_id LIMIT 1) ELSE 0 END), 0) AS valor_total,
        COUNT(CASE WHEN m.tipo = 'cancelamento' THEN 1 END) AS canceladas
      FROM movimentacoes m
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
      LEFT JOIN clientes c ON c.id = m.cliente_id
      ${where}
      GROUP BY chave
    `
    try {
      const db = getDbApi()
      const contagem = (await db.get(`SELECT COUNT(*) AS c FROM (${base})`, params)) as { c: number }
      setTotal(contagem.c)
      const limite = Math.min(POR_PAGINA, Math.max(contagem.c - pagina * POR_PAGINA, 0))
      if (limite > 0) {
        const rows = (await db.all(`${base} ORDER BY MAX(m.criado_em) DESC LIMIT ? OFFSET ?`, [...params, POR_PAGINA, pagina * POR_PAGINA])) as unknown as GrupoTransacao[]
        setGrupos(rows)
      } else {
        setGrupos([])
      }
    } catch {
      setGrupos([])
      setTotal(0)
    } finally {
      setCarregando(false)
    }
  }, [filtroTipo, filtroCategoria, filtroCliente, filtroFornecedor, exibirVendas, busca, produtoFiltro, pagina])

  useEffect(() => { carregar() }, [carregar])

  const abrirDetalhe = async (g: GrupoTransacao) => {
    setDetalheMeta(g)
    setDetalheItens([])
    setDetalhe({ documento: g.documento, venda_id: g.venda_id, compra_id: g.compra_id, id: Number(g.chave.split('-')[1]) })
    try {
      let sql: string
      let params: unknown[]
      if (g.documento) {
        sql = `SELECT m.id, m.produto_id, p.nome AS produto_nome, m.tipo, m.categoria, m.quantidade, m.valor, m.motivo, m.documento, m.origem, m.destino, p.lote, p.data_validade, m.estoque_anterior, m.estoque_posterior, m.criado_em
               FROM movimentacoes m JOIN produtos p ON p.id = m.produto_id WHERE m.documento = ? ORDER BY m.id`
        params = [g.documento]
      } else if (g.venda_id) {
        sql = `SELECT m.id, m.produto_id, p.nome AS produto_nome, m.tipo, m.categoria, m.quantidade, m.valor, m.motivo, m.documento, m.origem, m.destino, p.lote, p.data_validade, m.estoque_anterior, m.estoque_posterior, m.criado_em
               FROM movimentacoes m JOIN produtos p ON p.id = m.produto_id WHERE m.venda_id = ? ORDER BY m.id`
        params = [g.venda_id]
      } else {
        sql = `SELECT m.id, m.produto_id, p.nome AS produto_nome, m.tipo, m.categoria, m.quantidade, m.valor, m.motivo, m.documento, m.origem, m.destino, p.lote, p.data_validade, m.estoque_anterior, m.estoque_posterior, m.criado_em
               FROM movimentacoes m JOIN produtos p ON p.id = m.produto_id WHERE m.id = ? ORDER BY m.id`
        params = [Number(g.chave.split('-')[1])]
      }
      const rows = (await getDbApi().all(sql, params)) as unknown as DetalheTransacao[]
      setDetalheItens(rows)
      if (g.compra_id != null) {
        const c = (await getDbApi().get(`SELECT cancelada FROM compras WHERE id = ?`, [g.compra_id])) as { cancelada: number } | undefined
        setCompraCancelada(c?.cancelada === 1)
      } else {
        setCompraCancelada(false)
      }
    } catch {
      setDetalheItens([])
    }
  }

  const totalPaginas = Math.max(Math.ceil(total / POR_PAGINA), 1)

  const estornarCompra = async (compraId: number) => {
    if (!window.confirm('Estornar esta compra? O estoque será revertido e a entrada anulada.')) return
    setEstornando(true)
    setMensagem('')
    try {
      const r = await getEstoqueApi().compraCancelar({ compra_id: compraId, usuario_id: usuarioId })
      if (!r.ok) { setMensagem(r.erro || 'Falha ao estornar a compra.'); return }
      setMensagem(`Compra ${r.numero} estornada — ${r.itens_revertidos} item(ns) revertido(s).`)
      setDetalhe(null)
      carregar()
    } catch (e) {
      setMensagem(`Erro ao estornar: ${(e as Error).message}`)
    } finally {
      setEstornando(false)
    }
  }

  const fmtDataHora = (dt: string) => {
    const d = new Date(dt)
    if (isNaN(d.getTime())) return dt
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const label = (g: GrupoTransacao) => {
    if (g.categoria) return labelCategoria(g.categoria)
    if (g.tipo === 'saida') return 'Venda'
    if (g.tipo === 'cancelamento') return 'Cancelamento'
    return g.tipo
  }

  const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const categoriasDisponiveis = useMemo(() => {
    const set = new Set<string>()
    TIPOS_POR_DIRECAO.entrada.forEach((t) => set.add(t.id))
    TIPOS_POR_DIRECAO.saida.forEach((t) => set.add(t.id))
    return Array.from(set)
  }, [])

  return (
    <div className="est-abas-conteudo">
      <div className="est-toolbar">
        <div className="segmented">
          <button className={filtroTipo === 'todos' ? 'ativo' : ''} onClick={() => { setFiltroTipo('todos'); setPagina(0) }}>Todos</button>
          <button className={filtroTipo === 'entrada' ? 'ativo' : ''} onClick={() => { setFiltroTipo('entrada'); setPagina(0) }}>Entradas</button>
          <button className={filtroTipo === 'saida' ? 'ativo' : ''} onClick={() => { setFiltroTipo('saida'); setPagina(0) }}>Saídas</button>
        </div>
        <select value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPagina(0) }}>
          <option value="">Todas as categorias</option>
          {categoriasDisponiveis.map((c) => <option key={c} value={c}>{labelCategoria(c)}</option>)}
        </select>
        <select value={filtroCliente} onChange={(e) => { setFiltroCliente(e.target.value); setPagina(0) }}>
          <option value="">Todos os clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select value={filtroFornecedor} onChange={(e) => { setFiltroFornecedor(e.target.value); setPagina(0) }}>
          <option value="">Todos os fornecedores</option>
          {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
        <input className="busca" placeholder="Buscar por número, produto ou observação..." value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0) }} />
        <label className="opcao-checa est-exibir-vendas" title="Mostrar venda e devoluções realizadas no PDV">
          <input type="checkbox" checked={exibirVendas} onChange={(e) => { setExibirVendas(e.target.checked); setPagina(0) }} />
          <span>Exibir vendas e devoluções</span>
        </label>
        <div className="est-toolbar-acoes">
          <button className="btn-primario est-btn-azul" onClick={() => setMenuTipo(menuTipo === 'entrada' ? null : 'entrada')} title="Nova entrada">+ Entrada</button>
          <button className="btn-primario est-btn-azul" onClick={() => setMenuTipo(menuTipo === 'saida' ? null : 'saida')} title="Nova saída">− Saída</button>
        </div>
      </div>

      {menuTipo && (
        <div className="est-mov-menu-wrap">
          <div className="est-mov-menu">
            <div className="est-mov-menu-titulo">{menuTipo === 'entrada' ? 'Entrada de estoque' : 'Saída de estoque'}</div>
            {TIPOS_POR_DIRECAO[menuTipo].map((t) => (
              <button key={t.id} className="est-mov-menu-item" onClick={() => { setMenuTipo(null); onNova(menuTipo, t.id) }}>
                {menuTipo === 'entrada' ? '▲' : '▼'} {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {produtoFiltro != null && (
        <div className="est-filtro-produto">
          Filtrando por produto — <button className="btn-mini" onClick={onLimparFiltro}>limpar filtro</button>
        </div>
      )}

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {carregando && grupos.length === 0 ? (
        <p className="sem-resultado">Carregando movimentações...</p>
      ) : grupos.length === 0 ? (
        <p className="sem-resultado">Nenhuma movimentação encontrada.</p>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Abrir (F2)</th>
                <th>Tipo</th>
                <th>Número</th>
                <th>Data/Hora</th>
                <th className="th-direita">Total Final</th>
                <th className="th-centro">Itens</th>
                <th>Cliente / Fornecedor</th>
                <th>Observações</th>
                <th>Funcionário</th>
                <th className="th-centro">Status</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const ehEntrada = g.tipo === 'entrada'
                const ehSaida = g.tipo === 'saida'
                const cancelada = g.canceladas > 0
                return (
                  <tr
                    key={g.chave}
                    className={`${cancelada ? 'linha-cancelada' : ''} ${selecionado === g.chave ? 'linha-selecionada' : ''}`}
                    onClick={() => setSelecionado(g.chave)}
                  >
                    <td className="td-centro">
                      <button className="btn-mini btn-primario" title="Abrir detalhes (F2)" onClick={(e) => { e.stopPropagation(); abrirDetalhe(g) }}>Abrir</button>
                    </td>
                    <td>
                      <span className={`est-tipo ${ehEntrada ? 'entrada' : ehSaida ? 'saida' : ''}`}>
                        {ehEntrada ? '▲' : ehSaida ? '▼' : ''} {label(g)}
                      </span>
                    </td>
                    <td>{g.documento || (g.venda_id ? `Venda #${g.venda_id}` : g.chave)}</td>
                    <td>{fmtDataHora(g.criado_em)}</td>
                    <td className="td-direita">R$ {fmtNum(g.valor_total)}</td>
                    <td className="td-centro">{g.qtd_itens} ({g.quantidade_total})</td>
                    <td>{g.fornecedor_nome || g.cliente_nome || '—'}</td>
                    <td className="est-observer">{g.motivo || (g.origem || g.destino || '—')}</td>
                    <td>{g.usuario_nome || '—'}</td>
                    <td className="td-centro">{cancelada ? <span className="rp-status erro">Cancelada</span> : <span className="rp-status ok">OK</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > POR_PAGINA && (
        <div className="est-paginacao">
          <button className="btn-mini" disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(p - 1, 0))}>← Anterior</button>
          <span>Página {pagina + 1} de {totalPaginas} ({total} movimentações)</span>
          <button className="btn-mini" disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)}>Próxima →</button>
        </div>
      )}

      {detalhe && (
        <div className="modal-overlay" onClick={() => setDetalhe(null)}>
          <div className="modal modal-estoque" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Detalhes da movimentação</h3>
              <button className="modal-fechar" onClick={() => setDetalhe(null)} aria-label="Fechar">✕</button>
            </div>
            {detalheMeta && (
              <div className="est-detalhe-meta">
                <div className="linha"><span>Tipo</span><strong>{label(detalheMeta)}</strong></div>
                <div className="linha"><span>Data/hora</span><strong>{fmtDataHora(detalheMeta.criado_em)}</strong></div>
                <div className="linha"><span>Documento</span><strong>{detalheMeta.documento || (detalheMeta.venda_id ? `Venda #${detalheMeta.venda_id}` : detalheMeta.chave)}</strong></div>
                {detalheMeta.compra_id != null && <div className="linha"><span>Compra</span><strong>#{detalheMeta.compra_id}{compraCancelada ? ' — estornada' : ''}</strong></div>}
                {detalheMeta.usuario_nome && <div className="linha"><span>Funcionário</span><strong>{detalheMeta.usuario_nome}</strong></div>}
                {detalheMeta.fornecedor_nome && <div className="linha"><span>Fornecedor</span><strong>{detalheMeta.fornecedor_nome}</strong></div>}
                {detalheMeta.cliente_nome && <div className="linha"><span>Cliente</span><strong>{detalheMeta.cliente_nome}</strong></div>}
                {detalheMeta.origem && <div className="linha"><span>Origem</span><strong>{detalheMeta.origem}</strong></div>}
                {detalheMeta.destino && <div className="linha"><span>Destino</span><strong>{detalheMeta.destino}</strong></div>}
                {detalheMeta.motivo && <div className="linha"><span>Observação</span><strong>{detalheMeta.motivo}</strong></div>}
                <div className="linha"><span>Total Final</span><strong>R$ {fmtNum(detalheMeta.valor_total)}</strong></div>
              </div>
            )}
            <div className="tabela-wrap" style={{ maxHeight: 300 }}>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="th-centro">Qtd</th>
                    <th className="th-centro">Est. ant.</th>
                    <th className="th-centro">Est. post.</th>
                    <th className="th-direita">Valor</th>
                    <th className="th-centro">Lote</th>
                    <th className="th-centro">Validade</th>
                  </tr>
                </thead>
                <tbody>
                  {detalheItens.map((i) => (
                    <tr key={i.id}>
                      <td>{i.produto_nome}</td>
                      <td className="td-centro">{i.quantidade}</td>
                      <td className="td-centro">{i.estoque_anterior != null ? i.estoque_anterior : '—'}</td>
                      <td className="td-centro">{i.estoque_posterior != null ? i.estoque_posterior : '—'}</td>
                      <td className="td-direita">R$ {fmtNum(i.valor)}</td>
                      <td className="td-centro">{i.lote || '—'}</td>
                      <td className="td-centro">{i.data_validade || '—'}</td>
                    </tr>
                  ))}
                  {detalheItens.length === 0 && <tr><td colSpan={7} className="sem-resultado">Carregando...</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="modal-acoes">
              {detalheMeta?.categoria === 'compra' && detalheMeta.compra_id != null && (
                <button
                  className="btn-secundario"
                  disabled={estornando || compraCancelada}
                  onClick={() => estornarCompra(detalheMeta.compra_id!)}
                  title={compraCancelada ? 'Compra já estornada' : 'Reverter a entrada de estoque desta compra'}
                >
                  {compraCancelada ? 'Compra estornada' : estornando ? 'Estornando...' : 'Estornar compra'}
                </button>
              )}
              <button className="btn-secundario" onClick={() => setDetalhe(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
