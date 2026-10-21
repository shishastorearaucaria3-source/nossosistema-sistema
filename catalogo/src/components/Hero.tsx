import type { LojaPublica } from '../types'
import logoPerfil from '../assets/logo-perfil.png'

export default function Hero({ loja }: { loja: LojaPublica }) {
  if (!loja.nome) return null
  return (
    <section className="hero">
      <div className="hero__conteudo">
        <img className="hero__logo" src={logoPerfil} alt={`${loja.nome} — logotipo`} />
        <h1 className="hero__titulo">{loja.nome}</h1>
        <p className="hero__txt">
          Narguilés, essências, acessórios e carvão — tudo que você precisa para a sua sessão perfeita.
        </p>
        <div className="hero__infos">
          {loja.horario && (
            <p className="hero__info">
              <span className="hero__info-icon" aria-hidden="true">🕐</span>
              {loja.horario}
            </p>
          )}
          {loja.whatsapp && (
            <p className="hero__info">
              <span className="hero__info-icon" aria-hidden="true">📱</span>
              {loja.whatsapp}
            </p>
          )}
          {loja.endereco && (
            <p className="hero__info">
              <span className="hero__info-icon" aria-hidden="true">📍</span>
              {loja.endereco}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
