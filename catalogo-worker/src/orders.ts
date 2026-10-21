import type { Env } from "./backend";

export interface ItemPedidoEntrada {
  produto_id: number;
  quantidade: number;
}

export interface PedidoOnlineEntrada {
  cliente: { nome?: string; whatsapp?: string };
  modalidade?: "entrega" | "retirada";
  endereco?: string;
  cep?: string;
  zona_id?: number | null;
  forma_pagamento?: string;
  observacao?: string;
  itens: ItemPedidoEntrada[];
}

interface LinhaPreco {
  produto_id: number;
  nome: string;
  quantidade: number;
  preco: number;
  subtotal: number;
  estoque: number;
}

interface ProdutoD1 {
  id: number;
  nome: string;
  preco: number;
  preco_promo: number | null;
  tem_promo: number;
  disponivel: number;
  estoque: number;
}

export interface ZonaD1 {
  id: number;
  nome: string;
  preco: number;
  ceps: string;
}

export interface ResultadoCriarPedido {
  ok: boolean;
  erro?: string;
  pedido?: {
    id: string;
    numero: number;
    total: number;
    taxa_entrega: number;
    subtotal: number;
  };
}

export interface PedidoOnlineSaida {
  id: string;
  numero: number;
  cliente_nome: string;
  cliente_whatsapp: string;
  modalidade: string;
  endereco: string | null;
  cep: string | null;
  zona_nome: string | null;
  taxa_entrega: number;
  subtotal: number;
  desconto: number;
  total: number;
  forma_pagamento: string;
  observacao: string | null;
  status: string;
  criado_em: string;
  atualizado_em: string;
  itens: {
    produto_id: number;
    nome_produto: string;
    quantidade: number;
    preco_unitario: number;
    subtotal: number;
  }[];
}

function somenteDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

// Mesma regra de correspondência do front (prefixo de CEP) — primeiro match na
// ordem da lista vinda do D1 (ORDER BY preco, nome).
function cepPertence(cep: string, cepsStr: string): boolean {
  const alvo = somenteDigitos(cep);
  if (!alvo || alvo.length < 3) return false;
  let ceps: unknown[] = [];
  try {
    const p = JSON.parse(cepsStr);
    if (Array.isArray(p)) ceps = p;
  } catch {
    return false;
  }
  if (ceps.length === 0) return false;
  return ceps.some((c) => {
    const entrada = somenteDigitos(c);
    if (!entrada || entrada.length < 3) return false;
    const tamanho = Math.min(entrada.length, 8, alvo.length);
    return alvo.slice(0, tamanho) === entrada.slice(0, tamanho);
  });
}

function zonaPorCep(cep: string, zonas: ZonaD1[]): ZonaD1 | undefined {
  const limpo = somenteDigitos(cep);
  if (!limpo || limpo.length < 3) return undefined;
  return zonas.find((z) => cepPertence(limpo, z.ceps));
}

function gerarPedidoId(d: Date): string {
  const cripto = globalThis.crypto as Crypto | undefined;
  if (cripto?.randomUUID) return cripto.randomUUID();
  const rand = Math.random().toString(36).slice(2, 10);
  return `ped-${d.getTime().toString(36)}-${rand}`;
}

