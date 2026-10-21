import { getDb } from './index'
import { sincronizarCatalogo, garantirSyncToken } from './catalogo-sync'
import { puxarPedidosOnline } from './pedidos-online'

const INTERVALO_PADRAO_MS = 60_000

function pegarConfig(chave: string): string {
  try {
    const db = getDb()
    const r = db.prepare(`SELECT valor FROM config WHERE chave = ?`).get(chave) as { valor: string | null } | undefined
    return r?.valor ?? ''
  } catch { return '' }
}

function setSync(chave: string, valor: string): void {
  try {
    const db = getDb()
    db.prepare(`INSERT INTO catalogo_sync (chave, valor) VALUES (?, ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`)
      .run(chave, valor)
  } catch { /* ignore */ }
}

export async function cicloAutoSync(): Promise<void> {
  garantizarToken()
  setSync('status', 'sincronizando')

  const res = await sincronizarCatalogo()
  if (!res.ok) {
    setSync('status', 'erro')
    setSync('ultimo_erro', res.erro || 'erro_na_sync')
    return
  }

  await puxarPedidosOnline()
}

function garantizarToken(): void {
  try { garantirSyncToken() } catch { /* ignore */ }
}

let syncAgendado = false
let timerSync: ReturnType<typeof setTimeout> | null = null

function intervaloMs(): number {
  const s = Number(pegarConfig('auto_sync_intervalo_seg')) || 0
  return s > 0 ? s * 1000 : INTERVALO_PADRAO_MS
}

function proximoCiclo(): void {
  timerSync = setTimeout(() => {
    if (pegarConfig('auto_sync_ativos') === '1') {
      cicloAutoSync()
        .then(() => {})
        .catch(() => {})
    }
    if (syncAgendado) proximoCiclo()
  }, intervaloMs())
}

export function agendarSyncAutomatico(): void {
  if (syncAgendado) return
  syncAgendado = true
  proximoCiclo()
}

export function pararSyncAutomatico(): void {
  if (timerSync) clearTimeout(timerSync)
  timerSync = null
  syncAgendado = false
}

export function conectarCatalogoNoStartup(): void {
  try { garantirSyncToken() } catch { /* ignore */ }
  cicloAutoSync()
    .then(() => {})
    .catch(() => { setSync('status', 'sem_conexao') })
}
