import { useCarrinho } from '../state/carrinho'
import logoBranca from '../assets/logo-branca.png'

export default function Cabecalho({
  nomeLoja,
  pedidosAtivos,
  busca,
  onBusca,
  categoriaAtiva,
  categorias,
  onCategoria
}: {
  nomeLoja: string
  pedidosAtivos: boolean
  busca: string
  onBusca: (v: string) => void
  categoriaAtiva: number | null
  categorias: { id: number; nome: string }[]
  onCategoria: (id: number | null) => void
}) {
  const { itensCount, setAbrir } = useCarrinho()

  return (
    <header className="cabecalho">
      <div className="cabecalho__topo">
        <a
          className="marca"
          href="/"
          onClick={(e) => {
            e.preventDefault()
            onCategoria(null)
            onBusca('')
          }}
        >
          <img className="marca__logo" src={logoBranca} alt={`${nomeLoja || 'Shisha Store'} — logo`} />
          <span className="marca__nome">{nomeLoja || 'Shisha Store'}</span>
        </a>
        <button
          className="btn-carrinho"
          onClick={() => setAbrir(true)}
          aria-label={pedidosAtivos ? `Abrir carrinho (${itensCount} itens)` : 'Abrir carrinho (pedidos pausados)'}
        >
          <span aria-hidden="true">🛒</span>
          <span className="btn-carrinho__badge">{itensCount}</span>
        </button>
      </div>
      <div className="cabecalho__busca">
        <input
          type="search"
          className="busca"
          placeholder="Buscar essências, narguilés, acessórios..."
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
          aria-label="Buscar produto"
        />
      </div>
      <nav className="categorias" aria-label="Categorias">
        <button
          className={`chip${categoriaAtiva === null ? ' chip--ativa' : ''}`}
          onClick={() => onCategoria(null)}
        >
          Todos
        </button>
        {categorias.map((c) => (
          <button
            key={c.id}
            className={`chip${categoriaAtiva === c.id ? ' chip--ativa' : ''}`}
            onClick={() => onCategoria(c.id)}
          >
            {c.nome}
          </button>
        ))}
      </nav>
    </header>
  )
}
