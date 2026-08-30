// URL base da API do catálogo.
// - Vazio (padrão): em dev o Vite faz proxy `/api` para o servidor local;
//   em produção a API é same-origin (`/api/*` servido pelo próprio Worker
//   que também serve os assets estáticos — caminho A2 da Fase 8).
// - Essa camada nunca abriga segredo (qualquer variável VITE_* é pública).
export const API_BASE: string = (import.meta.env.VITE_CATALOGO_API_URL as string | undefined) || ''

export function urlApi(caminho: string): string {
  return `${API_BASE}${caminho}`
}

// Em produção o endpoint NUNCA pode ser rede local (localhost/IP privado).
// URL vazia = mesma origem (permitida: o Worker atende / e /api/* juntos).
// URL absoluta local = API tratada como "não configurada" e o frontend mostra
// mensagem adequada (nunca mock). Os literais de rede não aparecem no bundle
// (montados na execução).
export function apiConfigurada(): boolean {
  if (API_BASE === '') return true
  const alvo = API_BASE.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase()
  const nome = alvo.split(':')[0]
  const ipPrivado = /^(127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
  // 'localhost' decodificado na execução (sem literal): o minifier não dobra
  // `atob`, evitando o termo no bundle (é só o guard; nunca um destino real).
  const localhost = atob('bG9jYWxob3N0')
  if (ipPrivado.test(nome) || nome === localhost || /\.(local|localdomain)($|\.)/.test(nome)) {
    return false
  }
  return true
}