import { useState } from 'react'
import ProductImage from './ProductImage'
import ProductActions from './ProductActions'

export interface CatalogoProduto {
  id: number
  nome: string
  codigo: string
  preco: number
  estoque: number
  categoria: string | null
  catalogo_publicado: boolean
  catalogo_ordem: number
  imagem: string | null
  descricao: string | null
}

export default function ProductRow({
  produto,
  editandoDescricao,
  onAlternarPublicacao,
  onSalvarDescricao,
  onEditarDescricao,
  onCompartilhar,
  onAbrir
}: {
  produto: CatalogoProduto
  editandoDescricao: boolean
  onAlternarPublicacao: (p: CatalogoProduto) => void
  onSalvarDescricao: (p: CatalogoProduto, texto: string) => void
  onEditarDescricao: (p: CatalogoProduto) => void
  onCompartilhar: (p: CatalogoProduto) => void
  onAbrir: (p: CatalogoProduto) => void
}) {
  return (
    <div className="cp-linha">
      <div className="cp-col-publicar">
        <button
          className={`cat-switch pequeno ${produto.catalogo_publicado ? 'ligado' : ''}`}
          role="switch"
          aria-checked={produto.catalogo_publicado}
          onClick={() => onAlternarPublicacao(produto)}
          title={produto.catalogo_publicado ? 'Publicado' : 'Não publicado'}
        >
          <span className="cat-switch-bola" />
        </button>
      </div>

      <div className="cp-col-imagem">
        <ProductImage base64={produto.imagem} nome={produto.nome} />
      </div>

      <div className="cp-col-produto" onClick={() => onAbrir(produto)}>
        <strong className="cp-nome">{produto.nome}</strong>
        <span className="cp-codigo-preco">
          {produto.codigo} • R$ {produto.preco.toFixed(2)}
        </span>
        <span className="cp-estoque-categoria">
          <span className={produto.estoque <= 0 ? 'cp-estoque-zero' : 'cp-estoque-ok'}>
            {produto.estoque}
          </span>
          {' • '}
          {produto.categoria ?? 'Sem categoria'}
        </span>
      </div>

      <div className="cp-col-descricao">
        {editandoDescricao ? (
          <DescricaoEditor produto={produto} onSalvar={onSalvarDescricao} onFechar={() => onEditarDescricao(produto)} />
        ) : (
          <button className="cp-adicionar-desc" onClick={() => onEditarDescricao(produto)}>
            {produto.descricao || 'Adicionar Descrição'}
          </button>
        )}
      </div>

      <div className="cp-col-acoes">
        <ProductActions
          onCompartilhar={() => onCompartilhar(produto)}
          onAbrir={() => onAbrir(produto)}
        />
      </div>
    </div>
  )
}

function DescricaoEditor({
  produto,
  onSalvar,
  onFechar
}: {
  produto: CatalogoProduto
  onSalvar: (p: CatalogoProduto, texto: string) => void
  onFechar: () => void
}) {
  const [texto, setTexto] = useState(produto.descricao ?? '')
  return (
    <div className="cp-desc-editor">
      <input
        autoFocus
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSalvar(produto, texto)
          if (e.key === 'Escape') onFechar()
        }}
        placeholder="Descrição do produto"
      />
      <div className="cp-desc-acoes">
        <button className="btn-mini" onClick={() => onSalvar(produto, texto)}>Salvar</button>
        <button className="btn-mini" onClick={onFechar}>Cancelar</button>
      </div>
    </div>
  )
}
