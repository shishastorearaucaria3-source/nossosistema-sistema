import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDataDir } from '../src/shared/data-dir.ts'
import { DatabaseSync } from 'node:sqlite'

// Script de primeira migração: envia os produtos atuais do SQLite para o Supabase.
// Uso: node scripts/migrar-para-supabase.mjs
// Pré-requisitos: variáveis de ambiente SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// EMPRESA_ID configuradas (ou em .env na raiz).

const supabaseUrl = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const empresaId = process.env.EMPRESA_ID

function requireEnv(nome) {
  if (!process.env[nome]) {
    console.error(`[ERRO] Variável obrigatória ausente: ${nome}`)
    process.exit(1)
  }
}

requireEnv('SUPABASE_URL')
requireEnv('SUPABASE_SERVICE_ROLE_KEY')
requireEnv('EMPRESA_ID')

const dbPath = process.env.TABACARIA_DB || join(getDataDir(), 'tabacaria.sqlite')
if (!existsSync(dbPath)) {
  console.error(`[ERRO] Banco SQLite não encontrado em: ${dbPath}`)
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

function usarConfig(chave) {
  try {
    const r = db.prepare(`SELECT valor FROM config WHERE chave = ?`).get(chave)
    return r?.valor ?? null
  } catch { return null }
}

function detectarExtensao(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return 'jpg'
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120)
}

