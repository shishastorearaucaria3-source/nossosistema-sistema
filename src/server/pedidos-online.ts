import { getDb } from './index'
import { getSupabase, getEmpresaId } from './supabase-client'

export interface ResultadoPullPedidos {
  ok: boolean
  erro?: string
  puxados?: number
}

interface PedidoSupabase {
  id: string
  numero: number
  cliente_nome: string
  cliente_whatsapp: string | null
  modalidade: string
  endereco: string | null
  cep: string | null
  zona_nome: string | null
  taxa_entrega: number
  subtotal: number
  desconto: number
  total: number
  forma_pagamento: string | null
  observacao: string | null
  status: string
  criado_em: string
  atualizado_em: string
  itens?: {
    produto_id: number
    nome_produto: string
    quantidade: number
    preco_unitario: number
    subtotal: number
  }[]
}

// Fluxo profissional de atendimento: Novo → Confirmado → Separando →
// Saiu para entrega → Entregue / Cancelado. 'novo' é o status nativo do
// checkout online. Status legados ('em_atendimento','concluido') são
// aceitos na leitura para não quebrar pedidos antigos já salvos.
export const STATUS_FLUXO = [
  'novo',
  'confirmado',
  'separando',
  'saiu_entrega',
  'entregue',
  'cancelado'
] as const

export type StatusPedidoOnline = (typeof STATUS_FLUXO)[number]

const STATUS_LEGADO_PARA_CANONICO: Record<string, StatusPedidoOnline> = {
  em_atendimento: 'confirmado',
  concluido: 'entregue'
}

export const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo',
  confirmado: 'Confirmado',
  separando: 'Separando',
  saiu_entrega: 'Saiu para entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado'
}

export const STATUS_COR: Record<string, string> = {
  novo: 'novo',
  confirmado: 'confirmado',
  separando: 'separando',
  saiu_entrega: 'saiu_entrega',
  entregue: 'entregue',
  cancelado: 'cancelado'
}

// Ordem canônica usada para saber se um status é "mais avançado" que outro.
const INDICE_STATUS = new Map(STATUS_FLUXO.map((s, i) => [s, i]))

export function statusCanonico(status: string | null | undefined): StatusPedidoOnline {
  const s = String(status || '').toLowerCase()
  if ((STATUS_FLUXO as readonly string[]).includes(s)) return s as StatusPedidoOnline
  if (STATUS_LEGADO_PARA_CANONICO[s]) return STATUS_LEGADO_PARA_CANONICO[s]
  return 'novo'
}

function lerUltimoPull(db: ReturnType<typeof getDb>): string {
  try {
    const r = db.prepare(`SELECT valor FROM pedidos_online_sync WHERE chave = 'ultimo_pedido_criado'`).get() as { valor: string | null } | undefined
    return r?.valor || ''
  } catch {
    return ''
  }
}

function gravarUltimoPull(db: ReturnType<typeof getDb>, criado: string): void {
  db.prepare(`INSERT INTO pedidos_online_sync (chave, valor) VALUES ('ultimo_pedido_criado', ?)
              ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`)
    .run(criado)
}

export async function puxarPedidosOnline(): Promise<ResultadoPullPedidos> {
  const empresaId = getEmpresaId()
  if (!empresaId) return { ok: false, erro: 'EMPRESA_ID_nao_configurado' }

  let supabase
  try {
    supabase = getSupabase()
  } catch {
    return { ok: false, erro: 'supabase_nao_configurado' }
  }

  const db = getDb()
  const desde = lerUltimoPull(db)

  try {
    let query = supabase
      .from('pedidos_online')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('criado_em', { ascending: true })

    if (desde) query = query.gt('criado_em', desde)

    const { data: pedidos, error } = await query
    if (error) return { ok: false, erro: error.message }

    const jaVistos = new Set<string>()
    try {
      const rows = db.prepare(`SELECT id FROM pedidos_online`).all() as { id: string }[]
      for (const r of rows) jaVistos.add(r.id)
    } catch { /* ignore */ }

    let confirmados = 0
    let ultimoCriado = ''

    for (const pedido of (pedidos || []) as PedidoSupabase[]) {
      if (pedido.criado_em > ultimoCriado) ultimoCriado = pedido.criado_em
      if (jaVistos.has(pedido.id)) continue

      const { data: itens } = await supabase
        .from('pedido_itens_online')
        .select('produto_id, nome_produto, quantidade, preco_unitario, subtotal')
        .eq('pedido_id', pedido.id)
        .order('id', { ascending: true })

      const pedidoComItens = { ...pedido, itens: itens || [] }
      const inseriu = importarUmPedido(db, pedidoComItens, jaVistos)
      if (inseriu) confirmados++
    }

    if (ultimoCriado) gravarUltimoPull(db, ultimoCriado)
    return { ok: true, puxados: confirmados }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro_desconhecido'
    return { ok: false, erro: msg }
  }
}

