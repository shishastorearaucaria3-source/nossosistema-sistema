import { ReactNode, useEffect } from 'react'

export interface UiModalProps {
  aberto: boolean
  titulo: string
  tamanho?: 'normal' | 'grande'
  aoFechar: () => void
  children: ReactNode
  rodape?: ReactNode
}

export default function Modal({ aberto, titulo, tamanho = 'normal', aoFechar, children, rodape }: UiModalProps) {
  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aberto, aoFechar])

  if (!aberto) return null

  return (
    <div className="ui-modal-overlay" onClick={aoFechar}>
      <div
        className={`ui-modal ${tamanho === 'grande' ? 'ui-modal--grande' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="ui-modal-cabecalho">
          <h3>{titulo}</h3>
          <button className="ui-toast-fechar" onClick={aoFechar} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="ui-modal-corpo">{children}</div>
        {rodape && <div className="ui-modal-rodape">{rodape}</div>}
      </div>
    </div>
  )
}