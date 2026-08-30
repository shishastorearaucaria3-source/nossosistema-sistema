import { HTMLAttributes, ReactNode } from 'react'

export interface UiCardProps extends HTMLAttributes<HTMLDivElement> {
  semPadding?: boolean
  clicavel?: boolean
}

export default function Card({ semPadding = false, clicavel = false, className = '', ...rest }: UiCardProps) {
  const cls = ['ui-card', semPadding ? 'ui-card--sem-padding' : '', clicavel ? 'ui-card--clicavel' : '', className]
    .filter(Boolean)
    .join(' ')
  return <div {...rest} className={cls} />
}

export function CardTitulo({ titulo, acoes }: { titulo: string; acoes?: ReactNode }) {
  return (
    <div className="ui-card-titulo">
      <h3>{titulo}</h3>
      {acoes}
    </div>
  )
}