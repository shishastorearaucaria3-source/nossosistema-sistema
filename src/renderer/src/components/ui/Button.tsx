import { ButtonHTMLAttributes } from 'react'

export type VarianteBotao = 'primario' | 'secundario' | 'perigo' | 'sucesso' | 'fantasma'
export type TamanhoBotao = 'pequeno' | 'medio' | 'grande'

export interface UiBotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao
  tamanho?: TamanhoBotao
  bloco?: boolean
}

export default function Button({
  variante = 'secundario',
  tamanho = 'medio',
  bloco = false,
  className = '',
  type = 'button',
  ...rest
}: UiBotaoProps) {
  const cls = [
    'ui-botao',
    variante !== 'secundario' ? `ui-botao--${variante}` : '',
    tamanho !== 'medio' ? `ui-botao--${tamanho}` : '',
    bloco ? 'ui-botao--bloco' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return <button {...rest} type={type} className={cls} />
}