import { useCallback, useEffect, useRef, useState, ReactNode } from 'react'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card, { CardTitulo } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import Loading from '../../components/ui/Loading'
import PageHeader from '../../components/ui/PageHeader'
import Table from '../../components/ui/Table'
import { formatarBRL } from '../relatorios/data'
import { carregarDashboard, DashboardData, EstadoDashboard, estadoInicial } from './dashboardData'

function formatarQtd(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function formatarMomento(utc: string): string {
  const d = new Date(utc.replace(' ', 'T') + 'Z')
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function dataLonga(): string {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
}

function CartaoStat({
  rotulo,
  valor,
  detalhe,
  aoClicar
}: {
  rotulo: string
  valor: ReactNode
  detalhe?: ReactNode
  aoClicar?: () => void
}) {
  const conteudo = (
    <>
      <span className="ui-stat-rotulo">{rotulo}</span>
      <span className="ui-stat-valor">{valor}</span>
      {detalhe && <span className="ui-stat-detalhe">{detalhe}</span>}
    </>
  )
  if (!aoClicar) return <Card>{conteudo}</Card>
  return (
    <Card
      clicavel
      onClick={aoClicar}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          aoClicar()
        }
      }}
    >
      {conteudo}
    </Card>
  )
}

const ATALHOS = [
  { label: 'Nova venda', desc: 'PDV (F3)', aoClicar: 'pdv' },
  { label: 'Produtos', desc: 'Cadastro, fotos e preços', aoClicar: 'produtos' },
  { label: 'Clientes', desc: 'Cadastro e histórico', aoClicar: 'clientes' },
  { label: 'Delivery', desc: 'Pedidos online', aoClicar: 'delivery' },
  { label: 'Estoque', desc: 'Ajustes e compras', aoClicar: 'estoque' },
  { label: 'Caixa', desc: 'Abertura e fechamento', aoClicar: 'caixa' },
  { label: 'Contas a pagar', desc: 'Financeiro', aoClicar: 'financeiro' },
  { label: 'Relatórios', desc: 'Vendas e métricas', aoClicar: 'relatorios' }
]

export default function Home({ usuarioNome, onAbrirPdv, onNavegar }: {
  usuarioNome: string
  onAbrirPdv: () => void
  onNavegar: (tela: string) => void
}) {
  const [estado, setEstado] = useState<EstadoDashboard>(estadoInicial)
  const emVooRef = useRef(false)

  const carregar = useCallback(async () => {
    if (emVooRef.current) return
    emVooRef.current = true
    try {
      const dados = await carregarDashboard()
      setEstado({ fase: 'ok', dados })
    } catch (e) {
      setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : 'Erro inesperado ao carregar o painel.' })
    } finally {
      emVooRef.current = false
    }
  }, [])

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 15000)
    return () => clearInterval(t)
  }, [carregar])

  if (estado.fase === 'carregando') return <Loading texto="Carregando o painel..." />

  if (estado.fase === 'offline') {
    return (
      <ErrorState
        titulo="Servidor indisponível"
        descricao="Conecte o aplicativo ao servidor para visualizar o painel do dia."
        onTentarNovamente={carregar}
      />
    )
  }

  if (estado.fase === 'erro') {
    return <ErrorState descricao={estado.mensagem} onTentarNovamente={carregar} />
  }

  return <Painel dados={estado.dados} usuarioNome={usuarioNome} onAbrirPdv={onAbrirPdv} onNavegar={onNavegar} onAtualizar={carregar} />
}

