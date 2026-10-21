import { createClient } from '@supabase/supabase-js'

// Remove categorias residuais no Supabase que NAO existem na fonte autoritativa (D1).
// Seguro: so apaga categorias com ZERO produtos referenciando-as (FK ON DELETE SET NULL ainda
// garante que nenhum produto e apagado). Idempotente: rodar de novo e seguro.
//
// Uso: node scripts/limpar-categorias-residuais.mjs
// Prz-requisitos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EMPRESA_ID.

const supabaseUrl = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const empresaId = process.env.EMPRESA_ID
const CATALOGO_URL = process.env.CATALOGO_URL || 'https://catalogo-worker.shishastore-tabacaria.workers.dev'

function requireEnv(nome) {
  if (!process.env[nome]) { console.error(`[ERRO] Variavel obrigatoria ausente: ${nome}`); process.exit(1) }
}
requireEnv('SUPABASE_URL')
requireEnv('SUPABASE_SERVICE_ROLE_KEY')
requireEnv('EMPRESA_ID')

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

async function main() {
  // 1) Conjunto autoritativo do D1
  const r = await fetch(`${CATALOGO_URL}/api/catalogo/publico`)
  if (!r.ok) throw new Error(`D1 /publico HTTP ${r.status}`)
  const j = await r.json()
  const autorizados = new Set((j.categorias || []).map((c) => String(c.id)))

  // 2) Categorias atuais no Supabase
  const { data: cats, error } = await supabase
    .from('catalog_categories').select('id, external_id, nome').eq('empresa_id', empresaId).order('external_id')
  if (error) throw new Error(`select categorias: ${error.message}`)

  const residuais = (cats || []).filter((c) => !autorizados.has(String(c.external_id)))
  console.log(`D1 categorias: ${autorizados.size} | Supabase categorias: ${(cats || []).length} | residuais: ${residuais.length}`)

  for (const c of residuais) {
    // Valida referencias antes de apagar
    const { count, error: cntErr } = await supabase
      .from('catalog_products').select('*', { count: 'exact', head: true }).eq('categoria_id', c.id)
    if (cntErr) throw new Error(`contar produtos da categoria ${c.external_id}: ${cntErr.message}`)
    if (count > 0) {
      console.log(`[PULO] categoria ${c.external_id} '${c.nome}' tem ${count} produtos referenciando — nao apagada`)
      continue
    }
    const { error: delErr } = await supabase.from('catalog_categories').delete().eq('id', c.id)
    if (delErr) throw new Error(`apagar categoria ${c.external_id}: ${delErr.message}`)
    console.log(`[-] apagada categoria ${c.external_id} '${c.nome}' (0 refs)`)
  }

  // 3) Contagem final
  const { count: final, error: fErr } = await supabase
    .from('catalog_categories').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId)
  if (fErr) throw new Error(fErr.message)
  console.log(`\nCategorias finais no Supabase: ${final} (esperado ${autorizados.size})`)
  console.log('Concluido.')
}

main().catch((e) => { console.error(`[ERRO] ${e.message}`); process.exit(1) })
