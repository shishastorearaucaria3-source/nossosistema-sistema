import { Fragment, useEffect, useState, useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { getDbApi, getCaixasApi } from '../../shared/db'
import CaixaImportar from './CaixaImportar'
import OpcoesCaixa from './OpcoesCaixa'

interface Caixa {
  id: number
  usuario_id: number | null
  usuario_nome: string | null
  usuario_fechamento: number | null
  usuario_fechamento_nome: string | null
  aberto: number
  saldo_inicial: number
  total_vendas: number
  total_sangrias: number
  total_suprimentos: number
  descontos: number
  cancelamentos: number
  qtd_vendas: number
  aberto_em: string
  fechado_em: string | null
  saldo_informado: number | null
  quebra: number | null
  reaberto_em: string | null
  reaberto_por_nome: string | null
}

interface MovimentoTimeline {
  id: number
  valor: number
  descricao: string
  detalhe: string
  criado_em: string
}

interface PagamentoForma {
  forma: string
  valor: number
}

type Aba = 'atual' | 'anteriores' | 'conferir' | 'contador'

const COLUNAS_CAIXA: [string, string][] = [
  ['acoes', 'Ações'],
  ['numero', 'Nº'],
  ['abertura', 'Abertura'],
  ['fechamento', 'Fechamento'],
  ['abriu', 'Abriu'],
  ['fechou', 'Fechou'],
  ['vendas', 'Vendas'],
  ['qtd', 'Qtd'],
  ['saldo', 'Saldo'],
  ['saldo_informado', 'Saldo Informado'],
  ['quebra', 'Quebra']
]

export default function Caixa({ usuarioId, usuarioNome, onAbrirCaixa, pedirConfig }: { usuarioId?: number; usuarioNome?: string; onAbrirCaixa?: (caixaId: number) => void; pedirConfig?: number }) {
  const [caixaAtual, setCaixaAtual] = useState<Caixa | null>(null)
  const [historico, setHistorico] = useState<Caixa[]>([])
  const [timeline, setTimeline] = useState<MovimentoTimeline[]>([])
  const [formas, setFormas] = useState<PagamentoForma[]>([])
  const [canais, setCanais] = useState<{ tipo: string; valor: number }[]>([])
  const [aba, setAba] = useState<Aba>('atual')
  const [modoImportar, setModoImportar] = useState(false)
  const [caixaExpandido, setCaixaExpandido] = useState<number | null>(null)
  const [limiteHistorico, setLimiteHistorico] = useState(60)
  const [colLarguras, setColLarguras] = useState<Record<string, number>>(() => {
    try {
      const s = localStorage.getItem('caixa_hist_cols')
      return s ? (JSON.parse(s) as Record<string, number>) : {}
    } catch {
      return {}
    }
  })
  const [soComQuebra, setSoComQuebra] = useState(false)
  const [filtroAberto, setFiltroAberto] = useState(false)
  const [periodoFiltro, setPeriodoFiltro] = useState<'todos' | 'hoje' | 'ontem' | '7d' | 'mensal' | 'personalizado'>('todos')
  const [periodoFiltroAberto, setPeriodoFiltroAberto] = useState(false)
  const [dataIniFiltro, setDataIniFiltro] = useState('')
  const [dataFimFiltro, setDataFimFiltro] = useState('')
  const [vendasCaixa, setVendasCaixa] = useState<{ id: number; numero: string; total: number; created_at: string; itens: { nome_produto: string; quantidade: number; preco_unitario: number }[] }[]>([])
  const [movimentosCaixa, setMovimentosCaixa] = useState<{ tipo: string; valor: number; motivo: string | null; criado_em: string }[]>([])
  const [saldoAbertura, setSaldoAbertura] = useState('')
  const [saldoFechamento, setSaldoFechamento] = useState('')
  const [valorMov, setValorMov] = useState('')
  const [motivoMov, setMotivoMov] = useState('')
  const [tipoMov, setTipoMov] = useState<'sangria' | 'suprimento'>('suprimento')
  const [modalMov, setModalMov] = useState(false)
  const [meiosPagamento, setMeiosPagamento] = useState<{ id: number; nome: string; tipo: string }[]>([])
  const [sangriasPorForma, setSangriasPorForma] = useState<Record<string, string>>({})
  const [modalAbrir, setModalAbrir] = useState(false)
  const [modalFechar, setModalFechar] = useState(false)
  const [modalConfirmarQuebra, setModalConfirmarQuebra] = useState(false)
  const [quebraPendente, setQuebraPendente] = useState<{ saldoFisico: number; quebra: number } | null>(null)
  const [modalOpcoes, setModalOpcoes] = useState(false)
  const [caixaSaldoAbertura, setCaixaSaldoAbertura] = useState<'informar' | 'zerado' | 'anterior'>('anterior')
  const [exigirSaldoFinal, setExigirSaldoFinal] = useState(true)
  const [fechamentoPor, setFechamentoPor] = useState<'forma' | 'total'>('total')
  const ultimoPedirConfig = useRef(pedirConfig ?? 0)
  useEffect(() => {
    if ((pedirConfig ?? 0) > ultimoPedirConfig.current) {
      setModalOpcoes(true)
      ultimoPedirConfig.current = pedirConfig ?? 0
    }
  }, [pedirConfig])
  const [menuCaixaAberto, setMenuCaixaAberto] = useState(false)
  const [modalAlterarSaldo, setModalAlterarSaldo] = useState(false)
  const [modalCorrigirData, setModalCorrigirData] = useState(false)
  const [novoSaldoInicial, setNovoSaldoInicial] = useState('')
  const [novaAbertura, setNovaAbertura] = useState('')
  const [modalTotalizar, setModalTotalizar] = useState(false)
  const [buscaCodigo, setBuscaCodigo] = useState('')
  const [modalRelatorio, setModalRelatorio] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [conferencia, setConferencia] = useState<Record<string, string>>({})
  const [contador, setContador] = useState<Record<string, string>>(() => {
    try {
      const s = localStorage.getItem('caixa_contador')
      return s ? JSON.parse(s) : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('caixa_contador', JSON.stringify(contador))
    } catch {
      // ignore
    }
  }, [contador])

  const carregar = useCallback(async () => {
    const db = getDbApi()
    const atual = (await db.get(
      `SELECT c.*, u.nome AS usuario_nome FROM caixas c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE c.aberto = 1 ORDER BY c.id DESC LIMIT 1`
    )) as unknown as Caixa | undefined
    setCaixaAtual(atual ?? null)

    let periodoSql = ''
    const periodoParams: string[] = []
    const hoje = new Date()
    const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (periodoFiltro === 'hoje') {
      periodoSql = `AND date(c.aberto_em) = ?`
      periodoParams.push(fmtD(hoje))
    } else if (periodoFiltro === 'ontem') {
      const d = new Date(hoje); d.setDate(d.getDate() - 1)
      periodoSql = `AND date(c.aberto_em) = ?`
      periodoParams.push(fmtD(d))
    } else if (periodoFiltro === '7d') {
      const d = new Date(hoje); d.setDate(d.getDate() - 7)
      periodoSql = `AND date(c.aberto_em) >= ?`
      periodoParams.push(fmtD(d))
    } else if (periodoFiltro === 'mensal') {
      periodoSql = `AND date(c.aberto_em) >= date('now','start of month')`
    } else if (periodoFiltro === 'personalizado' && dataIniFiltro && dataFimFiltro) {
      periodoSql = `AND date(c.aberto_em) >= ? AND date(c.aberto_em) <= ?`
      periodoParams.push(dataIniFiltro, dataFimFiltro)
    }

    const hist = (await db.all(
      `SELECT c.*, u.nome AS usuario_nome, uf.nome AS usuario_fechamento_nome, ur.nome AS reaberto_por_nome
       FROM caixas c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN usuarios uf ON uf.id = c.usuario_fechamento
       LEFT JOIN usuarios ur ON ur.id = c.reaberto_por
       WHERE c.aberto = 0
         ${soComQuebra ? `AND (c.quebra IS NOT NULL AND ABS(c.quebra) > 0.005)` : ''}
         ${periodoSql}
       ORDER BY COALESCE(c.aberto_em, c.fechado_em, '') DESC, c.id DESC LIMIT ?`,
      [...periodoParams, limiteHistorico]
    )) as unknown as Caixa[]
    setHistorico(hist)

    if (atual) {
      const vendas = (await db.all(
        `SELECT v.id, v.total, v.subtotal, v.created_at,
           (SELECT p.forma FROM pagamentos p WHERE p.venda_id = v.id LIMIT 1) AS forma
         FROM vendas v WHERE v.caixa_id = ? AND v.status != 'cancelada' ORDER BY v.id ASC`,
        [atual.id]
      )) as unknown as { id: number; total: number; subtotal: number; created_at: string; forma: string | null }[]

      const timelineItems: MovimentoTimeline[] = []
      for (const v of vendas) {
        const desconto = v.subtotal - v.total
        timelineItems.push({
          id: v.id,
          valor: v.total,
          descricao: desconto > 0 ? `Desconto: R$ ${desconto.toFixed(2)}` : 'Venda',
          detalhe: desconto > 0 ? 'Venda' : v.forma ?? '-',
          criado_em: v.created_at
        })
      }
      const movs = (await db.all(
        `SELECT * FROM movimentos_caixa WHERE caixa_id = ? ORDER BY id ASC`,
        [atual.id]
      )) as unknown as { id: number; tipo: string; valor: number; motivo: string | null; criado_em: string }[]
      for (const m of movs) {
        timelineItems.push({
          id: 100000 + m.id,
          valor: m.tipo === 'sangria' ? -m.valor : m.valor,
          descricao: m.tipo === 'sangria' ? 'Sangria' : m.tipo === 'suprimento' ? 'Suprimento' : m.tipo === 'abertura' ? 'Abertura de Caixa' : 'Fechamento',
          detalhe: m.motivo ?? '-',
          criado_em: m.criado_em
        })
      }
      setTimeline(timelineItems)

      const pag = (await db.all(
        `SELECT p.forma, SUM(p.valor) AS valor FROM pagamentos p
         JOIN vendas v ON v.id = p.venda_id
         WHERE v.caixa_id = ? AND v.status != 'cancelada' GROUP BY p.forma ORDER BY valor DESC`,
        [atual.id]
      )) as unknown as PagamentoForma[]
      setFormas(pag)

      const canais = (await db.all(
        `SELECT v.tipo, SUM(v.total) AS valor FROM vendas v
         WHERE v.caixa_id = ? AND v.status != 'cancelada' GROUP BY v.tipo`,
        [atual.id]
      )) as unknown as { tipo: string; valor: number }[]
      setCanais(canais)
    } else {
      setTimeline([])
      setFormas([])
      setCanais([])
    }

    const meios = (await db.all(
      `SELECT id, nome, tipo FROM formas_pagamento WHERE ativo = 1 ORDER BY id`
    )) as unknown as { id: number; nome: string; tipo: string }[]
    setMeiosPagamento(meios)
  }, [limiteHistorico, soComQuebra, periodoFiltro, dataIniFiltro, dataFimFiltro])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    getDbApi()
      .all(
        `SELECT chave, valor FROM config WHERE chave IN ('caixa_saldo_abertura','caixa_exigir_saldo_final','caixa_fechamento_por')`
      )
      .then((rows) => {
        const mapa: Record<string, string> = {}
        for (const r of rows as unknown as { chave: string; valor: string | null }[]) mapa[r.chave] = r.valor ?? ''
        if (mapa['caixa_saldo_abertura']) setCaixaSaldoAbertura(mapa['caixa_saldo_abertura'] as 'informar' | 'zerado' | 'anterior')
        setExigirSaldoFinal(mapa['caixa_exigir_saldo_final'] !== '0')
        if (mapa['caixa_fechamento_por']) setFechamentoPor(mapa['caixa_fechamento_por'] as 'forma' | 'total')
      })
      .catch(() => {})
  }, [modalOpcoes])

  useEffect(() => {
    const fechar = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.dropdown-filtro')) setFiltroAberto(false)
      if (!(e.target as HTMLElement).closest('.caixa-periodo-drop')) setPeriodoFiltroAberto(false)
      if (!(e.target as HTMLElement).closest('.menu-caixa-atual')) setMenuCaixaAberto(false)
    }
    window.addEventListener('mousedown', fechar)
    return () => window.removeEventListener('mousedown', fechar)
  }, [])

  const abrirModalAbrir = () => {
    if (caixaSaldoAbertura === 'zerado') {
      setSaldoAbertura(formatarMoedaDigitos('0'))
    } else if (caixaSaldoAbertura === 'anterior') {
      getDbApi()
        .get(
          `SELECT COALESCE(saldo_informado, saldo_inicial + total_vendas + total_suprimentos - total_sangrias) AS saldo
           FROM caixas WHERE aberto = 0 ORDER BY COALESCE(aberto_em, fechado_em) DESC, id DESC LIMIT 1`
        )
        .then((ult) => {
          const s = (ult as { saldo: number } | undefined)?.saldo ?? 0
          setSaldoAbertura(formatarMoedaDigitos(String(Math.max(0, Math.round(s * 100)))))
        })
        .catch(() => setSaldoAbertura(''))
    } else {
      setSaldoAbertura('')
    }
    setModalAbrir(true)
  }

  const abrirCaixa = async () => {
    const saldo = parseMoedaDigitada(saldoAbertura)
    const res = await getDbApi().run(
      `INSERT INTO caixas (usuario_id, saldo_inicial, aberto, aberto_em) VALUES (?, ?, 1, datetime('now','localtime'))`,
      [usuarioId ?? null, saldo]
    )
    const caixaId = Number(res.lastInsertRowid)
    await getDbApi().run(
      `INSERT INTO movimentos_caixa (caixa_id, tipo, valor, motivo, usuario_id, criado_em) VALUES (?, 'abertura', ?, 'Abertura de Caixa', ?, datetime('now','localtime'))`,
      [caixaId, saldo, usuarioId ?? null]
    )
    setModalAbrir(false)
    setSaldoAbertura('')
    setMensagem(`Caixa #${caixaId} aberto.`)
    carregar()
  }

  const lancarMovimento = async () => {
    if (!caixaAtual) return
    if (tipoMov === 'sangria' && meiosPagamento.length > 0) {
      let total = 0
      for (const m of meiosPagamento) {
        const valor = parseMoedaDigitada(sangriasPorForma[m.nome] ?? '')
        if (valor <= 0) continue
        await getDbApi().run(
          `INSERT INTO movimentos_caixa (caixa_id, tipo, valor, motivo, usuario_id) VALUES (?, 'sangria', ?, ?, ?)`,
          [caixaAtual.id, valor, `Sangria - ${m.nome}${motivoMov ? ` (${motivoMov})` : ''}`, usuarioId ?? null]
        )
        total += valor
      }
      if (total <= 0) {
        setMensagem('Informe um valor válido para a remoção.')
        return
      }
      await getDbApi().run(`UPDATE caixas SET total_sangrias = total_sangrias + ? WHERE id = ?`, [total, caixaAtual.id])
      setModalMov(false)
      setValorMov('')
      setMotivoMov('')
      setSangriasPorForma({})
      setMensagem('Remoção registrada.')
      carregar()
      return
    }
    const valor = parseMoedaDigitada(valorMov)
    if (!valor || valor <= 0) {
      setMensagem('Informe um valor válido.')
      return
    }
    await getDbApi().run(
      `INSERT INTO movimentos_caixa (caixa_id, tipo, valor, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)`,
      [caixaAtual.id, tipoMov, valor, motivoMov || null, usuarioId ?? null]
    )
    if (tipoMov === 'sangria') {
      await getDbApi().run(`UPDATE caixas SET total_sangrias = total_sangrias + ? WHERE id = ?`, [valor, caixaAtual.id])
    } else {
      await getDbApi().run(`UPDATE caixas SET total_suprimentos = total_suprimentos + ? WHERE id = ?`, [valor, caixaAtual.id])
    }
    setModalMov(false)
    setValorMov('')
    setMotivoMov('')
    setMensagem(tipoMov === 'sangria' ? 'Remoção registrada.' : 'Entrada registrada.')
    carregar()
  }

  const abrirModalSangria = () => {
    setTipoMov('sangria')
    setValorMov('')
    setMotivoMov('')
    const base: Record<string, string> = {}
    for (const m of meiosPagamento) base[m.nome] = ''
    setSangriasPorForma(base)
    setModalMov(true)
  }

  const abrirModalSuprimento = () => {
    setTipoMov('suprimento')
    setValorMov('')
    setMotivoMov('')
    setSangriasPorForma({})
    setModalMov(true)
  }

  const reabrirCaixa = async (id: number) => {
    const db = getDbApi()
    const aberto = (await db.get(
      `SELECT id FROM caixas WHERE aberto = 1 LIMIT 1`
    )) as { id: number } | undefined
    if (aberto) {
      setMensagem(`Já existe um caixa aberto (#${aberto.id}). Feche-o antes de reabrir outro.`)
      return
    }
    if (!confirm(`Reabrir o caixa #${id}? As vendas voltarão para o caixa atual e novas vendas entram nele.`)) return
    await db.run(
      `UPDATE caixas SET aberto = 1, fechado_em = NULL, saldo_inicial = COALESCE(saldo_informado, saldo_inicial), reaberto_em = datetime('now', 'localtime'), reaberto_por = ? WHERE id = ?`,
      [usuarioId ?? null, id]
    )
    const saldoReaberto = (await db.get(`SELECT saldo_inicial FROM caixas WHERE id = ?`, [id])) as { saldo_inicial: number }
    setMensagem(`Caixa #${id} reaberto com saldo de R$ ${saldoReaberto.saldo_inicial.toFixed(2)}.`)
    carregar()
  }

  const executarFechamento = async (saldoFisico: number, totalSistema: number, quebra: number) => {
    if (!caixaAtual) return
    try {
      const db = getDbApi()
      await db.run(
        `UPDATE caixas SET aberto = 0, fechado_em = datetime('now', 'localtime'), usuario_fechamento = ?, saldo_informado = ?, quebra = ? WHERE id = ?`,
        [usuarioId ?? null, saldoFisico, quebra, caixaAtual.id]
      )
      await db.run(
        `INSERT INTO movimentos_caixa (caixa_id, tipo, valor, motivo, usuario_id) VALUES (?, 'fechamento', ?, ?, ?)`,
        [caixaAtual.id, saldoFisico, `Fechamento (sistema: R$ ${totalSistema.toFixed(2)}, quebra: ${quebra >= 0 ? '+' : ''}R$ ${quebra.toFixed(2)})`, usuarioId ?? null]
      )
      setModalFechar(false)
      setModalConfirmarQuebra(false)
      setQuebraPendente(null)
      setSaldoFechamento('')
      setMensagem(`Caixa fechado. Quebra: ${quebra >= 0 ? '+' : ''}R$ ${quebra.toFixed(2)}`)
      carregar()
    } catch (err) {
      setMensagem(`Erro ao fechar o caixa: ${(err as Error).message}`)
    }
  }

  const fecharCaixa = async () => {
    if (!caixaAtual) {
      setMensagem('Nenhum caixa aberto para fechar.')
      return
    }
    const saldoFisicoDigitado = parseMoedaDigitada(saldoFechamento)
    const totalSistema = saldoFinal
    const saldoFisico = exigirSaldoFinal ? (saldoFisicoDigitado || totalSistema) : (saldoFisicoDigitado > 0 ? saldoFisicoDigitado : totalSistema)
    const quebra = Number((saldoFisico - totalSistema).toFixed(2))
    if (Math.abs(quebra) > 0.0001) {
      setQuebraPendente({ saldoFisico, quebra })
      setModalConfirmarQuebra(true)
      return
    }
    await executarFechamento(saldoFisico, totalSistema, quebra)
  }

  const alterarSaldoInicial = async () => {
    if (!caixaAtual) return
    const valor = parseMoedaDigitada(novoSaldoInicial)
    await getDbApi().run(`UPDATE caixas SET saldo_inicial = ? WHERE id = ?`, [valor, caixaAtual.id])
    setModalAlterarSaldo(false)
    setMensagem(`Saldo inicial do caixa #${caixaAtual.id} alterado para R$ ${valor.toFixed(2)}.`)
    carregar()
  }

  const corrigirDataHora = async () => {
    if (!caixaAtual || !novaAbertura) return
    await getDbApi().run(`UPDATE caixas SET aberto_em = ? WHERE id = ?`, [novaAbertura, caixaAtual.id])
    setModalCorrigirData(false)
    setMensagem('Data/hora de abertura corrigida.')
    carregar()
  }

  const totalizarPeriodo = () => {
    const totais = historico.reduce(
      (acc, c) => {
        acc.vendas += c.total_vendas
        acc.qtd += c.qtd_vendas
        acc.sangrias += c.total_sangrias
        acc.suprimentos += c.total_suprimentos
        acc.saldo += c.saldo_inicial + c.total_vendas + c.total_suprimentos - c.total_sangrias
        return acc
      },
      { vendas: 0, qtd: 0, sangrias: 0, suprimentos: 0, saldo: 0 }
    )
    const fim =
      periodoFiltro === 'hoje' ? ' hoje'
      : periodoFiltro === 'ontem' ? ' de ontem'
      : periodoFiltro === '7d' ? ' dos últimos 7 dias'
      : periodoFiltro === 'mensal' ? ' deste mês'
      : periodoFiltro === 'personalizado' ? ` de ${dataIniFiltro} até ${dataFimFiltro}`
      : ' do período filtrado'
    setMensagem(`Total do período${fim}: R$ ${totais.vendas.toFixed(2)} em vendas (${totais.qtd} vendas), ${totais.suprimentos.toFixed(2)} entradas, ${totais.sangrias.toFixed(2)} saídas, saldo final R$ ${totais.saldo.toFixed(2)}.`)
    setModalTotalizar(false)
  }

  const saldoFinal =
    caixaAtual && timeline.length
      ? timeline.reduce((s, m) => s + m.valor, 0)
      : caixaAtual
        ? caixaAtual.saldo_inicial + caixaAtual.total_vendas + caixaAtual.total_suprimentos - caixaAtual.total_sangrias
        : 0

  const totalVendas = caixaAtual?.total_vendas ?? 0
  const totalFormas = formas.reduce((s, f) => s + f.valor, 0)
  const lucroBruto = caixaAtual ? totalVendas * 0.52 : 0

  const numCaixa = caixaAtual?.id ?? 0
  const horaAbertura = caixaAtual?.aberto_em ? caixaAtual.aberto_em.slice(11, 16) : ''
  const dataAbertura = caixaAtual?.aberto_em ? caixaAtual.aberto_em.slice(0, 10) : ''

  const canalMax = Math.max(...canais.map((c) => c.valor), 1)

  const exportarCaixas = async () => {
    const res = await getCaixasApi().exportar()
    setMensagem(res.ok ? `${res.qtd} caixa(s) exportado(s) para ${res.arquivo}` : res.erro ?? 'Falha ao exportar.')
  }

  const alternarCaixa = async (id: number) => {
    if (caixaExpandido === id) {
      setCaixaExpandido(null)
      return
    }
    setCaixaExpandido(id)
    const db = getDbApi()
    const rows = (await db.all(
      `SELECT v.id, v.numero, v.total, v.created_at,
              (SELECT GROUP_CONCAT(vi.nome_produto || '|' || vi.quantidade || '|' || vi.preco_unitario, '~')
               FROM venda_itens vi WHERE vi.venda_id = v.id) AS itens_str
       FROM vendas v WHERE v.caixa_id = ? ORDER BY v.created_at DESC LIMIT 500`,
      [id]
    )) as unknown as { id: number; numero: string; total: number; created_at: string; itens_str: string | null }[]
    const vendas = rows.map((r) => ({
      id: r.id,
      numero: r.numero,
      total: r.total,
      created_at: r.created_at,
      itens: (r.itens_str || '').split('~').filter(Boolean).map((parte) => {
        const [nome_produto, quantidade, preco_unitario] = parte.split('|')
        return { nome_produto, quantidade: Number(quantidade), preco_unitario: Number(preco_unitario) }
      })
    }))
    setVendasCaixa(vendas)
    const movs = (await db.all(
      `SELECT tipo, valor, motivo, criado_em FROM movimentos_caixa WHERE caixa_id = ? ORDER BY id ASC`,
      [id]
    )) as unknown as { tipo: string; valor: number; motivo: string | null; criado_em: string }[]
    setMovimentosCaixa(movs)
  }

  const importarCaixas = async () => {
    if (!confirm('Importar caixas? Os dados do arquivo serão adicionados/atualizados (inclusive movimentações e o vínculo das vendas).')) return
    const res = await getCaixasApi().importar()
    setMensagem(res.ok ? `${res.qtd} caixa(s) importado(s).` : res.erro ?? 'Falha ao importar.')
    carregar()
  }

  const confirmarConferencia = async () => {
    if (!caixaAtual) return
    setMensagem('Conferência salva (valores digitais).')
  }

  const CEDULAS = [200, 100, 50, 20, 10, 5, 2]
  const MOEDAS = [1, 0.5, 0.25, 0.1, 0.05, 0.01]

  const totalContado =
    CEDULAS.reduce((s, c) => s + (Number(contador[`c${c}`]) || 0) * c, 0) +
    MOEDAS.reduce((s, m) => s + (Number(contador[`m${m}`]) || 0) * m, 0)

  const nomeFormaIcone = (forma: string) => {
    const f = forma.toLowerCase()
    if (f.includes('dinheiro')) return 'dinheiro'
    if (f.includes('pix')) return 'pix'
    if (f.includes('crédito') || f.includes('credito')) return 'credito'
    if (f.includes('débito') || f.includes('debito')) return 'debito'
    return 'outro'
  }

  const formatarMoedaDigitos = (v: string) => {
    const digitos = v.replace(/\D/g, '').slice(0, 12)
    if (!digitos) return ''
    const valor = Number(digitos) / 100
    return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const iniciarRedimensionar = (campo: string) => (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault()
    const th = (e.currentTarget as HTMLElement).closest('th')
    if (!th) return
    const iniX = e.clientX
    const iniLarg = th.offsetWidth
    const mover = (ev: PointerEvent) => {
      const nova = Math.max(50, iniLarg + (ev.clientX - iniX))
      th.style.width = `${nova}px`
      setColLarguras((c) => {
        const prox = { ...c, [campo]: nova }
        try { localStorage.setItem('caixa_hist_cols', JSON.stringify(prox)) } catch { /* ignora */ }
        return prox
      })
    }
    const fim = () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', fim)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', fim)
  }

  const parseMoedaDigitada = (v: string) => {
    const digitos = v.replace(/\D/g, '')
    if (!digitos) return 0
    return Number(digitos) / 100
  }

  const totalSangriaPorForma = meiosPagamento.reduce((s, m) => s + parseMoedaDigitada(sangriasPorForma[m.nome] ?? ''), 0)

  const corCanal = (tipo: string) => (tipo === 'delivery' ? '#8b5cf6' : '#2563eb')

  return (
    <div className="page page-caixa">
      <div className="page-header">
        <h2>Caixa <span className="seta-titulo">▾</span></h2>
        <div className="page-acoes">
          <div className="dropdown-filtro caixa-periodo-drop">
            <button className="btn-secundario dropdown-periodo-btn" onClick={() => setPeriodoFiltroAberto((v) => !v)}>
              {periodoFiltro === 'todos' ? 'Todos os períodos' : periodoFiltro === 'hoje' ? 'Hoje' : periodoFiltro === 'ontem' ? 'Ontem' : periodoFiltro === '7d' ? 'Últimos 7 dias' : periodoFiltro === 'mensal' ? 'Este mês' : 'Personalizado'} <span className="seta-dropdown">▼</span>
            </button>
            {periodoFiltroAberto && (
              <div className="dropdown-periodo-menu">
                {([['todos', 'Todos os períodos'], ['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', 'Últimos 7 dias'], ['mensal', 'Este mês'], ['personalizado', 'Personalizado']] as const).map(([k, l]) => (
                  <button key={k} className={`dropdown-periodo-item ${periodoFiltro === k ? 'ativo' : ''}`} onClick={() => { setPeriodoFiltro(k); setPeriodoFiltroAberto(false) }}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            {periodoFiltro === 'personalizado' && (
              <div className="caixa-periodo-datas">
                <input type="date" value={dataIniFiltro} onChange={(e) => setDataIniFiltro(e.target.value)} />
                <span>até</span>
                <input type="date" value={dataFimFiltro} onChange={(e) => setDataFimFiltro(e.target.value)} />
              </div>
            )}
          </div>
          <button className="btn-secundario" onClick={() => setModoImportar(true)}>Importar planilha</button>
          <button className="btn-secundario" onClick={exportarCaixas}>Exportar</button>
          <button className="btn-secundario" onClick={importarCaixas}>Importar</button>
          {caixaAtual ? (
            <>
              <button className="btn-secundario" onClick={abrirModalSuprimento}>Adicionar Dinheiro</button>
              <button className="btn-secundario" onClick={abrirModalSangria}>Remover Valores</button>
            </>
          ) : (
            <button className="btn-primario" onClick={abrirModalAbrir}>Abrir caixa</button>
          )}
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {modoImportar && (
        <CaixaImportar onConcluido={() => { setModoImportar(false); carregar() }} />
      )}

      {!modoImportar && (
      <>
      <div className="abas-caixa">
        <button className={`aba-caixa ${aba === 'atual' ? 'ativa' : ''}`} onClick={() => setAba('atual')}>Caixa Atual</button>
        <button className={`aba-caixa ${aba === 'anteriores' ? 'ativa' : ''}`} onClick={() => setAba('anteriores')}>Caixas Anteriores</button>
        <button className={`aba-caixa ${aba === 'conferir' ? 'ativa' : ''}`} onClick={() => setAba('conferir')}>Conferir Meio de Pagamento</button>
        <button className={`aba-caixa ${aba === 'contador' ? 'ativa' : ''}`} onClick={() => setAba('contador')}>Contador de Dinheiro</button>
      </div>

      {aba === 'atual' && (
        <>
          {!caixaAtual && (
            <div className="rel-painel caixa-sem-caixa">
              <h3>Nenhum caixa aberto</h3>
              <p className="sem-resultado">Abra o caixa para registrar vendas e movimentações.</p>
              <button className="btn-primario" onClick={abrirModalAbrir}>Abrir caixa</button>
            </div>
          )}

          {caixaAtual && (
            <div className="caixa-layout">
              <div className="caixa-coluna-esq">
                <section className="card-caixa">
                  <div className="card-caixa-topo">
                    <div>
                      <h3>Resumo do Caixa #{numCaixa}</h3>
                      <p className="card-caixa-sub">Aberto Hoje ({horaAbertura})</p>
                    </div>
                    <div className="menu-caixa-atual">
                      <button className="btn-icone" title="Opções do caixa" onClick={() => setMenuCaixaAberto((v) => !v)}>⋯</button>
                      {menuCaixaAberto && (
                        <div className="dropdown-filtro-menu">
                          <button className="dropdown-filtro-item" onClick={() => { setMenuCaixaAberto(false); setNovoSaldoInicial(String(caixaAtual.saldo_inicial)); setModalAlterarSaldo(true); setMensagem('') }}>Alterar saldo inicial</button>
                          <button className="dropdown-filtro-item" onClick={() => { setMenuCaixaAberto(false); setNovaAbertura(caixaAtual.aberto_em); setModalCorrigirData(true); setMensagem('') }}>Corrigir data/hora</button>
                          <button className="dropdown-filtro-item" onClick={() => { setMenuCaixaAberto(false); setModalRelatorio(true) }}>Relatório</button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="resumo-linhas">
                    <div className="linha"><span>{caixaAtual.qtd_vendas} Descontos em vendas</span><span className="texto-vermelho">-R$ {caixaAtual.descontos.toFixed(2)}</span></div>
                    <div className="linha"><span>Saldo inicial</span><span>R$ {caixaAtual.saldo_inicial.toFixed(2)}</span></div>
                    <div className="linha"><span>Total de vendas</span><span>R$ {totalVendas.toFixed(2)}</span></div>
                    <div className="linha"><span>Adicionado (suprimento)</span><span className="texto-verde">+R$ {caixaAtual.total_suprimentos.toFixed(2)}</span></div>
                    <div className="linha"><span>Retirado (sangria)</span><span className="texto-vermelho">-R$ {caixaAtual.total_sangrias.toFixed(2)}</span></div>
                    <div className="linha saldo-final"><span>Saldo Final</span><strong>R$ {saldoFinal.toFixed(2)}</strong></div>
                    <div className="linha"><span>Lucro Bruto</span><span className="texto-verde">R$ {lucroBruto.toFixed(2)}</span></div>
                  </div>
                  <div className="card-caixa-acoes">
                    <button className="btn-secundario" onClick={() => { setTipoMov('suprimento'); setModalMov(true) }}>Adicionar Dinheiro</button>
                    <button className="btn-secundario" onClick={() => { setTipoMov('sangria'); setModalMov(true) }}>Remover Valores</button>
                  </div>
                </section>

                <section className="card-caixa">
                  <div className="card-caixa-topo">
                    <h3>Canais de Venda</h3>
                    <button className="btn-icone" title="Detalhes">⋯</button>
                  </div>
                  <div className="canais-lista">
                    {canais.length === 0 && <p className="sem-resultado">Nenhuma venda ainda.</p>}
                    {canais.map((c) => (
                      <div key={c.tipo} className="canal-item">
                        <div className="canal-info">
                          <span>{c.tipo === 'delivery' ? 'Online' : 'Loja / Venda Local'}</span>
                          <strong>R$ {c.valor.toFixed(2)}</strong>
                        </div>
                        <div className="canal-barra">
                          <div
                            className="canal-barra-preenchida"
                            style={{ width: `${(c.valor / canalMax) * 100}%`, background: corCanal(c.tipo) }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="caixa-coluna-meio">
                <section className="card-caixa">
                  <div className="card-caixa-topo">
                    <h3>Meio de Pagamento</h3>
                    <button className="btn-icone" title="Detalhes">⋯</button>
                  </div>
                  <div className="formas-lista">
                    {formas.length === 0 && <p className="sem-resultado">Nenhum pagamento ainda.</p>}
                    {formas.map((f) => (
                      <div key={f.forma} className="forma-item">
                        <span className={`forma-icone forma-${nomeFormaIcone(f.forma)}`}>
                          {nomeFormaIcone(f.forma) === 'dinheiro' ? 'R$' : nomeFormaIcone(f.forma) === 'pix' ? 'P' : nomeFormaIcone(f.forma) === 'credito' ? 'C' : nomeFormaIcone(f.forma) === 'debito' ? 'D' : '•'}
                        </span>
                        <span className="forma-nome">{f.forma}</span>
                        <strong>R$ {f.valor.toFixed(2)}</strong>
                      </div>
                    ))}
                    <div className="forma-total">
                      <span>Total</span>
                      <strong>R$ {totalFormas.toFixed(2)}</strong>
                    </div>
                  </div>
                </section>
              </div>

              <div className="caixa-coluna-mov">
                <section className="card-caixa card-movimentacao">
                  <div className="card-caixa-topo">
                    <h3>Movimentação <span className="seta-titulo">▾</span></h3>
                    <button className="link-detalhes" onClick={() => setAba('conferir')}>Mais detalhes</button>
                  </div>
                  <div className="timeline">
                    {timeline.map((m) => (
                      <div key={m.id} className="timeline-item">
                        <div className="timeline-ponto" />
                        <div className="timeline-conteudo">
                          <strong className={m.valor < 0 ? 'texto-vermelho' : ''}>
                            {m.valor < 0 ? '-' : ''}R$ {Math.abs(m.valor).toFixed(2)}
                          </strong>
                          <span>{m.descricao}</span>
                          <small>{m.detalhe}</small>
                        </div>
                        {m.criado_em && <span className="timeline-hora">{m.criado_em.slice(11, 16)}</span>}
                      </div>
                    ))}
                    {timeline.length === 0 && <p className="sem-resultado">Sem movimentações.</p>}
                  </div>
                  <div className="timeline-saldo">
                    <span>Saldo Final</span>
                    <strong>R$ {saldoFinal.toFixed(2)}</strong>
                    <button className="btn-fechar-caixa" onClick={() => setModalFechar(true)}>Fechar Caixa</button>
                  </div>
                </section>
              </div>
            </div>
          )}
        </>
      )}

      {aba === 'anteriores' && (
        <div className="rel-painel">
          <div className="rel-cabecalho">
            <h3>Caixas anteriores</h3>
            <div className="dropdown-filtro">
              <button
                className="btn-secundario dropdown-periodo-btn"
                onClick={() => setFiltroAberto((v) => !v)}
                title="Filtros"
              >
                {soComQuebra ? 'Caixas com quebra' : 'Todos os caixas'} <span className="seta-dropdown">▼</span>
              </button>
              {filtroAberto && (
                <div className="dropdown-filtro-menu">
                  <button className={`dropdown-filtro-item ${!soComQuebra ? 'ativo' : ''}`} onClick={() => { setSoComQuebra(false); setLimiteHistorico(60); setFiltroAberto(false) }}>
                    Todos os caixas
                  </button>
                  <button className={`dropdown-filtro-item ${soComQuebra ? 'ativo' : ''}`} onClick={() => { setSoComQuebra(true); setLimiteHistorico(60); setFiltroAberto(false) }}>
                    Mostrar caixas que tiveram quebra
                  </button>
                </div>
              )}
            </div>
            <input
              className="input-busca-caixa"
              value={buscaCodigo}
              onChange={(e) => setBuscaCodigo(e.target.value.replace(/\D/g, ''))}
              placeholder="Buscar por nº do caixa"
            />
            <button className="btn-secundario" onClick={() => setModalTotalizar(true)}>Totalizar Período</button>
          </div>
          <p className="nota-config">A quebra é o saldo final do caixa ser diferente do valor informado no fechamento.</p>
          <div className="tabela-scroll-h">
          <table className="tabela tabela-redimensao">
            <thead>
              <tr>
                {COLUNAS_CAIXA.map(([chave, rotulo]) => (
                  <th key={chave} style={colLarguras[chave] ? { width: colLarguras[chave] } : undefined}>
                    {rotulo}
                    <span className="th-redim-alca" onPointerDown={(e) => iniciarRedimensionar(chave)(e)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historico.filter((c) => !buscaCodigo || String(c.id) === buscaCodigo).map((c) => (
                <Fragment key={c.id}>
                  <tr className="caixa-linha">
                    <td className="td-acoes">
                      <button className="btn-mini" title="Ver vendas e movimentações deste caixa" onClick={() => alternarCaixa(c.id)}>Ver</button>
                      <button className="btn-mini" title="Reabrir este caixa" onClick={() => reabrirCaixa(c.id)}>Reabrir</button>
                    </td>
                    <td>#{c.id}</td>
                    <td>{c.aberto_em}</td>
                    <td>{c.fechado_em ?? '-'}</td>
                    <td>{c.usuario_nome ?? '-'}</td>
                    <td>{c.usuario_fechamento_nome ?? '-'}</td>
                    <td>R$ {c.total_vendas.toFixed(2)}</td>
                    <td>{c.qtd_vendas}</td>
                    <td>R$ {(c.saldo_inicial + c.total_vendas + c.total_suprimentos - c.total_sangrias).toFixed(2)}</td>
                    <td>{c.saldo_informado != null ? `R$ ${c.saldo_informado.toFixed(2)}` : '-'}</td>
                    <td className={c.quebra != null && c.quebra !== 0 ? 'texto-vermelho' : ''}>
                      {c.quebra != null ? `R$ ${c.quebra.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                  {caixaExpandido === c.id && (
                    <tr key={`d${c.id}`} className="caixa-detalhe-linha">
                      <td colSpan={COLUNAS_CAIXA.length}>
                        <div className="caixa-detalhe">
                          {c.reaberto_em && (
                            <div className="caixa-movimentos">
                              <strong className="caixa-movimentos-titulo">Reaberto</strong>
                              <div className="caixa-venda-item">
                                <span>Reaberto em {c.reaberto_em}{c.reaberto_por_nome ? ` por ${c.reaberto_por_nome}` : ''}</span>
                              </div>
                            </div>
                          )}
                          {movimentosCaixa.length > 0 && (
                            <div className="caixa-movimentos">
                              <strong className="caixa-movimentos-titulo">Movimentações</strong>
                              {movimentosCaixa.map((m, mi) => (
                                <div key={mi} className="caixa-venda-item">
                                  <span>{m.tipo === 'sangria' ? 'Sangria/Quebra' : m.tipo === 'suprimento' ? 'Suprimento' : m.tipo === 'abertura' ? 'Abertura' : 'Fechamento'} {m.motivo ? `- ${m.motivo}` : ''}</span>
                                  <span>{m.criado_em?.slice(0, 16)}</span>
                                  <strong className={m.tipo === 'sangria' ? 'texto-vermelho' : ''}>
                                    {m.tipo === 'sangria' ? '-' : '+'}R$ {m.valor.toFixed(2)}
                                  </strong>
                                </div>
                              ))}
                            </div>
                          )}
                          {vendasCaixa.length === 0 ? (
                            <p className="sem-resultado">Nenhuma venda neste caixa.</p>
                          ) : (
                            vendasCaixa.map((v) => (
                              <div key={v.id} className="caixa-venda">
                                <div className="caixa-venda-cab">
                                  <strong>{v.numero}</strong>
                                  <span>{v.created_at}</span>
                                  <strong>R$ {v.total.toFixed(2)}</strong>
                                </div>
                                {v.itens.length > 0 && (
                                  <div className="caixa-venda-itens">
                                    {v.itens.map((it, idx) => (
                                      <div key={idx} className="caixa-venda-item">
                                        <span>{it.nome_produto}</span>
                                        <span>{it.quantidade}x</span>
                                        <span>R$ {it.preco_unitario.toFixed(2)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {historico.filter((c) => !buscaCodigo || String(c.id) === buscaCodigo).length === 0 && (
                <tr><td colSpan={COLUNAS_CAIXA.length} className="sem-resultado">Nenhum caixa anterior.</td></tr>
              )}
            </tbody>
          </table>
          </div>
          {historico.length >= limiteHistorico && (
            <div className="carregar-mais-wrap">
              <button className="btn-secundario" onClick={() => setLimiteHistorico((l) => l + 60)}>
                Carregar mais caixas
              </button>
            </div>
          )}
        </div>
      )}

      {aba === 'conferir' && (
        !caixaAtual ? (
          <div className="rel-painel caixa-sem-caixa">
            <h3>Nenhum caixa aberto</h3>
            <p className="sem-resultado">Abra o caixa para conferir os meios de pagamento.</p>
            <button className="btn-primario" onClick={abrirModalAbrir}>Abrir caixa</button>
          </div>
        ) : (
        <div className="rel-painel">
          <h3>Conferir Meio de Pagamento</h3>
          <p className="nota-config">Informe o valor físico/digital conferido de cada meio e compare com o registrado.</p>
          <table className="tabela">
            <thead>
              <tr><th>Meio</th><th>Registrado</th><th>Conferido</th><th>Diferença</th></tr>
            </thead>
            <tbody>
              {formas.map((f) => {
                const conf = Number(conferencia[f.forma]) || 0
                const dif = conf - f.valor
                return (
                  <tr key={f.forma}>
                    <td>{f.forma}</td>
                    <td>R$ {f.valor.toFixed(2)}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="input-tabela"
                        value={conferencia[f.forma] ?? ''}
                        onChange={(e) => setConferencia({ ...conferencia, [f.forma]: e.target.value })}
                        placeholder="0.00"
                      />
                    </td>
                    <td className={dif < 0 ? 'texto-vermelho' : dif > 0 ? 'texto-verde' : ''}>
                      {conferencia[f.forma] ? `R$ ${dif.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                )
              })}
              {formas.length === 0 && (
                <tr><td colSpan={4} className="sem-resultado">Nenhum pagamento no caixa.</td></tr>
              )}
            </tbody>
          </table>
          <div className="modal-acoes">
            <button className="btn-primario" onClick={confirmarConferencia}>Salvar conferência</button>
          </div>
        </div>
        )
      )}

      {aba === 'contador' && (
        !caixaAtual ? (
          <div className="rel-painel caixa-sem-caixa">
            <h3>Nenhum caixa aberto</h3>
            <p className="sem-resultado">Abra o caixa para usar o contador de dinheiro.</p>
            <button className="btn-primario" onClick={abrirModalAbrir}>Abrir caixa</button>
          </div>
        ) : (
        <div className="caixa-contador">
          <section className="card-caixa">
            <div className="card-caixa-topo"><h3>Contador de Dinheiro</h3></div>
            <div className="contador-celulas">
              <div className="contador-grupo">
                <h4>Cédulas</h4>
                {CEDULAS.map((c) => (
                  <div key={c} className="contador-linha">
                    <span>R$ {c.toFixed(2)}</span>
                    <input
                      type="number"
                      min="0"
                      value={contador[`c${c}`] ?? ''}
                      onChange={(e) => setContador({ ...contador, [`c${c}`]: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
              <div className="contador-grupo">
                <h4>Moedas</h4>
                {MOEDAS.map((m) => (
                  <div key={m} className="contador-linha">
                    <span>R$ {m.toFixed(2)}</span>
                    <input
                      type="number"
                      min="0"
                      value={contador[`m${m}`] ?? ''}
                      onChange={(e) => setContador({ ...contador, [`m${m}`]: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="contador-total">
              <span>Total contado</span>
              <strong>R$ {totalContado.toFixed(2)}</strong>
            </div>
            <div className={`modal-acoes ${totalContado === saldoFinal ? 'diferenca-ok' : ''}`}>
              <span className="nota-config">
                Diferença: R$ {(totalContado - saldoFinal).toFixed(2)}
              </span>
              <button className="btn-primario" onClick={() => { setSaldoFechamento(String(totalContado)); setModalFechar(true) }}>
                Usar na conferência
              </button>
            </div>
          </section>
        </div>
        )
      )}

      {modalAbrir && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Abrir caixa</h3>
            <div className="form-grid">
              <label>Operador: {usuarioNome ?? usuarioId ?? '-'}</label>
              <label>Saldo inicial (R$)
                {caixaSaldoAbertura !== 'informar' ? (
                  <>
                    <input autoFocus readOnly value={saldoAbertura} placeholder="0,00" inputMode="decimal" tabIndex={-1} />
                    <small className="nota-config">
                      {caixaSaldoAbertura === 'anterior' ? 'Saldo anterior (não pode ser alterado).' : 'Caixa zerado (não pode ser alterado).'}
                    </small>
                  </>
                ) : (
                  <input
                    autoFocus
                    value={saldoAbertura}
                    onChange={(e) => setSaldoAbertura(formatarMoedaDigitos(e.target.value))}
                    placeholder="0,00"
                    inputMode="decimal"
                  />
                )}
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalAbrir(false)}>Cancelar</button>
              <button className="btn-primario" onClick={abrirCaixa}>Abrir</button>
            </div>
          </div>
        </div>
      )}

      {modalMov && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>{tipoMov === 'sangria' ? 'Remover Valores' : 'Adicionar Dinheiro'}</h3>
            <div className="form-grid">
              {tipoMov === 'sangria' && meiosPagamento.length > 0 ? (
                <>
                  {meiosPagamento.map((m) => (
                    <label key={m.id} style={{ gridColumn: '1 / -1' }}>
                      {m.nome} (R$)
                      <input
                        value={sangriasPorForma[m.nome] ?? ''}
                        onChange={(e) => setSangriasPorForma({ ...sangriasPorForma, [m.nome]: formatarMoedaDigitos(e.target.value) })}
                        placeholder="0,00"
                        inputMode="decimal"
                      />
                    </label>
                  ))}
                  <div className="modal-resumo" style={{ gridColumn: '1 / -1' }}>
                    <div className="linha"><span>Total a remover</span><strong>R$ {totalSangriaPorForma.toFixed(2)}</strong></div>
                  </div>
                  <span className="nota-config" style={{ gridColumn: '1 / -1' }}>
                    Informe o valor retirado em cada meio de pagamento separadamente.
                  </span>
                </>
              ) : (
                <label>Valor (R$)
                  <input
                    autoFocus
                    value={valorMov}
                    onChange={(e) => setValorMov(formatarMoedaDigitos(e.target.value))}
                    placeholder="0,00"
                    inputMode="decimal"
                  />
                  <small className="nota-config">Digite somente números — ex: 1500 = R$ 15,00</small>
                </label>
              )}
              <label style={{ gridColumn: '1 / -1' }}>Motivo
                <input value={motivoMov} onChange={(e) => setMotivoMov(e.target.value)} placeholder={tipoMov === 'sangria' ? 'Ex: pagar entregador, troco...' : 'Ex: aporte de troco...'} />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalMov(false)}>Cancelar</button>
              <button className="btn-primario" onClick={lancarMovimento}>Registrar</button>
            </div>
          </div>
        </div>
      )}

      {modalFechar && caixaAtual && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Fechar caixa #{caixaAtual.id}</h3>
            <div className="modal-resumo">
              <div className="linha"><span>Saldo inicial</span><strong>R$ {caixaAtual.saldo_inicial.toFixed(2)}</strong></div>
              <div className="linha"><span>Total de vendas</span><strong>R$ {totalVendas.toFixed(2)}</strong></div>
              <div className="linha"><span>Entradas (suprimentos)</span><strong>R$ {caixaAtual.total_suprimentos.toFixed(2)}</strong></div>
              <div className="linha"><span>Retiradas (sangrias)</span><strong>R$ {caixaAtual.total_sangrias.toFixed(2)}</strong></div>
              <div className="linha"><span>Descontos</span><strong className="texto-vermelho">-R$ {caixaAtual.descontos.toFixed(2)}</strong></div>
              {fechamentoPor === 'forma' && (
                <>
                  {formas.map((f) => (
                    <div key={f.forma} className="linha"><span>• {f.forma}</span><strong>R$ {f.valor.toFixed(2)}</strong></div>
                  ))}
                </>
              )}
              <div className="linha total-periodo"><span>Saldo Final</span><strong>R$ {saldoFinal.toFixed(2)}</strong></div>
            </div>
            <div className="form-grid">
              <label>Saldo físico contado (R$) {exigirSaldoFinal ? '(obrigatório)' : '(opcional)'}
                <input autoFocus value={saldoFechamento} onChange={(e) => setSaldoFechamento(formatarMoedaDigitos(e.target.value))} placeholder={saldoFinal.toFixed(2)} inputMode="decimal" />
              </label>
            </div>
            <div className="modal-resumo">
              <div className="linha total-periodo"><span>Quebra de caixa</span>
                <strong className={parseMoedaDigitada(saldoFechamento) - saldoFinal !== 0 ? 'texto-vermelho' : ''}>
                  {((parseMoedaDigitada(saldoFechamento) - saldoFinal) >= 0 ? '+' : '') + (parseMoedaDigitada(saldoFechamento) - saldoFinal).toFixed(2)}
                </strong>
              </div>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalFechar(false)}>Cancelar</button>
              <button className="btn-primario" onClick={fecharCaixa}>Confirmar fechamento</button>
            </div>
          </div>
        </div>
      )}

      {modalConfirmarQuebra && quebraPendente && caixaAtual && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Confirmação de quebra de caixa</h3>
            <p className="sem-resultado">
              O saldo físico informado difere do saldo do sistema. O valor correto apontado pelo sistema é{' '}
              <strong>R$ {saldoFinal.toFixed(2)}</strong>. Confirma o fechamento com a quebra registrada abaixo?
            </p>
            <div className="modal-resumo">
              <div className="linha"><span>Saldo do sistema (correto)</span><strong>R$ {saldoFinal.toFixed(2)}</strong></div>
              <div className="linha"><span>Saldo físico informado</span><strong>R$ {quebraPendente.saldoFisico.toFixed(2)}</strong></div>
              <div className="linha total-periodo"><span>Quebra de caixa</span>
                <strong className={quebraPendente.quebra < 0 ? 'texto-vermelho' : ''}>
                  {quebraPendente.quebra >= 0 ? '+' : ''}R$ {quebraPendente.quebra.toFixed(2)}
                </strong>
              </div>
            </div>
            {quebraPendente.quebra < 0 && (
              <p className="sem-resultado texto-vermelho">
                Atenção: houve sobra/valores divergentes. Revise o valor contado antes de confirmar.
              </p>
            )}
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => { setModalConfirmarQuebra(false); setQuebraPendente(null) }}>Voltar</button>
              <button className="btn-primario" onClick={() => executarFechamento(quebraPendente.saldoFisico, saldoFinal, quebraPendente.quebra)}>Confirmar e fechar no valor do sistema</button>
            </div>
          </div>
        </div>
      )}

      {modalAlterarSaldo && caixaAtual && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Alterar saldo inicial — caixa #{caixaAtual.id}</h3>
            <p className="nota-config">O saldo inicial atual é R$ {caixaAtual.saldo_inicial.toFixed(2)}. Digite o novo valor em R$.</p>
            <div className="form-grid">
              <label>Novo saldo inicial (R$)
                <input autoFocus value={novoSaldoInicial} onChange={(e) => setNovoSaldoInicial(formatarMoedaDigitos(e.target.value))} placeholder="0,00" inputMode="decimal" />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalAlterarSaldo(false)}>Cancelar</button>
              <button className="btn-primario" onClick={alterarSaldoInicial}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {modalCorrigirData && caixaAtual && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Corrigir data/hora — caixa #{caixaAtual.id}</h3>
            <p className="nota-config">Ajuste a data/hora de abertura do caixa. Formato: AAAA-MM-DD HH:MM:SS.</p>
            <div className="form-grid">
              <label>Data/hora de abertura
                <input autoFocus value={novaAbertura} onChange={(e) => setNovaAbertura(e.target.value)} placeholder="2026-08-31 08:00:00" />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalCorrigirData(false)}>Cancelar</button>
              <button className="btn-primario" onClick={corrigirDataHora}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {modalRelatorio && caixaAtual && (
        <div className="modal-overlay" onClick={() => setModalRelatorio(false)}>
          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>Relatório do caixa #{caixaAtual.id}</h3>
            <div className="modal-resumo">
              <div className="linha"><span>Abertura</span><strong>{caixaAtual.aberto_em}</strong></div>
              <div className="linha"><span>Saldo inicial</span><strong>R$ {caixaAtual.saldo_inicial.toFixed(2)}</strong></div>
              <div className="linha"><span>Total de vendas</span><strong>R$ {totalVendas.toFixed(2)}</strong></div>
              <div className="linha"><span>Qtd. vendas</span><strong>{caixaAtual.qtd_vendas}</strong></div>
              <div className="linha"><span>Entradas (suprimentos)</span><strong>R$ {caixaAtual.total_suprimentos.toFixed(2)}</strong></div>
              <div className="linha"><span>Retiradas (sangrias)</span><strong>R$ {caixaAtual.total_sangrias.toFixed(2)}</strong></div>
              <div className="linha"><span>Descontos</span><strong className="texto-vermelho">-R$ {caixaAtual.descontos.toFixed(2)}</strong></div>
              <div className="linha total-periodo"><span>Saldo Final</span><strong>R$ {saldoFinal.toFixed(2)}</strong></div>
            </div>
            <div className="modal-acoes">
              <button className="btn-primario" onClick={() => { setModalRelatorio(false); setMensagem('Relatório de caixa gerado.') }}>Gerar relatório</button>
            </div>
          </div>
        </div>
      )}

      {modalTotalizar && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Totalizar Período</h3>
            <p className="nota-config">
              Soma os caixas do período atual ({periodoFiltro === 'todos' ? 'todos' : periodoFiltro === 'hoje' ? 'hoje' : periodoFiltro === 'ontem' ? 'ontem' : periodoFiltro === '7d' ? 'últimos 7 dias' : periodoFiltro === 'mensal' ? 'este mês' : 'personalizado'}) mostrados na lista acima ({historico.filter((c) => !buscaCodigo || String(c.id) === buscaCodigo).length} caixa(s)).
            </p>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalTotalizar(false)}>Cancelar</button>
              <button className="btn-primario" onClick={totalizarPeriodo}>Totalizar</button>
            </div>
          </div>
        </div>
      )}

      {modalOpcoes && <OpcoesCaixa onFechar={() => setModalOpcoes(false)} />}
      </>
      )}
    </div>
  )
}
