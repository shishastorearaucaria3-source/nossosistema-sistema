import { garantirTokenRelay } from '../shared/relay-token'
import { sincronizarCatalogo } from './catalogo-sync'
import { puxarPedidosOnline } from './pedidos-online'

export interface ResultadoReparo {
  ok: boolean
  sucesso?: {
    conectado: boolean
    sincronizado: boolean
    produtos?: number
    pedidos_puxados?: number
  }
  erro?: string
}

export async function repararConexaoCatalogo(): Promise<ResultadoReparo> {
  garantirTokenRelay()

  const sync = await sincronizarCatalogo()
  if (!sync.ok) {
    if (sync.erro === 'supabase_nao_configurado') return { ok: false, erro: 'supabase_nao_configurado' }
    return { ok: false, erro: 'sincronizacao_falhou' }
  }

  let pedidosPuxados = 0
  const pull = await puxarPedidosOnline()
  if (pull.ok) pedidosPuxados = pull.puxados ?? 0

  return {
    ok: true,
    sucesso: {
      conectado: true,
      sincronizado: true,
      produtos: sync.produtos_sincronizados,
      pedidos_puxados: pedidosPuxados,
    },
  }
}
