import { useEffect, useState } from 'react'
import type { ProdutoPublicoV1 } from '../types'
import { obterImagem } from '../api/imagens'
import { MOCK_IMAGENS } from '../mock/dados'

export default function ImagemProduto({ produto, origem }: { produto: ProdutoPublicoV1; origem: 'api' | 'mock' }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    setSrc(null)
    if (produto.imagem == null) return
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

  if (!src) return <div className="img-produto img-produto--vazio" aria-hidden="true" />
  return <img className="img-produto" src={src} alt={produto.nome} loading="lazy" />
}