import { useEffect, useState, useCallback } from 'react'
import { getDbApi } from '../../shared/db'

type Periodo = 'hoje' | 'ontem' | '7d' | '15d' | 'mes' | 'mes_anterior' | 'personalizado'

const PERIODOS: { chave: Periodo; rotulo: string }[] = [
  { chave: 'hoje', rotulo: 'Hoje' },
  { chave: 'ontem', rotulo: 'Ontem' },
  { chave: '7d', rotulo: 'Últimos 7 dias' },
  { chave: '15d', rotulo: 'Últimos 15 dias' },
  { chave: 'mes', rotulo: 'Este mês' },
  { chave: 'mes_anterior', rotulo: 'Mês anterior' },
  { chave: 'personalizado', rotulo: 'Período personalizado' }
]

interface LinhaFornecedor {
  fornecedor_id: number | null
  fornecedor: string
  produtos: number
  qtd: number
  custo: number
  reposicao: number
  jaSeparado: number
  falta: number
  status: 'ok' | 'pendente'
}

interface LinhaProduto {
  produto: string
  fornecedor_id: number | null
  fornecedor: string | null
  categoria: string | null
  qtd: number
  preco_venda: number
  faturamento: number
  custo_unitario: number
  custo_total: number
  margem_unit: number
  margem_total: number
  reposicao: number
  estoque_atual: number
  estoque_minimo: number
}

