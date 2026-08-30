export default function Loading({ texto = 'Carregando...' }: { texto?: string }) {
  return (
    <div className="ui-carregando">
      <span className="ui-spinner" />
      <span>{texto}</span>
    </div>
  )
}