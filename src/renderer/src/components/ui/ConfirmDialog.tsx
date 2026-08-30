import Button from './Button'
import Modal from './Modal'

export interface UiConfirmarProps {
  aberto: boolean
  titulo: string
  mensagem: string
  confirmar?: string
  cancelar?: string
  perigo?: boolean
  aoConfirmar: () => void
  aoCancelar: () => void
}

export default function ConfirmDialog({
  aberto,
  titulo,
  mensagem,
  confirmar = 'Confirmar',
  cancelar = 'Cancelar',
  perigo = false,
  aoConfirmar,
  aoCancelar
}: UiConfirmarProps) {
  return (
    <Modal
      aberto={aberto}
      titulo={titulo}
      aoFechar={aoCancelar}
      rodape={
        <>
          <Button variante="fantasma" onClick={aoCancelar}>
            {cancelar}
          </Button>
          <Button
            variante={perigo ? 'perigo' : 'primario'}
            onClick={() => {
              aoConfirmar()
              aoCancelar()
            }}
          >
            {confirmar}
          </Button>
        </>
      }
    >
      <p className="ui-estado-desc" style={{ maxWidth: 'none', textAlign: 'left' }}>
        {mensagem}
      </p>
    </Modal>
  )
}