export async function listarPedidosOnline(
  env: Env,
  desde?: string | null,
): Promise<{ ok: boolean; erro?: string; pedidos?: PedidoOnlineSaida[] }> {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY && env.EMPRESA_ID) {
    const { BackendSupabase } = await import("./backend-supabase");
    const backend = new BackendSupabase({
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
      EMPRESA_ID: env.EMPRESA_ID,
    });
    const res = await backend.listarPedidos(desde);
    if (!res.ok) return { ok: false, erro: res.erro };
    return { ok: true, pedidos: res.pedidos as unknown as PedidoOnlineSaida[] };
  }
  const db = env.CATALOGO_DB;
  if (!db) return { ok: false, erro: "d1_nao_configurado" };

  try {
    let linhas: { results: unknown[] };
    if (desde) {
      linhas = await db
        .prepare(
          "SELECT * FROM pedidos_online WHERE criado_em > ? ORDER BY criado_em ASC"
        )
        .bind(desde)
        .all();
    } else {
      linhas = await db.prepare("SELECT * FROM pedidos_online ORDER BY criado_em ASC").all();
    }

    const pedidos: PedidoOnlineSaida[] = [];
    for (const r of linhas.results as Record<string, unknown>[]) {
      const itensRows = await db
        .prepare(
          "SELECT produto_id, nome_produto, quantidade, preco_unitario, subtotal FROM pedido_itens_online WHERE pedido_id = ? ORDER BY id ASC"
        )
        .bind(r.id)
        .all<{
          produto_id: number;
          nome_produto: string;
          quantidade: number;
          preco_unitario: number;
          subtotal: number;
        }>();
      pedidos.push({
        id: String(r.id),
        numero: Number(r.numero) || 0,
        cliente_nome: String(r.cliente_nome || ""),
        cliente_whatsapp: String(r.cliente_whatsapp || ""),
        modalidade: String(r.modalidade || "entrega"),
        endereco: r.endereco ? String(r.endereco) : null,
        cep: r.cep ? String(r.cep) : null,
        zona_nome: r.zona_nome ? String(r.zona_nome) : null,
        taxa_entrega: Number(r.taxa_entrega) || 0,
        subtotal: Number(r.subtotal) || 0,
        desconto: Number(r.desconto) || 0,
        total: Number(r.total) || 0,
        forma_pagamento: String(r.forma_pagamento || ""),
        observacao: r.observacao ? String(r.observacao) : null,
        status: String(r.status || "novo"),
        criado_em: String(r.criado_em),
        atualizado_em: String(r.atualizado_em),
        itens: itensRows.results,
      });
    }
    return { ok: true, pedidos };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro_desconhecido";
    return { ok: false, erro: msg };
  }
}

