import type { Env } from "./backend";

interface LojaSyncData {
  nome_loja?: string;
  whatsapp?: string;
  endereco?: string;
  horario?: string;
  manutencao_ativos?: boolean;
  pedidos_ativos?: boolean;
  aceita_entrega?: boolean;
  aceita_retirada?: boolean;
  taxa_entrega?: number;
  mostrar_estoque?: boolean;
  sem_estoque?: "despublicar" | "manter";
}

interface CategoriaSync {
  id: number;
  nome: string;
}

interface ProdutoSync {
  id: number;
  nome: string;
  descricao: string | null;
  categoria_id: number | null;
  subcategoria: string | null;
  marca: string | null;
  preco: number;
  preco_promo: number | null;
  tem_promo: boolean;
  disponivel: boolean;
  estoque: number;
  ordem: number;
  imagem_b64: string | null;
  imagem_ext: string | null;
}

interface ZonaSync {
  id: number;
  nome: string;
  preco: number;
  ceps?: string[];
}

export interface PayloadSincronizacao {
  limpar?: boolean;
  final?: boolean;
  loja?: LojaSyncData;
  categorias?: CategoriaSync[];
  produtos?: ProdutoSync[];
  zonas?: ZonaSync[];
}

export function verificarTokenSync(
  fornecido: string | null,
  esperado: string
): boolean {
  if (!fornecido || !esperado) return false;
  if (fornecido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < fornecido.length; i++) {
    diff |= fornecido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diff === 0;
}

export async function processarSincronizacao(
  env: Env,
  payload: PayloadSincronizacao
): Promise<{ ok: boolean; erro?: string }> {
  // Em modo Supabase, a sincronização principal acontece direto do ERP local
  // para o Supabase (sem passar pelo Worker). Este endpoint permanece apenas
  // como caminho de compatibilidade com o D1 legado.
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY && env.EMPRESA_ID) {
    return { ok: true, erro: "supabase_sync_direto_usar_worker_publico" };
  }
  if (!env.CATALOGO_DB) {
    return { ok: false, erro: "d1_nao_configurado" };
  }
  const db = env.CATALOGO_DB;
  const bucket = env.CATALOGO_BUCKET;

  try {
    if (payload.loja) {
      const loja = payload.loja;
      const stmts: D1PreparedStatement[] = [];
      const set = (chave: string, valor: string) =>
        db
          .prepare(
            "INSERT INTO loja_config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor"
          )
          .bind(chave, valor);
      if (loja.nome_loja !== undefined) stmts.push(set("nome_loja", loja.nome_loja));
      if (loja.whatsapp !== undefined) stmts.push(set("whatsapp", loja.whatsapp));
      if (loja.endereco !== undefined) stmts.push(set("endereco", loja.endereco));
      if (loja.horario !== undefined) stmts.push(set("horario", loja.horario));
      if (loja.manutencao_ativos !== undefined) stmts.push(set("manutencao_ativos", loja.manutencao_ativos ? "1" : "0"));
      if (loja.pedidos_ativos !== undefined) stmts.push(set("pedidos_ativos", loja.pedidos_ativos ? "1" : "0"));
      if (loja.aceita_entrega !== undefined) stmts.push(set("aceita_entrega", loja.aceita_entrega ? "1" : "0"));
      if (loja.aceita_retirada !== undefined) stmts.push(set("aceita_retirada", loja.aceita_retirada ? "1" : "0"));
      if (loja.taxa_entrega !== undefined) stmts.push(set("taxa_entrega", String(loja.taxa_entrega)));
      if (loja.mostrar_estoque !== undefined) stmts.push(set("mostrar_estoque", loja.mostrar_estoque ? "1" : "0"));
      if (loja.sem_estoque !== undefined) stmts.push(set("sem_estoque", loja.sem_estoque));
      if (stmts.length > 0) await db.batch(stmts);
    }

    if (payload.categorias) {
      if (payload.limpar) {
        await db.exec("DELETE FROM categorias");
      }
      if (payload.categorias.length > 0) {
        const stmts = payload.categorias.map((c) =>
          db.prepare("INSERT INTO categorias (id, nome) VALUES (?, ?)").bind(c.id, c.nome)
        );
        await db.batch(stmts);
      }
    }

    if (payload.produtos) {
      if (payload.limpar) {
        await db.exec("DELETE FROM produtos");
      }
      const stmts: D1PreparedStatement[] = [];
      const uploads: { key: string; bytes: Uint8Array; ext: string }[] = [];
      const bk = bucket;
      for (const p of payload.produtos) {
        let imagemKey: string | null = null;
        if (p.imagem_b64 && bk) {
          const ext = p.imagem_ext || "jpg";
          imagemKey = `produtos/${p.id}.${ext}`;
          const bytes = Uint8Array.from(atob(p.imagem_b64), (c) => c.charCodeAt(0));
          uploads.push({ key: imagemKey, bytes, ext });
        } else if (p.imagem_b64 && !bk) {
          const ext = p.imagem_ext || "jpg";
          imagemKey = `inline:${ext}:${p.imagem_b64}`;
        }
        stmts.push(
          db
            .prepare(
              `INSERT INTO produtos (id, nome, descricao, categoria_id, subcategoria, marca,
               preco, preco_promo, tem_promo, disponivel, estoque, ordem, imagem_key)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 nome=excluded.nome, descricao=excluded.descricao, categoria_id=excluded.categoria_id,
                 subcategoria=excluded.subcategoria, marca=excluded.marca, preco=excluded.preco,
                 preco_promo=excluded.preco_promo, tem_promo=excluded.tem_promo,
                 disponivel=excluded.disponivel, estoque=excluded.estoque, ordem=excluded.ordem,
                 imagem_key=COALESCE(excluded.imagem_key, produtos.imagem_key)`
            )
            .bind(
              p.id, p.nome, p.descricao, p.categoria_id, p.subcategoria, p.marca,
              p.preco, p.preco_promo, p.tem_promo ? 1 : 0, p.disponivel ? 1 : 0,
              p.estoque, p.ordem, imagemKey
            )
        );
      }
      await Promise.all(
        uploads.map((u) =>
          bk!.put(u.key, u.bytes, {
            httpMetadata: {
              contentType: u.ext === "png" ? "image/png" : u.ext === "webp" ? "image/webp" : "image/jpeg",
              cacheControl: "public, max-age=86400",
            },
          })
        )
      );
      await db.batch(stmts);
    }

    if (payload.zonas) {
      // Substituição total a cada sincronização bem-sucedida: evita deixar
      // zonas órfãs/antigas no catálogo quando uma zona é excluída no ERP.
      await db.exec("DELETE FROM zonas_entrega");
      if (payload.zonas.length > 0) {
        const stmts = payload.zonas.map((z) => {
          const cepsJson = JSON.stringify(
            Array.isArray(z.ceps) ? z.ceps.filter((c) => typeof c === "string" && c.length >= 3) : []
          );
          return db
            .prepare("INSERT INTO zonas_entrega (id, nome, preco, ceps) VALUES (?, ?, ?, ?)")
            .bind(z.id, z.nome, z.preco, cepsJson);
        });
        await db.batch(stmts);
      }
    }

    if (payload.final) {
      await db
        .prepare(
          "INSERT INTO sync_meta (chave, valor) VALUES ('ultima_sync', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor"
        )
        .bind(new Date().toISOString())
        .run();
    }

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro_desconhecido";
    return { ok: false, erro: msg };
  }
}
