import { BackendSupabase } from "./backend-supabase";

export interface LojaPublica {
  nome: string;
  whatsapp?: string;
  endereco?: string;
  horario?: string;
  manutencao_ativos?: boolean;
  pedidos_ativos?: boolean;
  aceita_entrega?: boolean;
  aceita_retirada?: boolean;
  taxa_entrega?: number;
  zonas?: { id: number; nome: string; preco: number; ceps?: string[] }[];
}

export interface CategoriaPublica {
  id: number;
  nome: string;
}

export interface ProdutoPublicoV1 {
  id: number;
  nome: string;
  descricao: string | null;
  categoria: string | null;
  categoria_id: number | null;
  subcategoria: string | null;
  marca: string | null;
  preco: number;
  preco_promo: number | null;
  tem_promo: boolean;
  disponivel: boolean;
  estoque?: number;
  ordem: number;
  imagem: number | string | null;
}

export interface CatalogoPublicoV1 {
  version: 1;
  generatedAt: string;
  loja: LojaPublica;
  categorias: CategoriaPublica[];
  produtos: ProdutoPublicoV1[];
}

export interface ImagemCatalogo {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
}

export interface CatalogoBackend {
  getCatalogoPublico(): Promise<CatalogoPublicoV1>;
  getImagem(id: number): Promise<ImagemCatalogo | null>;
}

export interface Env {
  CATALOGO_BACKEND_MODE?: string;
  CATALOGO_BACKEND_TIMEOUT_MS?: string;
  CATALOGO_CORS_ORIGEM?: string;
  CATALOGO_API?: Fetcher;
  CATALOGO_RELAY_TOKEN?: string;
  CATALOGO_DB?: D1Database;
  CATALOGO_BUCKET?: R2Bucket;
  CATALOGO_SYNC_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  EMPRESA_ID?: string;
}

const LOJA_SINTETICA: LojaPublica = {
  nome: "Loja Teste Sintetica",
  whatsapp: "(00) 00000-0000",
  endereco: "Rua Sintetica, 000",
  horario: "09:00-18:00",
};

const CATEGORIAS_SINTETICAS: CategoriaPublica[] = [
  { id: 1, nome: "Vaporizadores" },
  { id: 2, nome: "Acessorios" },
];

const PRODUTOS_SINTETICOS: ProdutoPublicoV1[] = [
  {
    id: 1,
    nome: "Vaporizador Sintetico X",
    descricao: "Item sintetico usado apenas na homologacao",
    categoria: "Vaporizadores",
    categoria_id: 1,
    subcategoria: "Sintetico",
    marca: "Marca Sintetica",
    preco: 49.9,
    preco_promo: 39.9,
    tem_promo: true,
    disponivel: true,
    estoque: 5,
    ordem: 1,
    imagem: 1,
  },
  {
    id: 2,
    nome: "Piteira Sintetica",
    descricao: null,
    categoria: "Acessorios",
    categoria_id: 2,
    subcategoria: null,
    marca: null,
    preco: 9.9,
    preco_promo: null,
    tem_promo: false,
    disponivel: true,
    estoque: 20,
    ordem: 2,
    imagem: null,
  },
  {
    id: 3,
    nome: "Narguile Sintetico Mini",
    descricao: "Item sintetico - indisponivel de proposito",
    categoria: "Acessorios",
    categoria_id: 2,
    subcategoria: "Sintetico",
    marca: "Marca Sintetica",
    preco: 149.9,
    preco_promo: null,
    tem_promo: false,
    disponivel: false,
    estoque: 0,
    ordem: 3,
    imagem: 2,
  },
];

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const JPEG_MINIMO = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

class BackendMock implements CatalogoBackend {
  getCatalogoPublico(): Promise<CatalogoPublicoV1> {
    const catalogo: CatalogoPublicoV1 = {
      version: 1,
      generatedAt: new Date().toISOString(),
      loja: LOJA_SINTETICA,
      categorias: CATEGORIAS_SINTETICAS,
      produtos: PRODUTOS_SINTETICOS,
    };
    return Promise.resolve(catalogo);
  }

