export interface LojaPublica {
  nome: string;
  whatsapp?: string;
  endereco?: string;
  horario?: string;
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
  imagem: number | null;
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

// Base fixa e simbólica: o host/porta/cep do destino SÃO definidos pela
// configuração do VPC Service (binding env.CATALOGO_API) — nunca pelo
// visitante. Qualquer host presente aqui é ignorado (sem SSRF).
const BASE_VPC = "http://catalogo-interno";

class BackendVpc implements CatalogoBackend {
  private binding: Fetcher;
  private token: string;

  constructor(binding: Fetcher, token: string) {
    this.binding = binding;
    this.token = token;
  }

  private cabecalhos(): Record<string, string> {
    return { "Authorization": "Bearer " + this.token };
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

export function criarBackend(env: Env): CatalogoBackend {
  if (env.CATALOGO_API) {
    return new BackendVpc(env.CATALOGO_API, env.CATALOGO_RELAY_TOKEN || "");
  }
  const modo = env.CATALOGO_BACKEND_MODE || "mock";
  if (modo === "erro") return ERRO;
  if (modo === "timeout") return TIMEOUT;
  return MOCK;
}