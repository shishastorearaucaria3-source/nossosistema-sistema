import StoreInfo from './StoreInfo'
import { ConfigExibicao } from './ExibicaoModal'
import { DadosLoja } from './LojaModal'

export interface DadosCard {
  pedidosAtivos: boolean
  entrega: boolean
  retirada: boolean
  formasAtivas: string[]
}

export default function RightPanel({
  nomeLoja,
  naoPublicados,
  dados,
  dadosLoja,
  exibicao,
  onAbrirCard
}: {
  nomeLoja: string
  naoPublicados: number
  dados: DadosCard
  dadosLoja: DadosLoja
  exibicao: ConfigExibicao
  onAbrirCard: (titulo: string) => void
}) {
  const modalidades = [
    dados.entrega && dados.retirada ? 'Entrega e Retirada' : dados.entrega ? 'Apenas Entrega' : dados.retirada ? 'Apenas Retirada' : 'Pedidos desativados'
  ].join('')

  const textoEstoque = exibicao.sem_estoque === 'despublicar'
    ? 'Despublicar itens automaticamente ao zerar o estoque'
    : 'Manter itens publicados mesmo sem estoque'

  const textoLoja = dadosLoja.telefone
    ? `WhatsApp: ${dadosLoja.telefone}`
    : 'Falta configurar o WhatsApp'

  const cards = [
    { titulo: 'Dados da Loja', texto: textoLoja, corTexto: (dadosLoja.telefone ? 'normal' : 'vermelho') as 'normal' | 'vermelho' },
    { titulo: 'Produtos', texto: `${naoPublicados} de seus itens não estão publicados.`, corTexto: 'vermelho' as const },
    {
      titulo: 'Pedidos pelo Catálogo',
      texto: dados.pedidosAtivos ? modalidades : 'Pedidos desativados',
      corTexto: (dados.pedidosAtivos ? 'normal' : 'vermelho') as 'normal' | 'vermelho'
    },
    { titulo: 'Instruções de Pagamento', texto: dados.formasAtivas.length ? dados.formasAtivas.join(' e ') : 'Nenhuma forma ativa' },
    { titulo: 'Canais de Contato', texto: dadosLoja.telefone ? `WhatsApp ${dadosLoja.telefone}` : 'WhatsApp não configurado', corTexto: (dadosLoja.telefone ? 'normal' : 'vermelho') as 'normal' | 'vermelho' },
    { titulo: 'Estoque', texto: textoEstoque }
  ]

  return (
    <aside className="rp-painel">
      <StoreInfo nomeLoja={nomeLoja} />
      <div className="rp-cards">
        {cards.map((c) => (
          <button key={c.titulo} className="rp-card" onClick={() => onAbrirCard(c.titulo)}>
            <div>
              <strong>{c.titulo}</strong>
              <span className={c.corTexto === 'vermelho' ? 'rp-texto-vermelho' : ''}>{c.texto}</span>
            </div>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        ))}
      </div>
    </aside>
  )
}
