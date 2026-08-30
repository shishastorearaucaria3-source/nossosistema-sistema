import { SelectHTMLAttributes } from 'react'

export interface UiSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  rotulo?: string
}

export default function Select({ rotulo, className = '', children, ...rest }: UiSelectProps) {
  const el = <select {...rest} className={`ui-campo ${className}`.trim()}>{children}</select>
  if (!rotulo) return el
  return (
    <label className="ui-campo-rotulo" style={{ width: '100%' }}>
      <span>{rotulo}</span>
      {el}
    </label>
  )
}