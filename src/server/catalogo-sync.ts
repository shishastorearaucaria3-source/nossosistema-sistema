import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDataDir } from '../shared/data-dir'
import { getDb } from './index'
import { setSincronizando, limparFilaCatalogo } from './catalogo'
import { getSupabase, getEmpresaId } from './supabase-client'
import { enqueueOperacao, contarPendentesFila } from './fila-offline'

const NOME_ARQUIVO_SYNC_TOKEN = 'catalogo-sync.token'

function caminhoSyncToken(): string {
  return join(getDataDir(), NOME_ARQUIVO_SYNC_TOKEN)
}

export function lerSyncToken(): string {
  const doEnv = (process.env.CATALOGO_SYNC_TOKEN || '').trim()
  if (doEnv) return doEnv
  try {
    const f = process.env.CATALOGO_SYNC_TOKEN_FILE || caminhoSyncToken()
    if (existsSync(f)) return readFileSync(f, 'utf8').trim()
  } catch { /* ignore */ }
  return ''
}

export function garantirSyncToken(): string {
  const existente = lerSyncToken()
  if (existente) return existente
  const token = randomBytes(32).toString('hex')
  try {
    const f = process.env.CATALOGO_SYNC_TOKEN_FILE || caminhoSyncToken()
    mkdirSync(getDataDir(), { recursive: true })
    writeFileSync(f, token + '\n', 'utf8')
  } catch { /* ignore */ }
  return token
}

export interface ResultadoSync {
  ok: boolean
  erro?: string
  produtos_sincronizados?: number
  tempo_ms?: number
}

function pegarConfig(chave: string): string {
  try {
    const db = getDb()
    const r = db.prepare(`SELECT valor FROM config WHERE chave = ?`).get(chave) as { valor: string | null } | undefined
    return r?.valor ?? ''
  } catch { return '' }
}

function getZonasPublicas(): { id: number; nome: string; preco: number; ceps: string[] }[] {
  try {
    const db = getDb()
    const rows = db.prepare(`SELECT id, nome, preco, ceps FROM zonas_entrega WHERE ativo = 1 ORDER BY preco, nome`).all() as unknown as { id: number; nome: string; preco: number; ceps: string | null }[]
    return rows.map((r) => {
      let ceps: string[] = []
      if (typeof r.ceps === 'string' && r.ceps) {
        try {
          const parsed = JSON.parse(r.ceps)
          if (Array.isArray(parsed)) ceps = parsed.map(String).filter((c) => c.length >= 3)
        } catch { /* ignore */ }
      }
      return { id: r.id, nome: r.nome, preco: r.preco, ceps }
    })
  } catch { return [] }
}

function detectarExtensao(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return 'jpg'
}

function extensaoParaMime(ext: string): string {
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120)
}

function criarFilaPendente(produtoIds: number[]): void {
  try {
    const db = getDb()
    for (const id of produtoIds) {
      db.prepare(`INSERT OR IGNORE INTO catalogo_fila (produto_id) VALUES (?)`).run(id)
    }
  } catch { /* ignore */ }
}

