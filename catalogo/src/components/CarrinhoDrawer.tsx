import { useCarrinho } from '../state/carrinho'
import { formatarMoeda } from '../types'

export default function CarrinhoDrawer() {
  const { itens, abrir, setAbrir, remover, mudarQuantidade, limpar, total } = useCarrinho()

  if (!abrir) return null

  return (
    <div className="drawer-overlay" onClick={() => setAbrir(false)} role="presentation">
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Carrinho">
        <div className="drawer__topo">
          <h2>Carrinho</h2>
          <button className="drawer__fechar" onClick={() => setAbrir(false)} aria-label="Fechar carrinho">
            ✕
          </button>
        </div>

        {itens.length === 0 ? (
          <div className="drawer__vazio">
            <p>Seu carrinho está vazio.</p>
          </div>
        ) : (
          <>
            <ul className="drawer__lista">
              {itens.map((i) => (
                <li key={i.id} className="drawer__item">
                  <div className="drawer__item-info">
                    <span className="drawer__item-nome">{i.nome}</span>
                    <span className="drawer__item-preco">{formatarMoeda(i.preco)}</span>
                  </div>
                  <div className="drawer__item-acao">
                    <button className="qtd-btn" onClick={() => mudarQuantidade(i.id, i.quantidade - 1)} aria-label="Diminuir quantidade">
                      −
                    </button>
                    <span className="qtd-valor">{i.quantidade}</span>
                    <button className="qtd-btn" onClick={() => mudarQuantidade(i.id, i.quantidade + 1)} aria-label="Aumentar quantidade">
                      +
                    </button>
                    <button className="drawer__remover" onClick={() => remover(i.id)} aria-label="Remover item">
                      Remover
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="drawer__rodape">
              <div className="drawer__total">
                <span>Total</span>
                <strong>{formatarMoeda(total)}</strong>
              </div>
              <button className="btn-limpar" onClick={limpar}>
                Limpar carrinho
              </button>
              <p className="drawer__aviso">Checkout será disponibilizado em uma próxima fase.</p>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}