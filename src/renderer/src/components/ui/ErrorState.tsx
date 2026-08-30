import Button from './Button'

export interface UiErroProps {
  titulo?: string
  descricao?: string
  onTentarNovamente?: () => void
}

export default function ErrorState({ titulo = 'Não foi possível carregar', descricao, onTentarNovamente }: UiErroProps) {
  return (
    <div className="ui-estado">
      <div className="ui-estado-titulo">{titulo}</div>
      {descricao && <div className="ui-estado-desc">{descricao}</div>}
      {onTentarNovamente && (
        <Button variante="primario" tamanho="pequeno" onClick={onTentarNovamente}>
          Tentar novamente
        </Button>
      )}
    </div>
  )
}