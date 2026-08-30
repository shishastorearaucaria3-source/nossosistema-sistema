import type { CatalogoPublicoV1 } from '../types'

// Mock fiel ao JSON de `/api/catalogo/publico` (Fase 1) — usado somente em
// `vite dev` quando o servidor local do ERP não está ligado. Nunca em produção.

function svgPlaceholder(cor: string, rotulo: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${cor}"/><text x="300" y="310" font-family="Arial, sans-serif" font-size="34" fill="#ffffff" text-anchor="middle">${rotulo}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const cores = ['#8a5a2b', '#5b7c5b', '#b3552c', '#46586e', '#7c4d2d', '#3f6f6a', '#80623c', '#6e4a5f']

export const MOCK_CATALOGO: CatalogoPublicoV1 = {
  version: 1,
  generatedAt: new Date().toISOString(),
  loja: {
    nome: 'Shisha Store',
    whatsapp: '(41) 99999-0000',
    endereco: 'Rua das Flores, 123 — Centro',
    horario: '10h às 22h'
  },
  categorias: [
    { id: 1, nome: 'Essências' },
    { id: 2, nome: 'Acessórios' },
    { id: 3, nome: 'Carvão' },
    { id: 4, nome: 'Narguilés' }
  ],
  produtos: [
    { id: 1, nome: 'Essência Al Fakher 50g — Melancia', descricao: 'Essência premium para narguilé, sabor intenso.', categoria: 'Essências', categoria_id: 1, subcategoria: null, marca: 'Al Fakher', preco: 59.9, preco_promo: 49.9, tem_promo: true, disponivel: true, estoque: 20, ordem: 1, imagem: 1 },
    { id: 2, nome: 'Essência Zomo 50g — Menta Selvagem', descricao: 'Menta refrescante e duradoura.', categoria: 'Essências', categoria_id: 1, subcategoria: null, marca: 'Zomo', preco: 39.9, preco_promo: null, tem_promo: false, disponivel: true, estoque: 15, ordem: 2, imagem: 2 },
    { id: 3, nome: 'Bowl Funil de Vidro', descricao: 'Cabeça de vidro para narguilé, encaixe universal.', categoria: 'Acessórios', categoria_id: 2, subcategoria: null, marca: 'Innox', preco: 79.9, preco_promo: 69.9, tem_promo: true, disponivel: true, estoque: 8, ordem: 3, imagem: 3 },
    { id: 4, nome: 'Mangueira Siliconada 2m', descricao: 'Mangueira flexível com bocal de silicone.', categoria: 'Acessórios', categoria_id: 2, subcategoria: null, marca: 'Myasys', preco: 49.9, preco_promo: null, tem_promo: false, disponivel: true, estoque: 0, ordem: 4, imagem: 4 },
    { id: 5, nome: 'Carvão Natural 1kg', descricao: 'Carvão de coco natural para narguilé.', categoria: 'Carvão', categoria_id: 3, subcategoria: null, marca: 'Coco Nara', preco: 34.9, preco_promo: null, tem_promo: false, disponivel: true, estoque: 30, ordem: 5, imagem: null },
    { id: 6, nome: 'Carvão Rápido 1kg', descricao: 'Acendimento rápido, sem cheiro.', categoria: 'Carvão', categoria_id: 3, subcategoria: null, marca: 'Prince', preco: 29.9, preco_promo: 24.9, tem_promo: true, disponivel: false, estoque: 0, ordem: 6, imagem: 6 },
    { id: 7, nome: 'Narguilé Babylon 80cm', descricao: 'Narguilé completo com base de vidro.', categoria: 'Narguilés', categoria_id: 4, subcategoria: null, marca: 'Babylon', preco: 299.9, preco_promo: null, tem_promo: false, disponivel: true, estoque: 3, ordem: 7, imagem: 7 },
    { id: 8, nome: 'Narguilé Myasys 40cm', descricao: 'Narguilé compacto de alumínio.', categoria: 'Narguilés', categoria_id: 4, subcategoria: null, marca: 'Myasys', preco: 349.9, preco_promo: 319.9, tem_promo: true, disponivel: true, estoque: 5, ordem: 8, imagem: 8 }
  ]
}

// As chaves seguem o ID da IMAGEM (campo `imagem` do produto), pois é o que
// a API real usa em /api/imagem/:id — assim o mock espelha o fluxo real.
export const MOCK_IMAGENS: Record<number, string> = Object.fromEntries(
  MOCK_CATALOGO.produtos.filter((p) => p.imagem !== null).map((p) => [p.imagem as number, svgPlaceholder(cores[(p.id as number) % cores.length], p.nome)])
)