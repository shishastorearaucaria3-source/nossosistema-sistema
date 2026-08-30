import { ReactNode } from 'react'

export interface UiVazioProps {
  titulo?: string
  descricao?: string
  acao?: ReactNode
}

export default function EmptyState({ titulo = 'Nada por aqui', descricao, acao }: UiVazioProps) {
  return (
    <div className="ui-estado">
      <div className="ui-estado-titulo">{titulo}</div>
      {descricao && <div className="ui-estado-desc">{descricao}</div>}
      {acao && <div className="ui-estado-acao">{acao}</div>}
    </div>
  )
}