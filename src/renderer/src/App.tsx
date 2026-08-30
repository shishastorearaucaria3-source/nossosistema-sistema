import { useEffect, useState, useCallback, useRef } from 'react'
import Pdv from './features/pdv/Pdv'
import Produtos from './features/produtos/Produtos'
import Clientes from './features/clientes/Clientes'
import Vendas from './features/vendas/Vendas'
import Estoque from './features/estoque/Estoque'
import Relatorios from './features/relatorios/Relatorios'
import Financeiro from './features/financeiro/Financeiro'
import Comissoes from './features/comissoes/Comissoes'
import Usuarios from './features/usuarios/Usuarios'
import Delivery from './features/delivery/Delivery'
import Zonas from './features/zonas/Zonas'
import CatalogoOnline from './features/catalogo/CatalogoOnline'
import Caixa from './features/caixa/Caixa'
import CaixaTransacoes from './features/caixa/CaixaTransacoes'
import FormasPagamento from './features/formaspagamento/FormasPagamento'
import AlterarPrecos from './features/precos/AlterarPrecos'
import AtendimentoWhatsApp from './features/whatsapp/AtendimentoWhatsApp'
import Home from './features/inicio/Home'
import Login from './features/login/Login'
import { getDbApi, hasDbApi, getAuthApi, Usuario, fazerBackupManual, setFullscreen, getServidorApi } from './shared/db'
import Toasts from './components/ui/Toast'

type Tela = 'inicio' | 'pdv' | 'produtos' | 'clientes' | 'vendas' | 'estoque' | 'financeiro' | 'comissoes' | 'relatorios' | 'usuarios' | 'delivery' | 'zonas' | 'catalogo' | 'caixa' | 'formaspagamento' | 'precos' | 'nfe' | 'sobre' | 'whatsapp'

const ICONES: Record<string, string> = {
  inicio: 'M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z',
  vendas: 'M6 3h12l2 5v13H4V8z M4 8h16 M9 3l1 5 M15 3l-1 5 M8 13h8 M8 17h5',
  clientes: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
  produtos: 'M3 7 12 3l9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  estoque: 'M4 7h16v13H4z M8 7V4h8v3 M9 12h6 M9 15h6',
  catalogo: 'M3 4h18v16H3z M3 10h18 M8 4v16 M16 4v16',
  financeiro: 'M3 6h18v13H3z M16 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M3 9h4 M17 15h4',
  caixa: 'M5 4h14a2 2 0 0 1 2 2v13H3V6a2 2 0 0 1 2-2z M3 9h18 M7 13h6 M7 16h4 M19 19v2',
  relatorios: 'M4 4h16v16H4z M8 16v-5 M12 16V8 M16 16v-3',
  nfe: 'M6 2h9l5 5v15H6z M14 2v5h5 M9 12h6 M9 16h6',
  apps: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  sobre: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01',
  pdv: 'M4 4h16v11H4z M8 20h8 M12 15v5 M2 20h20',
  delivery: 'M3 7h13v9H3z M16 10h4l2 3v3h-6z M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M18 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  zonas: 'M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  comissoes: 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5',
  formas: 'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z M2 10h20',
  precos: 'M3 6h18v13H3z M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M5 9h3 M5 13h3',
  usuarios: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
  whatsapp: 'M12 2C6.48 2 2 6.48 2 12c0 1.82.5 3.53 1.35 5L2 22l5.14-1.34A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z M16.5 14.5c-.25-.13-1.5-.74-1.73-.82-.23-.09-.4-.13-.56.13-.17.27-.64.82-.79.98-.14.17-.29.19-.54.06-.25-.13-1.04-.38-1.98-1.22-.74-.65-1.23-1.46-1.38-1.71-.14-.25-.02-.38.1-.51.1-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.76-1.85-.2-.48-.4-.42-.56-.42h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.5-.61 1.71-1.2.22-.59.22-1.1.15-1.2-.06-.11-.23-.17-.48-.3z'
}

