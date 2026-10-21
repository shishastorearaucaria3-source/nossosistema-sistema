import { useEffect, useState, useCallback } from 'react'
import { getDbApi, getImagemApi, getCatalogoApi, getServidorApi } from '../../shared/db'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import Filters from './components/Filters'
import ProductTable from './components/ProductTable'
import { CatalogoProduto } from './components/ProductRow'
import RightPanel from './components/RightPanel'
import FloatingChatButton from './components/FloatingChatButton'
import PedidosModal, { ConfigPedidos } from './components/PedidosModal'
import PagamentoModal, { FormaConfig } from './components/PagamentoModal'
import ExibicaoModal, { ConfigExibicao } from './components/ExibicaoModal'
import LojaModal, { DadosLoja } from './components/LojaModal'

interface LinhaBanco {
  id: number
  nome: string
  codigo: string | null
  codigo_barras: string | null
  codigo_interno: string | null
  preco_venda: number
  estoque: number
  categoria_nome: string | null
  catalogo_publicado: number
  descricao: string | null
}

export default function CatalogoOnline({
  onNavegar,
  usuarioNome
}: {
  onNavegar: (tela: string) => void
  usuarioNome: string
}) {
  const [produtos, setProdutos] = useState<CatalogoProduto[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [busca, setBusca] = useState('')
  const [filtros, setFiltros] = useState({ categoria: 'Todas', imagem: 'Todos', publicacao: 'Todos', estoque: 'Todos' })
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [ativo, setAtivo] = useState(true)
  const [nomeLoja, setNomeLoja] = useState('Minha Loja')
  const [mensagem, setMensagem] = useState('')
  const [configPedidos, setConfigPedidos] = useState<ConfigPedidos>({ pedidosAtivos: true, aceitaEntrega: true, aceitaRetirada: false, taxaEntrega: 5 })
  const [formas, setFormas] = useState<FormaConfig[]>([])
  const [modalPedidos, setModalPedidos] = useState(false)
  const [modalPagamento, setModalPagamento] = useState(false)
  const [modalExibicao, setModalExibicao] = useState(false)
  const [configExibicao, setConfigExibicao] = useState<ConfigExibicao>({
    mostrar_estoque: true,
    sem_estoque: 'despublicar',
    aceitar_pedidos_sem_estoque: false,
    destacar_promocoes: true
  })
  const [manutencao, setManutencao] = useState(false)
  const [limite, setLimite] = useState(50)
  const [modalLoja, setModalLoja] = useState(false)
  const [dadosLoja, setDadosLoja] = useState<DadosLoja>({ nome: 'Minha Loja', telefone: '', endereco: '', horario: '' })
  const [reparando, setReparando] = useState(false)
  const [etapaReparo, setEtapaReparo] = useState('')
  const [conexaoOk, setConexaoOk] = useState<boolean | null>(null)
  const [sincStatus, setSincStatus] = useState<{
    status: string
    ultima_sync: string
    pendentes: number
    ultimo_erro: string
    sincronizando: boolean
    conectado: boolean
    auto_sync_ativos: boolean
    auto_sync_intervalo_seg: number
  } | null>(null)

  useEffect(() => {
    getServidorApi()
      .catalogoStatus()
      .then((r) => setConexaoOk(!!(r.ok && (r.token_relay_configurado || r.token_sync_configurado))))
      .catch(() => setConexaoOk(null))
    const tick = () => {
      getServidorApi()
        .catalogoSyncStatus()
        .then(setSincStatus)
        .catch(() => {})
    }
    tick()
    const timer = setInterval(tick, 5000)
    return () => clearInterval(timer)
  }, [])

  const alternarAutoSync = async () => {
    const proximo = !(sincStatus?.auto_sync_ativos ?? false)
    try {
      await getServidorApi().catalogoAutoSync({
        ativo: proximo,
        intervalo_seg: sincStatus?.auto_sync_intervalo_seg || 60
      })
      setSincStatus((s) => (s ? { ...s, auto_sync_ativos: proximo } : s))
      setMensagem(proximo ? 'Auto-sync do catálogo ativado.' : 'Auto-sync do catálogo desativado.')
    } catch {
      setMensagem('Não foi possível alterar o auto-sync.')
    }
  }

  const repararConexao = async () => {
    setReparando(true)
    setConexaoOk(null)
    try {
      setEtapaReparo('Conectando...')
      await new Promise((r) => setTimeout(r, 400))
      setEtapaReparo('Atualizando configuração...')
      const r = await getServidorApi().catalogoRepair()
      setEtapaReparo('')
      if (r.ok) {
        setConexaoOk(true)
        setMensagem('Catálogo conectado e atualizado com sucesso.')
      } else {
        setConexaoOk(false)
        setMensagem(erroAmigavelReparo(r.erro))
      }
    } catch {
      setEtapaReparo('')
      setConexaoOk(false)
      setMensagem(erroAmigavelReparo(undefined))
    } finally {
      setReparando(false)
    }
  }

  const erroAmigavelReparo = (codigo?: string): string => {
    switch (codigo) {
      case 'nao_autorizado':
        return 'Não foi possível autenticar no catálogo conectado. Verifique a conexão e tente novamente.'
      case 'token_sync_ausente':
        return 'A conexão do catálogo ainda não foi finalizada. Atualize o aplicativo ou contate o suporte.'
      case 'sincronizacao_falhou':
      case 'comunicacao_falhou':
        return 'Não foi possível sincronizar com o catálogo online no momento. Tente novamente em instantes.'
      default:
        return 'Não foi possível conectar ao catálogo online agora. Tente novamente em instantes.'
    }
  }

  const carregar = useCallback(async () => {
    const db = getDbApi()
    const cfg = (await db.get(`SELECT valor FROM config WHERE chave = 'nome_loja'`)) as { valor: string } | undefined
    setNomeLoja(cfg?.valor || 'Minha Loja')

    const pegar = async (chave: string, padrao: string) => {
      const r = (await db.get(`SELECT valor FROM config WHERE chave = ?`, [chave])) as { valor: string } | undefined
      return r?.valor ?? padrao
    }
    const pedidosAtivos = (await pegar('pedidos_ativos', '1')) === '1'
    const aceitaEntrega = (await pegar('aceita_entrega', '1')) === '1'
    const aceitaRetirada = (await pegar('aceita_retirada', '0')) === '1'
    const taxaEntrega = Number(await pegar('taxa_entrega', '5')) || 0
    setConfigPedidos({ pedidosAtivos, aceitaEntrega, aceitaRetirada, taxaEntrega })
    setAtivo(pedidosAtivos)
    setManutencao((await pegar('manutencao_ativos', '0')) === '1')
    setDadosLoja({
      nome: cfg?.valor || 'Minha Loja',
      telefone: await pegar('telefone_loja', ''),
      endereco: await pegar('endereco_loja', ''),
      horario: await pegar('horario_funcionamento', '')
    })

    getCatalogoApi().getExibicao().then((c) => {
      setConfigExibicao({
        mostrar_estoque: c.mostrar_estoque ?? true,
        sem_estoque: c.sem_estoque === 'manter' ? 'manter' : 'despublicar',
        aceitar_pedidos_sem_estoque: c.aceitar_pedidos_sem_estoque ?? false,
        destacar_promocoes: c.destacar_promocoes ?? true
      })
    }).catch(() => {})

    const fs = (await db.all(`SELECT id, nome, tipo, ativo FROM formas_pagamento ORDER BY id`)) as unknown as FormaConfig[]
    setFormas(fs)

    const rows = (await db.all(
      `SELECT p.id, p.nome, p.codigo_barras, p.codigo_interno, p.preco_venda, p.estoque, p.descricao,
              p.catalogo_publicado, p.catalogo_ordem, c.nome AS categoria_nome
       FROM produtos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       ORDER BY p.nome`
    )) as unknown as (LinhaBanco & { catalogo_ordem: number })[]
    const lista = rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      codigo: r.codigo_interno ?? r.codigo_barras ?? '',
      preco: r.preco_venda,
      estoque: r.estoque,
      categoria: r.categoria_nome,
      catalogo_publicado: !!r.catalogo_publicado,
      catalogo_ordem: r.catalogo_ordem,
      imagem: null,
      descricao: r.descricao
    }))
    setProdutos(lista)
    setCategorias([...new Set(lista.map((p) => p.categoria).filter(Boolean) as string[])].sort())
    setLimite(50)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const filtrados = produtos.filter((p) => {
    if (busca && !p.nome.toLowerCase().includes(busca.toLowerCase()) && !p.codigo.toLowerCase().includes(busca.toLowerCase())) return false
    if (filtros.categoria !== 'Todas' && p.categoria !== filtros.categoria) return false
    if (filtros.imagem === 'Com imagem' && !p.imagem) return false
    if (filtros.imagem === 'Sem imagem' && p.imagem) return false
    if (filtros.publicacao === 'Publicados' && !p.catalogo_publicado) return false
    if (filtros.publicacao === 'Não publicados' && p.catalogo_publicado) return false
    if (filtros.estoque === 'Com estoque' && p.estoque <= 0) return false
    if (filtros.estoque === 'Sem estoque' && p.estoque > 0) return false
    return true
  })

  const naoPublicados = produtos.filter((p) => !p.catalogo_publicado).length
  const produtosExibidos = filtrados.slice(0, limite)
  const temMais = filtrados.length > limite

  useEffect(() => {
    const ids = produtosExibidos.map((p) => p.id)
    if (!ids.length) return
    let cancelado = false
    getImagemApi().listPorIds(ids).then((imgs) => {
      if (cancelado) return
      setProdutos((prev) => prev.map((p) => (imgs[p.id] ? { ...p, imagem: imgs[p.id] } : p)))
    }).catch(() => {})
    return () => { cancelado = true }
  }, [filtros.categoria, filtros.publicacao, filtros.estoque, filtros.imagem, busca, limite])

  const alternarPublicacao = async (p: CatalogoProduto) => {
    const novo = p.catalogo_publicado ? 0 : 1
    await getDbApi().run(
      `UPDATE produtos SET catalogo_publicado = ?, alterado_em = datetime('now') WHERE id = ?`,
      [novo, p.id]
    )
    setProdutos((prev) => prev.map((x) => (x.id === p.id ? { ...x, catalogo_publicado: !p.catalogo_publicado } : x)))
    setMensagem(novo ? `"${p.nome}" publicado no catálogo.` : `"${p.nome}" removido do catálogo.`)
  }

  const salvarDescricao = async (p: CatalogoProduto, texto: string) => {
    await getDbApi().run(`UPDATE produtos SET descricao = ? WHERE id = ?`, [texto.trim() || null, p.id])
    setProdutos((prev) => prev.map((x) => (x.id === p.id ? { ...x, descricao: texto.trim() || null } : x)))
    setEditandoId(null)
    setMensagem('Descrição salva.')
  }

  const salvarConfig = async (chave: string, valor: string) => {
    await getDbApi().run(
      `INSERT INTO config (chave, valor) VALUES (?, ?)
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
      [chave, valor]
    )
  }

  const salvarPedidos = async (c: ConfigPedidos) => {
    await salvarConfig('pedidos_ativos', c.pedidosAtivos ? '1' : '0')
    await salvarConfig('aceita_entrega', c.aceitaEntrega ? '1' : '0')
    await salvarConfig('aceita_retirada', c.aceitaRetirada ? '1' : '0')
    await salvarConfig('taxa_entrega', String(c.taxaEntrega))
    setConfigPedidos(c)
    setAtivo(c.pedidosAtivos)
    setModalPedidos(false)
    setMensagem('Configuração de pedidos salva.')
  }

  const salvarPagamento = async (nova: FormaConfig[]) => {
    const db = getDbApi()
    for (const f of nova) {
      await db.run(`UPDATE formas_pagamento SET ativo = ? WHERE id = ?`, [f.ativo, f.id])
    }
    setFormas(nova)
    setModalPagamento(false)
    setMensagem('Formas de pagamento atualizadas.')
  }

  const formasAtivasNomes = formas.filter((f) => f.ativo).map((f) => f.nome)

  const abrirCard = (titulo: string) => {
    if (titulo === 'Dados da Loja' || titulo === 'Canais de Contato') {
      setModalLoja(true)
    } else if (titulo === 'Pedidos pelo Catálogo') {
      setModalPedidos(true)
    } else if (titulo === 'Instruções de Pagamento') {
      setModalPagamento(true)
    } else if (titulo === 'Estoque') {
      setModalExibicao(true)
    } else if (titulo === 'Produtos') {
      setMensagem('Use o toggle de publicação na tabela para publicar/despublicar itens.')
    } else {
      setMensagem(`"${titulo}" — configuração em breve.`)
    }
  }

  const salvarExibicao = async (c: ConfigExibicao) => {
    setConfigExibicao(c)
    setModalExibicao(false)
    setMensagem('Configuração de exibição salva.')
  }

  const salvarDadosLoja = (d: DadosLoja) => {
    setDadosLoja(d)
    setNomeLoja(d.nome)
    setModalLoja(false)
    setMensagem('Dados da loja salvos e publicados.')
  }

  const alternarManutencao = async () => {
    const novo = !manutencao
    if (novo && !confirm('Ativar manutenção? O catálogo público ficará fora do ar até desativar.')) return
    await salvarConfig('manutencao_ativos', novo ? '1' : '0')
    setManutencao(novo)
    setMensagem(novo ? 'Manutenção ativada.' : 'Manutenção desativada.')
  }

  const publicarTodos = async () => {
    const qtd = produtos.filter((p) => !p.catalogo_publicado).length
    if (qtd === 0) {
      setMensagem('Todos os produtos já estão publicados no catálogo.')
      return
    }
    if (!confirm(`Publicar todos os ${qtd} produto(s) não publicados no catálogo?`)) return
    await getDbApi().run(`UPDATE produtos SET catalogo_publicado = 1, alterado_em = datetime('now')`, [])
    setProdutos((prev) => prev.map((p) => ({ ...p, catalogo_publicado: true })))
    setMensagem(`${qtd} produto(s) publicado(s) no catálogo.`)
  }

  const despublicarTodos = async () => {
    const qtd = produtos.filter((p) => p.catalogo_publicado).length
    if (qtd === 0) {
      setMensagem('Nenhum produto publicado no catálogo.')
      return
    }
    if (!confirm(`Remover todos os ${qtd} produto(s) do catálogo?`)) return
    await getDbApi().run(`UPDATE produtos SET catalogo_publicado = 0, alterado_em = datetime('now')`, [])
    setProdutos((prev) => prev.map((p) => ({ ...p, catalogo_publicado: false })))
    setFiltros((prev) => ({ ...prev, publicacao: 'Todos' }))
    setMensagem(`${qtd} produto(s) removido(s) do catálogo.`)
  }

  return (
    <div className="cat-online">
      <div className="cat-conteudo">
        <Header
          manutencao={manutencao}
          onAlternarManutencao={alternarManutencao}
          usuarioNome={usuarioNome}
        />
        <div className="cat-rele">
          <span className="cat-rele-titulo">Conexão do catálogo</span>
          <button
            className="btn-primario"
            onClick={repararConexao}
            disabled={reparando}
          >
            {reparando ? 'Conectando...' : 'Atualizar conexão do catálogo'}
          </button>
          {conexaoOk !== null && !reparando && (
            <span className={conexaoOk ? 'cat-rele-ok' : 'cat-rele-erro'}>
              {conexaoOk ? 'Conectado.' : 'Não conectado.'}
            </span>
          )}
          {sincStatus && (
            <div className="cat-rele-detalhe">
              <span className={sincStatus.conectado ? 'cat-rele-ok' : 'cat-rele-erro'}>
                {sincStatus.conectado ? 'Online' : 'Sem conexão com o Worker'}
              </span>
              {sincStatus.sincronizando && <span className="cat-rele-ok"> · Sincronizando…</span>}
              <span className="cat-rele-info">
                {' '}· Última sync: {sincStatus.ultima_sync}
              </span>
              {sincStatus.pendentes > 0 && (
                <span className="cat-rele-info"> · {sincStatus.pendentes} pendente(s)</span>
              )}
              {sincStatus.ultimo_erro && !sincStatus.conectado && (
                <div className="cat-rele-erro">Erro: {sincStatus.ultimo_erro}</div>
              )}
              <label className="cat-rele-auto">
                <input
                  type="checkbox"
                  checked={!!sincStatus.auto_sync_ativos}
                  onChange={alternarAutoSync}
                />
                Auto-sync a cada {sincStatus.auto_sync_intervalo_seg}s
              </label>
            </div>
          )}
        </div>
        {reparando && etapaReparo && <div className="mensagem">{etapaReparo}</div>}
        <SearchBar valor={busca} onChange={setBusca} />
        <Filters
          categorias={categorias}
          filtros={filtros}
          onMudar={setFiltros}
          onAbrirFiltros={() => setMensagem('Filtros avançados em breve.')}
        />
        {mensagem && <div className="mensagem">{mensagem}</div>}
        <div className="cat-botoes-publicacao">
          <button className="btn-mini" onClick={publicarTodos}>Publicar todos</button>
          <button className="btn-mini" onClick={despublicarTodos}>Despublicar todos</button>
        </div>
        <ProductTable
          produtos={produtosExibidos}
          editandoId={editandoId}
          onAlternarPublicacao={alternarPublicacao}
          onSalvarDescricao={salvarDescricao}
          onEditarDescricao={(p) => setEditandoId(editandoId === p.id ? null : p.id)}
          onCompartilhar={(p) => setMensagem(`Link de "${p.nome}" copiado (em breve).`)}
          onAbrir={(p) => setMensagem(`Abrindo "${p.nome}" (detalhes em breve).`)}
        />
        {temMais && (
          <div className="cat-carregar-mais">
            <button className="btn-primario" onClick={() => setLimite((l) => l + 50)}>
              Carregar mais ({filtrados.length - limite} restantes)
            </button>
          </div>
        )}
      </div>

      <RightPanel
        nomeLoja={nomeLoja}
        naoPublicados={naoPublicados}
        dados={{
          pedidosAtivos: configPedidos.pedidosAtivos,
          entrega: configPedidos.aceitaEntrega,
          retirada: configPedidos.aceitaRetirada,
          formasAtivas: formasAtivasNomes
        }}
        dadosLoja={dadosLoja}
        exibicao={configExibicao}
        onAbrirCard={abrirCard}
      />

      <FloatingChatButton onClick={() => setMensagem('Chat em breve.')} />

      {modalPedidos && (
        <PedidosModal
          config={configPedidos}
          onSalvar={salvarPedidos}
          onFechar={() => setModalPedidos(false)}
          onIrZonas={() => onNavegar('zonas')}
        />
      )}
      {modalPagamento && (
        <PagamentoModal
          formas={formas}
          onSalvar={salvarPagamento}
          onFechar={() => setModalPagamento(false)}
        />
      )}
      {modalExibicao && (
        <ExibicaoModal
          onSalvar={salvarExibicao}
          onFechar={() => setModalExibicao(false)}
        />
      )}
      {modalLoja && (
        <LojaModal
          dados={dadosLoja}
          onSalvar={salvarDadosLoja}
          onFechar={() => setModalLoja(false)}
        />
      )}
    </div>
  )
}
