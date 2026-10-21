import logoBranca from '../assets/logo-branca.png'

export default function Rodape({ nomeLoja }: { nomeLoja: string }) {
  const ano = new Date().getFullYear()
  return (
    <footer className="rodape">
      <div className="rodape__conteudo">
        <img className="rodape__logo" src={logoBranca} alt={`${nomeLoja || 'Shisha Store'} — logo`} />
        <span className="rodape__nome">{nomeLoja || 'Shisha Store'}</span>
        <div className="rodape__divider" />
        <p>
          © {ano} {nomeLoja || 'Shisha Store'} — Catálogo online
        </p>
      </div>
    </footer>
  )
}
