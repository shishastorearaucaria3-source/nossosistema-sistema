import { DatabaseSync } from 'node:sqlite'
import { getDb } from './index'

export interface CatalogoConfig {
  site_url: string
  nome_loja: string
}

function configPadrao(): CatalogoConfig {
  return {
    site_url: '',
    nome_loja: 'Minha Loja'
  }
}

export function getConfig(): CatalogoConfig {
  const cfg = configPadrao()
  const db = getDb()
  const nomeLoja = db.prepare(`SELECT valor FROM config WHERE chave = 'nome_loja'`).get() as { valor: string | null } | undefined
  if (nomeLoja?.valor) cfg.nome_loja = nomeLoja.valor
  try {
    const raw = db.prepare(`SELECT valor FROM catalogo_sync WHERE chave = 'config'`).get() as { valor: string } | undefined
    if (raw?.valor) Object.assign(cfg, JSON.parse(raw.valor))
  } catch { /* ignore */ }
  return cfg
}

export function salvarConfig(parcial: Partial<CatalogoConfig>): CatalogoConfig {
  const db = getDb()
  const atual = getConfig()
  const novo = { ...atual, ...parcial }
  db.prepare(`INSERT INTO catalogo_sync (chave, valor) VALUES ('config', ?)
              ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`)
    .run(JSON.stringify(novo))
  return novo
}

function setSync(chave: string, valor: string): void {
  const db = getDb()
  db.prepare(`INSERT INTO catalogo_sync (chave, valor) VALUES (?, ?)
              ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`)
    .run(chave, valor)
}

function getSync(chave: string): string {
  const db = getDb()
  const r = db.prepare(`SELECT valor FROM catalogo_sync WHERE chave = ?`).get(chave) as { valor: string | null } | undefined
  return r?.valor ?? ''
}

function marcarProdutoAlterado(produtoId: number): void {
  const db = getDb()
  db.prepare(`UPDATE produtos SET alterado_em = datetime('now') WHERE id = ?`).run(produtoId)
  db.prepare(`INSERT INTO catalogo_fila (produto_id) VALUES (?)`).run(produtoId)
}

export function notificarAlteracaoProduto(produtoId: number): void {
  try {
    marcarProdutoAlterado(produtoId)
  } catch { /* ignore */ }
}

export interface ProdutoPublico {
  id: number
  nome: string
  codigo: string | null
  categoria: string | null
  categoria_id: number | null
  subcategoria: string | null
  descricao: string | null
  marca: string | null
  preco: number
  preco_promo: number | null
  tem_promo: boolean
  disponivel: boolean
  estoque: number
  ordem: number
  imagem: string | null
}

export interface ExibicaoConfig {
  mostrar_estoque: boolean
  sem_estoque: 'despublicar' | 'manter'
  aceitar_pedidos_sem_estoque: boolean
  destacar_promocoes: boolean
}

function exibicaoPadrao(): ExibicaoConfig {
  return {
    mostrar_estoque: true,
    sem_estoque: 'despublicar',
    aceitar_pedidos_sem_estoque: false,
    destacar_promocoes: true
  }
}

export function pegarConfig(chave: string): string {
  try {
    const db = getDb()
    const r = db.prepare(`SELECT valor FROM config WHERE chave = ?`).get(chave) as { valor: string | null } | undefined
    return r?.valor ?? ''
  } catch { return '' }
}

