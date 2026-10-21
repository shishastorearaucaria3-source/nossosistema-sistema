import { CSSProperties, ReactNode, useEffect } from 'react'

export interface UiModalProps {
  aberto: boolean
  titulo: string
  tamanho?: 'normal' | 'grande' | 'telaCheia'
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

  const modalClass = [
    'ui-modal',
    tamanho === 'grande' ? 'ui-modal--grande' : '',
    tamanho === 'telaCheia' ? 'ui-modal--full' : '',
  ].filter(Boolean).join(' ')

  const modalStyle: CSSProperties = tamanho === 'telaCheia' ? {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100vh',
    maxWidth: '100vw',
    maxHeight: '100vh',
    margin: 'auto',
    borderRadius: 0,
    zIndex: 9999,
    overflowY: 'auto',
  } : {}

  return (
    <div className="ui-modal-overlay" onClick={aoFechar}>
      <div
        className={modalClass}
        style={modalStyle}
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