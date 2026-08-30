import { HTMLAttributes } from 'react'

export type TomBadge = 'ok' | 'aviso' | 'perigo' | 'info' | 'neutro'

export interface UiBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tom?: TomBadge
}

export default function Badge({ tom = 'neutro', className = '', ...rest }: UiBadgeProps) {
  const cls = ['ui-badge', tom !== 'neutro' ? `ui-badge--${tom}` : '', className].filter(Boolean).join(' ')
  return <span {...rest} className={cls} />
}