export default function Distribuicao({ usuarioId }: { usuarioId?: number }) {
  const [periodo, setPeriodo] = useState<Periodo>('7d')
  const [dataIni, setDataIni] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [filtroFornecedor, setFiltroFornecedor] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroProduto, setFiltroProduto] = useState('')
  const [filtroForma, setFiltroForma] = useState('')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('concluida')
  const [filtrosAplicados, setFiltrosAplicados] = useState(false)
  const [periodoAberto, setPeriodoAberto] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [fornecedores, setFornecedores] = useState<LinhaFornecedor[]>([])
  const [produtos, setProdutos] = useState<LinhaProduto[]>([])
  const [resumo, setResumo] = useState({ faturamento: 0, custo: 0, reposicao: 0, margem: 0, jaSeparado: 0, aSeparar: 0, disponivel: 0 })
  const [categorias, setCategorias] = useState<{ id: number; nome: string }[]>([])
  const [todasFormas, setTodasFormas] = useState<string[]>([])
  const [vendedores, setVendedores] = useState<{ id: number; nome: string }[]>([])
  const [listaFornecedores, setListaFornecedores] = useState<{ id: number; nome: string }[]>([])
  const [modalConfig, setModalConfig] = useState(false)
  const [regras, setRegras] = useState<Record<number, { tipo: string; valor: string }>>({})
  const [modalSeparar, setModalSeparar] = useState<LinhaFornecedor | null>(null)
  const [sepValor, setSepValor] = useState('')
  const [sepData, setSepData] = useState('')
  const [sepDest, setSepDest] = useState('')
  const [sepObs, setSepObs] = useState('')
  const [colunasProduto, setColunasProduto] = useState<Record<string, boolean>>(() => {
    try {
      const s = localStorage.getItem('dist_colunas_produto')
      return s ? JSON.parse(s) : {}
    } catch {
      return {}
    }
  })

  const periodoWhere = (): string => {
    const hoje = new Date()
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    switch (periodo) {
      case 'hoje': return `AND date(v.created_at) = '${fmt(hoje)}'`
      case 'ontem': {
        const d = new Date(hoje); d.setDate(d.getDate() - 1)
        return `AND date(v.created_at) = '${fmt(d)}'`
      }
      case '7d': {
        const d = new Date(hoje); d.setDate(d.getDate() - 7)
        return `AND date(v.created_at) >= '${fmt(d)}'`
      }
      case '15d': {
        const d = new Date(hoje); d.setDate(d.getDate() - 15)
        return `AND date(v.created_at) >= '${fmt(d)}'`
      }
      case 'mes': return `AND date(v.created_at) >= date('now','start of month')`
      case 'mes_anterior': return `AND date(v.created_at) >= date('now','start of month','-1 month') AND date(v.created_at) < date('now','start of month')`
      case 'personalizado':
        if (dataIni && dataFim) return `AND date(v.created_at) >= '${dataIni}' AND date(v.created_at) <= '${dataFim}'`
        return `AND 1 = 1`
    }
  }

  const filtrosExtra = (): { sql: string; params: unknown[] } => {
    const conds: string[] = []
    const params: unknown[] = []
    if (filtroFornecedor) { conds.push(`f.id = ?`); params.push(Number(filtroFornecedor)) }
    if (filtroCategoria) { conds.push(`cat.id = ?`); params.push(Number(filtroCategoria)) }
    if (filtroProduto) { conds.push(`p.nome LIKE ?`); params.push(`%${filtroProduto}%`) }
    if (filtroForma) {
      conds.push(`EXISTS (SELECT 1 FROM pagamentos pg2 WHERE pg2.venda_id = v.id AND pg2.forma = ?)`)
      params.push(filtroForma)
    }
    if (filtroVendedor) { conds.push(`v.vendedor_id = ?`); params.push(Number(filtroVendedor)) }
    if (filtroStatus === 'concluida') conds.push(`v.status = 'concluida'`)
    else if (filtroStatus === 'cancelada') conds.push(`v.status = 'cancelada'`)
    return { sql: conds.length ? ` AND ${conds.join(' AND ')}` : '', params }
  }

  const carregar = useCallback(async () => {
    const db = getDbApi()
    const where = periodoWhere()
    const fe = filtrosExtra()

    const vendas = (await db.all(
      `SELECT v.id, v.total, v.created_at FROM vendas v
       WHERE 1=1 ${where} ${fe.sql}`,
      fe.params
    )) as unknown as { id: number; total: number; created_at: string }[]
    const idsVendas = vendas.map((v) => v.id)
    const idsStr = idsVendas.length ? idsVendas.map(() => '?').join(',') : '0'

    const itens = (await db.all(
      `SELECT vi.venda_id, vi.nome_produto, vi.quantidade, vi.subtotal,
              p.id AS produto_id, p.preco_custo, p.estoque, p.estoque_minimo,
              f.id AS fornecedor_id, f.nome AS fornecedor, cat.nome AS categoria
       FROM venda_itens vi
       JOIN vendas v ON v.id = vi.venda_id
       LEFT JOIN produtos p ON p.id = vi.produto_id
       LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
       LEFT JOIN categorias cat ON cat.id = p.categoria_id
       WHERE v.id IN (${idsStr})`,
      idsVendas
    )) as unknown as { venda_id: number; nome_produto: string; quantidade: number; subtotal: number; produto_id: number | null; preco_custo: number; estoque: number; estoque_minimo: number; fornecedor_id: number | null; fornecedor: string | null; categoria: string | null }[]

    const sepRows = (await db.all(
      `SELECT s.fornecedor_id, COALESCE(SUM(s.valor),0) AS total FROM separacoes_dinheiro s GROUP BY s.fornecedor_id`
    )) as unknown as { fornecedor_id: number | null; total: number }[]
    const separadoMap = new Map(sepRows.map((r) => [String(r.fornecedor_id ?? 'null'), r.total]))

    const faturamento = vendas.reduce((s, v) => s + v.total, 0)
    const custoTotal = itens.reduce((s, i) => s + (i.preco_custo || 0) * i.quantidade, 0)

    // por fornecedor
    const mapaFor = new Map<string, LinhaFornecedor>()
    const prodPorFor = new Map<string, Set<string>>()
    for (const i of itens) {
      const chave = String(i.fornecedor_id ?? 'null')
      const atual = mapaFor.get(chave) ?? { fornecedor_id: i.fornecedor_id, fornecedor: i.fornecedor ?? 'Sem fornecedor', produtos: 0, qtd: 0, custo: 0, reposicao: 0, jaSeparado: 0, falta: 0, status: 'pendente' as const }
      atual.qtd += i.quantidade
      atual.custo += (i.preco_custo || 0) * i.quantidade
      mapaFor.set(chave, atual)
      if (!prodPorFor.has(chave)) prodPorFor.set(chave, new Set())
      prodPorFor.get(chave)!.add(i.nome_produto)
    }
    const linhasFor: LinhaFornecedor[] = []
    for (const [chave, l] of mapaFor) {
      l.produtos = prodPorFor.get(chave)?.size ?? 0
      const regra = regras[l.fornecedor_id ?? 0]
      const pct = regra && regra.tipo === 'percent' ? (Number(regra.valor) || 100) : 100
      l.reposicao = l.custo * (pct / 100)
      l.jaSeparado = separadoMap.get(chave) ?? 0
      l.falta = Math.max(0, l.reposicao - l.jaSeparado)
      l.status = l.falta <= 0.005 ? 'ok' : 'pendente'
      linhasFor.push(l)
    }
    linhasFor.sort((a, b) => b.custo - a.custo)
    setFornecedores(linhasFor)

    // por produto
    const mapaProd = new Map<string, LinhaProduto>()
    for (const i of itens) {
      const atual = mapaProd.get(i.nome_produto) ?? {
        produto: i.nome_produto, fornecedor_id: i.fornecedor_id, fornecedor: i.fornecedor, categoria: i.categoria,
        qtd: 0, preco_venda: i.subtotal > 0 ? i.subtotal / i.quantidade : 0, faturamento: 0,
        custo_unitario: i.preco_custo || 0, custo_total: 0, margem_unit: 0, margem_total: 0,
        reposicao: 0, estoque_atual: i.estoque || 0, estoque_minimo: i.estoque_minimo || 0
      }
      atual.qtd += i.quantidade
      atual.faturamento += i.subtotal
      atual.custo_total += (i.preco_custo || 0) * i.quantidade
      if (atual.preco_venda <= 0 && i.subtotal > 0) atual.preco_venda = i.subtotal / i.quantidade
      mapaProd.set(i.nome_produto, atual)
    }
    const linhasProd: LinhaProduto[] = []
    for (const l of mapaProd.values()) {
      l.margem_unit = l.preco_venda - l.custo_unitario
      l.margem_total = l.faturamento - l.custo_total
      const regra = regras[l.fornecedor_id ?? 0]
      const pct = regra && regra.tipo === 'percent' ? (Number(regra.valor) || 100) : 100
      l.reposicao = l.custo_total * (pct / 100)
      linhasProd.push(l)
    }
    linhasProd.sort((a, b) => b.faturamento - a.faturamento)
    setProdutos(linhasProd)

    const totalReposicao = linhasFor.reduce((s, l) => s + l.reposicao, 0)
    const jaSeparadoTotal = linhasFor.reduce((s, l) => s + l.jaSeparado, 0)
    const aSeparar = linhasFor.reduce((s, l) => s + l.falta, 0)
    setResumo({
      faturamento,
      custo: custoTotal,
      reposicao: totalReposicao,
      margem: faturamento - custoTotal,
      jaSeparado: jaSeparadoTotal,
      aSeparar: aSeparar,
      disponivel: Math.max(0, faturamento - totalReposicao)
    })
  }, [periodo, dataIni, dataFim, filtroFornecedor, filtroCategoria, filtroProduto, filtroForma, filtroVendedor, filtroStatus, regras, filtrosAplicados])

  useEffect(() => {
    if (!filtrosAplicados) return
    carregar()
  }, [carregar, filtrosAplicados])

  useEffect(() => {
    getDbApi().all(`SELECT id, nome FROM categorias ORDER BY nome`).then((rows) => setCategorias(rows as unknown as { id: number; nome: string }[]))
    getDbApi().all(`SELECT DISTINCT forma FROM pagamentos ORDER BY forma`).then((rows) => setTodasFormas((rows as unknown as { forma: string }[]).map((r) => r.forma)))
    getDbApi().all(`SELECT id, nome FROM usuarios WHERE ativo = 1 ORDER BY nome`).then((rows) => setVendedores(rows as unknown as { id: number; nome: string }[]))
    getDbApi().all(`SELECT id, nome FROM fornecedores ORDER BY nome`).then((rows) => {
      const f = rows as unknown as { id: number; nome: string }[]
      setListaFornecedores(f)
      const r: Record<number, { tipo: string; valor: string }> = {}
      for (const x of f) r[x.id] = { tipo: 'percent', valor: '100' }
      setRegras(r)
    })
  }, [])

  useEffect(() => {
    const fechar = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.dist-periodo-drop')) setPeriodoAberto(false)
    }
    window.addEventListener('mousedown', fechar)
    return () => window.removeEventListener('mousedown', fechar)
  }, [])

  const aplicar = () => {
    setFiltrosAplicados(true)
    setMensagem('Filtros aplicados.')
  }

  const limpar = () => {
    setFiltroFornecedor('')
    setFiltroCategoria('')
    setFiltroProduto('')
    setFiltroForma('')
    setFiltroVendedor('')
    setFiltroStatus('concluida')
    setPeriodo('7d')
    setDataIni('')
    setDataFim('')
    setFiltrosAplicados(true)
    setMensagem('Filtros limpos.')
  }

  const salvarRegras = async () => {
    const db = getDbApi()
    for (const [idStr, regra] of Object.entries(regras)) {
      const id = Number(idStr)
      const tipo = regra.tipo === 'percent' ? 0 : 1
      await db.run(`UPDATE fornecedores SET regra_reposicao = ?, regra_reposicao_valor = ? WHERE id = ?`, [tipo, Number(regra.valor) || 0, id])
    }
    setModalConfig(false)
    setMensagem('Regras de reposição salvas.')
    carregar()
  }

  const registrarSeparacao = async () => {
    if (!modalSeparar) return
    const valor = Number(sepValor.replace(/\D/g, '')) / 100
    if (!valor || valor <= 0) {
      setMensagem('Informe um valor válido.')
      return
    }
    await getDbApi().run(
      `INSERT INTO separacoes_dinheiro (fornecedor_id, valor, data, destinacao, observacao, usuario_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [modalSeparar.fornecedor_id, valor, sepData || new Date().toISOString().slice(0, 10), sepDest || null, sepObs || null, usuarioId ?? null]
    )
    setModalSeparar(null)
    setSepValor('')
    setSepData('')
    setSepDest('')
    setSepObs('')
    setMensagem('Separação registrada.')
    carregar()
  }

  const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const colunasProdVisiveis: { chave: string; label: string }[] = [
    { chave: 'produto', label: 'Produto' },
    { chave: 'fornecedor', label: 'Fornecedor' },
    { chave: 'categoria', label: 'Categoria' },
    { chave: 'qtd', label: 'Qtd vendida' },
    { chave: 'preco_venda', label: 'Preço venda' },
    { chave: 'faturamento', label: 'Faturamento' },
    { chave: 'custo_unitario', label: 'Custo unitário' },
    { chave: 'custo_total', label: 'Custo total' },
    { chave: 'margem_unit', label: 'Margem unit.' },
    { chave: 'margem_total', label: 'Margem total' },
    { chave: 'reposicao', label: 'Reposição' },
    { chave: 'estoque_atual', label: 'Estoque atual' },
    { chave: 'estoque_minimo', label: 'Estoque mín' }
  ]

  const card = (titulo: string, valor: number, cor = '') => (
    <div className={`rp-metrica ${cor ? `dist-cor-${cor}` : ''}`}>
      <span className="rp-metrica-titulo">{titulo}</span>
      <strong>R$ {fmt(valor)}</strong>
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <h2>Distribuição do Dinheiro das Vendas</h2>
        <div className="page-acoes">
          <button className="btn-secundario" onClick={() => setModalConfig(true)}>⚙ Configurar Regras</button>
          <button className="btn-primario" onClick={aplicar}>APLICAR FILTROS</button>
          <button className="btn-secundario" onClick={limpar}>LIMPAR FILTROS</button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      <div className="filtros-vendas">
        <div className="dropdown-filtro dist-periodo-drop">
          <button className="btn-secundario dropdown-periodo-btn" onClick={() => setPeriodoAberto((v) => !v)}>
            {PERIODOS.find((p) => p.chave === periodo)?.rotulo} <span className="seta-dropdown">▼</span>
          </button>
          {periodoAberto && (
            <div className="dropdown-periodo-menu">
              {PERIODOS.map((p) => (
                <button key={p.chave} className={`dropdown-periodo-item ${periodo === p.chave ? 'ativo' : ''}`} onClick={() => { setPeriodo(p.chave); setPeriodoAberto(false) }}>
                  {p.rotulo}
                </button>
              ))}
            </div>
          )}
        </div>
        {periodo === 'personalizado' && (
          <>
            <input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </>
        )}
        <select value={filtroFornecedor} onChange={(e) => setFiltroFornecedor(e.target.value)}>
          <option value="">Todos fornecedores</option>
          {listaFornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
          <option value="">Todas categorias</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <input className="busca" value={filtroProduto} onChange={(e) => setFiltroProduto(e.target.value)} placeholder="Produto..." />
        <select value={filtroForma} onChange={(e) => setFiltroForma(e.target.value)}>
          <option value="">Todas formas</option>
          {todasFormas.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={filtroVendedor} onChange={(e) => setFiltroVendedor(e.target.value)}>
          <option value="">Todos funcionários</option>
          {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
        </select>
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="concluida">Concluídas</option>
          <option value="cancelada">Canceladas</option>
          <option value="todas">Todas</option>
        </select>
      </div>

      {filtrosAplicados && (
        <>
          <div className="rp-metricas">
            {card('FATURAMENTO', resumo.faturamento, 'azul')}
            {card('CUSTO DOS PRODUTOS', resumo.custo, 'cinza')}
            {card('VALOR PARA REPOSIÇÃO', resumo.reposicao, 'vermelho')}
            {card('MARGEM BRUTA', resumo.margem, 'verde')}
            {card('VALOR JÁ SEPARADO', resumo.jaSeparado, 'laranja')}
            {card('VALOR A SEPARAR', resumo.aSeparar, 'amarelo')}
            {card('DISPONÍVEL', resumo.disponivel, 'roxo')}
          </div>

          <div className="rp-tabela-card">
            <h4>Quanto preciso separar por fornecedor</h4>
            <table className="rp-tabela">
              <thead>
                <tr>
                  <th>Fornecedor</th><th>Produtos</th><th>Qtd.</th><th>Custo vendido</th>
                  <th>Para reposição</th><th>Já separado</th><th>Falta separar</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {fornecedores.map((f) => (
                  <tr key={f.fornecedor_id ?? 'null'}>
                    <td>{f.fornecedor}</td>
                    <td>{f.produtos}</td>
                    <td>{f.qtd}</td>
                    <td>R$ {fmt(f.custo)}</td>
                    <td>R$ {fmt(f.reposicao)}</td>
                    <td>R$ {fmt(f.jaSeparado)}</td>
                    <td className={f.falta > 0 ? 'texto-vermelho' : 'texto-verde'}>R$ {fmt(f.falta)}</td>
                    <td>
                      <span className={`rp-status ${f.status === 'ok' ? 'ok' : 'pendente'}`}>
                        {f.status === 'ok' ? 'OK' : 'Pendente'}
                      </span>
                    </td>
                    <td className="td-acoes">
                      {f.falta > 0 && (
                        <button className="btn-mini" onClick={() => { setModalSeparar(f); setSepValor(''); setSepData(new Date().toISOString().slice(0, 10)); setSepDest(''); setSepObs('') }}>
                          Separar valor
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {fornecedores.length === 0 && (
                  <tr><td colSpan={9} className="sem-resultado">Sem dados no período.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>TOTAL PARA FORNECEDORES</td>
                  <td>R$ {fmt(resumo.reposicao)}</td>
                  <td>R$ {fmt(resumo.jaSeparado)}</td>
                  <td className={resumo.aSeparar > 0 ? 'texto-vermelho' : 'texto-verde'}>R$ {fmt(resumo.aSeparar)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rp-tabela-card">
            <h4>Produtos vendidos e dinheiro necessário para reposição</h4>
            <table className="rp-tabela">
              <thead>
                <tr>
                  {colunasProdVisiveis.filter((c) => colunasProduto[c.chave] !== false).map((c) => <th key={c.chave}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {produtos.map((p, i) => (
                  <tr key={i}>
                    {colunasProdVisiveis.filter((c) => colunasProduto[c.chave] !== false).map((c) => (
                      <td key={c.chave}>
                        {c.chave === 'produto' ? p.produto
                          : c.chave === 'fornecedor' ? (p.fornecedor ?? '-')
                          : c.chave === 'categoria' ? (p.categoria ?? '-')
                          : c.chave === 'qtd' ? p.qtd
                          : c.chave === 'preco_venda' ? `R$ ${fmt(p.preco_venda)}`
                          : c.chave === 'faturamento' ? `R$ ${fmt(p.faturamento)}`
                          : c.chave === 'custo_unitario' ? `R$ ${fmt(p.custo_unitario)}`
                          : c.chave === 'custo_total' ? `R$ ${fmt(p.custo_total)}`
                          : c.chave === 'margem_unit' ? `R$ ${fmt(p.margem_unit)}`
                          : c.chave === 'margem_total' ? `R$ ${fmt(p.margem_total)}`
                          : c.chave === 'reposicao' ? `R$ ${fmt(p.reposicao)}`
                          : c.chave === 'estoque_atual' ? p.estoque_atual
                          : p.estoque_minimo}
                      </td>
                    ))}
                  </tr>
                ))}
                {produtos.length === 0 && (
                  <tr><td colSpan={colunasProdVisiveis.length} className="sem-resultado">Sem dados no período.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rp-tabela-card">
            <h4>Distribuição do dinheiro</h4>
            <div className="dist-cinza-barra">
              <div className="dist-cinza-seg vermelho" style={{ flex: resumo.reposicao }} title={`Reposição de estoque: R$ ${fmt(resumo.reposicao)}`}>
                🔴 Reposição R$ {fmt(resumo.reposicao)}
              </div>
              <div className="dist-cinza-seg verde" style={{ flex: Math.max(resumo.disponivel, 0.01) }} title={`Disponível: R$ ${fmt(resumo.disponivel)}`}>
                🟢 Disponível R$ {fmt(resumo.disponivel)}
              </div>
            </div>
            <div className="resumo-linhas">
              <div className="linha"><span>🔴 Reposição de estoque</span><strong>R$ {fmt(resumo.reposicao)}</strong></div>
              <div className="linha"><span>🟠 Fornecedores (já separado)</span><strong>R$ {fmt(resumo.jaSeparado)}</strong></div>
              <div className="linha"><span>🟡 Ainda necessário</span><strong className="texto-vermelho">R$ {fmt(resumo.aSeparar)}</strong></div>
              <div className="linha"><span>🔵 Margem bruta</span><strong className="texto-verde">R$ {fmt(resumo.margem)}</strong></div>
              <div className="linha"><span>🟢 Disponível</span><strong className="texto-verde">R$ {fmt(resumo.disponivel)}</strong></div>
            </div>
          </div>

          <div className="rp-tabela-card">
            <h4>Resumo</h4>
            <div className="resumo-linhas">
              <div className="linha"><span>Faturamento</span><strong>R$ {fmt(resumo.faturamento)}</strong></div>
              <div className="linha"><span>Custo dos produtos vendidos</span><strong>R$ {fmt(resumo.custo)}</strong></div>
              <div className="linha"><span>Valor necessário para reposição</span><strong>R$ {fmt(resumo.reposicao)}</strong></div>
              <div className="linha"><span>Total reservado</span><strong>R$ {fmt(resumo.jaSeparado)}</strong></div>
              <div className="linha"><span>Total ainda necessário</span><strong className="texto-vermelho">R$ {fmt(resumo.aSeparar)}</strong></div>
              <div className="linha"><span>Margem bruta</span><strong className="texto-verde">R$ {fmt(resumo.margem)}</strong></div>
              <div className="linha total-periodo"><span>Valor disponível</span><strong className="texto-verde">R$ {fmt(resumo.disponivel)}</strong></div>
            </div>
          </div>
        </>
      )}

      {modalConfig && (
        <div className="modal-overlay" onClick={() => setModalConfig(false)}>
          <div className="modal modal-tela-cheia" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Configurar regras de reposição</h3>
              <button className="btn-icone" onClick={() => setModalConfig(false)}>✕</button>
            </div>
            <div className="modal-corpo">
              <p className="nota-config">Defina como calcular o valor a separar por fornecedor. Padrão: 100% do custo dos produtos vendidos.</p>
              <div className="permissoes-grid" style={{ maxHeight: '60vh' }}>
                {listaFornecedores.map((f) => {
                  const regra = regras[f.id] ?? { tipo: 'percent', valor: '100' }
                  return (
                    <div key={f.id} className="dist-regra-item">
                      <strong>{f.nome}</strong>
                      <select value={regra.tipo} onChange={(e) => setRegras({ ...regras, [f.id]: { ...regra, tipo: e.target.value } })}>
                        <option value="percent">Percentual do custo</option>
                        <option value="fixo">Valor fixo</option>
                      </select>
                      <input
                        type="text" inputMode="decimal"
                        value={regra.valor}
                        onChange={(e) => setRegras({ ...regras, [f.id]: { ...regra, valor: e.target.value } })}
                        placeholder={regra.tipo === 'percent' ? '%' : 'R$'}
                      />
                    </div>
                  )
                })}
                {listaFornecedores.length === 0 && <p className="sem-resultado">Nenhum fornecedor cadastrado.</p>}
              </div>
            </div>
            <div className="modal-rodape">
              <div className="modal-acoes-direita">
                <button className="btn-secundario" onClick={() => setModalConfig(false)}>Cancelar</button>
                <button className="btn-primario" onClick={salvarRegras}>Salvar regras</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalSeparar && (
        <div className="modal-overlay" onClick={() => setModalSeparar(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Separar valor — {modalSeparar.fornecedor}</h3>
            <div className="modal-resumo">
              <div className="linha"><span>Necessário</span><strong>R$ {fmt(modalSeparar.reposicao)}</strong></div>
              <div className="linha"><span>Já separado</span><strong>R$ {fmt(modalSeparar.jaSeparado)}</strong></div>
              <div className="linha total-periodo"><span>Falta</span><strong className="texto-vermelho">R$ {fmt(modalSeparar.falta)}</strong></div>
            </div>
            <div className="form-grid">
              <label>Valor a separar (R$)
                <input
                  autoFocus inputMode="decimal" value={sepValor}
                  onChange={(e) => setSepValor(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder={modalSeparar.falta.toFixed(2)}
                />
              </label>
              <label>Data
                <input type="date" value={sepData} onChange={(e) => setSepData(e.target.value)} />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>Destinação
                <input value={sepDest} onChange={(e) => setSepDest(e.target.value)} placeholder="Ex: pagamento fornecedor" />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>Observação
                <input value={sepObs} onChange={(e) => setSepObs(e.target.value)} />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalSeparar(null)}>Cancelar</button>
              <button className="btn-primario" onClick={registrarSeparacao}>Registrar separação</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
