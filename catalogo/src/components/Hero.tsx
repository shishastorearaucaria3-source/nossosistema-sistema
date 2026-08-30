import type { LojaPublica } from '../types'

export default function Hero({ loja }: { loja: LojaPublica }) {
  if (!loja.nome) return null
  return (
    <section className="hero">
      <div className="hero__conteudo">
        <h1 className="hero__titulo">{loja.nome}</h1>
        <p className="hero__txt">Catálogo online da loja — produtos, promoções e disponibilidade atualizados.</p>
        {loja.horario && <p className="hero__info">🕐 {loja.horario}</p>}
        {loja.whatsapp && <p className="hero__info">📱 {loja.whatsapp}</p>}
        {loja.endereco && <p className="hero__info">📍 {loja.endereco}</p>}
      </div>
    </section>
  )
}