async function main() {
  console.log(`\n=== Primeira migração SQLite → Supabase ===`)
  console.log(`Banco: ${dbPath}`)
  console.log(`Empresa: ${empresaId}`)

  // 1) Contagem local
  const totalLocal = db.prepare(`SELECT COUNT(*) AS c FROM produtos WHERE ativo = 1`).get().c
  const publicadosLocal = db.prepare(`SELECT COUNT(*) AS c FROM produtos WHERE ativo = 1 AND catalogo_publicado = 1`).get().c
  console.log(`Produtos ativos locais: ${totalLocal} (publicados: ${publicadosLocal})`)

  // 2) Settings
  const settings = {
    nome_loja: usarConfig('nome_loja') || 'Loja',
    whatsapp: usarConfig('telefone_loja') || null,
    endereco: usarConfig('endereco_loja') || null,
    horario: usarConfig('horario_funcionamento') || null,
    manutencao_ativos: usarConfig('manutencao_ativos') === '1',
    pedidos_ativos: (usarConfig('pedidos_ativos') || '1') === '1',
    aceita_entrega: (usarConfig('aceita_entrega') || '1') === '1',
    aceita_retirada: usarConfig('aceita_retirada') === '1',
    taxa_entrega: Number(usarConfig('taxa_entrega')) || 0,
    mostrar_estoque: usarConfig('catalogo_mostrar_estoque') !== '0',
    sem_estoque: usarConfig('catalogo_sem_estoque') || 'manter',
    updated_at: new Date().toISOString(),
  }
  const { error: settingsErr } = await supabase
    .from('catalog_settings')
    .upsert({ empresa_id: empresaId, ...settings }, { onConflict: 'empresa_id' })
  if (settingsErr) throw new Error(`settings: ${settingsErr.message}`)
  console.log('[OK] Settings sincronizadas')

  // 3) Categorias
  const categorias = db.prepare(`SELECT id, nome FROM categorias`).all()
  if (categorias.length > 0) {
    const catData = categorias.map((c) => ({
      empresa_id: empresaId,
      external_id: c.id,
      nome: c.nome,
    }))
    const { error: catErr } = await supabase
      .from('catalog_categories')
      .upsert(catData, { onConflict: 'empresa_id,external_id' })
    if (catErr) throw new Error(`categorias: ${catErr.message}`)
  }
  console.log(`[OK] ${categorias.length} categorias sincronizadas`)

  const { data: existingCats } = await supabase
    .from('catalog_categories')
    .select('id, external_id')
    .eq('empresa_id', empresaId)
  const catMap = new Map(existingCats.map((c) => [c.external_id, c.id]))

  // 4) Produtos (com validação)
  const produtos = db.prepare(`
    SELECT p.id, p.nome, p.descricao, p.categoria_id, s.nome AS subcategoria,
           m.nome AS marca, p.preco_venda AS preco, p.preco_promo, p.promocional,
           p.estoque, p.catalogo_ordem AS ordem, p.catalogo_publicado,
           (p.imagem IS NOT NULL AND length(p.imagem) > 0) AS tem_imagem
    FROM produtos p
    LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.ativo = 1
    ORDER BY p.catalogo_ordem, p.nome
  `).all()

  let duplicados = 0
  const vistos = new Set()
  let semNome = 0
  let precoInvalido = 0

  const TAMANHO_LOTE = 50
  for (let i = 0; i < produtos.length; i += TAMANHO_LOTE) {
    const lote = produtos.slice(i, i + TAMANHO_LOTE)
    const data = []

    for (const p of lote) {
      if (!p.nome || !String(p.nome).trim()) { semNome++; continue }
      if (vistos.has(p.id)) { duplicados++; continue }
      vistos.add(p.id)
      if (typeof p.preco !== 'number' || isNaN(p.preco) || p.preco < 0) { precoInvalido++; continue }

      let imagemUrl = null
      if (p.tem_imagem) {
        try {
          const row = db.prepare(`SELECT imagem FROM produtos WHERE id = ?`).get(p.id)
          if (row?.imagem && row.imagem.length > 0) {
            const buf = Buffer.from(row.imagem)
            const ext = detectarExtensao(buf)
            const path = `${empresaId}/${p.id}.${ext}`
            const { error: uploadErr } = await supabase.storage
              .from('produtos')
              .upload(path, new Uint8Array(buf), {
                contentType: ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
                cacheControl: 'public, max-age=86400',
                upsert: true,
              })
            if (!uploadErr) {
              const { data: urlData } = supabase.storage.from('produtos').getPublicUrl(path)
              imagemUrl = urlData.publicUrl
            }
          }
        } catch { /* ignore */ }
      }

      const temPromo = !!(p.promocional && p.preco_promo && p.preco_promo > 0)
      data.push({
        empresa_id: empresaId,
        external_id: p.id,
        nome: p.nome,
        slug: slugify(p.nome),
        descricao: p.descricao,
        preco: p.preco,
        preco_promo: temPromo ? p.preco_promo : null,
        categoria_id: p.categoria_id ? catMap.get(p.categoria_id) || null : null,
        subcategoria: p.subcategoria,
        marca: p.marca,
        publicado: p.catalogo_publicado === 1,
        estoque_publico: p.estoque || 0,
        ordem: p.ordem || 0,
        imagem_url: imagemUrl,
        updated_at: new Date().toISOString(),
      })
    }

    if (data.length > 0) {
      const { error: prodErr } = await supabase
        .from('catalog_products')
        .upsert(data, { onConflict: 'empresa_id,external_id' })
      if (prodErr) throw new Error(`produtos: ${prodErr.message}`)
    }
    console.log(`[OK] Lote ${i / TAMANHO_LOTE + 1}: ${data.length} produtos`)
  }

  console.log(`\nValidações: ${duplicados} duplicados, ${semNome} sem nome, ${precoInvalido} preço inválido`)

  // 5) Zonas
  const zonas = db.prepare(`SELECT id, nome, preco, ceps FROM zonas_entrega WHERE ativo = 1`).all()
  if (zonas.length > 0) {
    const zonasData = zonas.map((z) => {
      let ceps = []
      if (z.ceps) { try { ceps = JSON.parse(z.ceps) } catch {} }
      return {
        empresa_id: empresaId,
        external_id: z.id,
        nome: z.nome,
        preco: z.preco,
        ceps: Array.isArray(ceps) ? ceps : [],
      }
    })
    const { error: zonasErr } = await supabase
      .from('catalog_zones')
      .upsert(zonasData, { onConflict: 'empresa_id,external_id' })
    if (zonasErr) throw new Error(`zonas: ${zonasErr.message}`)
  }
  console.log(`[OK] ${zonas.length} zonas sincronizadas`)

  // 6) Comparação final
  const { count: countSupabase } = await supabase
    .from('catalog_products')
    .select('*', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)

  console.log(`\n=== Resumo da migração ===`)
  console.log(`SQLite ativos: ${totalLocal}`)
  console.log(`Supabase produtos: ${countSupabase}`)
  console.log(`Divergências: ${Math.abs(totalLocal - countSupabase)}`)
  console.log(`\nMigração concluída com sucesso!`)
}

main().catch((e) => {
  console.error(`[ERRO] Falha na migração: ${e.message}`)
  process.exit(1)
})
