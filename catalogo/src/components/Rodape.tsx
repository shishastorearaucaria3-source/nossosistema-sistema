export default function Rodape({ nomeLoja }: { nomeLoja: string }) {
  const ano = new Date().getFullYear()
  return (
    <footer className="rodape">
      <p>
        {nomeLoja || 'Catálogo'} © {ano} — Catálogo online
      </p>
    </footer>
  )
}