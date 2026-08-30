export type VerdictoRota =
  | { tipo: "publico" }
  | { tipo: "imagem"; id: number | null }
  | { tipo: "nenhuma" };

export function analisarRota(pathname: string): VerdictoRota {
  const partes = pathname.split("/").filter((p) => p.length > 0);

  if (
    partes.length === 3 &&
    partes[0] === "api" &&
    partes[1] === "catalogo" &&
    partes[2] === "publico"
  ) {
    return { tipo: "publico" };
  }

  if (
    partes.length === 4 &&
    partes[0] === "api" &&
    partes[1] === "catalogo" &&
    partes[2] === "imagem"
  ) {
    const raw = partes[3];
    if (/^[1-9]\d*$/.test(raw)) {
      return { tipo: "imagem", id: Number(raw) };
    }
    return { tipo: "imagem", id: null };
  }

  return { tipo: "nenhuma" };
}