// Extrai todas as fotos de produtos do Produto.nx1 (formato NX1 binario com
// NXHD headers intercalados) do nexbackuptotal e salva como imagens limpas.
//
// Descoberta: o Nex armazena imagens em "paginas" de 4096 bytes, com
// headers NXHD (20 bytes) + null pad (2 bytes) intercalados a cada 4KB.
// A extracao precisa remover esses headers para gerar imagens validas.
//
// Uso: node scripts/extrair-fotos-nx1-limpo.js [origem] [destino]
//   origem  = pasta com Dados/ (padrao: D:\sistema loja tabacaria\nexbackuptotal\Dados)
//   destino = pasta de saida    (padrao: D:\backup nex\fotos_nex)
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const origemPadrao = 'D:\\sistema loja tabacaria\\nexbackuptotal\\Dados';
const destinoPadrao = 'D:\\backup nex\\fotos_nex';
const args = process.argv.slice(2);
const origem = args[0] ? path.resolve(args[0]) : origemPadrao;
const destino = args[1] ? path.resolve(args[1]) : destinoPadrao;

const arquivoProduto = path.join(origem, 'Produto.nx1');
if (!fs.existsSync(arquivoProduto)) {
  console.error('Nao achou Produto.nx1 em:', arquivoProduto);
  process.exit(1);
}

fs.mkdirSync(destino, { recursive: true });

console.log(`[nx1-limpo] origem:  ${origem}`);
console.log(`[nx1-limpo] destino: ${destino}`);

const buf = fs.readFileSync(arquivoProduto);
const total = buf.length;
console.log(`[nx1-limpo] Produto.nx1: ${(total / 1024 / 1024).toFixed(1)} MB`);

// --- helpers ---

const ehHex = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x61 && b <= 0x66) || (b >= 0x41 && b <= 0x46);

function assina(off) {
  if (buf[off] === 0x89 && buf[off+1] === 0x50 && buf[off+2] === 0x4e && buf[off+3] === 0x47) return 'png';
  if (buf[off] === 0xff && buf[off+1] === 0xd8 && buf[off+2] === 0xff) return 'jpg';
  return null;
}

function fimImg(off, ext) {
  const jan = Math.min(total, off + 8 * 1024 * 1024);
  if (ext === 'png') {
    for (let p = off + 8; p + 12 <= jan; p++) {
      if (buf[p] === 0x49 && buf[p+1] === 0x45 && buf[p+2] === 0x4e && buf[p+3] === 0x44 &&
          buf[p-4] === 0 && buf[p-3] === 0 && buf[p-2] === 0 && buf[p-1] === 0)
        return p + 8;
    }
    return -1;
  }
  for (let p = off + 2; p + 2 <= jan; p++)
    if (buf[p] === 0xff && buf[p+1] === 0xd9) return p + 2;
  return -1;
}

// Encontra todos os NXHD markers dentro de uma faixa (para remocao)
function findNxhd(from, to) {
  const hits = [];
  for (let i = from; i + 20 <= to; i++) {
    if (buf[i] === 0x4e && buf[i+1] === 0x58 && buf[i+2] === 0x48 && buf[i+3] === 0x44) {
      hits.push(i);
    }
  }
  return hits;
}

// Remove headers NXHD (22 bytes cada: 2 null + 20 NXHD) de uma faixa,
// retornando os dados de imagem limpos.
function removerNxhd(off, fim) {
  const nxhds = findNxhd(off, fim);
  if (nxhds.length === 0) return Buffer.from(buf.slice(off, fim));

  const cleanLen = fim - off - nxhds.length * 22;
  if (cleanLen <= 0) return null;

  const result = Buffer.alloc(cleanLen);
  let w = 0, r = off;
  for (const nx of nxhds) {
    const removeStart = nx - 2;
    if (removeStart > r) {
      buf.copy(result, w, r, removeStart);
      w += removeStart - r;
    }
    r = nx + 20;
  }
  if (r < fim) {
    buf.copy(result, w, r, fim);
    w += fim - r;
  }
  return result.slice(0, w);
}

// --- etapa 1: inicios de imagem ---
console.log('[nx1-limpo] varrendo inicios de imagem...');
const starts = [];
for (let i = 0; i + 4 <= total; i++) {
  const ext = assina(i);
  if (ext) starts.push({ off: i, ext });
}
const startsPos = starts.map((x) => x.off);
const startsExt = starts.map((x) => x.ext);
console.log(`[nx1-limpo] blobs encontrados: ${starts.length} (${starts.filter(x=>x.ext==='jpg').length} JPG, ${starts.filter(x=>x.ext==='png').length} PNG)`);