// Zonas de entrega ativas no checkout público (sem o polígono — a zona é
// identificada pelo CEP informado no catálogo; o valor da taxa entra na
// mensagem do WhatsApp). Exclui polígono e dados internos do ERP.
export function getZonasPublicas(): { id: number; nome: string; preco: number; ceps: string[] }[] {
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

export function getExibicao(): ExibicaoConfig {
  const d = exibicaoPadrao()
  const mostrar = pegarConfig('catalogo_mostrar_estoque')
  const sem = pegarConfig('catalogo_sem_estoque')
  const aceitar = pegarConfig('catalogo_aceitar_sem_estoque')
  const destacar = pegarConfig('catalogo_destacar_promo')
  if (mostrar !== '') d.mostrar_estoque = mostrar === '1'
  if (sem === 'manter') d.sem_estoque = 'manter'
  if (aceitar !== '') d.aceitar_pedidos_sem_estoque = aceitar === '1'
  if (destacar !== '') d.destacar_promocoes = destacar === '1'
  return d
}

export function salvarExibicao(cfg: Partial<ExibicaoConfig>): ExibicaoConfig {
  const atual = getExibicao()
  const novo: ExibicaoConfig = {
    mostrar_estoque: typeof cfg.mostrar_estoque === 'boolean' ? cfg.mostrar_estoque : atual.mostrar_estoque,
    sem_estoque: cfg.sem_estoque === 'manter' ? 'manter' : 'despublicar',
    aceitar_pedidos_sem_estoque: typeof cfg.aceitar_pedidos_sem_estoque === 'boolean' ? cfg.aceitar_pedidos_sem_estoque : atual.aceitar_pedidos_sem_estoque,
    destacar_promocoes: typeof cfg.destacar_promocoes === 'boolean' ? cfg.destacar_promocoes : atual.destacar_promocoes
  }
  const db = getDb()
  const gravar = (chave: string, valor: string) =>
    db.prepare(`INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(chave, valor)
  gravar('catalogo_mostrar_estoque', novo.mostrar_estoque ? '1' : '0')
  gravar('catalogo_sem_estoque', novo.sem_estoque)
  gravar('catalogo_aceitar_sem_estoque', novo.aceitar_pedidos_sem_estoque ? '1' : '0')
  gravar('catalogo_destacar_promo', novo.destacar_promocoes ? '1' : '0')
  return novo
}

export function gerarDadosPublicos(): ProdutoPublico[] {
  const db = getDb()
  const exib = getExibicao()
  const rows = db.prepare(
    `SELECT p.id, p.nome, COALESCE(p.codigo_interno, p.codigo_barras) AS codigo,
            c.nome AS categoria, p.categoria_id, s.nome AS subcategoria, p.descricao,
            m.nome AS marca,
            p.preco_venda AS preco, p.preco_promo, p.promocional,
            p.estoque, p.catalogo_ordem AS ordem, p.ativo, p.catalogo_publicado,
            (p.imagem IS NOT NULL AND length(p.imagem) > 0) AS tem_imagem
     FROM produtos p
     LEFT JOIN categorias c ON c.id = p.categoria_id
     LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
     LEFT JOIN marcas m ON m.id = p.marca_id
     WHERE p.ativo = 1 AND p.catalogo_publicado = 1
     ORDER BY p.catalogo_ordem, p.nome`
  ).all() as unknown as {
    id: number; nome: string; codigo: string | null; categoria: string | null; categoria_id: number | null; subcategoria: string | null;
    descricao: string | null; marca: string | null; preco: number; preco_promo: number | null; promocional: number;
    estoque: number; ordem: number; ativo: number; catalogo_publicado: number; tem_imagem: number
  }[]
  const lista = rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    codigo: r.codigo,
    categoria: r.categoria,
    categoria_id: r.categoria_id,
    subcategoria: r.subcategoria,
    descricao: r.descricao,
    marca: r.marca,
    preco: r.preco,
    preco_promo: r.promocional ? r.preco_promo : null,
    tem_promo: !!(r.promocional && r.preco_promo && r.preco_promo > 0),
    disponivel: r.estoque > 0,
    estoque: r.estoque,
    ordem: r.ordem,
    imagem: r.tem_imagem ? `imagens/${r.id}.jpg` : null
  }))
  // Regra "despublicar ao zerar estoque": filtra itens sem estoque do catálogo público
  if (exib.sem_estoque === 'despublicar') {
    return lista.filter((p) => p.estoque > 0)
  }
  return lista
}

export interface StatusCatalogo {
  status: string
  ultima_sync: string
  proxima_sync: string
  produtos_publicados: number
  pendentes: number
  ultimo_erro: string
  site_url: string
  configurado: boolean
  sincronizando: boolean
  conectado: boolean
  auto_sync_ativos: boolean
  auto_sync_intervalo_seg: number
}

let sincronizando = false

export function setSincronizando(v: boolean): void {
  sincronizando = v
}

// Limpa a fila de alterações pendentes após uma sincronização bem-sucedida.
export function limparFilaCatalogo(): void {
  try {
    getDb().prepare(`DELETE FROM catalogo_fila`).run()
  } catch { /* ignore */ }
}

export function getStatus(): StatusCatalogo {
  const db = getDb()
  const cfg = getConfig()
  const publicados = db.prepare(`SELECT COUNT(*) AS c FROM produtos WHERE ativo = 1 AND catalogo_publicado = 1`).get() as { c: number }
  const pendentes = db.prepare(`SELECT COUNT(*) AS c FROM catalogo_fila`).get() as { c: number }
  const ultima = getSync('ultima_sync')
  let proxima = '—'
  if (ultima) {
    const d = new Date(ultima)
    d.setHours(d.getHours() + 1)
    proxima = d.toLocaleString('pt-BR')
  }
  return {
    status: getSync('status') || 'nunca_sincronizado',
    ultima_sync: ultima ? new Date(ultima).toLocaleString('pt-BR') : 'Nunca',
    proxima_sync: proxima,
    produtos_publicados: publicados.c,
    pendentes: pendentes.c,
    ultimo_erro: getSync('ultimo_erro'),
    site_url: cfg.site_url,
    configurado: !!cfg.site_url,
    sincronizando,
    conectado: getSync('conectado') === '1',
    auto_sync_ativos: pegarConfig('auto_sync_ativos') === '1',
    auto_sync_intervalo_seg: Number(pegarConfig('auto_sync_intervalo_seg')) || 60,
  }
}

// ---------- API pública de leitura do catálogo (Fase 1) ----------
// Somente leitura. Reutiliza as regras de `gerarDadosPublicos` (ativos,
// publicados, filtro "sem estoque") e aplica as configurações de exibição.

export interface LojaPublica {
  nome?: string
  whatsapp?: string
  endereco?: string
  horario?: string
  manutencao_ativos?: boolean
  pedidos_ativos?: boolean
  aceita_entrega?: boolean
  aceita_retirada?: boolean
  taxa_entrega?: number
  zonas?: { id: number; nome: string; preco: number; ceps: string[] }[]
}

export interface CategoriaPublica {
  id: number
  nome: string
}

export interface ProdutoPublicoV1 {
  id: number
  nome: string
  descricao: string | null
  categoria: string | null
  categoria_id: number | null
  subcategoria: string | null
  marca: string | null
  preco: number
  preco_promo: number | null
  tem_promo: boolean
  disponivel: boolean
  estoque?: number
  ordem: number
  imagem: number | null
}

export interface CatalogoPublicoV1 {
  version: 1
  generatedAt: string
  loja: LojaPublica
  categorias: CategoriaPublica[]
  produtos: ProdutoPublicoV1[]
}

export function gerarCatalogoPublico(): CatalogoPublicoV1 {
  const exib = getExibicao()
  const base = gerarDadosPublicos()

  const loja: LojaPublica = {}
  const nome = getConfig().nome_loja
  if (nome) loja.nome = nome
  const whatsapp = pegarConfig('telefone_loja')
  if (whatsapp) loja.whatsapp = whatsapp
  const endereco = pegarConfig('endereco_loja')
  if (endereco) loja.endereco = endereco
  const horario = pegarConfig('horario_funcionamento')
  if (horario) loja.horario = horario

  // Estado de operação da loja: manutenção, pedidos ativos e entrega/retirada.
  // O catálogo online usa estes sinalizadores para bloquear compras e o
  // checkout (manutenção) ou desativar o carrinho (pedidos desativados).
  loja.manutencao_ativos = pegarConfig('manutencao_ativos') === '1'
  loja.pedidos_ativos = (pegarConfig('pedidos_ativos') || '1') === '1'
  loja.aceita_entrega = (pegarConfig('aceita_entrega') || '1') === '1'
  loja.aceita_retirada = pegarConfig('aceita_retirada') === '1'
  loja.taxa_entrega = Number(pegarConfig('taxa_entrega')) || 0
  const zonas = getZonasPublicas()
  if (zonas.length > 0) loja.zonas = zonas

  const produtos: ProdutoPublicoV1[] = base.map((p) => {
    const item: ProdutoPublicoV1 = {
      id: p.id,
      nome: p.nome,
      descricao: p.descricao,
      categoria: p.categoria,
      categoria_id: p.categoria_id,
      subcategoria: p.subcategoria,
      marca: p.marca,
      preco: p.preco,
      preco_promo: p.preco_promo,
      tem_promo: p.tem_promo,
      disponivel: p.disponivel,
      ordem: p.ordem,
      imagem: p.imagem ? p.id : null
    }
    // Estoque só é exposto se a configuração pública permitir.
    if (exib.mostrar_estoque) item.estoque = p.estoque
    return item
  })

  const mapaCategorias = new Map<number, string>()
  for (const p of produtos) {
    if (p.categoria_id != null && p.categoria !== null && !mapaCategorias.has(p.categoria_id)) {
      mapaCategorias.set(p.categoria_id, p.categoria)
    }
  }
  const categorias: CategoriaPublica[] = [...mapaCategorias.entries()]
    .map(([id, nome2]) => ({ id, nome: nome2 }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    loja,
    categorias,
    produtos
  }
}