interface MenuItem {
  id: Tela
  label: string
  icon: string
  atalho?: string
  admin?: boolean
  abrePdv?: boolean
  emBreve?: boolean
}

const MENU_PRINCIPAL: MenuItem[] = [
  { id: 'inicio', label: 'Início', icon: 'inicio' },
  { id: 'vendas', label: 'Vendas', icon: 'vendas' },
  { id: 'clientes', label: 'Clientes', icon: 'clientes' },
  { id: 'produtos', label: 'Produtos', icon: 'produtos' },
  { id: 'estoque', label: 'Estoque', icon: 'estoque' },
  { id: 'catalogo', label: 'Catálogo Online', icon: 'catalogo' },
  { id: 'financeiro', label: 'Contas a Pagar', icon: 'financeiro' },
  { id: 'caixa', label: 'Caixa', icon: 'caixa' },
  { id: 'relatorios', label: 'Relatórios', icon: 'relatorios' },
  { id: 'nfe', label: 'Nota Fiscal', icon: 'nfe', emBreve: true }
]

const MENU_GESTAO: MenuItem[] = [
  { id: 'comissoes', label: 'Comissões', icon: 'comissoes' },
  { id: 'precos', label: 'Alterar preços', icon: 'precos' },
  { id: 'whatsapp', label: 'Atendimento WhatsApp', icon: 'whatsapp', admin: true },
  { id: 'usuarios', label: 'Gerenciar usuários', icon: 'usuarios', admin: true }
]

