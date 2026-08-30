import { useEffect, useMemo, useState } from 'react'
import { obterCatalogo } from './api/catalogoApi'
import type { OrigemDados } from './api/catalogoApi'
import type { CatalogoPublicoV1 } from './types'
import Cabecalho from './components/Cabecalho'
import Hero from './components/Hero'
import GradeProdutos from './components/GradeProdutos'
import CarrinhoDrawer from './components/CarrinhoDrawer'
import BannerConexao from './components/BannerConexao'
import Rodape from './components/Rodape'

export default function App() {
  const [estado, setEstado] = useState<{ dados: CatalogoPublicoV1 | null; origem: OrigemDados }>({
    dados: null,
    origem: 'api'
  })
  const [busca, setBusca] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  const [categoria, setCategoria] = useState<number | null>(() => {
    const cat = new URLSearchParams(window.location.search).get('cat')
    return cat && /^\d+$/.test(cat) ? Number(cat) : null
  })

  useEffect(() => {
    let ativo = true
    obterCatalogo().then((r) => {
      if (ativo) setEstado(r)
    })
    return () => {
      ativo = false
    }
  }, [])

  // URLs compartilháveis e refletidas na barra de endereço via query string,
  // sem router lib (esquema ?q= e ?cat= — evita fallback SPA em hospedagem estática).
  useEffect(() => {
    const params = new URLSearchParams()
    if (busca) params.set('q', busca)
    if (categoria !== null) params.set('cat', String(categoria))
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [busca, categoria])

  const dados = estado.dados

  useEffect(() => {
    if (dados?.loja.nome) document.title = `${dados.loja.nome} — Catálogo`
  }, [dados])

  const visiveis = useMemo(() => {
    if (!dados) return []
    const texto = busca.trim().toLowerCase()
    return dados.produtos.filter((p) => {
      if (categoria !== null && p.categoria_id !== categoria) return false
      if (!texto) return true
      const alvo = [p.nome, p.descricao ?? '', p.marca ?? '', p.categoria ?? '', p.subcategoria ?? ''].join(' ').toLowerCase()
      return alvo.includes(texto)
    })
  }, [dados, busca, categoria])

  const ofertas = useMemo(() => (dados ? dados.produtos.filter((p) => p.tem_promo && p.disponivel) : []), [dados])

  if (!dados) {
    return (
      <div className="carregando" role="status">
        <p>Carregando catálogo…</p>
      </div>
    )
  }

  const origem = estado.origem
  const origemGrade: 'api' | 'mock' = origem === 'api' ? 'api' : 'mock'
  const aoTentarNovamente = () => {
    obterCatalogo(true).then(setEstado)
  }

  const nomeCategoria = dados.categorias.find((c) => c.id === categoria)?.nome ?? null
  const tituloGrade = nomeCategoria
    ? `Categoria: ${nomeCategoria}`
    : busca.trim()
      ? `Resultados para "${busca.trim()}"`
      : 'Todos os produtos'

  return (
    <>
      <BannerConexao origem={origem} aoUsarReal={aoTentarNovamente} />
      <Cabecalho
        nomeLoja={dados.loja.nome ?? ''}
        busca={busca}
        onBusca={setBusca}
        categoriaAtiva={categoria}
        categorias={dados.categorias}
        onCategoria={setCategoria}
      />
      <main className="conteudo">
        <Hero loja={dados.loja} />
        {ofertas.length > 0 && (
          <section className="ofertas" aria-label="Ofertas da semana">
            <h2 className="ofertas__titulo">Ofertas da semana</h2>
            <GradeProdutos produtos={ofertas} origem={origemGrade} />
          </section>
        )}
        <h2 className="grade-titulo">{tituloGrade}</h2>
        <GradeProdutos produtos={visiveis} origem={origemGrade} />
      </main>
      <Rodape nomeLoja={dados.loja.nome ?? ''} />
      <CarrinhoDrawer />
    </>
  )
}