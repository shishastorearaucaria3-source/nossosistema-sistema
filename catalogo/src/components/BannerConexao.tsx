import type { OrigemDados } from '../api/catalogoApi'

// Mensagem só aparece em produção quando API não configurada/disponível.
// A versão de dev (com instruções de servidor local) é eliminada do bundle
// de produção pelo Vite/minifier (nunca vaza rede local p/ o cliente).
const MSG_ERRO = import.meta.env.DEV
  ? 'Não foi possível alcançar o servidor local (porta 3210). Inicie o Sistema e tente novamente.'
  : 'Catálogo indisponível neste momento. Tente novamente mais tarde.'

export default function BannerConexao({ origem, aoUsarReal }: { origem: OrigemDados; aoUsarReal?: () => void }) {
  if (origem === 'api') return null
  if (origem === 'erro') {
    return (
      <div className="banner banner--erro" role="alert">
        {MSG_ERRO}
      </div>
    )
  }
  // Modo mock é exclusivo de desenvolvimento.
  if (!import.meta.env.DEV) return null
  return (
    <div className="banner banner--mock">
      Mostrando <strong>dados de exemplo</strong> (servidor local não encontrado).{' '}
      {aoUsarReal && (
        <button className="banner__acao" onClick={aoUsarReal}>
          Buscar dados reais
        </button>
      )}
    </div>
  )
}