import type { LojaPublica } from '../types'

export default function Manutencao({ loja }: { loja: LojaPublica }) {
  return (
    <div className="manutencao">
      <div className="manutencao__card">
        <span className="manutencao__icone" aria-hidden="true">🔧</span>
        <h1>{loja.nome || 'Catálogo'}</h1>
        <p>Estamos em manutenção. O catálogo estará disponível novamente em breve.</p>
        {loja.whatsapp && (
          <p className="manutencao__cta">Para dúvidas, fale conosco pelo WhatsApp: {loja.whatsapp}</p>
        )}
      </div>
    </div>
  )
}