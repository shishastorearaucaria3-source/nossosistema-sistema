import type { ProdutoPublicoV1 } from '../types'
import CartaoProduto from './CartaoProduto'

export default function GradeProdutos({ produtos, origem }: { produtos: ProdutoPublicoV1[]; origem: 'api' | 'mock' }) {
  if (produtos.length === 0) {
    return <p className="sem-resultado">Nenhum produto encontrado. Tente outra busca ou categoria.</p>
  }
  return (
    <div className="grade">
      {produtos.map((p) => (
        <CartaoProduto key={p.id} produto={p} origem={origem} />
      ))}
    </div>
  )
}