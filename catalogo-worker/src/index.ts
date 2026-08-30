import { analisarRota } from "./router";
import { coletarOrigens, headersCors, originPermitida } from "./cors";
import { criarBackend, type Env } from "./backend";

const TIMEOUT_PADRAO_MS = 3000;
const METODOS_PREFLIGHT = "GET, OPTIONS";
const MAX_AGE_PREFLIGHT = "86400";

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
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": MAX_AGE_PREFLIGHT,
      },
    });
  }

  if (request.method !== "GET") {
    return respostaJson({ error: "metodo_nao_permitido" }, 405, cors);
  }

  const tempoMs = Number(env.CATALOGO_BACKEND_TIMEOUT_MS) > 0 ? Number(env.CATALOGO_BACKEND_TIMEOUT_MS) : TIMEOUT_PADRAO_MS;
  const backend = criarBackend(env);

  try {
    if (rota.tipo === "publico") {
      const dados = await comTimeout(backend.getCatalogoPublico(), tempoMs);
      return new Response(JSON.stringify(dados), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      });
    }

    if (rota.tipo === "imagem") {
      if (rota.id === null) {
        return respostaJson({ error: "id_invalido" }, 400, cors);
      }
      const imagem = await comTimeout(backend.getImagem(rota.id), tempoMs);
      if (!imagem) {
        return respostaJson({ error: "imagem_nao_encontrada" }, 404, cors);
      }
      return new Response(imagem.bytes, {
        status: 200,
        headers: {
          "Content-Type": imagem.mime,
          "Cache-Control": "public, max-age=3600",
          ...cors,
        },
      });
    }

    return respostaJson({ error: "nao_encontrado" }, 404, cors);
  } catch {
    return respostaJson({ error: "catalogo_indisponivel" }, 503, cors);
  }
}

export default {
  fetch: (request: Request, env: Env) => handleRequest(request, env),
};