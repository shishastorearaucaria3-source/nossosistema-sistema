import { useEffect, useMemo, useRef, useState } from 'react'
import { getPedidosOnlineApi, PedidoOnline } from '../../shared/db'
import { formatarMoeda } from '../../shared/CampoDinheiro'

// Fluxo profissional de atendimento do pedido online.
const STATUS_FLUXO = ['novo', 'confirmado', 'separando', 'saiu_entrega', 'entregue', 'cancelado'] as const

const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo',
  confirmado: 'Confirmado',
  separando: 'Separando',
  saiu_entrega: 'Saiu para entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado'
}

// Estados finais (não podem avançar para um status de fluxo).
const STATUS_FINAL: Record<string, boolean> = {
  entregue: true,
  cancelado: true
}

const FORMAS_LABEL: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito'
}

const MODALIDADE_LABEL: Record<string, string> = {
  entrega: 'Entrega',
  retirada: 'Retirada'
}

const formatarData = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const formatarDataCurta = (iso: string | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const formatarTelefone = (v: string | null | undefined): string => {
  const s = String(v || '').replace(/\D/g, '')
  if (s.length === 11) return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`
  if (s.length === 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`
  return v || '—'
}

const formatarMoedaBr = (n: number | null | undefined): string => {
  const v = Number(n || 0)
  return v.toFixed(2).replace('.', ',')
}

interface Toast {
  tipo: 'ok' | 'erro' | 'info'
  texto: string
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export default function PedidosOnline() {
  const [pedidos, setPedidos] = useState<PedidoOnline[]>([])
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [puxando, setPuxando] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [detalhe, setDetalhe] = useState<PedidoOnline | null>(null)
  const [detalheAberto, setDetalheAberto] = useState(false)
  const [atualizando, setAtualizando] = useState<string | null>(null)

  const puxandoRef = useRef(false)

  const mostrarToast = (tipo: Toast['tipo'], texto: string) => {
    setToast({ tipo, texto })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToast(null), 4000)
  }

  const carregar = async (silencioso = false) => {
    if (!silencioso) setCarregando(true)
    try {
      const r = await getPedidosOnlineApi().listar({ busca, status: filtroStatus, de, ate })
      if (r.ok) {
        setPedidos(r.pedidos ?? [])
      } else if (!silencioso) {
        setPedidos([])
        mostrarToast('erro', r.erro || 'Falha ao listar pedidos.')
      }
    } catch {
      if (!silencioso) mostrarToast('erro', 'Servidor indisponível. Verifique a conexão.')
    } finally {
      if (!silencioso) setCarregando(false)
    }
  }

  const puxar = async (silencioso = false) => {
    if (puxandoRef.current) return
    puxandoRef.current = true
    if (!silencioso) setPuxando(true)
    try {
      const r = await getPedidosOnlineApi().puxar()
      if (!silencioso) {
        if (r.ok) {
          mostrarToast('ok', r.puxados && r.puxados > 0 ? `${r.puxados} pedido(s) novo(s) importado(s).` : 'Nenhum pedido novo.')
        } else if (r.erro === 'nao_autorizado') {
          mostrarToast('erro', 'Não foi possível autenticar no catálogo online.')
        } else if (r.erro === 'supabase_nao_configurado' || r.erro === 'EMPRESA_ID_nao_configurado') {
          mostrarToast('erro', 'Catálogo online não configurado neste terminal.')
        } else {
          mostrarToast('erro', r.erro || 'Falha ao puxar pedidos.')
        }
      }
      await carregar(true)
    } catch {
      if (!silencioso) mostrarToast('erro', 'Erro de comunicação com o servidor.')
    } finally {
      puxandoRef.current = false
      if (!silencioso) setPuxando(false)
    }
  }

  useEffect(() => {
    carregar()
    // Atualização automática: puxa novos pedidos e recarrega a lista sem
    // recarregar a aplicação. Silencioso para não interromper o operador.
    puxar(true)
    const id = setInterval(() => {
      puxar(true)
    }, 20_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Aplica busca/filtro ao recarregar a lista quando mudam (sem aguardar o
    // intervalo). Evita disparar no primeiro mount.
    const t = setTimeout(() => carregar(true), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtroStatus, de, ate])

  const abrirDetalhe = async (id: string) => {
    try {
      const r = await getPedidosOnlineApi().detalhe(id)
      if (r.ok && r.pedido) {
        setDetalhe(r.pedido)
        setDetalheAberto(true)
      } else {
        mostrarToast('erro', r.erro || 'Não foi possível carregar o pedido.')
      }
    } catch {
      mostrarToast('erro', 'Falha ao carregar o detalhe do pedido.')
    }
  }

  const mudarStatus = async (id: string, status: string) => {
    setAtualizando(id)
    try {
      const r = await getPedidosOnlineApi().atualizarStatus(id, status)
      if (r.ok) {
        mostrarToast(
          r.sincronizado === false ? 'info' : 'ok',
          r.sincronizado === false
            ? 'Status atualizado localmente, mas não foi possível salvar na nuvem (offline).'
            : `Pedido atualizado para "${STATUS_LABEL[status] || status}".`
        )
        // Se o detalhe está aberto para este pedido, recarrega o tracking.
        if (detalhe?.id === id) await abrirDetalhe(id)
        await carregar(true)
      } else {
        mostrarToast('erro', r.erro || 'Falha ao atualizar status.')
      }
    } catch {
      mostrarToast('erro', 'Erro de comunicação ao atualizar o status.')
    } finally {
      setAtualizando(null)
    }
  }

  const contadores = useMemo(() => {
    const c: Record<string, number> = {}
    for (const s of STATUS_FLUXO) c[s] = 0
    for (const p of pedidos) {
      const st = STATUS_FINAL[p.status] && p.status !== 'novo' ? p.status : p.status
      c[st] = (c[st] || 0) + 1
    }
    c['todos'] = pedidos.length
    return c
  }, [pedidos])

  // Resumo financeiro do filtro atual
  const resumoTotal = useMemo(() => pedidos.reduce((s, p) => s + (p.total || 0), 0), [pedidos])

  const candidatosProximoStatus = useMemo(() => {
    const m: Record<string, string[]> = {}
    const passos: string[] = [...STATUS_FLUXO]
    for (let i = 0; i < passos.length; i++) {
      const atual = passos[i]
      m[atual] = i < passos.length - 1 ? [passos[i + 1]] : []
    }
    // Do fluxo, 'entregue' e 'cancelado' são finais. Cancelar é possível a partir
    // de qualquer status não final.
    m['novo'] = ['confirmado', 'cancelado']
    m['confirmado'] = ['separando', 'cancelado']
    m['separando'] = ['saiu_entrega', 'cancelado']
    m['saiu_entrega'] = ['entregue', 'cancelado']
    return m
  }, [])

  const statusFinal = (s: string) => !!STATUS_FINAL[s]

  return (
    <div className="podon-pagina">
      <div className="podon-topo">
        <div className="podon-titulo-bloco">
          <h2 className="pg-titulo">Pedidos Online</h2>
          <p className="podon-subtitulo">
            Pedidos feitos no catálogo online, importados e acompanhados aqui em tempo real.
          </p>
        </div>
        <div className="podon-acoes">
          <button className="btn-primario" onClick={() => puxar(false)} disabled={puxando}>
            {puxando ? 'Puxando…' : 'Puxar pedidos'}
          </button>
          <button className="btn-secundario" onClick={() => carregar(false)} disabled={carregando}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {toast && (
        <div className={`podon-toast podon-toast-${toast.tipo}`} role="status">
          <span className="podon-toast-icone">{toast.tipo === 'ok' ? '✓' : toast.tipo === 'erro' ? '✕' : 'ℹ'}</span>
          <span>{toast.texto}</span>
        </div>
      )}

      <div className="podon-resumo">
        <div className="podon-resumo-item">
          <span>Total no filtro</span>
          <strong>{pedidos.length}</strong>
        </div>
        <div className="podon-resumo-item">
          <span>Valor no filtro</span>
          <strong>R$ {formatarMoedaBr(resumoTotal)}</strong>
        </div>
        <div className="podon-resumo-item podon-resumo-novo">
          <span>Novos</span>
          <strong>{contadores['novo'] || 0}</strong>
        </div>
        <div className="podon-resumo-item podon-resumo-andam">
          <span>Em andamento</span>
          <strong>{(contadores['confirmado'] || 0) + (contadores['separando'] || 0) + (contadores['saiu_entrega'] || 0)}</strong>
        </div>
        <div className="podon-resumo-item podon-resumo-entregue">
          <span>Entregues</span>
          <strong>{contadores['entregue'] || 0}</strong>
        </div>
        <div className="podon-resumo-item podon-resumo-cancelado">
          <span>Cancelados</span>
          <strong>{contadores['cancelado'] || 0}</strong>
        </div>
      </div>

      <div className="podon-filtros">
        <div className="podon-busca">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            type="text"
            placeholder="Buscar por número, cliente ou telefone…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="podon-filtro">
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="select-padrao">
            <option value="todos">Todos os status</option>
            {STATUS_FLUXO.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="podon-filtro">
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="input-padrao" title="De" />
          <span className="podon-filtro-sep">até</span>
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="input-padrao" title="Até" />
        </div>
      </div>

      <div className="tabela-wrap">
        <table className="tabela-padrao">
          <thead>
            <tr>
              <th>N°</th>
              <th>Cliente</th>
              <th>Data / Hora</th>
              <th>Itens</th>
              <th>Entrega</th>
              <th>Subtotal</th>
              <th>Total</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.length === 0 && (
              <tr>
                <td colSpan={9} className="podon-vazio">
                  {carregando ? 'Carregando…' : 'Nenhum pedido encontrado. Puxe os pedidos do catálogo online para começar.'}
                </td>
              </tr>
            )}
            {pedidos.map((p) => (
              <tr key={p.id} className={`podon-linha ${p.status === 'novo' ? 'podon-linha-novo' : ''}`}>
                <td className="podon-numero">#{p.numero}</td>
                <td>
                  <strong>{p.cliente_nome}</strong>
                  <div className="podon-wpp">{formatarTelefone(p.cliente_whatsapp)}</div>
                </td>
                <td>{formatarData(p.criado_em)}</td>
                <td className="podon-itens-count">{p.itens?.length || 0} item(ns)</td>
                <td>
                  {p.modalidade === 'entrega' ? (
                    <>
                      <span className="podon-modalidade">Entrega</span>
                      {p.zona_nome && <span className="podon-zona"> · {p.zona_nome}</span>}
                      <div className="podon-taxa">Taxa R$ {formatarMoedaBr(p.taxa_entrega)}</div>
                    </>
                  ) : (
                    <span className="podon-modalidade">Retirada</span>
                  )}
                </td>
                <td>R$ {formatarMoedaBr(p.subtotal)}</td>
                <td className="podon-total">R$ {formatarMoedaBr(p.total)}</td>
                <td>
                  <select
                    className={`podon-status podon-status-${p.status}`}
                    value={p.status}
                    onChange={(e) => mudarStatus(p.id, e.target.value)}
                    disabled={atualizando === p.id}
                  >
                    {STATUS_FLUXO.map((s) => (
                      <option key={s} value={s} disabled={p.status === s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="btn-mini" onClick={() => abrirDetalhe(p.id)}>Detalhes</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detalheAberto && detalhe && (
        <div className="modal-overlay" onClick={() => setDetalheAberto(false)}>
          <div className="modal podon-modal" onClick={(e) => e.stopPropagation()}>
            <div className="podon-modal-topo">
              <div>
                <h3 className="modal-produto-titulo">Pedido #{detalhe.numero}</h3>
                <p className="modal-produto-sub">
                  {formatarData(detalhe.criado_em)} · {MODALIDADE_LABEL[detalhe.modalidade] || detalhe.modalidade}
                </p>
              </div>
              <span className={`badge-status podon-status podon-status-${detalhe.status}`}>{STATUS_LABEL[detalhe.status] || detalhe.status}</span>
              <button className="modal-fechar" onClick={() => setDetalheAberto(false)} title="Fechar">✕</button>
            </div>

            <div className="podon-modal-corpo">
              <section className="podon-secao">
                <header className="podon-secao-titulo">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  Cliente
                </header>
                <div className="podon-info-grid">
                  <div><span>Nome</span><strong>{detalhe.cliente_nome}</strong></div>
                  <div><span>WhatsApp</span><strong>{formatarTelefone(detalhe.cliente_whatsapp)}</strong></div>
                  <div className="podon-info-linha-inteira">
                    <span>Pagamento</span>
                    <strong>{detalhe.forma_pagamento ? FORMAS_LABEL[detalhe.forma_pagamento] ?? detalhe.forma_pagamento : '—'}</strong>
                  </div>
                </div>
              </section>

              <section className="podon-secao">
                <header className="podon-secao-titulo">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" /><path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01" /></svg>
                  Entrega {detalhe.modalidade === 'entrega' ? '/ Retirada' : ''}
                </header>
                {detalhe.modalidade === 'entrega' ? (
                  <div className="podon-info-grid">
                    <div className="podon-info-linha-inteira"><span>Endereço</span><strong>{detalhe.endereco || '—'}</strong></div>
                    <div><span>CEP</span><strong>{detalhe.cep || '—'}</strong></div>
                    <div><span>Zona</span><strong>{detalhe.zona_nome || '—'}</strong></div>
                    <div><span>Taxa de entrega</span><strong>R$ {formatarMoedaBr(detalhe.taxa_entrega)}</strong></div>
                  </div>
                ) : (
                  <p className="nota-config">Retirada no local. Cliente avisado quando estiver pronto.</p>
                )}
                {detalhe.observacao && (
                  <div className="podon-obs">
                    <span>Observações do cliente</span>
                    <p>{detalhe.observacao}</p>
                  </div>
                )}
              </section>

              <section className="podon-secao">
                <header className="podon-secao-titulo">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
                  Itens do pedido
                </header>
                <table className="tabela-padrao podon-itens-tabela">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Qtd</th>
                      <th>Preço unit.</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detalhe.itens || []).map((i, idx) => (
                      <tr key={idx}>
                        <td>{i.nome_produto}</td>
                        <td>{i.quantidade}</td>
                        <td>R$ {formatarMoedaBr(i.preco_unitario)}</td>
                        <td>R$ {formatarMoedaBr(i.subtotal)}</td>
                      </tr>
                    ))}
                    {(detalhe.itens || []).length === 0 && (
                      <tr><td colSpan={4} className="podon-vazio">Sem itens.</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="podon-totais">
                  <div><span>Subtotal</span><strong>R$ {formatarMoedaBr(detalhe.subtotal)}</strong></div>
                  {detalhe.desconto > 0 && <div><span>Desconto</span><strong>- R$ {formatarMoedaBr(detalhe.desconto)}</strong></div>}
                  <div><span>Entrega</span><strong>R$ {formatarMoedaBr(detalhe.taxa_entrega)}</strong></div>
                  <div className="podon-total-final"><span>Total</span><strong>R$ {formatarMoedaBr(detalhe.total)}</strong></div>
                </div>
              </section>

              <section className="podon-secao">
                <header className="podon-secao-titulo">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                  Acompanhamento / Tracking
                </header>

                <div className="podon-stepper">
                  {STATUS_FLUXO.map((s, idx) => {
                    const final = statusFinal(s)
                    const atual = detalhe.status
                    const indiceAtual = STATUS_FLUXO.indexOf(atual as (typeof STATUS_FLUXO)[number])
                    const alcancado = idx <= indiceAtual
                    const clicavel = !final && !(atual === s) && !statusFinal(atual)
                    const permitido = (candidatosProximoStatus[atual] || []).includes(s) || alcancado
                    return (
                      <div
                        key={s}
                        className={[
                          'podon-passo',
                          final ? 'podon-passo-final' : '',
                          alcancado ? 'podon-passo-ativo' : '',
                          atual === s ? 'podon-passo-atual' : '',
                          clicavel && permitido ? 'podon-passo-clicavel' : ''
                        ].join(' ')}
                        onClick={() => clicavel && permitido && mudarStatus(detalhe.id, s)}
                        title={clicavel && permitido ? `Mudar para ${STATUS_LABEL[s]}` : ''}
                      >
                        <span className="podon-passo-bolha">{alcancado ? '✓' : idx + 1}</span>
                        <span className="podon-passo-nome">{STATUS_LABEL[s]}</span>
                      </div>
                    )
                  })}
                </div>

                <div className="podon-tracking">
                  <span className="podon-tracking-label">Histórico de status</span>
                  {(detalhe.tracking || []).length === 0 ? (
                    <p className="nota-config">Sem histórico registrado.</p>
                  ) : (
                    <ul className="podon-tracking-lista">
                      {[...(detalhe.tracking || [])].map((t) => (
                        <li key={t.id}>
                          <span className={`podon-status podon-status-${t.status}`}>{STATUS_LABEL[t.status] || t.status}</span>
                          <span className="podon-tracking-data">{formatarDataCurta(t.atualizado_em)}</span>
                          <span className="podon-tracking-origem">{t.origem === 'online' ? 'Catálogo online' : 'ERP'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>

            <div className="podon-modal-rodape">
              <button className="btn-secundario" onClick={() => setDetalheAberto(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
