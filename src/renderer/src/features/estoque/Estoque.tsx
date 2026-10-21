import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { getDbApi, getImagemApi, dataUrlImagem } from '../../shared/db'
import Movimentacoes, { MovimentoModal } from './Movimentacoes'
import CompraModal from './Compra'
import Validade from './Validade'
import Inventario from './Inventario'
import { TIPOS_POR_DIRECAO, labelCategoria } from './tipos'

interface ProdutoEstoque {
  id: number
  nome: string
  codigo_barras: string | null
  codigo_interno: string | null
  categoria_nome: string | null
  categoria_id: number | null
  preco_custo: number
  preco_venda: number
  estoque: number
  estoque_minimo: number
  unidade: string
  ativo: number
  controla_estoque: number
  lote: string | null
  data_validade: string | null
  data_fabricacao: string | null
  pedidos: number
}

interface FichaMov {
  id: number
  tipo: string
  categoria: string | null
  quantidade: number
  valor: number
  motivo: string | null
  documento: string | null
  origem: string | null
  destino: string | null
  estoque_anterior: number | null
  estoque_posterior: number | null
  criado_em: string
  usuario_nome: string | null
}

interface FichaResumo {
  entradas: number
  saidas: number
  saldo: number
  custo_medio: number
}

type AbaEstoque = 'produtos' | 'transacoes' | 'validade' | 'inventario'

type Situacao = 'todos' | 'ativos' | 'com_estoque' | 'sem_estoque' | 'baixo' | 'negativo'
type Ordenacao = 'nome' | 'estoque_asc' | 'estoque_desc' | 'custo' | 'venda'

const SITUACOES: { id: Situacao; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'ativos', label: 'Ativos' },
  { id: 'com_estoque', label: 'Com estoque' },
  { id: 'sem_estoque', label: 'Sem estoque' },
  { id: 'baixo', label: 'Estoque baixo' },
  { id: 'negativo', label: 'Estoque negativo' }
]

const ORDENS: { id: Ordenacao; label: string }[] = [
  { id: 'nome', label: 'Nome' },
  { id: 'estoque_asc', label: 'Estoque (menor→maior)' },
  { id: 'estoque_desc', label: 'Estoque (maior→menor)' },
  { id: 'custo', label: 'Custo total' },
  { id: 'venda', label: 'Valor de venda' }
]