export async function criarPedidoOnline(
  env: Env,
  corpo: PedidoOnlineEntrada,
  ip: string,
): Promise<ResultadoCriarPedido> {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY && env.EMPRESA_ID) {
    const { BackendSupabase } = await import("./backend-supabase");
    const backend = new BackendSupabase({
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
      EMPRESA_ID: env.EMPRESA_ID,
    });
    const res = await backend.criarPedido(
      corpo as unknown as Record<string, unknown>,
      ip,
    );
    if (!res.ok) return { ok: false, erro: res.erro };
    return { ok: true, pedido: res.pedido as ResultadoCriarPedido["pedido"] };
  }
  const db = env.CATALOGO_DB;
  if (!db) return { ok: false, erro: "d1_nao_configurado" };

  try {
    // Configurações da loja (pedidos_ativos, forma de entrega)
    const lojaRows = await db
      .prepare("SELECT chave, valor FROM loja_config")
      .all<{ chave: string; valor: string }>();
    const lojaMap = new Map(lojaRows.results.map((r) => [r.chave, r.valor]));
    if (lojaMap.get("pedidos_ativos") === "0") {
      return { ok: false, erro: "pedidos_pausados" };
    }
    const aceitaEntrega = lojaMap.get("aceita_entrega") !== "0";
    const aceitaRetirada = lojaMap.get("aceita_retirada") === "1";

    // Validação básica
    const modalidade = corpo.modalidade === "retirada" ? "retirada" : "entrega";
    if (modalidade === "entrega" && !aceitaEntrega) {
      return { ok: false, erro: "modalidade_indisponivel" };
    }
    if (modalidade === "retirada" && !aceitaRetirada) {
      return { ok: false, erro: "modalidade_indisponivel" };
    }

    const nome = (corpo.cliente?.nome || "").trim();
    const whats = somenteDigitos(corpo.cliente?.whatsapp);
    if (!nome) return { ok: false, erro: "nome_obrigatorio" };
    if (whats.length < 10) return { ok: false, erro: "whatsapp_invalido" };

    const itensEntrada = Array.isArray(corpo.itens) ? corpo.itens : [];
    if (itensEntrada.length === 0) return { ok: false, erro: "carrinho_vazio" };

    // Normaliza itens e valida quantidades
    const pedidos: { produto_id: number; quantidade: number }[] = [];
    for (const item of itensEntrada) {
      const pid = Number(item.produto_id);
      const qtd = Number(item.quantidade);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (!Number.isInteger(qtd) || qtd <= 0) continue;
      pedidos.push({ produto_id: pid, quantidade: qtd });
    }
    if (pedidos.length === 0) return { ok: false, erro: "carrinho_vazio" };

    // Busca produtos no D1 — recalcula preço SEMPRE no backend.
    const ids = pedidos.map((p) => p.produto_id);
    const placeholders = ids.map(() => "?").join(",");
    const produtoRows = await db
      .prepare(
        `SELECT id, nome, preco, preco_promo, tem_promo, disponivel, estoque
         FROM produtos WHERE id IN (${placeholders})`
      )
      .bind(...ids)
      .all<ProdutoD1>();
    const produtoMap = new Map(produtoRows.results.map((p) => [p.id, p]));

    // Seleção de estoque: se algum produto indisponível/sem estoque, recusa.
    const linhas: LinhaPreco[] = [];
    for (const p of pedidos) {
      const prod = produtoMap.get(p.produto_id);
      if (!prod) return { ok: false, erro: "produto_indisponivel" };
      if (prod.disponivel !== 1 && prod.disponivel !== undefined) {
        return { ok: false, erro: "produto_indisponivel" };
      }
      if (typeof prod.estoque === "number" && prod.estoque < p.quantidade) {
        return { ok: false, erro: "estoque_insuficiente" };
      }
      const precoFinal =
        prod.tem_promo === 1 && prod.preco_promo && prod.preco_promo > 0
          ? prod.preco_promo
          : prod.preco;
      linhas.push({
        produto_id: prod.id,
        nome: prod.nome,
        quantidade: p.quantidade,
        preco: precoFinal,
        subtotal: Math.round(precoFinal * p.quantidade * 100) / 100,
        estoque: prod.estoque,
      });
    }

    const subtotal = Math.round(linhas.reduce((s, l) => s + l.subtotal, 0) * 100) / 100;

    // Taxa de entrega: recalcula pela zona via CEP (nunca confia no front).
    let taxaEntrega = 0;
    let zonaNome: string | null = null;
    if (modalidade === "entrega") {
      const zonasRows = await db
        .prepare("SELECT id, nome, preco, ceps FROM zonas_entrega ORDER BY preco, nome")
        .all<ZonaD1>();
      const cep = somenteDigitos(corpo.cep);
      if (cep.length !== 8) return { ok: false, erro: "cep_invalido" };
      const zona = zonaPorCep(cep, zonasRows.results);
      if (zona) {
        taxaEntrega = Number(zona.preco) || 0;
        zonaNome = zona.nome;
      }
      if (!zonaNome && !corpo.endereco?.trim()) {
        return { ok: false, erro: "endereco_obrigatorio" };
      }
      if (!zonaNome) {
        // CEP fora das zonas: a entrega é bloqueada no front; aqui reforça.
        return { ok: false, erro: "cep_fora_zona" };
      }
    }

    const total = Math.round((subtotal + taxaEntrega) * 100) / 100;
    const agora = new Date();
    const agoraIso = agora.toISOString();
    const id = gerarPedidoId(agora);

    // Número sequencial do pedido (sync_meta) — aproximação simple.
    const meta = await db
      .prepare("SELECT valor FROM sync_meta WHERE chave = 'ultimo_numero_pedido'")
      .first<{ valor: string }>();
    const numero = (Number(meta?.valor) || 0) + 1;

    const stmts: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO pedidos_online (id, numero, cliente_nome, cliente_whatsapp, modalidade,
             endereco, cep, zona_nome, taxa_entrega, subtotal, desconto, total,
             forma_pagamento, observacao, status, ip, criado_em, atualizado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'novo', ?, ?, ?)`
        )
        .bind(
          id, numero, nome, whats, modalidade,
          modalidade === "entrega" ? (corpo.endereco || "").trim() : null,
          modalidade === "entrega" ? somenteDigitos(corpo.cep) || null : null,
          zonaNome, taxaEntrega, subtotal, total,
          (corpo.forma_pagamento || "").trim().slice(0, 50),
          (corpo.observacao || "").trim().slice(0, 500) || null,
          ip.slice(0, 45), agoraIso, agoraIso,
        ),
      ...linhas.map((l) =>
        db
          .prepare(
            "INSERT INTO pedido_itens_online (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(id, l.produto_id, l.nome, l.quantidade, l.preco, l.subtotal)
      ),
      db
        .prepare(
          "INSERT INTO sync_meta (chave, valor) VALUES ('ultimo_numero_pedido', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor"
        )
        .bind(String(numero)),
    ];

    await db.batch(stmts);

    return {
      ok: true,
      pedido: { id, numero, total, taxa_entrega: taxaEntrega, subtotal },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro_desconhecido";
    return { ok: false, erro: msg };
  }
}
