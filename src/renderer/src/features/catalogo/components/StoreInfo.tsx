export default function StoreInfo({ nomeLoja }: { nomeLoja: string }) {
  return (
    <div className="rp-loja">
      <div className="rp-logo">
        {nomeLoja.charAt(0).toUpperCase()}
      </div>
      <span className="rp-url">Catálogo online</span>
      <strong className="rp-subdominio">{nomeLoja}</strong>
    </div>
  )
}