const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Estoque({
  usuarioId,
  onAbrirProduto
}: {
  usuarioId: number
  onAbrirProduto?: (id: number) => void
}) {
  const [aba, setAba] = useState<AbaEstoque>('produtos')
  const [produtos, setProdutos] = useState<ProdutoEstoque[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [tamanhoPagina, setTamanhoPagina] = useState(50)
  const [busca, setBusca] = useState('')
  const [categoriaSel, setCategoriaSel] = useState('')
  const [categorias, setCategorias] = useState<{ id: number; nome: string }[]>([])
  const [situacao, setSituacao] = useState<Situacao>('todos')
  const [ordem, setOrdem] = useState<Ordenacao>('nome')
  const [carregando, setCarregando] = useState(true)
  const [imagens, setImagens] = useState<Record<number, string>>({})
  const [mensagem, setMensagem] = useState('')

  const [modalMov, setModalMov] = useState<{ tipo: 'entrada' | 'saida'; produtoId?: number; categoria?: string } | null>(null)
  const [menuMov, setMenuMov] = useState<{ tipo: 'entrada' | 'saida'; produtoId?: number } | null>(null)
  const [compraAberta, setCompraAberta] = useState(false)
  const [produtoMovFiltro, setProdutoMovFiltro] = useState<number | null>(null)

  const [mostrarFinanceiro, setMostrarFinanceiro] = useState(true)
  const [expansos, setExpansos] = useState<Record<number, boolean>>({})

  const [ficha, setFicha] = useState<ProdutoEstoque | null>(null)
  const [fichaMovs, setFichaMovs] = useState<FichaMov[]>([])
  const [fichaResumo, setFichaResumo] = useState<FichaResumo>({ entradas: 0, saidas: 0, saldo: 0, custo_medio: 0 })
  const [fichaCarregando, setFichaCarregando] = useState(false)

  const [editandoEstoque, setEditandoEstoque] = useState<{ id: number; valor: string } | null>(null)
  const tabelaRef = useRef<HTMLDivElement>(null)

  const [selecionadoId, setSelecionadoId] = useState<number | null>(null)
  const abrirFichaSelecionada = () => {
    const alvo = produtos.find((p) => p.id === selecionadoId) ?? produtos[0]
    if (alvo) abrirFicha(alvo)
  }

  useEffect(() => {
    document.title = 'Estoque'
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); abrirFichaSelecionada() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, selecionadoId])

  useEffect(() => {
    getDbApi().all('SELECT id, nome FROM categorias ORDER BY nome').then((rows) => {
      setCategorias(rows as unknown as { id: number; nome: string }[])
    }).catch(() => {})
  }, [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    const conds: string[] = []
    const params: unknown[] = []
    const termo = busca.trim()
    if (termo) {
      conds.push(`(p.nome LIKE ? OR p.codigo_barras LIKE ? OR p.codigo_interno LIKE ?)`)
      const like = `%${termo}%`
      params.push(like, like, like)
    }
    if (categoriaSel) { conds.push(`p.categoria_id = ?`); params.push(Number(categoriaSel)) }
    if (situacao === 'ativos') conds.push(`p.ativo = 1`)
    if (situacao === 'com_estoque') conds.push(`p.estoque > 0`)
    if (situacao === 'sem_estoque') conds.push(`p.estoque <= 0`)
    if (situacao === 'baixo') conds.push(`p.controla_estoque = 1 AND p.estoque <= p.estoque_minimo AND p.estoque > 0`)
    if (situacao === 'negativo') conds.push(`p.estoque < 0`)
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    let orderBy = 'p.nome ASC'
    if (ordem === 'estoque_asc') orderBy = 'p.estoque ASC'
    if (ordem === 'estoque_desc') orderBy = 'p.estoque DESC'
    if (ordem === 'custo') orderBy = '(p.estoque * p.preco_custo) DESC'
    if (ordem === 'venda') orderBy = '(p.estoque * p.preco_venda) DESC'
    const sql = `
      SELECT p.id, p.nome, p.codigo_barras, p.codigo_interno, p.preco_custo, p.preco_venda, p.estoque,
             p.estoque_minimo, p.unidade, p.ativo, p.controla_estoque, p.lote, p.data_validade, p.data_fabricacao,
             p.categoria_id, c.nome AS categoria_nome,
             (SELECT COALESCE(SUM(pi.quantidade), 0) FROM pedido_itens pi
              JOIN pedidos p2 ON p2.id = pi.pedido_id
              WHERE pi.produto_id = p.id AND p2.status NOT IN ('entregue', 'cancelado')) AS pedidos
      FROM produtos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `
    const sqlCount = `
      SELECT COUNT(*) AS c FROM produtos p ${where}
    `
    try {
      const db = getDbApi()
      const contagem = (await db.get(sqlCount, params)) as { c: number }
      setTotal(contagem.c)
      const rows = (await db.all(sql, [...params, tamanhoPagina, pagina * tamanhoPagina])) as unknown as ProdutoEstoque[]
      setProdutos(rows)
      const ids = rows.map((r) => r.id)
      if (ids.length > 0) {
        const imgs = (await getImagemApi().listPorIds(ids).catch(() => ({}))) as Record<number, string>
        setImagens(imgs)
      } else {
        setImagens({})
      }
    } catch {
      setProdutos([])
      setTotal(0)
    } finally {
      setCarregando(false)
    }
  }, [busca, categoriaSel, situacao, ordem, tamanhoPagina, pagina])

  useEffect(() => { carregar() }, [carregar])

  const totalPaginas = Math.max(Math.ceil(total / tamanhoPagina), 1)

  const resumo = produtos.reduce(
    (acc, p) => {
      acc.qtd += p.estoque
      acc.custo += p.estoque * p.preco_custo
      acc.venda += p.estoque * p.preco_venda
      return acc
    },
    { qtd: 0, custo: 0, venda: 0 }
  )

  const baixo = (p: ProdutoEstoque) => p.controla_estoque === 1 && p.estoque <= p.estoque_minimo

  const toggleExpansao = (id: number) => {
    setExpansos((prev) => {
      const novo = { ...prev, [id]: !prev[id] }
      return novo
    })
  }

  const salvarEstoqueInline = async (p: ProdutoEstoque, novo: number | null) => {
    setEditandoEstoque(null)
    if (novo == null || novo === p.estoque) return
    try {
      await getDbApi().run(
        `UPDATE produtos SET estoque = ? WHERE id = ?`,
        [novo, p.id]
      )
      setProdutos((prev) => prev.map((x) => x.id === p.id ? { ...x, estoque: novo } : x))
      setMensagem(`Estoque de ${p.nome} ajustado para ${novo} ${p.unidade}.`)
    } catch (e) {
      setMensagem(`Erro ao ajustar estoque: ${(e as Error).message}`)
    }
  }

  const fmtDataHora = (dt: string) => {
    const d = new Date(dt)
    if (isNaN(d.getTime())) return dt
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const statusVal = (d: string | null) => {
    if (!d) return { cls: 'sem-validade', label: 'Sem validade' }
    const venc = new Date(d + 'T00:00:00').getTime()
    if (isNaN(venc)) return { cls: 'sem-validade', label: 'Inválida' }
    const dias = Math.ceil((venc - Date.now()) / 86400000)
    if (dias < 0) return { cls: 'vencido', label: `Vencido há ${Math.abs(dias)}d` }
    if (dias <= 7) return { cls: 'proximo', label: `${dias}d` }
    if (dias <= 30) return { cls: 'atencao', label: `${dias}d` }
    return { cls: 'ok', label: `${dias}d` }
  }

  const abrirFicha = async (p: ProdutoEstoque) => {
    setFicha(p)
    setFichaMovs([])
    setFichaResumo({ entradas: 0, saidas: 0, saldo: 0, custo_medio: 0 })
    setFichaCarregando(true)
    try {
      const db = getDbApi()
      const rows = (await db.all(
        `SELECT m.id, m.tipo, m.categoria, m.quantidade, m.valor, m.motivo, m.documento, m.origem, m.destino, m.estoque_anterior, m.estoque_posterior, m.criado_em, u.nome AS usuario_nome
         FROM movimentacoes m LEFT JOIN usuarios u ON u.id = m.usuario_id
         WHERE m.produto_id = ? ORDER BY m.id DESC LIMIT 200`,
        [p.id]
      )) as unknown as FichaMov[]
      setFichaMovs(rows)
      const r = (await db.get(
        `SELECT
           COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.quantidade ELSE 0 END), 0) AS entradas,
           COALESCE(SUM(CASE WHEN m.tipo = 'saida' THEN m.quantidade ELSE 0 END), 0) AS saidas,
           COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.quantidade ELSE -m.quantidade END), 0) AS saldo,
           COALESCE(AVG(CASE WHEN m.tipo = 'entrada' AND m.valor > 0 THEN m.valor / NULLIF(m.quantidade, 0) END), 0) AS custo_medio
         FROM movimentacoes m WHERE m.produto_id = ?`,
        [p.id]
      )) as unknown as FichaResumo
      setFichaResumo({ ...r, entradas: Number(r.entradas), saidas: Number(r.saidas), saldo: Number(r.saldo), custo_medio: Number(r.custo_medio) })
    } catch {
      setFichaMovs([])
    } finally {
      setFichaCarregando(false)
    }
  }

  const selecionarLinha = (id: number) => setSelecionadoId(id)

  return (
    <div className="page">
      <div className="page-header">
        <h2>Estoque</h2>
        <div className="page-acoes" />
      </div>

      <div className="est-abas">
        {(['produtos', 'transacoes', 'validade', 'inventario'] as AbaEstoque[]).map((a) => (
          <button
            key={a}
            className={`aba-estoque ${aba === a ? 'ativa' : ''}`}
            onClick={() => setAba(a)}
          >
            {a === 'produtos' ? 'Estoque por Produto' : a === 'transacoes' ? 'Transações' : a === 'validade' ? 'Controle de Validade' : 'Inventário'}
          </button>
        ))}
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {aba === 'produtos' && (
        <div className="est-abas-conteudo">
          <div className="est-toolbar">
            <input
              className="busca"
              placeholder="Pesquisar por nome, código ou código interno..."
              value={busca}
              onChange={(e) => { setBusca(e.target.value); setPagina(0) }}
            />
            <select value={categoriaSel} onChange={(e) => { setCategoriaSel(e.target.value); setPagina(0) }}>
              <option value="">Todas as categorias</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <select value={situacao} onChange={(e) => { setSituacao(e.target.value as Situacao); setPagina(0) }}>
              {SITUACOES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={ordem} onChange={(e) => { setOrdem(e.target.value as Ordenacao); setPagina(0) }}>
              {ORDENS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <select value={tamanhoPagina} onChange={(e) => { setTamanhoPagina(Number(e.target.value)); setPagina(0) }}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>

          {menuMov && (
            <div className="est-mov-menu-wrap">
              <div className="est-mov-menu">
                <div className="est-mov-menu-titulo">
                  {menuMov.tipo === 'entrada' ? 'Entrada de estoque' : 'Saída de estoque'}
                  <button className="est-mov-menu-fechar" onClick={() => setMenuMov(null)} aria-label="Fechar">✕</button>
                </div>
                {TIPOS_POR_DIRECAO[menuMov.tipo].map((t) => (
                  <button
                    key={t.id}
                    className="est-mov-menu-item"
                    onClick={() => {
                      const { tipo, produtoId } = menuMov
                      setMenuMov(null)
                      if (tipo === 'entrada' && t.id === 'compra') setCompraAberta(true)
                      else setModalMov({ tipo, categoria: t.id, produtoId })
                    }}
                  >
                    {menuMov.tipo === 'entrada' ? '▲' : '▼'} {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="est-resumo">
            <div className="est-resumo-item">
              <span>Produtos exibidos</span>
              <strong>{total}</strong>
            </div>
            <div className="est-resumo-item">
              <span>Unidades em estoque</span>
              <strong>{resumo.qtd.toLocaleString('pt-BR')}</strong>
            </div>
            <div className="est-resumo-item">
              <span>Custo total do estoque</span>
              <strong>R$ {fmt(resumo.custo)}</strong>
            </div>
            <div className="est-resumo-item">
              <span>Valor de venda do estoque</span>
              <strong>R$ {fmt(resumo.venda)}</strong>
            </div>
          </div>

          {carregando && produtos.length === 0 ? (
            <p className="sem-resultado">Carregando produtos...</p>
          ) : produtos.length === 0 ? (
            <p className="sem-resultado">Nenhum produto encontrado com os filtros atuais.</p>
          ) : (
            <div className="tabela-wrap" style={{ maxHeight: 'calc(100vh - 380px)' }} ref={tabelaRef}>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Ação / Abrir (F2)</th>
                    <th className="th-centro">Imagem</th>
                    <th>Produto</th>
                    <th className="th-centro">Estoque atual</th>
                    <th className="th-centro">Pedidos</th>
                    <th className="th-centro">Disponível</th>
                    {mostrarFinanceiro && <th className="th-direita">Custo unit.</th>}
                    {mostrarFinanceiro && <th className="th-direita">Custo total</th>}
                    {mostrarFinanceiro && <th className="th-direita">Venda total</th>}
                    <th className="th-centro">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {produtos.map((p) => {
                    const disponivel = p.estoque - p.pedidos
                    const repor = baixo(p)
                    const estaEditando = editandoEstoque?.id === p.id
                    return (
                      <Fragment key={p.id}>
                        <tr
                          className={`${!p.ativo ? 'linha-cancelada' : ''} ${selecionadoId === p.id ? 'linha-selecionada' : ''}`}
                          onClick={() => selecionarLinha(p.id)}
                        >
                          <td>
                            <div className="est-acoes">
                              <button className="btn-mini btn-primario" title="Abrir ficha / histórico (F2)" onClick={(e) => { e.stopPropagation(); abrirFicha(p) }}>Abrir</button>
                              <button className="btn-mini" title="Editar produto" onClick={(e) => { e.stopPropagation(); onAbrirProduto?.(p.id) }}>Editar</button>
                              <button className="btn-mini" title="Expandir detalhes" onClick={(e) => { e.stopPropagation(); toggleExpansao(p.id) }}>{expansos[p.id] ? '▲' : '▼'}</button>
                              <button className="btn-mini" title="Entrada deste produto" onClick={(e) => { e.stopPropagation(); setMenuMov({ tipo: 'entrada', produtoId: p.id }) }}>Ajustar</button>
                            </div>
                          </td>
                          <td className="td-centro">
                            {imagens[p.id] ? (
                              <img className="est-imagem" src={dataUrlImagem(imagens[p.id])} alt={p.nome} />
                            ) : (
                              <span className="est-imagem est-imagem-placeholder" title="Sem imagem">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <rect x="3" y="3" width="18" height="18" rx="2" />
                                  <circle cx="8.5" cy="8.5" r="1.5" />
                                  <path d="M21 15l-5-5L5 21" />
                                </svg>
                              </span>
                            )}
                          </td>
                          <td>
                            <strong>{p.nome}</strong>
                            <div className="est-sub">
                              <span>R$ {fmt(p.preco_venda)}</span>
                              {[p.codigo_barras, p.codigo_interno].filter(Boolean).join(' · ') && <span> · {[p.codigo_barras, p.codigo_interno].filter(Boolean).join(' · ')}</span>}
                              {p.categoria_nome ? <span> · {p.categoria_nome}</span> : null}
                            </div>
                          </td>
                          <td className={`td-centro ${p.estoque < 0 ? 'est-neg' : ''}`}>
                            {estaEditando ? (
                              <input
                                type="number"
                                step="0.01"
                                autoFocus
                                style={{ width: 90 }}
                                value={editandoEstoque.valor}
                                onChange={(e) => setEditandoEstoque({ id: p.id, valor: e.target.value })}
                                onBlur={() => salvarEstoqueInline(p, editandoEstoque.valor === '' ? null : Number(editandoEstoque.valor))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                  if (e.key === 'Escape') setEditandoEstoque(null)
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <input
                                className="est-estoque-inline"
                                title="Clique para editar o estoque"
                                style={{ width: 90 }}
                                value={p.estoque}
                                onClick={(e) => { e.stopPropagation(); setEditandoEstoque({ id: p.id, valor: String(p.estoque) }) }}
                                readOnly
                              />
                            )}
                            <span className="est-sub">{p.unidade}</span>
                          </td>
                          <td className="td-centro">{p.pedidos > 0 ? p.pedidos : '—'}</td>
                          <td className={`td-centro ${disponivel <= 0 ? 'est-neg' : ''}`}>
                            <strong>{disponivel} {p.unidade}</strong>
                          </td>
                          {mostrarFinanceiro && <td className="td-direita">R$ {fmt(p.preco_custo)}</td>}
                          {mostrarFinanceiro && <td className="td-direita">R$ {fmt(p.estoque * p.preco_custo)}</td>}
                          {mostrarFinanceiro && <td className="td-direita">R$ {fmt(p.estoque * p.preco_venda)}</td>}
                          <td className="td-centro">
                            {!p.ativo ? (
                              <span className="est-val-status vencido">Inativo</span>
                            ) : p.estoque < 0 ? (
                              <span className="est-val-status vencido">Negativo</span>
                            ) : repor ? (
                              <span className="est-val-status proximo">Repor</span>
                            ) : (
                              <span className="est-val-status ok">OK</span>
                            )}
                          </td>
                        </tr>
                        {expansos[p.id] && (
                          <tr className="linha-expansao">
                            <td colSpan={mostrarFinanceiro ? 9 : 6}>
                              <div className="est-expandido">
                                <div className="est-expandido-info">
                                  <div className="linha"><span>Estoque mínimo</span><strong>{p.estoque_minimo} {p.unidade}</strong></div>
                                  <div className="linha"><span>Controla estoque</span><strong>{p.controla_estoque === 1 ? 'Sim' : 'Não'}</strong></div>
                                  <div className="linha"><span>Categoria</span><strong>{p.categoria_nome || '—'}</strong></div>
                                  <div className="linha"><span>Lote</span><strong>{p.lote || '—'}</strong></div>
                                </div>
                                <div className="est-expandido-info">
                                  <div className="linha"><span>Fabricado em</span><strong>{p.data_fabricacao || '—'}</strong></div>
                                  <div className="linha"><span>Validade</span><strong>{p.data_validade || '—'}</strong></div>
                                  <div className="linha"><span>Situação validade</span><strong><span className={`est-val-status ${statusVal(p.data_validade).cls}`}>{statusVal(p.data_validade).label}</span></strong></div>
                                  <div className="linha"><span>Pendente (pedidos)</span><strong>{p.pedidos}</strong></div>
                                </div>
                                <button className="btn-mini" onClick={() => abrirFicha(p)}>Abrir histórico (F2)</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="est-rodape-total">
                    <td colSpan={3}>Totais ({produtos.length} produtos)</td>
                    <td className="td-centro"><strong>{resumo.qtd}</strong></td>
                    <td className="td-centro"><strong>{produtos.reduce((s, p) => s + p.pedidos, 0)}</strong></td>
                    <td className="td-centro"><strong>{produtos.reduce((s, p) => s + (p.estoque - p.pedidos), 0)}</strong></td>
                    {mostrarFinanceiro && <td className="td-direita">—</td>}
                    {mostrarFinanceiro && <td className="td-direita"><strong>R$ {fmt(resumo.custo)}</strong></td>}
                    {mostrarFinanceiro && <td className="td-direita"><strong>R$ {fmt(resumo.venda)}</strong></td>}
                    <td className="td-centro">—</td>
                  </tr>
                </tfoot>
              </table>
              <div className="est-rodape-dica">Dica: selecione uma linha e pressione <b>F2</b> para abrir a ficha do produto.</div>
            </div>
          )}

          {total > tamanhoPagina && (
            <div className="est-paginacao">
              <button className="btn-mini" disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(p - 1, 0))}>← Anterior</button>
              <span>Página {pagina + 1} de {totalPaginas} ({total} produtos)</span>
              <button className="btn-mini" disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)}>Próxima →</button>
            </div>
          )}
        </div>
      )}

      {aba === 'transacoes' && (
        <Movimentacoes
          usuarioId={usuarioId}
          produtoFiltro={produtoMovFiltro}
          onLimparFiltro={() => setProdutoMovFiltro(null)}
          onNova={(tipo, categoria) => {
            if (tipo === 'entrada' && categoria === 'compra') setCompraAberta(true)
            else setModalMov({ tipo, categoria })
          }}
        />
      )}

      {aba === 'validade' && <Validade onAbrirProduto={onAbrirProduto} />}

      {aba === 'inventario' && <Inventario usuarioId={usuarioId} />}

      {modalMov && (
        <MovimentoModal
          usuarioId={usuarioId}
          tipoInicial={modalMov.tipo}
          categoriaInicial={modalMov.categoria}
          produtoInicialId={modalMov.produtoId}
          onFechar={() => setModalMov(null)}
          onConcluido={(msg) => { setMensagem(msg); setProdutoMovFiltro(null); carregar() }}
        />
      )}

      {compraAberta && (
        <CompraModal
          usuarioId={usuarioId}
          onFechar={() => setCompraAberta(false)}
          onConcluido={(msg) => { setMensagem(msg); setProdutoMovFiltro(null); carregar() }}
        />
      )}

      {ficha && (
        <div className="modal-overlay" onClick={() => setFicha(null)}>
          <div className="modal modal-tela-cheia modal-estoque" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Ficha do produto — {ficha.nome}</h3>
              <button className="modal-fechar" onClick={() => setFicha(null)} aria-label="Fechar">✕</button>
            </div>
            <div className="modal-corpo">
              <div className="est-ficha-cabecalho">
                <div className="est-ficha-imagem">
                  {imagens[ficha.id] ? (
                    <img src={dataUrlImagem(imagens[ficha.id])} alt={ficha.nome} />
                  ) : (
                    <span className="est-imagem est-imagem-placeholder">
                      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    </span>
                  )}
                </div>
                <div className="est-ficha-dados">
                  <div className="linha"><span>Código</span><strong>{[ficha.codigo_barras, ficha.codigo_interno].filter(Boolean).join(' · ') || '—'}</strong></div>
                  <div className="linha"><span>Categoria</span><strong>{ficha.categoria_nome || '—'}</strong></div>
                  <div className="linha"><span>Estoque atual</span><strong className={ficha.estoque < 0 ? 'est-neg' : ''}>{ficha.estoque} {ficha.unidade}</strong></div>
                  <div className="linha"><span>Disponível</span><strong className={ficha.estoque - ficha.pedidos <= 0 ? 'est-neg' : ''}>{ficha.estoque - ficha.pedidos} {ficha.unidade}</strong></div>
                  <div className="linha"><span>Preço de venda</span><strong>R$ {fmt(ficha.preco_venda)}</strong></div>
                  <div className="linha"><span>Preço de custo</span><strong>R$ {fmt(ficha.preco_custo)}</strong></div>
                  <div className="linha"><span>Validade</span><strong>{ficha.data_validade || '—'} ({statusVal(ficha.data_validade).label})</strong></div>
                </div>
                <div className="est-ficha-resumo">
                  <div className="est-resumo-item"><span>Entradas</span><strong className="est-pos">{fichaResumo.entradas}</strong></div>
                  <div className="est-resumo-item"><span>Saídas</span><strong className="est-neg">{fichaResumo.saidas}</strong></div>
                  <div className="est-resumo-item"><span>Saldo (mov.)</span><strong>{fichaResumo.saldo}</strong></div>
                  <div className="est-resumo-item"><span>Custo médio</span><strong>R$ {fmt(fichaResumo.custo_medio)}</strong></div>
                </div>
              </div>

              {fichaCarregando ? (
                <p className="sem-resultado">Carregando movimentações...</p>
              ) : fichaMovs.length === 0 ? (
                <p className="sem-resultado">Nenhuma movimentação registrada para este produto.</p>
              ) : (
                <div className="tabela-wrap" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Data/Hora</th>
                        <th>Tipo</th>
                        <th className="th-centro">Qtd</th>
                        <th className="th-centro">Est. ant.</th>
                        <th className="th-centro">Est. post.</th>
                        <th className="th-direita">Valor</th>
                        <th>Documento</th>
                        <th>Funcionário</th>
                        <th>Observação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fichaMovs.map((m) => {
                        const ehEntrada = m.tipo === 'entrada'
                        const ehSaida = m.tipo === 'saida'
                        return (
                          <tr key={m.id}>
                            <td>{fmtDataHora(m.criado_em)}</td>
                            <td>
                              <span className={`est-tipo ${ehEntrada ? 'entrada' : ehSaida ? 'saida' : ''}`}>
                                {ehEntrada ? '▲' : ehSaida ? '▼' : ''} {m.categoria ? labelCategoria(m.categoria) : m.tipo}
                              </span>
                            </td>
                            <td className={`td-centro ${ehEntrada ? 'est-pos' : ehSaida ? 'est-neg' : ''}`}>
                              {ehEntrada ? '+' : ehSaida ? '-' : ''}{m.quantidade}
                            </td>
                            <td className="td-centro">{m.estoque_anterior != null ? m.estoque_anterior : '—'}</td>
                            <td className="td-centro">{m.estoque_posterior != null ? m.estoque_posterior : '—'}</td>
                            <td className="td-direita">R$ {fmt(m.valor)}</td>
                            <td>{m.documento || '—'}</td>
                            <td>{m.usuario_nome || '—'}</td>
                            <td>{m.motivo || (m.origem || m.destino || '—')}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-rodape">
              <div className="modal-acoes-direita">
                <button className="btn-secundario" onClick={() => { setProdutoMovFiltro(ficha.id); setFicha(null); setAba('transacoes') }}>Ver em Transações</button>
                <button className="btn-secundario" onClick={() => { setMenuMov({ tipo: 'entrada', produtoId: ficha.id }); setFicha(null) }}>+ Entrada</button>
                <button className="btn-primario" onClick={() => setFicha(null)}>Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}