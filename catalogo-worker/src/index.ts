import { analisarRota } from "./router";
import { coletarOrigens, headersCors, originPermitida } from "./cors";
import { criarBackend, type Env } from "./backend";
import { verificarTokenSync, processarSincronizacao, type PayloadSincronizacao } from "./sync";
import { criarPedidoOnline, listarPedidosOnline, type PedidoOnlineEntrada } from "./orders";

const TIMEOUT_PADRAO_MS = 3000;
const METODOS_PREFLIGHT = "GET, POST, OPTIONS";
const MAX_AGE_PREFLIGHT = "86400";

const CACHE_CATALOGO_PUBLICO = "catalogo-publico-v1";
const CACHE_IMAGENS = "catalogo-imagens";

// Limite anti-spam de criação de pedidos (por IP): janela de 60s com teto de
// pedidos. Estado em memória da instância — suficiente para limitar abuso.
const JANELA_RATE_LIMIT_MS = 60000;
const TETO_PEDIDOS_POR_IP = 6;
const FILA_RATE: Map<string, number[]> = new Map();

function rateLimitPermitido(ip: string): boolean {
  const agora = Date.now();
  const corte = agora - JANELA_RATE_LIMIT_MS;
  const fila = (FILA_RATE.get(ip) || []).filter((t) => t > corte);
  if (fila.length >= TETO_PEDIDOS_POR_IP) {
    FILA_RATE.set(ip, fila);
    return false;
  }
  fila.push(agora);
  FILA_RATE.set(ip, fila);
  return true;
}

function ipDoRequest(request: Request): string {
  const cf = (request as unknown as { cf?: { connectingIp?: string } }).cf;
  if (cf?.connectingIp) return cf.connectingIp;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
}

class BackendTimeoutError extends Error {}

