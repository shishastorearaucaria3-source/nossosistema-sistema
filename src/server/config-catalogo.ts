// Configuração central do Catálogo Online (produção).
//
// A única fonte de verdade para a URL pública do Worker (usada pelo
// polling/puxar de pedidos e pela sincronização). O usuário NÃO deve conhecer
// nem digitar essa URL — ela vive nesta constante de produção e, apenas se
// necessário para ambientes distintos, pode ser sobrescrita via config local
// (nunca via tela, somente por administração técnica).

// URL oficial pública do Worker do catálogo (produção).
export const URL_WORKER_CATALOGO_PADRAO = 'https://catalogo-worker.shishastore-tabacaria.workers.dev'

const CHAVE_URL_WORKER = 'url_worker_catalogo'

// Url atual do worker: usa a sobrescrita de config local quando explícita,
// caso contrário a constante de produção centralizada.
export function urlWorkerCatalogo(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { pegarConfig } = require('./catalogo') as { pegarConfig: (chave: string) => string }
    const custom = pegarConfig(CHAVE_URL_WORKER)
    if (custom && /^https?:\/\//i.test(custom.trim())) return custom.trim().replace(/\/+$/, '')
  } catch { /* ignore */ }
  return URL_WORKER_CATALOGO_PADRAO
}

// Define sobrescrita explícita da URL do worker (apenas administração técnica,
// nunca exposta na interface). Passar '' restaura a URL oficial de produção.
export function setUrlWorkerCatalogo(url: string): { ok: boolean } {
  try {
    const { getDb } = require('./index') as { getDb: () => { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } } }
    const db = getDb()
    const valor = (url || '').trim().replace(/\/+$/, '')
    db.prepare(`INSERT INTO config (chave, valor) VALUES (?, ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`)
      .run(CHAVE_URL_WORKER, valor)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