function importarUmPedido(
  db: ReturnType<typeof getDb>,
  pedido: PedidoSupabase,
  jaVistos: Set<string>,
): boolean {
  try {
    const agora = new Date().toISOString()
    db.exec('BEGIN IMMEDIATE')
    try {
      const ins = db.prepare(
        `INSERT OR IGNORE INTO pedidos_online
           (id, numero, cliente_nome, cliente_whatsapp, modalidade, endereco, cep, zona_nome,
            taxa_entrega, subtotal, desconto, total, forma_pagamento, observacao, status,
            importado_em, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        pedido.id, pedido.numero, pedido.cliente_nome, pedido.cliente_whatsapp,
        pedido.modalidade, pedido.endereco, pedido.cep, pedido.zona_nome,
        pedido.taxa_entrega, pedido.subtotal, pedido.desconto, pedido.total,
        pedido.forma_pagamento, pedido.observacao, 'novo', agora, pedido.criado_em,
        pedido.atualizado_em || agora
      )
      if ((ins.changes as number) === 0) {
        db.exec('COMMIT')
        jaVistos.add(pedido.id)
        return false
      }

      for (const item of pedido.itens || []) {
        db.prepare(
          `INSERT INTO pedido_online_itens
             (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(pedido.id, item.produto_id, item.nome_produto, item.quantidade, item.preco_unitario, item.subtotal)

        db.prepare(`UPDATE produtos SET estoque = estoque - ? WHERE id = ?`).run(item.quantidade, item.produto_id)
      }

      registrarTracking(db, pedido.id, 'novo', 'online')
      db.exec('COMMIT')
      jaVistos.add(pedido.id)
      return true
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* ignore */ }
      throw e
    }
  } catch {
    return false
  }
}

function registrarTracking(
  db: ReturnType<typeof getDb>,
  pedidoId: string,
  status: string,
  origem: string,
): void {
  try {
    db.prepare(
      `INSERT INTO pedido_online_tracking (pedido_id, status, origem, atualizado_em) VALUES (?, ?, ?, ?)`
    ).run(pedidoId, status, origem, new Date().toISOString())
  } catch { /* ignore */ }
}

function listarTracking(db: ReturnType<typeof getDb>, pedidoId: string): unknown[] {
  try {
    return db.prepare(
      `SELECT id, status, origem, atualizado_em FROM pedido_online_tracking
       WHERE pedido_id = ? ORDER BY id ASC`
    ).all(pedidoId) as unknown[]
  } catch {
    return []
  }
}

function listarItens(db: ReturnType<typeof getDb>, pedidoId: string): unknown[] {
  return db.prepare(
    `SELECT produto_id, nome_produto, quantidade, preco_unitario, subtotal
     FROM pedido_online_itens WHERE pedido_id = ? ORDER BY id ASC`
  ).all(String(pedidoId)) as unknown[]
}

export interface FiltroPedidosOnline {
  busca?: string
  status?: string
  de?: string
  ate?: string
}

export function listarPedidosOnline(filtro?: FiltroPedidosOnline): { ok: boolean; pedidos: unknown[]; total?: number } {
  const db = getDb()
  const f = filtro || {}
  const params: Array<string | number> = []

  let where = '1=1'
  if (f.status && f.status !== 'todos') {
    const canonico = statusCanonico(f.status)
    where += ` AND status = ?`
    params.push(canonico)
  }
  // criado_em é sempre ISO com sufixo 'Z' (UTC) vindo do catálogo. SQLite
  // datetime() não interpreta o 'Z', então a comparação de data usa apenas o
  // prefixo de 10 caracteres (AAAA-MM-DD), e a ordenação usa a string ISO
  // inteira (que ordena cronologicamente por ser UTC de largura fixa).
  if (f.de) {
    where += ` AND substr(criado_em,1,10) >= ?`
    params.push(f.de)
  }
  if (f.ate) {
    where += ` AND substr(criado_em,1,10) <= ?`
    params.push(f.ate)
  }

  let rows: Array<Record<string, unknown>> = []
  try {
    rows = db.prepare(
      `SELECT id, numero, cliente_nome, cliente_whatsapp, modalidade, endereco, cep, zona_nome,
              taxa_entrega, subtotal, desconto, total, forma_pagamento, observacao, status,
              importado_em, criado_em, atualizado_em
       FROM pedidos_online WHERE ${where} ORDER BY criado_em DESC, numero DESC`
    ).all(...params) as Array<Record<string, unknown>>
  } catch { /* ignore */ }

  let pedidos = rows.map((r) => {
    const itens = listarItens(db, String(r.id))
    return { ...r, itens, status: statusCanonico(r.status as string) }
  })

  // Busca textual (número, cliente ou telefone) — aplicada em memória para ser
  // resiliente a caracteres de formatação de telefone e números parciais.
  if (f.busca) {
    const b = String(f.busca).trim().toLowerCase()
    const digitos = b.replace(/\D/g, '')
    pedidos = pedidos.filter((p) => {
      const pv = p as Record<string, unknown>
      const numero = String(pv.numero ?? '')
      const nome = String((pv.cliente_nome as string) || '').toLowerCase()
      const whats = String((pv.cliente_whatsapp as string) || '').toLowerCase()
      if (numero.startsWith(b) || numero.includes(b)) return true
      if (nome.includes(b)) return true
      if (digitos && whats.replace(/\D/g, '').includes(digitos)) return true
      return false
    })
  }

  return { ok: true, pedidos, total: pedidos.length }
}

