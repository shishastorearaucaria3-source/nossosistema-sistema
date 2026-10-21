import type {
  CatalogoBackend,
  CatalogoPublicoV1,
  ImagemCatalogo,
  LojaPublica,
  CategoriaPublica,
  ProdutoPublicoV1,
} from "./backend";

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  EMPRESA_ID: string;
}

// Cliente Supabase do Worker via REST (PostgREST) — sem supabase-js no bundle,
// mantendo o Worker de borda enxuto e rápido. Usa a chave de serviço apenas no
// lado servidor/edge (nunca exposta ao frontend). Para leitura pública bastaria
// a chave anon, mas o Worker também grava pedidos (não usa D1 nesse modo).
export class BackendSupabase implements CatalogoBackend {
  private url: string;
  private key: string;
  private empresaId: string;

  constructor(env: SupabaseEnv) {
    this.url = env.SUPABASE_URL.replace(/\/+$/, "");
    this.key = env.SUPABASE_SERVICE_KEY;
    this.empresaId = env.EMPRESA_ID;
  }

  private async rest(
    path: string,
    query: string,
    opts: { method?: string; body?: unknown } = {},
  ): Promise<{ data: unknown; status: number; ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.url}/rest/v1${path}?${query}`, {
        method: opts.method || "GET",
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      if (!res.ok) {
        return { data: null, status: res.status, ok: false, error: String(parsed || res.statusText) };
      }
      return { data: parsed, status: res.status, ok: true };
    } catch (e) {
      return { data: null, status: 0, ok: false, error: e instanceof Error ? e.message : "erro_desconhecido" };
    }
  }

  private qs(params: Record<string, string>): string {
    return Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }

  async getCatalogoPublico(): Promise<CatalogoPublicoV1> {
    const eid = this.empresaId;

    const settingsRes = await this.rest(
      "/catalog_settings",
      this.qs({ select: "*", empresa_id: `eq.${eid}`, limit: "1" }),
    );
    const settings = Array.isArray(settingsRes.data) ? (settingsRes.data as Record<string, unknown>[])[0] : null;

    const catsRes = await this.rest(
      "/catalog_categories",
      this.qs({ select: "external_id,nome", empresa_id: `eq.${eid}`, order: "nome.asc" }),
    );
    const categories = (Array.isArray(catsRes.data) ? catsRes.data : []) as { external_id: number; nome: string }[];

    const prodsRes = await this.rest(
      "/catalog_products",
      this.qs({
        select: "external_id,nome,descricao,preco,preco_promo,subcategoria,marca,publicado,estoque_publico,ordem,imagem_url,categoria_id,catalog_categories!inner(external_id,nome)",
        empresa_id: `eq.${eid}`,
        order: "ordem.asc,nome.asc",
      }),
    );
    const products = (Array.isArray(prodsRes.data) ? prodsRes.data : []) as Record<string, unknown>[];

    const zonasRes = await this.rest(
      "/catalog_zones",
      this.qs({ select: "external_id,nome,preco,ceps", empresa_id: `eq.${eid}`, order: "preco.asc,nome.asc" }),
    );
    const zones = (Array.isArray(zonasRes.data) ? zonasRes.data : []) as {
      external_id: number;
      nome: string;
      preco: number;
      ceps: unknown;
    }[];

    const mostrarEstoque = settings?.mostrar_estoque !== false;
    const semEstoque = settings?.sem_estoque || "manter";

    const loja: LojaPublica = {
      nome: String(settings?.nome_loja || "Loja"),
      whatsapp: settings?.whatsapp ? String(settings.whatsapp) : undefined,
      endereco: settings?.endereco ? String(settings.endereco) : undefined,
      horario: settings?.horario ? String(settings.horario) : undefined,
      manutencao_ativos: !!settings?.manutencao_ativos,
      pedidos_ativos: settings?.pedidos_ativos !== false,
      aceita_entrega: settings?.aceita_entrega !== false,
      aceita_retirada: !!settings?.aceita_retirada,
      taxa_entrega: Number(settings?.taxa_entrega) || 0,
    };

    if (zones.length > 0) {
      loja.zonas = zones.map((z) => ({
        id: z.external_id,
        nome: z.nome,
        preco: Number(z.preco),
        ceps: Array.isArray(z.ceps) ? z.ceps.map(String).filter((c: string) => c.length >= 3) : [],
      }));
    }

    const categorias: CategoriaPublica[] = categories.map((c) => ({
      id: c.external_id,
      nome: c.nome,
    }));

    let produtosFmt: ProdutoPublicoV1[] = products
      .filter((p) => p.publicado !== false)
      .map((p) => {
        const cat = p.catalog_categories as unknown as
          | { external_id: number; nome: string }
          | null
          | undefined;
        return {
          id: Number(p.external_id),
          nome: String(p.nome),
          descricao: p.descricao ? String(p.descricao) : null,
          categoria: cat?.nome || null,
          categoria_id: cat?.external_id != null ? Number(cat.external_id) : null,
          subcategoria: p.subcategoria ? String(p.subcategoria) : null,
          marca: p.marca ? String(p.marca) : null,
          preco: Number(p.preco),
          preco_promo: p.preco_promo ? Number(p.preco_promo) : null,
          tem_promo: !!p.preco_promo && Number(p.preco_promo) > 0,
          disponivel: Number(p.estoque_publico) > 0,
          estoque: mostrarEstoque ? Number(p.estoque_publico) : undefined,
          ordem: Number(p.ordem),
          imagem: p.imagem_url ? String(p.imagem_url) : null,
        };
      });

    if (semEstoque === "despublicar") {
      produtosFmt = produtosFmt.filter((p) => (p.estoque ?? 0) > 0);
    }

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      loja,
      categorias,
      produtos: produtosFmt,
    };
  }

  async getImagem(id: number): Promise<ImagemCatalogo | null> {
    const res = await this.rest(
      "/catalog_products",
      this.qs({ select: "imagem_url", empresa_id: `eq.${this.empresaId}`, external_id: `eq.${id}`, limit: "1" }),
    );
    const row = Array.isArray(res.data) ? (res.data as Record<string, unknown>[])[0] : null;
    const url = row?.imagem_url;
    if (!url || typeof url !== "string") return null;

    try {
      const imgRes = await fetch(url);
      if (!imgRes.ok) return null;
      const mime = imgRes.headers.get("content-type") || "application/octet-stream";
      const bytes = new Uint8Array(await imgRes.arrayBuffer());
      return { bytes, mime };
    } catch {
      return null;
    }
  }

  async criarPedido(
    corpo: Record<string, unknown>,
    ip: string,
  ): Promise<{ ok: boolean; erro?: string; pedido?: Record<string, unknown> }> {
    const eid = this.empresaId;

    const settingsRes = await this.rest(
      "/catalog_settings",
      this.qs({ select: "pedidos_ativos,aceita_entrega,aceita_retirada", empresa_id: `eq.${eid}`, limit: "1" }),
    );
    const settings = Array.isArray(settingsRes.data) ? (settingsRes.data as Record<string, unknown>[])[0] : null;

    if (settings?.pedidos_ativos === false) return { ok: false, erro: "pedidos_pausados" };

    const cliente = (corpo.cliente || {}) as { nome?: string; whatsapp?: string };
    const nome = String(cliente.nome || "").trim();
    const whats = String(cliente.whatsapp || "").replace(/\D/g, "");
    if (!nome) return { ok: false, erro: "nome_obrigatorio" };
    if (whats.length < 10) return { ok: false, erro: "whatsapp_invalido" };

    const itensRaw = (Array.isArray(corpo.itens) ? corpo.itens : []) as {
      produto_id: number;
      quantidade: number;
    }[];
    if (itensRaw.length === 0) return { ok: false, erro: "carrinho_vazio" };

    const modalidade = corpo.modalidade === "retirada" ? "retirada" : "entrega";
    if (modalidade === "entrega" && settings?.aceita_entrega === false) return { ok: false, erro: "modalidade_indisponivel" };
    if (modalidade === "retirada" && settings?.aceita_retirada === false) return { ok: false, erro: "modalidade_indisponivel" };

    const ids = itensRaw.map((i) => i.produto_id).filter((x) => Number.isInteger(x));
    if (ids.length === 0) return { ok: false, erro: "carrinho_vazio" };

    const prodsRes = await this.rest(
      "/catalog_products",
      this.qs({ select: "external_id,nome,preco,preco_promo,publicado,estoque_publico", empresa_id: `eq.${eid}`, external_id: `in.(${ids.join(",")})` }),
    );
    const produtos = (Array.isArray(prodsRes.data) ? prodsRes.data : []) as Record<string, unknown>[];
    const prodMap = new Map<number, Record<string, unknown>>();
    for (const p of produtos) prodMap.set(Number(p.external_id), p);

    const linhas: { produto_id: number; nome: string; quantidade: number; preco: number; subtotal: number }[] = [];
    for (const item of itensRaw) {
      const pid = Number(item.produto_id);
      const qtd = Number(item.quantidade);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (!Number.isInteger(qtd) || qtd <= 0) continue;

      const prod = prodMap.get(pid);
      if (!prod) return { ok: false, erro: "produto_indisponivel" };
      if (prod.publicado === false) return { ok: false, erro: "produto_indisponivel" };
      if (Number(prod.estoque_publico) < qtd) return { ok: false, erro: "estoque_insuficiente" };

      const precoFinal = prod.preco_promo && Number(prod.preco_promo) > 0 ? Number(prod.preco_promo) : Number(prod.preco);
      linhas.push({
        produto_id: pid,
        nome: String(prod.nome),
        quantidade: qtd,
        preco: precoFinal,
        subtotal: Math.round(precoFinal * qtd * 100) / 100,
      });
    }
    if (linhas.length === 0) return { ok: false, erro: "carrinho_vazio" };

    const subtotal = Math.round(linhas.reduce((s, l) => s + l.subtotal, 0) * 100) / 100;

    let taxaEntrega = 0;
    let zonaNome: string | null = null;
    if (modalidade === "entrega") {
      const cep = String((corpo.cep as string) || "").replace(/\D/g, "");
      if (cep.length !== 8) return { ok: false, erro: "cep_invalido" };

      const zonasRes = await this.rest(
        "/catalog_zones",
        this.qs({ select: "external_id,nome,preco,ceps", empresa_id: `eq.${eid}`, order: "preco.asc" }),
      );
      const zonas = (Array.isArray(zonasRes.data) ? zonasRes.data : []) as {
        external_id: number;
        nome: string;
        preco: number;
        ceps: unknown;
      }[];

      for (const z of zonas) {
        const ceps = Array.isArray(z.ceps) ? z.ceps : [];
        const match = ceps.some((c: string) => {
          const clean = String(c).replace(/\D/g, "");
          if (clean.length < 3) return false;
          const len = Math.min(clean.length, 8, cep.length);
          return cep.slice(0, len) === clean.slice(0, len);
        });
        if (match) {
          taxaEntrega = Number(z.preco) || 0;
          zonaNome = z.nome;
          break;
        }
      }

      if (!zonaNome && !String(corpo.endereco || "").trim()) return { ok: false, erro: "endereco_obrigatorio" };
      if (!zonaNome) return { ok: false, erro: "cep_fora_zona" };
    }

    const total = Math.round((subtotal + taxaEntrega) * 100) / 100;
    const agora = new Date().toISOString();
    const id = crypto.randomUUID();

    const metaRes = await this.rest(
      "/sync_meta",
      this.qs({ select: "valor", empresa_id: `eq.${eid}`, chave: "eq.ultimo_numero_pedido", limit: "1" }),
    );
    const meta = Array.isArray(metaRes.data) ? (metaRes.data as Record<string, unknown>[])[0] : null;
    const numero = (Number(meta?.valor) || 0) + 1;

    const insert = await this.rest("/pedidos_online", "", {
      method: "POST",
      body: {
        id,
        empresa_id: eid,
        numero,
        cliente_nome: nome,
        cliente_whatsapp: whats,
        modalidade,
        endereco: modalidade === "entrega" ? String(corpo.endereco || "").trim() || null : null,
        cep: modalidade === "entrega" ? String(corpo.cep || "").replace(/\D/g, "") || null : null,
        zona_nome: zonaNome,
        taxa_entrega: taxaEntrega,
        subtotal,
        desconto: 0,
        total,
        forma_pagamento: String(corpo.forma_pagamento || "").trim().slice(0, 50),
        observacao: String(corpo.observacao || "").trim().slice(0, 500) || null,
        status: "novo",
        ip: ip.slice(0, 45),
        criado_em: agora,
        atualizado_em: agora,
      },
    });
    if (!insert.ok) return { ok: false, erro: String(insert.error) };

    const itensInsert = linhas.map((l) => ({
      pedido_id: id,
      produto_id: l.produto_id,
      nome_produto: l.nome,
      quantidade: l.quantidade,
      preco_unitario: l.preco,
      subtotal: l.subtotal,
    }));
    await this.rest("/pedido_itens_online", "", { method: "POST", body: itensInsert });

    await this.rest("/sync_meta", `on_conflict=empresa_id,chave`, {
      method: "POST",
      body: { empresa_id: eid, chave: "ultimo_numero_pedido", valor: String(numero), updated_at: agora },
    });

    return { ok: true, pedido: { id, numero, total, taxa_entrega: taxaEntrega, subtotal } };
  }

  async listarPedidos(
    desde?: string | null,
  ): Promise<{ ok: boolean; erro?: string; pedidos?: Record<string, unknown>[] }> {
    const eid = this.empresaId;
    const params: Record<string, string> = {
      select: "*",
      empresa_id: `eq.${eid}`,
      order: "criado_em.asc",
    };
    if (desde) params.criado_em = `gt.${desde}`;

    const res = await this.rest("/pedidos_online", this.qs(params));
    const pedidos = (Array.isArray(res.data) ? res.data : []) as Record<string, unknown>[];
    if (!Array.isArray(res.data)) return { ok: false, erro: String(res.error) };

    const result: Record<string, unknown>[] = [];
    for (const p of pedidos) {
      const itensRes = await this.rest(
        "/pedido_itens_online",
        this.qs({ select: "produto_id,nome_produto,quantidade,preco_unitario,subtotal", pedido_id: `eq.${p.id}`, order: "id.asc" }),
      );
      result.push({ ...p, itens: Array.isArray(itensRes.data) ? itensRes.data : [] });
    }
    return { ok: true, pedidos: result };
  }
}