function Painel({ dados, usuarioNome, onAbrirPdv, onNavegar, onAtualizar }: {
  dados: DashboardData
  usuarioNome: string
  onAbrirPdv: () => void
  onNavegar: (tela: string) => void
  onAtualizar: () => void
}) {
  const variacao = dados.variacaoFaturamento

  return (
    <div className="page home">
      <PageHeader
        titulo="Início"
        sub={`Bem-vindo, ${usuarioNome} · ${dataLonga()} · Atualizado às ${dados.carregadoEm}`}
        acoes={
          <Button variante="fantasma" tamanho="pequeno" onClick={onAtualizar}>
            Atualizar
          </Button>
        }
      />

      <div className="ui-grade ui-grade--stats">
        <CartaoStat
          rotulo="Vendas hoje"
          valor={dados.vendasHoje}
          detalhe="vendas concluídas no balcão e delivery"
          aoClicar={() => onNavegar('vendas')}
        />
        <CartaoStat
          rotulo="Faturamento hoje"
          valor={formatarBRL(dados.faturamentoHoje)}
          detalhe={
            variacao != null ? (
              <Badge tom={variacao >= 0 ? 'ok' : 'perigo'}>
                {variacao >= 0 ? '+' : ''}
                {variacao.toFixed(1)}% vs ontem
              </Badge>
            ) : (
              'Sem vendas ontem para comparar'
            )
          }
        />
        <CartaoStat
          rotulo="Ticket médio"
          valor={formatarBRL(dados.ticketMedioHoje)}
          detalhe="por venda concluída hoje"
        />
        <CartaoStat
          rotulo="Caixa"
          valor={dados.caixaAberto ? <Badge tom="ok">Aberto</Badge> : <Badge tom="aviso">Fechado</Badge>}
          detalhe={
            dados.caixaAberto
              ? dados.caixaUsuario
                ? `aberto por ${dados.caixaUsuario}`
                : 'sessão ativa'
              : 'abrir para vender no balcão'
          }
          aoClicar={() => onNavegar('caixa')}
        />
        <CartaoStat
          rotulo="Pedidos novos (delivery)"
          valor={dados.pedidosNovos}
          detalhe={dados.pedidosNovos > 0 ? 'aguardando atendimento' : 'nenhum no momento'}
          aoClicar={() => onNavegar('delivery')}
        />
        <CartaoStat
          rotulo="Contas abertas"
          valor={dados.contasAbertas}
          detalhe={`${dados.produtosAtivos} produtos ativos no cadastro`}
          aoClicar={() => onNavegar('financeiro')}
        />
      </div>

      <div className="ui-grade ui-grade--cartoes" style={{ marginTop: 'var(--esp-4)' }}>
        <Card>
          <CardTitulo
            titulo="Estoque crítico"
            acoes={
              <button className="ui-card-acao" onClick={() => onNavegar('estoque')}>
                ver estoque
              </button>
            }
          />
          {dados.estoqueCritico.length === 0 ? (
            <EmptyState titulo="Estoque saudável" descricao="Nenhum produto abaixo do mínimo." />
          ) : (
            <div className="ui-lista">
              {dados.estoqueCritico.map((p) => (
                <div key={p.id} className="ui-lista-item">
                  <div className="ui-lista-item-corpo">
                    <div className="ui-lista-nome">{p.nome}</div>
                    <div className="ui-lista-sub">
                      {formatarBRL(p.preco_venda)} · mínimo {formatarQtd(p.estoque_minimo)}
                    </div>
                  </div>
                  <Badge tom={p.estoque <= 0 ? 'perigo' : 'aviso'}>{p.estoque <= 0 ? 'sem estoque' : 'baixo'}</Badge>
                  <div className={`ui-lista-valor ${p.estoque <= 0 ? 'ui-lista-valor--perigo' : 'ui-lista-valor--aviso'}`}>
                    {formatarQtd(p.estoque)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardTitulo
            titulo="Vendas recentes"
            acoes={
              <button className="ui-card-acao" onClick={() => onNavegar('vendas')}>
                ver todas
              </button>
            }
          />
          <Table
            colunas={[
              { chave: 'criada_em', titulo: 'Quando', render: (v) => formatarMomento(v.criada_em) },
              { chave: 'cliente', titulo: 'Cliente' },
              { chave: 'total', titulo: 'Total', alinhar: 'direita', render: (v) => <strong>{formatarBRL(v.total)}</strong> }
            ]}
            linhas={dados.vendasRecentes}
            chaveLinha={(v) => v.numero}
            vazio={<EmptyState titulo="Nenhuma venda ainda" descricao="Quando houver vendas concluídas, elas aparecerão aqui." />}
          />
        </Card>

        <Card>
          <CardTitulo titulo="Atalhos" />
          <div className="ui-grade" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {ATALHOS.map((a) => (
              <button
                key={a.label}
                className="ui-atalho"
                onClick={() => (a.aoClicar === 'pdv' ? onAbrirPdv() : onNavegar(a.aoClicar))}
              >
                <span className="ui-atalho-nome">{a.label}</span>
                <span className="ui-atalho-desc">{a.desc}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}