  getImagem(id: number): Promise<ImagemCatalogo | null> {
    if (id === 1) return Promise.resolve({ bytes: PNG_1X1, mime: "image/png" });
    if (id === 2) return Promise.resolve({ bytes: JPEG_MINIMO, mime: "image/jpeg" });
    return Promise.resolve(null);
  }
}

class BackendErro implements CatalogoBackend {
  private falha(): Promise<never> {
    return Promise.reject(new Error("backend indisponivel (modo homologacao erro)"));
  }

  getCatalogoPublico(): Promise<CatalogoPublicoV1> {
    return this.falha();
  }

  getImagem(): Promise<ImagemCatalogo | null> {
    return this.falha();
  }
}

class BackendTimeout implements CatalogoBackend {
  getCatalogoPublico(): Promise<CatalogoPublicoV1> {
    return new Promise(() => {});
  }

  getImagem(): Promise<ImagemCatalogo | null> {
    return new Promise(() => {});
  }
}

const MOCK = new BackendMock();
const ERRO = new BackendErro();
const TIMEOUT = new BackendTimeout();

const BASE_VPC = "http://catalogo-interno";

class BackendVpc implements CatalogoBackend {
  private binding: Fetcher;
  private token: string;

  constructor(binding: Fetcher, token: string) {
    this.binding = binding;
    this.token = token;
  }

  private cabecalhos(): Record<string, string> {
    return { Authorization: "Bearer " + this.token };
  }

  async getCatalogoPublico(): Promise<CatalogoPublicoV1> {
    const res = await this.binding.fetch(`${BASE_VPC}/api/catalogo/publico`, {
      headers: this.cabecalhos(),
    });
    if (!res.ok) throw new Error("backend indisponivel");
    return (await res.json()) as CatalogoPublicoV1;
  }

