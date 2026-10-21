import { formatarMoeda } from '../types'
import type { ProdutoPublicoV1 } from '../types'
import { useCarrinho } from '../state/carrinho'
import ImagemProduto from './ImagemProduto'

export default function CartaoProduto({ produto, origem, pedidosAtivos }: { produto: ProdutoPublicoV1; origem: 'api' | 'mock'; pedidosAtivos: boolean }) {
  const { adicionar } = useCarrinho()

  return (
    <article className={`cartao-produto${produto.disponivel ? '' : ' cartao-produto--indisponivel'}`}>
      {produto.tem_promo && <span className="badge-promo">Oferta</span>}
      <ImagemProduto produto={produto} origem={origem} />
      <div className="cartao-produto__corpo">
        {produto.marca && <span className="cartao-produto__marca">{produto.marca}</span>}
        <h3 className="cartao-produto__nome">{produto.nome}</h3>
        {produto.descricao && <p className="cartao-produto__desc">{produto.descricao}</p>}
        <div className="cartao-produto__preco">
          {produto.tem_promo && produto.preco_promo ? (
            <>
              <span className="preco-normal">{formatarMoeda(produto.preco)}</span>
              <span className="preco-promo">{formatarMoeda(produto.preco_promo)}</span>
            </>
          ) : (
            <span className="preco-promo">{formatarMoeda(produto.preco)}</span>
          )}
          {produto.disponivel && pedidosAtivos ? (
            <button className="btn-add" onClick={() => adicionar(produto, 1)}>
              Adicionar
            </button>
          ) : (
            <button className="btn-add btn-add--bloqueado" disabled>
              {!produto.disponivel ? 'Indisponível' : 'Pedidos pausados'}
            </button>
          )}
        </div>
        <div className="cartao-produto__status">
          {produto.disponivel ? (
            <span className="status-disponivel">
              Disponível{typeof produto.estoque === 'number' && produto.estoque > 0 ? ` · ${produto.estoque} un.` : ''}
            </span>
          ) : (
            <span className="status-indisponivel">Indisponível</span>
          )}
        </div>
      </div>
    </article>
  )
}
