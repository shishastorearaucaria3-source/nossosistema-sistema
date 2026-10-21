import { useEffect, useState } from 'react'
import type { ProdutoPublicoV1 } from '../types'
import { obterImagem } from '../api/imagens'
import { MOCK_IMAGENS } from '../mock/dados'

function PlaceholderVazio() {
  return (
    <div className="img-produto img-produto--vazio" aria-hidden="true">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4a4057" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 7a7 7 0 1 1 7 7 7 7 0 0 1-7-7v0z" />
        <path d="M9 14v3" />
        <path d="M6 21h6" />
        <circle cx="4" cy="8" r="1" fill="#4a4057" />
      </svg>
    </div>
  )
}

export default function ImagemProduto({ produto, origem }: { produto: ProdutoPublicoV1; origem: 'api' | 'mock' }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    setSrc(null)
    if (produto.imagem == null) return

    if (typeof produto.imagem === 'string') {
      if (ativo) setSrc(produto.imagem)
      return
    }

    if (origem === 'mock') {
      const mock = MOCK_IMAGENS[produto.imagem]
      if (mock && ativo) setSrc(mock)
      return
    }
    let cancelado = false
    obterImagem(produto.imagem).then((s) => {
      if (ativo && !cancelado && s) setSrc(s)
    })
    return () => {
      ativo = false
      cancelado = true
    }
  }, [produto.imagem, origem])

  if (!src) return <PlaceholderVazio />
  return <img className="img-produto" src={src} alt={produto.nome} loading="lazy" />
}