export function listarPedidoOnlineDetalhe(id: string): { ok: boolean; pedido?: unknown; erro?: string } {
  const db = getDb()
  const row = db.prepare(
    `SELECT id, numero, cliente_nome, cliente_whatsapp, modalidade, endereco, cep, zona_nome,
            taxa_entrega, subtotal, desconto, total, forma_pagamento, observacao, status,
            importado_em, criado_em, atualizado_em
     FROM pedidos_online WHERE id = ?`
  ).get(id) as Record<string, unknown> | undefined
  if (!row) return { ok: false, erro: 'pedido_nao_encontrado' }
  return {
    ok: true,
    pedido: {
      ...row,
      status: statusCanonico(row.status as string),
      itens: listarItens(db, id),
      tracking: listarTracking(db, id)
    }
  }
}

async function sincronizarStatusSupabase(id: string, status: string): Promise<boolean> {
  try {
    const empresaId = getEmpresaId()
    if (!empresaId) return true
    const supabase = getSupabase()
    const { error } = await supabase
      .from('pedidos_online')
      .update({ status, atualizado_em: new Date().toISOString() })
      .eq('id', id)
      .eq('empresa_id', empresaId)
    return !error
  } catch {
    return false
  }
}

export interface ResultadoStatus {
  ok: boolean
  erro?: string
  sincronizado?: boolean
  status?: string
}

export async function atualizarStatusPedidoOnline(id: string, status: string): Promise<ResultadoStatus> {
  // Validação estrita do status de entrada: statusCanonico() normaliza com
  // fallback 'novo', então verificamos o raw contra o fluxo e os legados antes.
  const s = String(status || '').toLowerCase()
  const valido = (STATUS_FLUXO as readonly string[]).includes(s) || Boolean(STATUS_LEGADO_PARA_CANONICO[s])
  if (!valido) {
    return { ok: false, erro: 'status_invalido' }
  }
  const canonico = statusCanonico(status)

  const db = getDb()
  try {
    const existe = db.prepare(`SELECT id, status FROM pedidos_online WHERE id = ?`).get(id) as { id: string; status: string } | undefined
    if (!existe) return { ok: false, erro: 'pedido_nao_encontrado' }
    if (existe.status === canonico) return { ok: true, sincronizado: true, status: canonico }

    db.exec('BEGIN IMMEDIATE')
    try {
      if (canonico === 'cancelado') {
        const jaRestaurado = db.prepare(`SELECT 1 AS x FROM movimentacoes WHERE documento = ? LIMIT 1`).get(`PO-${id}`)
        if (!jaRestaurado) {
          const itens = db.prepare(
            `SELECT poi.produto_id, poi.quantidade FROM pedido_online_itens poi
             JOIN produtos p ON p.id = poi.produto_id
             WHERE poi.pedido_id = ? AND poi.produto_id IS NOT NULL AND p.controla_estoque = 1`
          ).all(id) as { produto_id: number; quantidade: number }[]
          const devolve = db.prepare(`UPDATE produtos SET estoque = estoque + ? WHERE id = ?`)
          const insMov = db.prepare(
            `INSERT INTO movimentacoes (produto_id, tipo, categoria, quantidade, motivo, documento, criado_em, estoque_anterior, estoque_posterior)
             VALUES (?, 'entrada', 'outras_entradas', ?, ?, ?, datetime('now'), ?, ?)`
          )
          for (const it of itens) {
            const antes = db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(it.produto_id) as { estoque: number }
            devolve.run(it.quantidade, it.produto_id)
            insMov.run(it.produto_id, it.quantidade, `Cancelamento do pedido online ${id}`, `PO-${id}`, antes.estoque, antes.estoque + it.quantidade)
          }
        }
      }
      db.prepare(`UPDATE pedidos_online SET status = ?, atualizado_em = ? WHERE id = ?`)
        .run(canonico, new Date().toISOString(), id)
      registrarTracking(db, id, canonico, 'erp')
      db.exec('COMMIT')
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* ignore */ }
      throw e
    }

    // Persistência no Supabase (catálogo público / tracking do cliente). Se
    // falhar (offline), o status local já foi gravado; retornamos indicando que
    // a nuvem não foi atualizada — a UI avisa, mas não bloqueia o atendimento.
    const sincronizado = await sincronizarStatusSupabase(id, canonico)
    return { ok: true, sincronizado, status: canonico }
  } catch {
    return { ok: false, erro: 'erro_ao_atualizar' }
  }
}

let pollingPedidosAgendado = false

export function agendarPollingPedidosOnline(): void {
  if (pollingPedidosAgendado) return
  pollingPedidosAgendado = true
  setInterval(() => {
    puxarPedidosOnline()
      .then(() => {})
      .catch(() => {})
  }, 20_000)
}
