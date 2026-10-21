import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProdutoPublicoV1 } from '../types'

export interface ItemCarrinho {
  id: number
  nome: string
  preco: number
  quantidade: number
  imagem: number | string | null
}

interface CarrinhoContexto {
  itens: ItemCarrinho[]
  abrir: boolean
  setAbrir: (v: boolean) => void
  adicionar: (p: ProdutoPublicoV1, qtde: number) => void
  remover: (id: number) => void
  mudarQuantidade: (id: number, qtde: number) => void
  limpar: () => void
  total: number
  itensCount: number
}

const CHAVE = 'catalogo.carrinho.v1'

const Ctx = createContext<CarrinhoContexto | null>(null)

function carregarItens(): ItemCarrinho[] {
  try {
    const raw = localStorage.getItem(CHAVE)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as ItemCarrinho[]) : []
  } catch {
    return []
  }
}

export function CarrinhoProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ItemCarrinho[]>(carregarItens)
  const [abrir, setAbrir] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(itens))
    } catch {
      /* localStorage indisponível: segue sem persistência */
    }
  }, [itens])

  const adicionar = useCallback((p: ProdutoPublicoV1, qtde: number) => {
    if (!p.disponivel || qtde <= 0) return
    setItens((atual) => {
      const existente = atual.find((i) => i.id === p.id)
      if (existente) {
        const limite = typeof p.estoque === 'number' && p.estoque > 0 ? p.estoque : 999
        const nova = Math.min(existente.quantidade + qtde, limite)
        return atual.map((i) => (i.id === p.id ? { ...i, quantidade: nova } : i))
      }
      return [{ id: p.id, nome: p.nome, preco: p.preco_promo && p.tem_promo ? p.preco_promo : p.preco, quantidade: qtde, imagem: p.imagem }, ...atual]
    })
    setAbrir(true)
  }, [])

  const remover = useCallback((id: number) => {
    setItens((atual) => atual.filter((i) => i.id !== id))
  }, [])

  const mudarQuantidade = useCallback((id: number, qtde: number) => {
    setItens((atual) =>
      atual.map((i) => {
        if (i.id !== id) return i
        if (qtde <= 0) return i
        return { ...i, quantidade: qtde }
      })
    )
  }, [])

  const limpar = useCallback(() => setItens([]), [])

  const total = useMemo(() => itens.reduce((s, i) => s + i.preco * i.quantidade, 0), [itens])
  const itensCount = useMemo(() => itens.reduce((s, i) => s + i.quantidade, 0), [itens])

  const valor = useMemo(
    () => ({ itens, abrir, setAbrir, adicionar, remover, mudarQuantidade, limpar, total, itensCount }),
    [itens, abrir, adicionar, remover, mudarQuantidade, limpar, total, itensCount]
  )

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useCarrinho(): CarrinhoContexto {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCarrinho deve ser usado dentro de CarrinhoProvider')
  return ctx
}