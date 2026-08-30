import { InputHTMLAttributes } from 'react'

export interface UiBuscaProps extends InputHTMLAttributes<HTMLInputElement> {}

export default function SearchInput({ className = '', ...rest }: UiBuscaProps) {
  return (
    <div className={`ui-busca ${className}`.trim()}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input {...rest} className="ui-campo" type="text" />
    </div>
  )
}