  async getImagem(id: number): Promise<ImagemCatalogo | null> {
    const res = await this.binding.fetch(`${BASE_VPC}/api/catalogo/imagem/${id}`, {
      headers: this.cabecalhos(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("backend indisponivel");
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      bytes,
      mime: res.headers.get("content-type") || "application/octet-stream",
    };
  }
}

class BackendD1 implements CatalogoBackend {
  private db: D1Database;
  private bucket: R2Bucket | undefined;

  constructor(db: D1Database, bucket?: R2Bucket) {
    this.db = db;
    this.bucket = bucket;
  }

  async getCatalogoPublico(): Promise<CatalogoPublicoV1> {
    const lojaRows = await this.db
      .prepare("SELECT chave, valor FROM loja_config")
      .all<{ chave: string; valor: string }>();
    const lojaMap = new Map(lojaRows.results.map((r) => [r.chave, r.valor]));

    const nome = lojaMap.get("nome_loja") || "Loja";
    const loja: LojaPublica = { nome };
    if (lojaMap.get("whatsapp")) loja.whatsapp = lojaMap.get("whatsapp");
    if (lojaMap.get("endereco")) loja.endereco = lojaMap.get("endereco");
    if (lojaMap.get("horario")) loja.horario = lojaMap.get("horario");
    loja.manutencao_ativos = lojaMap.get("manutencao_ativos") === "1";
    loja.pedidos_ativos = lojaMap.get("pedidos_ativos") !== "0";
    loja.aceita_entrega = lojaMap.get("aceita_entrega") !== "0";
    loja.aceita_retirada = lojaMap.get("aceita_retirada") === "1";
    loja.taxa_entrega = Number(lojaMap.get("taxa_entrega")) || 0;

    const zonas = await this.db
      .prepare("SELECT id, nome, preco, ceps FROM zonas_entrega ORDER BY preco, nome")
      .all<{ id: number; nome: string; preco: number; ceps: string | null }>();
    if (zonas.results.length > 0) {
      loja.zonas = zonas.results.map((z) => {
        let ceps: string[] = [];
        if (typeof z.ceps === "string" && z.ceps) {
          try {
            const parsed = JSON.parse(z.ceps);
            if (Array.isArray(parsed)) ceps = parsed.map(String).filter((c) => c.length >= 3);
          } catch {
            /* ignore */
          }
        }
        return { id: z.id, nome: z.nome, preco: z.preco, ceps };
      });
    }

    const categorias = await this.db
      .prepare("SELECT id, nome FROM categorias ORDER BY nome")
      .all<{ id: number; nome: string }>();

    const mostrarEstoque = lojaMap.get("mostrar_estoque") !== "0";
    const semEstoque = lojaMap.get("sem_estoque") || "manter";

    let produtos = await this.db
      .prepare(
        `SELECT p.id, p.nome, p.descricao, p.categoria_id, c.nome AS categoria,
                p.subcategoria, p.marca, p.preco, p.preco_promo, p.tem_promo,
                p.disponivel, p.estoque, p.ordem, p.imagem_key
         FROM produtos p
         LEFT JOIN categorias c ON c.id = p.categoria_id
         ORDER BY p.ordem, p.nome`
      )
      .all<{
        id: number; nome: string; descricao: string | null;
        categoria_id: number | null; categoria: string | null;
        subcategoria: string | null; marca: string | null;
        preco: number; preco_promo: number | null; tem_promo: number;
        disponivel: number; estoque: number; ordem: number;
        imagem_key: string | null;
      }>();

    let produtosFmt: ProdutoPublicoV1[] = produtos.results.map((r) => ({
      id: r.id,
      nome: r.nome,
      descricao: r.descricao,
      categoria: r.categoria,
      categoria_id: r.categoria_id,
      subcategoria: r.subcategoria,
      marca: r.marca,
      preco: r.preco,
      preco_promo: r.preco_promo,
      tem_promo: r.tem_promo === 1,
      disponivel: r.disponivel === 1,
      estoque: mostrarEstoque ? r.estoque : undefined,
      ordem: r.ordem,
      imagem: r.imagem_key ? r.id : null,
    }));

    if (semEstoque === "despublicar") {
      produtosFmt = produtosFmt.filter((p) => (p.estoque ?? 0) > 0);
    }

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      loja,
      categorias: categorias.results,
      produtos: produtosFmt,
    };
  }

  async getImagem(id: number): Promise<ImagemCatalogo | null> {
    const row = await this.db
      .prepare("SELECT imagem_key FROM produtos WHERE id = ?")
      .bind(id)
      .first<{ imagem_key: string | null }>();
    if (!row?.imagem_key) return null;

    if (row.imagem_key.startsWith("inline:")) {
      const partes = row.imagem_key.slice("inline:".length).split(":");
      const ext = partes[0] || "jpg";
      const b64 = partes.slice(1).join(":");
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        const bin = atob(b64);
        const buf = new ArrayBuffer(bin.length);
        bytes = new Uint8Array(buf);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } catch {
        return null;
      }
      const mime =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
      return { bytes, mime };
    }

    if (!this.bucket) return null;
    const obj = await this.bucket.get(row.imagem_key);
    if (!obj) return null;

    const mime = detectarMime(row.imagem_key);
    const bytes = new Uint8Array(await obj.arrayBuffer());
    return { bytes, mime };
  }
}

function detectarMime(key: string): string {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".gif")) return "image/gif";
  if (key.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

export function criarBackend(env: Env): CatalogoBackend {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY && env.EMPRESA_ID) {
    return new BackendSupabase({
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
      EMPRESA_ID: env.EMPRESA_ID,
    });
  }
  if (env.CATALOGO_DB) {
    return new BackendD1(env.CATALOGO_DB, env.CATALOGO_BUCKET);
  }
  if (env.CATALOGO_API) {
    return new BackendVpc(env.CATALOGO_API, env.CATALOGO_RELAY_TOKEN || "");
  }
  const modo = env.CATALOGO_BACKEND_MODE || "mock";
  if (modo === "erro") return ERRO;
  if (modo === "timeout") return TIMEOUT;
  return MOCK;
}
