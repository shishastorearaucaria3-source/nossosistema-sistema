import { useEffect, useState } from 'react'

export type TipoToast = 'ok' | 'aviso' | 'erro' | 'info'

interface ToastItem {
  id: number
  tipo: TipoToast
  mensagem: string
}

let emissor: ((item: ToastItem) => void) | null = null
let proximoId = 1

export function notificar(tipo: TipoToast, mensagem: string) {
  emissor?.({ id: proximoId++, tipo, mensagem })
}

export const toasts = {
  sucesso: (m: string) => notificar('ok', m),
  aviso: (m: string) => notificar('aviso', m),
  erro: (m: string) => notificar('erro', m),
  info: (m: string) => notificar('info', m)
}

export default function Toasts() {
  const [itens, setItens] = useState<ToastItem[]>([])

  useEffect(() => {
    emissor = (item) => {
      setItens((lista) => [...lista, item])
      setTimeout(() => {
        setItens((lista) => lista.filter((x) => x.id !== item.id))
      }, 4000)
    }
    return () => {
      emissor = null
    }
  }, [])

  if (itens.length === 0) return null

  return (
    <div className="ui-toast-area">
      {itens.map((t) => (
        <div key={t.id} className={`ui-toast ui-toast--${t.tipo}`}>
          <span>{t.mensagem}</span>
          <button
            className="ui-toast-fechar"
            onClick={() => setItens((lista) => lista.filter((x) => x.id !== t.id))}
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}