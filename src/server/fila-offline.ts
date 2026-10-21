import { getDb } from './index'

interface FilaItem {
  id: number
  operacao: string
  dados: string
  tentativas: number
  criado_em: string
  proximo_tentativa: string
  erro: string | null
}

const MAX_TENTATIVAS = 5
const INTERVALO_BASE_MS = 30_000

export function inicializarFilaOffline(): void {
  try {
    const db = getDb()
    db.exec(`CREATE TABLE IF NOT EXISTS catalogo_fila_offline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operacao TEXT NOT NULL,
      dados TEXT NOT NULL,
      tentativas INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL,
      proximo_tentativa TEXT NOT NULL,
      erro TEXT
    )`)
  } catch { /* ignore */ }
}

export function enqueueOperacao(operacao: string, dados: Record<string, unknown>): void {
  try {
    const db = getDb()
    const agora = new Date().toISOString()
    db.prepare(
      `INSERT INTO catalogo_fila_offline (operacao, dados, tentativas, criado_em, proximo_tentativa)
       VALUES (?, ?, 0, ?, ?)`
    ).run(operacao, JSON.stringify(dados), agora, agora)
  } catch { /* ignore */ }
}

export function processarFilaOffline(
  processar: (operacao: string, dados: Record<string, unknown>) => Promise<boolean>
): Promise<{ processados: number; falhas: number }> {
  return new Promise(async (resolve) => {
    let processados = 0
    let falhas = 0

    try {
      const db = getDb()
      const agora = new Date().toISOString()
      const itens = db.prepare(
        `SELECT * FROM catalogo_fila_offline
         WHERE tentativas < ? AND proximo_tentativa <= ?
         ORDER BY criado_em ASC
         LIMIT 50`
      ).all(MAX_TENTATIVAS, agora) as unknown as FilaItem[]

      for (const item of itens) {
        try {
          const dados = JSON.parse(item.dados) as Record<string, unknown>
          const ok = await processar(item.operacao, dados)

          if (ok) {
            db.prepare(`DELETE FROM catalogo_fila_offline WHERE id = ?`).run(item.id)
            processados++
          } else {
            const proximo = calcularProximoAttempt(item.tentativas + 1)
            db.prepare(
              `UPDATE catalogo_fila_offline
               SET tentativas = tentativas + 1, proximo_tentativa = ?, erro = 'retry'
               WHERE id = ?`
            ).run(proximo, item.id)
            falhas++
          }
        } catch {
          const proximo = calcularProximoAttempt(item.tentativas + 1)
          db.prepare(
            `UPDATE catalogo_fila_offline
             SET tentativas = tentativas + 1, proximo_tentativa = ?, erro = 'exception'
             WHERE id = ?`
          ).run(proximo, item.id)
          falhas++
        }
      }

      db.prepare(
        `DELETE FROM catalogo_fila_offline WHERE tentativas >= ?`
      ).all(MAX_TENTATIVAS)
    } catch { /* ignore */ }

    resolve({ processados, falhas })
  })
}

function calcularProximoAttempt(tentativa: number): string {
  const delay = INTERVALO_BASE_MS * Math.pow(2, tentativa - 1)
  return new Date(Date.now() + delay).toISOString()
}

export function contarPendentesFila(): number {
  try {
    const db = getDb()
    const r = db.prepare(
      `SELECT COUNT(*) AS c FROM catalogo_fila_offline WHERE tentativas < ?`
    ).get(MAX_TENTATIVAS) as { c: number } | undefined
    return r?.c || 0
  } catch { return 0 }
}

let timerFila: ReturnType<typeof setInterval> | null = null

export function iniciarLoopFilaOffline(
  processar: (operacao: string, dados: Record<string, unknown>) => Promise<boolean>
): void {
  if (timerFila) return
  timerFila = setInterval(() => {
    processarFilaOffline(processar)
      .then(() => {})
      .catch(() => {})
  }, 30_000)
}

export function pararLoopFilaOffline(): void {
  if (timerFila) clearInterval(timerFila)
  timerFila = null
}
