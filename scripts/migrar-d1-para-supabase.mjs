import { createClient } from '@supabase/supabase-js'

// Migração CORRETA: fonte = D1 (catálogo real que o sistema serve em produção).
// Motivo: o SQLite instalado (C:\NossoSistema\...\tabacaria.sqlite) está VAZIO de
// produtos (instalação nova). O catálogo real (1295 produtos/19 cat/1 zona) está no D1.
// Este script lê o /api/catalogo/publico do Worker e faz upsert no Supabase (idempotente).
//
// Uso: node scripts/migrar-d1-para-supabase.mjs
// Pré-requisitos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EMPRESA_ID.

const supabaseUrl = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const empresaId = process.env.EMPRESA_ID
const CATALOGO_URL = process.env.CATALOGO_URL || 'https://catalogo-worker.shishastore-tabacaria.workers.dev'

function requireEnv(nome) {
  if (!process.env[nome]) {
    console.error(`[ERRO] Variável obrigatória ausente: ${nome}`)
    process.exit(1)
  }
}
requireEnv('SUPABASE_URL')
requireEnv('SUPABASE_SERVICE_ROLE_KEY')
requireEnv('EMPRESA_ID')

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120)
}

function detectarExtensao(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return 'jpg'
}

async function baixarImagem(id) {
  const res = await fetch(`${CATALOGO_URL}/api/catalogo/imagem/${id}`)
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf || buf.length < 8) return null
  const ext = detectarExtensao(buf)
  return { buf, ext }
}

async function main() {
  console.log(`\n=== Migração D1 → Supabase ===`)
  console.log(`Fonte: ${CATALOGO_URL}/api/catalogo/publico | Empresa: ${empresaId}`)

  // 1) Buscar catálogo real no D1
  const r = await fetch(`${CATALOGO_URL}/api/catalogo/publico`)
  if (!r.ok) throw new Error(`D1 /publico HTTP ${r.status}`)
  const j = await r.json()

  const loja = j.loja || {}
  const categorias = j.categorias || []
  const produtos = j.produtos || []
  const zonas = loja.zonas || []
  console.log(`D1: ${produtos.length} produtos, ${categorias.length} categorias, ${zonas.length} zonas`)

  // 2) Settings
  const settings = {
    empresa_id: empresaId,
    nome_loja: loja.nome || 'Loja',
    whatsapp: loja.whatsapp || null,
    horario: loja.horario || null,
    manutencao_ativos: !!loja.manutencao_ativos,
    pedidos_ativos: loja.pedidos_ativos !== false,
    aceita_entrega: loja.aceita_entrega !== false,
    aceita_retirada: !!loja.aceita_retirada,
    taxa_entrega: Number(loja.taxa_entrega) || 0,
    updated_at: new Date().toISOString(),
  }
  const { error: setErr } = await supabase.from('catalog_settings').upsert(settings, { onConflict: 'empresa_id' })
  if (setErr) throw new Error(`settings: ${setErr.message}`)
  console.log('[OK] Settings')

  // 3) Categorias
  if (categorias.length > 0) {
    const catData = categorias.map((c) => ({ empresa_id: empresaId, external_id: c.id, nome: c.nome }))
    const { error: catErr } = await supabase.from('catalog_categories').upsert(catData, { onConflict: 'empresa_id,external_id' })
    if (catErr) throw new Error(`categorias: ${catErr.message}`)
  }
  console.log(`[OK] ${categorias.length} categorias`)

  // map external_id -> uuid (uuid do lado de cá)
  const { data: existingCats, error: catsSelErr } = await supabase
    .from('catalog_categories').select('id, external_id').eq('empresa_id', empresaId)
  if (catsSelErr) throw new Error(`cat select: ${catsSelErr.message}`)
  const catMap = new Map((existingCats || []).map((c) => [String(c.external_id), c.id]))

  // 4) Produtos + Imagens
  const TAMANHO_LOTE = 50
  let comImg = 0
  let totalEnviados = 0
  for (let i = 0; i < produtos.length; i += TAMANHO_LOTE) {
    const lote = produtos.slice(i, i + TAMANHO_LOTE)
    const data = []
    for (const p of lote) {
      if (!p.nome || !String(p.nome).trim()) continue
      let imagemUrl = null
      if (p.imagem) {
        try {
          const img = await baixarImagem(p.imagem)
          if (img) {
            const path = `${empresaId}/${p.id}.${img.ext}`
            const { error: upErr } = await supabase.storage.from('produtos').upload(
              path, new Uint8Array(img.buf), {
                contentType: img.ext === 'png' ? 'image/png' : img.ext === 'gif' ? 'image/gif' : img.ext === 'webp' ? 'image/webp' : 'image/jpeg',
                cacheControl: 'public, max-age=86400',
                upsert: true,
              })
            if (!upErr) {
              imagemUrl = supabase.storage.from('produtos').getPublicUrl(path).data.publicUrl
              comImg++
            }
          }
        } catch { /* image opcional */ }
      }
      const temPromo = !!(p.preco_promo && p.preco_promo > 0)
      data.push({
        empresa_id: empresaId,
        external_id: p.id,
        nome: p.nome,
        slug: slugify(p.nome),
        descricao: p.descricao,
        preco: Number(p.preco) || 0,
        preco_promo: temPromo ? Number(p.preco_promo) : null,
        categoria_id: p.categoria_id != null ? catMap.get(String(p.categoria_id)) || null : null,
        subcategoria: p.subcategoria,
        marca: p.marca,
        publicado: true,
        estoque_publico: Number(p.estoque) || 0,
        ordem: Number(p.ordem) || 0,
        imagem_url: imagemUrl,
        updated_at: new Date().toISOString(),
      })
    }
    if (data.length > 0) {
      const { error: prodErr } = await supabase.from('catalog_products').upsert(data, { onConflict: 'empresa_id,external_id' })
      if (prodErr) throw new Error(`produtos: ${prodErr.message}`)
      totalEnviados += data.length
    }
    console.log(`[OK] Lote ${i / TAMANHO_LOTE + 1}: ${data.length} produtos`)
  }
  console.log(`Total produtos enviados: ${totalEnviados} | com imagem: ${comImg}`)

  // 5) Zonas
  if (zonas.length > 0) {
    const zonasData = zonas.map((z) => ({
      empresa_id: empresaId,
      external_id: z.id,
      nome: z.nome,
      preco: Number(z.preco) || 0,
      ceps: Array.isArray(z.ceps) ? z.ceps : [],
    }))
    const { error: zonasErr } = await supabase.from('catalog_zones').upsert(zonasData, { onConflict: 'empresa_id,external_id' })
    if (zonasErr) throw new Error(`zonas: ${zonasErr.message}`)
  }
  console.log(`[OK] ${zonas.length} zonas`)

  // 6) Comparação
  const { count: countSupabase, error: cntErr } = await supabase
    .from('catalog_products').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId)
  if (cntErr) throw new Error(`count: ${cntErr.message}`)
  const { count: countCats } = await supabase
    .from('catalog_categories').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId)

  console.log(`\n=== Resumo ===`)
  console.log(`D1 produtos: ${produtos.length} | Supabase produtos: ${countSupabase}`)
  console.log(`D1 categorias: ${categorias.length} | Supabase categorias: ${countCats}`)
  console.log(`Imagens no Storage: ${comImg}`)
  console.log(`Divergência produtos: ${Math.abs(produtos.length - countSupabase)}`)
  console.log(`\nMigração D1 → Supabase concluída!`)
}

main().catch((e) => {
  console.error(`[ERRO] ${e.message}`)
  process.exit(1)
})
