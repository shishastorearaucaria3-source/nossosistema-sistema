import { ReactNode } from 'react'

export interface UiCabecalhoProps {
  titulo: ReactNode
  sub?: ReactNode
  acoes?: ReactNode
}

export default function PageHeader({ titulo, sub, acoes }: UiCabecalhoProps) {
  return (
    <div className="ui-cabecalho-pagina">
      <div>
        <h1>{titulo}</h1>
        {sub && <div className="ui-cabecalho-pagina-sub">{sub}</div>}
      </div>
      {acoes && <div className="ui-cabecalho-acoes">{acoes}</div>}
    </div>
  )
}