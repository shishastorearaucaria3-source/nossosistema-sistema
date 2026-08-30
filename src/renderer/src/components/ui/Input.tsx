import { InputHTMLAttributes } from 'react'

export interface UiCampoProps extends InputHTMLAttributes<HTMLInputElement> {
  rotulo?: string
}

export default function Input({ rotulo, className = '', ...rest }: UiCampoProps) {
  const el = <input {...rest} className={`ui-campo ${className}`.trim()} />
  if (!rotulo) return el
  return (
    <label className="ui-campo-rotulo" style={{ width: '100%' }}>
      <span>{rotulo}</span>
      {el}
    </label>
  )
}