import { dataUrlImagem } from '../../../shared/db'

export default function ProductImage({ base64, nome }: { base64: string | null; nome: string }) {
  return (
    <div className="cp-imagem-wrap">
      {base64 ? (
        <img className="cp-imagem" src={dataUrlImagem(base64)} alt={nome} />
      ) : (
        <div className="cp-imagem-vazia">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 6h5l2-2h2l2 2h5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
            <path d="M12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          </svg>
        </div>
      )}
      {base64 && <span className="cp-imagem-qtd">1/1</span>}
    </div>
  )
}
