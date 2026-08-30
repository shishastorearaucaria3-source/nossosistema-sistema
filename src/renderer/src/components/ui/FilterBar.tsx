import { ReactNode } from 'react'

export interface UiChip<T> {
  valor: T
  rotulo: string
}

export interface UiBarraFiltroProps<T> {
  opcoes: UiChip<T>[]
  ativo: T
  aoMudar: (valor: T) => void
  extra?: ReactNode
}

export default function FilterBar<T>({ opcoes, ativo, aoMudar, extra }: UiBarraFiltroProps<T>) {
  return (
    <div className="ui-barra-filtro">
      {opcoes.map((o) => (
        <button
          key={String(o.valor)}
          className={`ui-chip ${o.valor === ativo ? 'ui-chip--ativo' : ''}`}
          onClick={() => aoMudar(o.valor)}
        >
          {o.rotulo}
        </button>
      ))}
      {extra}
    </div>
  )
}