function respostaJson(
  corpo: unknown,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function comTimeout<T>(promessa: Promise<T>, tempoMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new BackendTimeoutError());
    }, tempoMs);
    promessa.then(
      (valor) => {
        clearTimeout(timer);
        resolve(valor);
      },
      (erro) => {
        clearTimeout(timer);
        reject(erro);
      },
    );
  });
}

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return respostaJson({ error: "requisicao_invalida" }, 400, {});
  }

  const origin = request.headers.get("origin");
  const origens = coletarOrigens(env);
  const cors = headersCors(origin, origens);

  if (origin && !originPermitida(origin, origens)) {
    return respostaJson({ error: "origem_nao_permitida" }, 403, cors);
  }

  const rota = analisarRota(url.pathname);

  if (rota.tipo === "nenhuma") {
    return respostaJson({ error: "nao_encontrado" }, 404, cors);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": METODOS_PREFLIGHT,
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": MAX_AGE_PREFLIGHT,
      },
    });
  }

  if (rota.tipo === "sync") {
    if (request.method !== "POST") {
      return respostaJson({ error: "metodo_nao_permitido" }, 405, cors);
    }
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!verificarTokenSync(token, env.CATALOGO_SYNC_TOKEN || "")) {
      return respostaJson({ error: "nao_autorizado" }, 401, cors);
    }
    if (!env.CATALOGO_DB && !(env.SUPABASE_URL && env.EMPRESA_ID)) {
      return respostaJson({ error: "d1_nao_configurado" }, 503, cors);
    }
    let payload: PayloadSincronizacao;
    try {
      payload = (await request.json()) as PayloadSincronizacao;
    } catch {
      return respostaJson({ error: "json_invalido" }, 400, cors);
    }
    const resultado = await processarSincronizacao(env, payload);
    if (!resultado.ok) {
      return respostaJson({ error: resultado.erro || "sync_falhou" }, 500, cors);
    }
    if (payload.final) {
      const cache = (caches as unknown as { default: Cache }).default;
      await cache.delete(new Request(`https://catalogo-worker/${CACHE_CATALOGO_PUBLICO}`));
      await cache.delete(new Request(`https://catalogo-worker/${CACHE_IMAGENS}`));
    }
    return respostaJson({ ok: true }, 200, cors);
  }

  if (rota.tipo === "pedido") {
    if (request.method !== "POST") {
      return respostaJson({ error: "metodo_nao_permitido" }, 405, cors);
    }
    if (!env.CATALOGO_DB && !(env.SUPABASE_URL && env.EMPRESA_ID)) {
      return respostaJson({ error: "d1_nao_configurado" }, 503, cors);
    }
    const ip = ipDoRequest(request);
    if (!rateLimitPermitido(ip)) {
      return respostaJson({ error: "limite_excedido" }, 429, cors);
    }
    let corpo: PedidoOnlineEntrada;
    try {
      corpo = (await request.json()) as PedidoOnlineEntrada;
    } catch {
      return respostaJson({ error: "json_invalido" }, 400, cors);
    }
    const resultado = await criarPedidoOnline(env, corpo, ip);
    if (!resultado.ok) {
      const validacao = [
        "pedidos_pausados", "modalidade_indisponivel", "nome_obrigatorio",
        "whatsapp_invalido", "carrinho_vazio", "produto_indisponivel",
        "estoque_insuficiente", "cep_invalido", "cep_fora_zona",
        "endereco_obrigatorio",
      ];
      const status = validacao.includes(resultado.erro || "") ? 400 : 500;
      return respostaJson({ error: resultado.erro || "erro_criar_pedido" }, status, cors);
    }
    return respostaJson(
      { ok: true, pedido: resultado.pedido },
      201,
      { "Cache-Control": "no-store", ...cors },
    );
  }

  if (rota.tipo === "pedidos") {
    if (request.method !== "GET") {
      return respostaJson({ error: "metodo_nao_permitido" }, 405, cors);
    }
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!verificarTokenSync(token, env.CATALOGO_SYNC_TOKEN || "")) {
      return respostaJson({ error: "nao_autorizado" }, 401, cors);
    }
    if (!env.CATALOGO_DB && !(env.SUPABASE_URL && env.EMPRESA_ID)) {
      return respostaJson({ error: "d1_nao_configurado" }, 503, cors);
    }
    const desde = url.searchParams.get("desde");
    const resultado = await listarPedidosOnline(env, desde);
    if (!resultado.ok) {
      return respostaJson({ error: resultado.erro || "erro_listar_pedidos" }, 500, cors);
    }
    return respostaJson(
      { ok: true, pedidos: resultado.pedidos },
      200,
      { "Cache-Control": "no-store", ...cors },
    );
  }

  if (request.method !== "GET") {
    return respostaJson({ error: "metodo_nao_permitido" }, 405, cors);
  }

  const tempoMs = Number(env.CATALOGO_BACKEND_TIMEOUT_MS) > 0 ? Number(env.CATALOGO_BACKEND_TIMEOUT_MS) : TIMEOUT_PADRAO_MS;
  const backend = criarBackend(env);

  try {
    if (rota.tipo === "publico") {
      const cache = (caches as unknown as { default: Cache }).default;
      const chaveCache = new Request(`https://catalogo-worker/${CACHE_CATALOGO_PUBLICO}`);
      const emCache = await cache.match(chaveCache);
      if (emCache) {
        return new Response(emCache.body, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            ...cors,
          },
        });
      }
      const dados = await comTimeout(backend.getCatalogoPublico(), tempoMs);
      const corpo = JSON.stringify(dados);
      await cache.put(
        chaveCache,
        new Response(corpo, {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }),
      );
      return new Response(corpo, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=300",
          ...cors,
        },
      });
    }

    if (rota.tipo === "imagem") {
      if (rota.id === null) {
        return respostaJson({ error: "id_invalido" }, 400, cors);
      }
      const cache = (caches as unknown as { default: Cache }).default;
      const chaveImagem = new Request(`https://catalogo-worker/${CACHE_IMAGENS}/${rota.id}`);
      const emCache = await cache.match(chaveImagem);
      if (emCache) {
        return new Response(emCache.body, {
          status: 200,
          headers: {
            "Content-Type": emCache.headers.get("content-type") || "application/octet-stream",
            "Cache-Control": "public, max-age=86400",
            ...cors,
          },
        });
      }
      const imagem = await comTimeout(backend.getImagem(rota.id), tempoMs);
      if (!imagem) {
        return respostaJson({ error: "imagem_nao_encontrada" }, 404, cors);
      }
      const mime = imagem.mime;
      await cache.put(
        chaveImagem,
        new Response(imagem.bytes, {
          status: 200,
          headers: { "Content-Type": mime },
        }),
      );
      return new Response(imagem.bytes, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=86400",
          ...cors,
        },
      });
    }

    return respostaJson({ error: "nao_encontrado" }, 404, cors);
  } catch (e) {
    console.error("catalogo_backend_error", e && e instanceof Error ? e.message : String(e));
    return respostaJson({ error: "catalogo_indisponivel" }, 503, cors);
  }
}

export default {
  fetch: (request: Request, env: Env) => handleRequest(request, env),
};
