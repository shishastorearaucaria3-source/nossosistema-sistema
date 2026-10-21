// Sync standalone: lê SQLite local e envia ao Worker (D1/R2) em lotes.
// Uso: node scripts/sync-catalogo.mjs <dbPath> <workerUrl> <tokenArquivo> [chunkSize] [--sem-imagens]
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const [dbPath, workerUrl, tokenArquivo] = process.argv.slice(2);
const semImagens = process.argv.includes('--sem-imagens');
const chunkSize = Number(process.argv[5] || 150);
if (!dbPath || !workerUrl || !tokenArquivo) {
  console.error('Uso: node scripts/sync-catalogo.mjs <dbPath> <workerUrl> <tokenArquivo> [chunkSize]');
  process.exit(1);
}

const token = readFileSync(tokenArquivo, 'utf8').trim();
if (!token) { console.error('Token vazio.'); process.exit(1); }

const db = new DatabaseSync(dbPath);

function pegarConfig(chave) {
  try {
    const r = db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
    return r?.valor ?? '';
  } catch { return ''; }
}

function getZonas() {
  try {
    const rows = db.prepare('SELECT id, nome, preco, ceps FROM zonas_entrega WHERE ativo = 1 ORDER BY preco, nome').all();
    return rows.map((z) => {
      let ceps = [];
      if (typeof z.ceps === 'string' && z.ceps) {
        try {
          const parsed = JSON.parse(z.ceps);
          if (Array.isArray(parsed)) ceps = parsed.map(String).filter((c) => c.length >= 3);
        } catch { /* ignore */ }
      }
      return { id: z.id, nome: z.nome, preco: z.preco, ceps };
    });
  } catch { return []; }
}

function detectarExtensao(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return 'jpg';
}

const nomeLoja = pegarConfig('nome_loja') || 'Loja';
const loja = { nome_loja: nomeLoja };
const whatsapp = pegarConfig('telefone_loja');
if (whatsapp) loja.whatsapp = whatsapp;
const endereco = pegarConfig('endereco_loja');
if (endereco) loja.endereco = endereco;
const horario = pegarConfig('horario_funcionamento');
if (horario) loja.horario = horario;
loja.manutencao_ativos = pegarConfig('manutencao_ativos') === '1';
loja.pedidos_ativos = (pegarConfig('pedidos_ativos') || '1') === '1';
loja.aceita_entrega = (pegarConfig('aceita_entrega') || '1') === '1';
loja.aceita_retirada = pegarConfig('aceita_retirada') === '1';
loja.taxa_entrega = Number(pegarConfig('taxa_entrega')) || 0;
loja.mostrar_estoque = pegarConfig('catalogo_mostrar_estoque') !== '0';
loja.sem_estoque = pegarConfig('catalogo_sem_estoque') || 'manter';

const categorias = db.prepare('SELECT id, nome FROM categorias ORDER BY nome').all();

const produtoRows = db.prepare(
  `SELECT p.id, p.nome, p.descricao, p.categoria_id, s.nome AS subcategoria,
          m.nome AS marca, p.preco_venda AS preco, p.preco_promo, p.promocional,
          p.estoque, p.catalogo_ordem AS ordem, p.ativo, p.catalogo_publicado,
          (p.imagem IS NOT NULL AND length(p.imagem) > 0) AS tem_imagem
   FROM produtos p
   LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
   LEFT JOIN marcas m ON m.id = p.marca_id
   WHERE p.ativo = 1 AND p.catalogo_publicado = 1
   ORDER BY p.catalogo_ordem, p.nome`
).all();

const zonas = getZonas();

let enviados = 0;
let imagens = 0;

async function enviar(payload, rotulo) {
  let tentativa = 0;
  while (true) {
    try {
      const res = await fetch(`${workerUrl}/api/catalogo/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        console.log(`lote ${rotulo}: HTTP ${res.status}`);
        return;
      }
      const body = await res.text();
      const retryavel = res.status === 503 || res.status === 520 || res.status === 524 || res.status === 429;
      if (!retryavel) {
        console.error(`ERRO lote ${rotulo}: HTTP ${res.status}`, body.slice(0, 300));
        process.exit(1);
      }
      console.warn(`lote ${rotulo}: HTTP ${res.status} (retryable), tentativa ${tentativa + 1}`);
    } catch (e) {
      console.warn(`lote ${rotulo}: falha de rede (${e.message}), tentativa ${tentativa + 1}`);
    }
    tentativa++;
    if (tentativa >= 8) {
      console.error(`lote ${rotulo}: desistiu após 8 tentativas`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 3000 * tentativa));
  }
}

// Lote 1: limpa + metadata + categorias + zonas + primeiro chunk de produtos
let idx = 0;
const totalChunks = Math.ceil(produtoRows.length / chunkSize);
let chunk = 1;

while (idx < produtoRows.length) {
  const fatia = produtoRows.slice(idx, idx + chunkSize).map((r) => {
    let imagem_b64 = null;
    let imagem_ext = null;
    if (!semImagens && r.tem_imagem) {
      try {
        const row = db.prepare('SELECT imagem FROM produtos WHERE id = ?').get(r.id);
        if (row?.imagem && row.imagem.length > 0) {
          const buf = Buffer.from(row.imagem);
          imagem_ext = detectarExtensao(buf);
          imagem_b64 = buf.toString('base64');
          imagens++;
        }
      } catch { /* ignore */ }
    }
    return {
      id: r.id,
      nome: r.nome,
      descricao: r.descricao,
      categoria_id: r.categoria_id,
      subcategoria: r.subcategoria,
      marca: r.marca,
      preco: r.preco,
      preco_promo: r.promocional ? r.preco_promo : null,
      tem_promo: !!(r.promocional && r.preco_promo && r.preco_promo > 0),
      disponivel: r.estoque > 0,
      estoque: r.estoque,
      ordem: r.ordem,
      imagem_b64,
      imagem_ext,
    };
  });

  const ultimo = idx + chunkSize >= produtoRows.length;
  const payload = {
    limpar: chunk === 1,
    final: ultimo,
    ...(chunk === 1 ? { loja, categorias, zonas } : {}),
    produtos: fatia,
  };
  await enviar(payload, `${chunk}/${totalChunks}`);
  enviados += fatia.length;
  idx += chunkSize;
  chunk++;
}

console.log(`\nSync concluído. ${enviados} produtos, ${imagens} imagens, ${categorias.length} categorias, ${zonas.length} zonas.`);
