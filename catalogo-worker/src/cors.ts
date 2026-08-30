import type { Env } from "./backend";

export const ORIGEM_PRODUCAO = "https://catalogo.shishastore.com.br";

export function coletarOrigens(env: Env): Set<string> {
  const origens = new Set<string>([ORIGEM_PRODUCAO]);
  const extra = (env.CATALOGO_CORS_ORIGEM || "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  for (const origem of extra) origens.add(origem);
  return origens;
}

export function originPermitida(origin: string, origens: Set<string>): boolean {
  return origens.has(origin);
}

export function headersCors(
  origin: string | null,
  origens: Set<string>,
): Record<string, string> {
  if (!origin) return {};
  if (!origens.has(origin)) return { "Vary": "Origin" };
  return { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
}