export default function App() {
  const [loja, setLoja] = useState('Carregando...')
  const [tela, setTela] = useState<Tela>('inicio')
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [carregado, setCarregado] = useState(false)
  const [msgBackup, setMsgBackup] = useState('')
  const [pdvFocado, setPdvFocado] = useState(false)
  const [sidebarRecolhida, setSidebarRecolhida] = useState(false)
  const [caixaTransacoesId, setCaixaTransacoesId] = useState<number | null>(null)
  const [permissoes, setPermissoes] = useState<Set<string> | null>(null)
  const [pedidoEdicaoId, setPedidoEdicaoId] = useState<number | null>(null)
  const [modoPdv, setModoPdv] = useState<'venda' | 'pedido' | 'orcamento'>('venda')
  const [produtoEdicaoId, setProdutoEdicaoId] = useState<number | null>(null)
  const [novosPedidos, setNovosPedidos] = useState(0)
  const novosPedidosRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!hasDbApi() || !usuario) return
    const verificar = async () => {
      try {
        const rows = (await getDbApi().all(
          `SELECT id FROM pedidos WHERE status = 'novo'`
        )) as unknown as { id: number }[]
        const ids = new Set(rows.map((r) => r.id))
        const novos = rows.filter((r) => !novosPedidosRef.current.has(r.id))
        for (const r of rows) novosPedidosRef.current.add(r.id)
        if (novos.length > 0) {
          try {
            const ctx = new AudioContext()
            const notas = [880, 1108.73, 1318.51]
            notas.forEach((freq, idx) => {
              const osc = ctx.createOscillator()
              const ganho = ctx.createGain()
              osc.type = 'sine'
              osc.frequency.value = freq
              osc.connect(ganho)
              ganho.connect(ctx.destination)
              const t = ctx.currentTime + idx * 0.18
              ganho.gain.setValueAtTime(0.001, t)
              ganho.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
              ganho.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
              osc.start(t)
              osc.stop(t + 0.18)
            })
          } catch {
            // sem som
          }
        }
        setNovosPedidos(ids.size)
      } catch {
        // sem acesso
      }
    }
    verificar()
    const t = setInterval(verificar, 6000)
    return () => clearInterval(t)
  }, [usuario])

  useEffect(() => {
    if (!hasDbApi() || !usuario) return
    getDbApi()
      .get(`SELECT valor FROM config WHERE chave = 'nome_loja'`)
      .then((row) => {
        if (row) setLoja((row as { valor: string | null }).valor ?? 'Minha Tabacaria')
      })
      .catch(() => setLoja('Minha Tabacaria'))
  }, [usuario])

  useEffect(() => {
    if (!hasDbApi()) return
    getAuthApi()
      .session()
      .then((u) => setUsuario(u))
      .finally(() => setCarregado(true))
  }, [])

  useEffect(() => {
    if (!usuario) return
    const carregarPermissoes = async () => {
      try {
        if (usuario.perfil === 'admin') {
          setPermissoes(null)
          return
        }
        const rows = (await getDbApi().all(
          `SELECT modulo FROM permissoes WHERE usuario_id = ?`,
          [usuario.id]
        )) as unknown as { modulo: string }[]
        setPermissoes(new Set(rows.map((r) => r.modulo)))
      } catch {
        setPermissoes(new Set())
      }
    }
    carregarPermissoes()
  }, [usuario])

  // Monitor de conexão com o servidor: se perder a conexão, desconecta o usuário
  useEffect(() => {
    if (!usuario) return
    let falhas = 0
    let desconectou = false
    const checar = async () => {
      if (desconectou) return
      const desconectar = () => {
        desconectou = true
        setMsgBackup('Conexão com o servidor perdida. Você foi desconectado.')
        setUsuario(null)
        setTela('inicio')
        setPdvFocado(false)
        setFullscreen(false).catch(() => {})
      }
      try {
        const s = await getServidorApi().status()
        const online = !!(s && s.online && s.api === 'conectada')
        if (online) {
          falhas = 0
          return
        }
        falhas++
        if (falhas >= 2) {
          getAuthApi().logout().catch(() => {})
          desconectar()
        }
      } catch {
        falhas++
        if (falhas >= 2) {
          getAuthApi().logout().catch(() => {})
          desconectar()
        }
      }
    }
    checar()
    const t = setInterval(checar, 2000)
    return () => clearInterval(t)
  }, [usuario])

  // Gate de acesso a módulos (uma fonte única). admin (permissoes === null) tem
  // acesso a tudo; demais usuários precisam do módulo em 'permissoes'. Usado no
  // menu, nos atalhos F3/F4/F5 e em toda navegação para não haver meio de burlar.
  const temModulo = useCallback(
    (mod: Tela) => {
      if (mod === 'inicio') return true
      if (usuario?.perfil === 'admin') return true
      if (mod === 'usuarios') return usuario?.perfil === 'gerente' || (permissoes?.has('usuarios') ?? false)
      if (!permissoes) return false
      return permissoes.has(mod)
    },
    [usuario, permissoes]
  )

  const irPdv = useCallback(async () => {
    if (pdvFocado) {
      setPdvFocado(true)
      setFullscreen(true).catch(() => {})
      return
    }
    if (usuario && !temModulo('pdv') && !temModulo('vendas')) {
      setMsgBackup('Você não tem permissão para acessar o PDV.')
      return
    }
    if (!hasDbApi()) {
      setTela('pdv')
      setPdvFocado(true)
      setFullscreen(true).catch(() => {})
      return
    }
    const caixa = (await getDbApi().get(`SELECT id FROM caixas WHERE aberto = 1 ORDER BY id DESC LIMIT 1`).catch(() => null)) as
      | { id: number }
      | null
      | undefined
    if (!caixa) {
      setMsgBackup('Caixa fechado. Abra o caixa na aba Caixa para vender no balcão (F3).')
      setTela('caixa')
      return
    }
    setModoPdv('venda')
    setPedidoEdicaoId(null)
    setTela('pdv')
    setPdvFocado(true)
    setFullscreen(true).catch(() => {})
  }, [usuario, temModulo])

  const editarPedido = useCallback((pedidoId: number) => {
    if (usuario && !temModulo('pdv') && !temModulo('vendas')) {
      setMsgBackup('Você não tem permissão para editar pedidos.')
      return
    }
    setPedidoEdicaoId(pedidoId)
    setTela('pdv')
    setPdvFocado(true)
    setFullscreen(true).catch(() => {})
  }, [usuario, temModulo])

  const novoPedido = useCallback(() => {
    if (usuario && !temModulo('vendas')) {
      setMsgBackup('Você não tem permissão para criar pedidos.')
      return
    }
    setModoPdv('pedido')
    setPedidoEdicaoId(null)
    setTela('pdv')
    setPdvFocado(true)
    setFullscreen(true).catch(() => {})
  }, [usuario, temModulo])

  const novoOrcamento = useCallback(() => {
    if (usuario && !temModulo('vendas')) {
      setMsgBackup('Você não tem permissão para criar orçamentos.')
      return
    }
    setModoPdv('orcamento')
    setPedidoEdicaoId(null)
    setTela('pdv')
    setPdvFocado(true)
    setFullscreen(true).catch(() => {})
  }, [usuario, temModulo])

  const sairPdv = useCallback(() => {
    setPedidoEdicaoId(null)
    setModoPdv('venda')
    setPdvFocado(false)
    setTela('vendas')
    setFullscreen(false).catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault()
        if (pdvFocado) {
          return
        }
        irPdv()
      }
      if (e.key === 'F4' && !pdvFocado) {
        e.preventDefault()
        novoPedido()
      }
      if (e.key === 'F5' && !pdvFocado) {
        e.preventDefault()
        novoOrcamento()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [irPdv, sairPdv, pdvFocado, novoPedido, novoOrcamento])

  const sair = async () => {
    await getAuthApi().logout()
    setUsuario(null)
    setTela('inicio')
    setPdvFocado(false)
    setFullscreen(false).catch(() => {})
  }

  if (!carregado) return <div className="login-loading">Carregando...</div>

  if (!usuario) {
    return <Login onLogin={(u) => setUsuario(u)} />
  }

  const navegar = (item: MenuItem) => {
    if (item.emBreve) {
      setMsgBackup(`${item.label} estará disponível em breve.`)
      return
    }
    if (item.abrePdv) {
      irPdv()
      return
    }
    if (!temModulo(item.id)) {
      setMsgBackup('Você não tem permissão para acessar este módulo.')
      return
    }
    setProdutoEdicaoId(null)
    setTela(item.id)
    setMsgBackup('')
  }

  const menuVisivel = MENU_GESTAO.filter((m) => !m.admin || temModulo(m.id))

  if (pdvFocado) {
    return (
      <div className="app pdv-focado">
        <Pdv
          usuarioId={usuario.id}
          aoConcluirVenda={sairPdv}
          aoVoltar={sairPdv}
          pedidoEdicaoId={pedidoEdicaoId}
          modo={modoPdv}
          onEditarProduto={(id) => setProdutoEdicaoId(id)}
        />
        {produtoEdicaoId != null && (
          <div className="pdv-overlay-edicao">
            <div className="pdv-overlay-edicao-topo">
              <span>Editando produto</span>
              <button className="btn-primario" onClick={() => setProdutoEdicaoId(null)}>Voltar para a venda</button>
            </div>
            <div className="pdv-overlay-edicao-conteudo">
              <Produtos produtoEdicaoId={produtoEdicaoId} />
            </div>
          </div>
        )}
      </div>
    )
  }

  const navegarPara = (t: string) => {
    const alvo = t as Tela
    if (!temModulo(alvo)) {
      setMsgBackup('Você não tem permissão para acessar este módulo.')
      return
    }
    setProdutoEdicaoId(null)
    setTela(alvo)
    setMsgBackup('')
  }

  const renderTela = () => {
    switch (tela) {
      case 'inicio':
        return <Home usuarioNome={usuario.nome} onAbrirPdv={irPdv} onNavegar={navegarPara} />
      case 'produtos':
        return <Produtos />
      case 'clientes':
        return <Clientes />
      case 'vendas':
        return <Vendas onNovaVenda={irPdv} onEditarPedido={editarPedido} onNovoPedido={novoPedido} onNovoOrcamento={novoOrcamento} />
      case 'estoque':
        return <Estoque usuarioId={usuario.id} onAbrirProduto={(id) => { setProdutoEdicaoId(id); setTela('produtos') }} />
      case 'financeiro':
        return <Financeiro usuarioId={usuario.id} />
      case 'comissoes':
        return <Comissoes />
      case 'relatorios':
        return <Relatorios onNavegar={navegarPara} usuarioNome={usuario.nome} />
      case 'usuarios':
        return temModulo('usuarios') ? <Usuarios /> : <Pdv />
      case 'delivery':
        return <Delivery />
      case 'zonas':
        return <Zonas />
      case 'catalogo':
        return <CatalogoOnline onNavegar={navegarPara} usuarioNome={usuario.nome} />
      case 'caixa':
        return caixaTransacoesId != null ? (
          <CaixaTransacoes caixaId={caixaTransacoesId} onVoltar={() => setCaixaTransacoesId(null)} />
        ) : (
          <Caixa usuarioId={usuario.id} usuarioNome={usuario.nome} onAbrirCaixa={(id) => setCaixaTransacoesId(id)} />
        )
      case 'formaspagamento':
        return <FormasPagamento />
      case 'precos':
        return <AlterarPrecos usuarioId={usuario.id} />
      case 'whatsapp':
        return <AtendimentoWhatsApp />
      case 'nfe':
      case 'sobre':
        return <EmBreve titulo={MENU_PRINCIPAL.find((m) => m.id === tela)?.label ?? ''} />
      default:
        return <Home usuarioNome={usuario.nome} onAbrirPdv={irPdv} onNavegar={navegarPara} />
    }
  }

  const renderItem = (item: MenuItem) => (
    <button
      key={item.id}
      className={`nav-item ${tela === item.id ? 'ativo' : ''} ${sidebarRecolhida ? 'recolhido' : ''}`}
      onClick={() => navegar(item)}
      title={sidebarRecolhida ? item.label : undefined}
    >
      <span className="nav-item-corpo">
        <svg className="nav-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d={ICONES[item.icon]} />
        </svg>
        <span className="nav-label">{item.label}</span>
        {item.id === 'vendas' && novosPedidos > 0 && (
          <span className="nav-badge">{novosPedidos}</span>
        )}
      </span>
      {!sidebarRecolhida && item.atalho && <kbd>{item.atalho}</kbd>}
    </button>
  )

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-esquerda">
          <button
            className="btn-hamburguer"
            onClick={() => setSidebarRecolhida((v) => !v)}
            title={sidebarRecolhida ? 'Expandir menu' : 'Recolher menu'}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1>Sistema Loja Tabacaria</h1>
        </div>
        <div className="header-direita">
          <span className="loja-nome">{loja}</span>
          <span className="usuario-logado">
            {usuario.nome}
            {usuario.perfil === 'admin' ? (
              <button
                className="perfil-badge perfil-badge-btn"
                onClick={() => { setTela('usuarios'); setMsgBackup('') }}
                title="Gerenciar usuários"
              >
                admin ▾
              </button>
            ) : (
              <span className="perfil-badge">{usuario.perfil}</span>
            )}
          </span>
          <button
            className="btn-mini"
            onClick={async () => setMsgBackup(await fazerBackupManual())}
            title="Backup automático a cada 4h"
          >
            Backup
          </button>
          <button className="btn-mini" onClick={sair}>Sair</button>
        </div>
      </header>
      <div className="app-corpo">
        <nav className={`sidebar ${sidebarRecolhida ? 'recolhida' : ''}`}>
          {msgBackup && <div className="msg-backup">{msgBackup}</div>}
          <div className="sidebar-grupo">{MENU_PRINCIPAL.map(renderItem)}</div>
          <div className="sidebar-separador" />
          <div className="sidebar-grupo">{menuVisivel.map(renderItem)}</div>
        </nav>
        <main className="main">{renderTela()}</main>
      </div>
      <Toasts />
    </div>
  )
}

function EmBreve({ titulo }: { titulo: string }) {
  return (
    <div className="page">
      <div className="page-header">
        <h2>{titulo}</h2>
      </div>
      <p className="sem-resultado">Este módulo estará disponível em breve.</p>
    </div>
  )
}