// --- etapa 2: hashes via URL (mais confiavel) ---
console.log('[nx1-limpo] extraindo hashes das URLs...');
const s = buf.toString('latin1');
const reUrl = /storage\.googleapis\.com\/nexapp-flutter\.appspot\.com\/production\/products\/([0-9a-fA-F]{32})/g;
const urlHashes = new Map();
{
  let m;
  while ((m = reUrl.exec(s))) {
    const h = m[1].toLowerCase();
    if (!urlHashes.has(h)) urlHashes.set(h, m.index);
  }
}
console.log(`[nx1-limpo] hashes unicos via URL: ${urlHashes.size}`);

// --- etapa 3: hashes inline (32 hex isolados, complemento) ---
console.log('[nx1-limpo] varrendo hashes inline...');
const inlineHashes = new Map();
for (let i = 0; i + 32 <= total; i++) {
  const h = buf.toString('ascii', i, i + 32);
  if (!/^[0-9a-fA-F]{32}$/.test(h)) continue;
  const b = i > 0 ? buf[i - 1] : -1;
  const a = i + 32 < total ? buf[i + 32] : -1;
  if ((b !== -1 && ehHex(b)) || (a !== -1 && ehHex(a))) continue;
  const hl = h.toLowerCase();
  if (!inlineHashes.has(hl)) inlineHashes.set(hl, i);
}
console.log(`[nx1-limpo] hashes inline (unicos): ${inlineHashes.size}`);

// Merge: URL hashes sao primarios, inline complementa
const allHashes = new Map([...urlHashes, ...inlineHashes]);
console.log(`[nx1-limpo] total hashes para extrair: ${allHashes.size}`);

// --- etapa 4: extrair cada imagem associada a um hash ---
console.log('[nx1-limpo] extraindo imagens limpas...');
let ok = 0, falha = 0, pulado = 0, duplicado = 0;
const HASHES = [...allHashes.entries()];
const WIN = 1 * 1024 * 1024;

for (let idx = 0; idx < HASHES.length; idx++) {
  const [hash, hashOff] = HASHES[idx];

  // encontra blob de imagem mais proximo ANTES do hash
  let lo = 0, hi = startsPos.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (startsPos[mid] <= hashOff) lo = mid + 1; else hi = mid; }
  const bi = lo - 1;
  if (bi < 0) { pulado++; continue; }

  const dist = hashOff - startsPos[bi];
  if (dist < 1 || dist > WIN) { pulado++; continue; }

  const ext = startsExt[bi];
  const f = fimImg(startsPos[bi], ext);
  if (f === -1 || f <= startsPos[bi] + 50) { falha++; continue; }

  const outFile = path.join(destino, `${hash}.${ext}`);
  if (fs.existsSync(outFile)) { duplicado++; continue; }

  // extrair e remover NXHD
  const clean = removerNxhd(startsPos[bi], f);
  if (!clean || clean.length < 300) { falha++; continue; }

  fs.writeFileSync(outFile, clean);
  ok++;

  if ((idx + 1) % 200 === 0 || idx === HASHES.length - 1) {
    console.log(`  [${idx + 1}/${HASHES.length}] ok=${ok} falha=${falha} pulado=${pulado} dup=${duplicado}`);
  }
}

console.log(`\n[nx1-limpo] === RESULTADO FINAL ===`);
console.log(`  total hashes: ${allHashes.size}`);
console.log(`  imagens salvas (limpas): ${ok}`);
console.log(`  falhas: ${falha}`);
console.log(`  pulados (sem blob proximo): ${pulado}`);
console.log(`  ja existentes: ${duplicado}`);

// --- etapa 5: validacao amostral com sharp (opcional) ---
(async () => {
  try {
    const sharp = require('D:/sistema loja tabacaria/node_modules/sharp');
    console.log('\n[nx1-limpo] validacao amostral (10 imagens aleatorias)...');
    const files = fs.readdirSync(destino).filter((f) => /\.(jpg|png)$/.test(f));
    const sample = files.sort(() => Math.random() - 0.5).slice(0, 10);
    let valid = 0, invalid = 0;
    for (const f of sample) {
      try {
        const meta = await sharp(path.join(destino, f)).metadata();
        valid++;
      } catch {
        invalid++;
        console.log(`  INVALIDA: ${f}`);
      }
    }
    console.log(`  validas: ${valid}/${sample.length}`);
  } catch (e) {
    console.log('[nx1-limpo] sharp nao disponivel para validacao:', e.message.split('\n')[0]);
  }
  console.log('\n[nx1-limpo] concluido.');
})();