export async function sincronizarCatalogo(_urlWorker?: string): Promise<ResultadoSync> {
  const empresaId = getEmpresaId()
  if (!empresaId) return { ok: false, erro: 'EMPRESA_ID_nao_configurado' }

  const inicio = Date.now()
  const db = getDb()
  setSincronizando(true)

  try {
    let supabase
    try {
      supabase = getSupabase()
    } catch {
      const msg = 'supabase_nao_configurado'
      registrarStatus('erro', msg)
      setSincronizando(false)
      return { ok: false, erro: msg, tempo_ms: Date.now() - inicio }
    }

    // 1) Settings
    const settings = {
      nome_loja: pegarConfig('nome_loja') || 'Loja',
      whatsapp: pegarConfig('telefone_loja') || null,
      endereco: pegarConfig('endereco_loja') || null,
      horario: pegarConfig('horario_funcionamento') || null,
      manutencao_ativos: pegarConfig('manutencao_ativos') === '1',
      pedidos_ativos: (pegarConfig('pedidos_ativos') || '1') === '1',
      aceita_entrega: (pegarConfig('aceita_entrega') || '1') === '1',
      aceita_retirada: pegarConfig('aceita_retirada') === '1',
      taxa_entrega: Number(pegarConfig('taxa_entrega')) || 0,
      mostrar_estoque: pegarConfig('catalogo_mostrar_estoque') !== '0',
      sem_estoque: pegarConfig('catalogo_sem_estoque') || 'manter',
      updated_at: new Date().toISOString(),
    }

    const { error: settingsErr } = await supabase
      .from('catalog_settings')
      .upsert({ empresa_id: empresaId, ...settings }, { onConflict: 'empresa_id' })
    if (settingsErr) throw new Error(`settings: ${settingsErr.message}`)

    // 2) Categorias
    const catRows = db.prepare(`SELECT id, nome FROM categorias ORDER BY nome`).all() as { id: number; nome: string }[]
    if (catRows.length > 0) {
      const catData = catRows.map((c) => ({
        empresa_id: empresaId,
        external_id: c.id,
        nome: c.nome,
      }))
      const { error: catErr } = await supabase
        .from('catalog_categories')
        .upsert(catData, { onConflict: 'empresa_id,external_id' })
      if (catErr) throw new Error(`categorias: ${catErr.message}`)
    }

    // 3) Categorias existentes no Supabase (para mapeamento de IDs)
    const { data: existingCats } = await supabase
      .from('catalog_categories')
      .select('id, external_id')
      .eq('empresa_id', empresaId)
    const catMap = new Map<number, string>()
    for (const c of existingCats || []) catMap.set(c.external_id, c.id)

    // 4) Produtos
    const produtoRows = db.prepare(
      `SELECT p.id, p.nome, p.descricao, p.categoria_id, s.nome AS subcategoria,
              m.nome AS marca, p.preco_venda AS preco, p.preco_promo, p.promocional,
              p.estoque, p.catalogo_ordem AS ordem, p.ativo, p.catalogo_publicado,
              (p.imagem IS NOT NULL AND length(p.imagem) > 0) AS tem_imagem,
              p.alterado_em
       FROM produtos p
       LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
       LEFT JOIN marcas m ON m.id = p.marca_id
       WHERE p.ativo = 1
       ORDER BY p.catalogo_ordem, p.nome`
    ).all() as {
      id: number; nome: string; descricao: string | null; categoria_id: number | null;
      subcategoria: string | null; marca: string | null; preco: number;
      preco_promo: number | null; promocional: number; estoque: number;
      ordem: number; tem_imagem: number; alterado_em: string | null; catalogo_publicado: number
    }[]

    const TAMANHO_LOTE = 50
    let syncCount = 0

    for (let i = 0; i < produtoRows.length; i += TAMANHO_LOTE) {
      const lote = produtoRows.slice(i, i + TAMANHO_LOTE)
      const produtosData = []

      for (const r of lote) {
        let imagemUrl: string | null = null
        if (r.tem_imagem) {
          try {
            const row = db.prepare(`SELECT imagem FROM produtos WHERE id = ?`).get(r.id) as { imagem: Uint8Array | null } | undefined
            if (row?.imagem && row.imagem.length > 0) {
              const buf = Buffer.from(row.imagem)
              const ext = detectarExtensao(buf)
              const path = `${empresaId}/${r.id}.${ext}`
              const { error: uploadErr } = await supabase.storage
                .from('produtos')
                .upload(path, buf, {
                  contentType: extensaoParaMime(ext),
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

        const catUuid = r.categoria_id ? catMap.get(r.categoria_id) || null : null
        const publicado = r.catalogo_publicado === 1
        const temPromo = !!(r.promocional && r.preco_promo && r.preco_promo > 0)

        produtosData.push({
          empresa_id: empresaId,
          external_id: r.id,
          nome: r.nome,
          slug: slugify(r.nome),
          descricao: r.descricao,
          preco: r.preco,
          preco_promo: temPromo ? r.preco_promo : null,
          categoria_id: catUuid,
          subcategoria: r.subcategoria,
          marca: r.marca,
          publicado,
          estoque_publico: r.estoque,
          ordem: r.ordem,
          imagem_url: imagemUrl,
          updated_at: new Date().toISOString(),
        })
      }

      const { error: prodErr } = await supabase
        .from('catalog_products')
        .upsert(produtosData, { onConflict: 'empresa_id,external_id' })
      if (prodErr) throw new Error(`produtos: ${prodErr.message}`)
      syncCount += lote.length
    }

    // 5) Desativar produtos que não existem mais no ERP ativo
    const idsAtivos = new Set(produtoRows.map((r) => r.id))
    const { data: produtosSupabase } = await supabase
      .from('catalog_products')
      .select('external_id')
      .eq('empresa_id', empresaId)
    for (const p of produtosSupabase || []) {
      if (!idsAtivos.has(p.external_id)) {
        await supabase
          .from('catalog_products')
          .update({ publicado: false, updated_at: new Date().toISOString() })
          .eq('empresa_id', empresaId)
          .eq('external_id', p.external_id)
      }
    }

    // 5b) Remover categorias que não existem mais no ERP (evita órfãs no Supabase).
    // ON DELETE SET NULL torna segura a exclusão mesmo se algum produto a referencie.
    const idsCategoriasAtivas = new Set(catRows.map((c) => c.id))
    for (const c of existingCats || []) {
      if (!idsCategoriasAtivas.has(c.external_id)) {
        const { error: catDelErr } = await supabase
          .from('catalog_categories')
          .delete()
          .eq('empresa_id', empresaId)
          .eq('external_id', c.external_id)
        if (catDelErr) throw new Error(`categorias/delete: ${catDelErr.message}`)
      }
    }

    // 6) Zonas
    const zonas = getZonasPublicas()
    if (zonas.length > 0) {
      const zonasData = zonas.map((z) => ({
        empresa_id: empresaId,
        external_id: z.id,
        nome: z.nome,
        preco: z.preco,
        ceps: z.ceps,
      }))
      const { error: zonasErr } = await supabase
        .from('catalog_zones')
        .upsert(zonasData, { onConflict: 'empresa_id,external_id' })
      if (zonasErr) throw new Error(`zonas: ${zonasErr.message}`)
    }

    // 7) Meta
    await supabase
      .from('sync_meta')
      .upsert(
        { empresa_id: empresaId, chave: 'ultima_sync', valor: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'empresa_id,chave' }
      )

    registrarStatus('sincronizado', '')
    limparFilaCatalogo()
    setSincronizando(false)
    return { ok: true, produtos_sincronizados: syncCount, tempo_ms: Date.now() - inicio }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro_desconhecido'
    registrarStatus('erro', msg)
    // Falhas transitórias (rede/Supabase) entram na fila offline para retry com
    // backoff automático, sem perder dados nem duplicar (a sync é idempotente).
    try {
      if (contarPendentesFila() === 0) {
        enqueueOperacao('sincronizar', {})
      }
    } catch { /* ignore */ }
    setSincronizando(false)
    return { ok: false, erro: msg, tempo_ms: Date.now() - inicio }
  }
}

function registrarStatus(status: string, erro: string): void {
  try {
    const db = getDb()
    db.prepare(`INSERT INTO catalogo_sync (chave, valor) VALUES ('status', ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(status)
    if (erro) {
      db.prepare(`INSERT INTO catalogo_sync (chave, valor) VALUES ('ultimo_erro', ?)
                  ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(erro)
    }
    db.prepare(`INSERT INTO catalogo_sync (chave, valor) VALUES ('ultima_sync', ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(new Date().toISOString())
  } catch { /* ignore */ }
}
