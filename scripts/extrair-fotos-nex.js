// Extrai todas as fotos de produtos embutidas no Produto.nx1 do Nex e salva
// como arquivos físicos reutilizáveis (<hash32hex>.png/.jpg) + manifesto
// ligando hash -> produto (código/nome/guid) para importação futura.
//
// Uso: node scripts/extrair-fotos-nex.js [origem] [destino]
//   origem  = pasta com os .nx1 (padrão: D:\backup nex\Nex\Dados)
//   destino = pasta de saída     (padrão: D:\backup nex\fotos_nex)
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const origemPadrao = 'D:\\backup nex\\Nex\\Dados';
const destinoPadrao = 'D:\\backup nex\\fotos_nex';
const args = process.argv.slice(2);
const origem = args[0] ? path.resolve(args[0]) : origemPadrao;
const destino = args[1] ? path.resolve(args[1]) : destinoPadrao;

const arquivoProduto = path.join(origem, 'Produto.nx1');
const arquivoCatalogo = path.join(origem, 'catalogo_json.nx1');
if (!fs.existsSync(arquivoProduto)) {
    console.error('Nao achou Produto.nx1 em:', arquivoProduto);
    process.exit(1);
}

const ehHex = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x61 && b <= 0x66) || (b >= 0x41 && b <= 0x46);

// Varre o binário do Produto.nx1 e devolve Map hash32hex->bytes com a foto REAL
// de cada produto, vinculada ao seu ImagemMD5/ImagemUrl (run 32 hex no registro).
// A imagem fica logo ANTES do campo ImagemMD5/ImagemUrl; troca o antigo chute
// posicional (hash hex imediatamente antes da imagem) que gerava fotos erradas/corrompidas.
function extrairImagensProdutoNx1(buf) {
    const map = new Map();
    const total = buf.length;
    // Fim de um PNG: primeiro chunk IEND bem-formado (len 0 + 'IEND') a partir do
    // magic. Os IDAT do Nex vêm intercalados com metadados da tabela, então não
    // dá para atravessar chunk a chunk — busca o marcador estruturado.
    const fimPng = (off) => {
        const janela = Math.min(total, off + 8 * 1024 * 1024);
        for (let p = off + 8; p + 12 <= janela; p++) {
            if (buf[p] === 0x49 && buf[p + 1] === 0x45 && buf[p + 2] === 0x4e && buf[p + 3] === 0x44 &&
                buf[p - 4] === 0 && buf[p - 3] === 0 && buf[p - 2] === 0 && buf[p - 1] === 0) {
                return p + 8;
            }
        }
        return -1;
    };
    // Fim de um JPG: primeiro marcador EOI (FF D9) literal após o SOI (janela ampla,
    // sem truncar blobs grandes; FF D9 dentro dos dados vem com byte-stuff FF 00).
    const fimJpg = (off) => {
        const janela = Math.min(total, off + 8 * 1024 * 1024);
        for (let p = off + 2; p + 2 <= janela; p++) {
            if (buf[p] === 0xff && buf[p + 1] === 0xd9)
                return p + 2;
        }
        return -1;
    };
    const assina = (off) => {
        const png = buf[off] === 0x89 && buf[off + 1] === 0x50 && buf[off + 2] === 0x4e && buf[off + 3] === 0x47;
        const jpg = buf[off] === 0xff && buf[off + 1] === 0xd8 && buf[off + 2] === 0xff;
        return png ? 'png' : jpg ? 'jpg' : null;
    };
    // 1) todos os inícios de imagem
    const starts = [];
    for (let i = 0; i + 8 <= total; i++) {
        const ext = assina(i);
        if (ext)
            starts.push({ off: i, ext });
    }
    // 2) todos os Ids de imagem (ImagemMD5/ImagemUrl = run 32 hex ASCII isolado)
    const ids = [];
    for (let i = 0; i + 32 <= total; i++) {
        const h = buf.toString('ascii', i, i + 32);
        if (!/^[0-9a-fA-F]{32}$/.test(h))
            continue;
        const b = i > 0 ? buf[i - 1] : -1;
        const a = i + 32 < total ? buf[i + 32] : -1;
        if ((b !== -1 && ehHex(b)) || (a !== -1 && ehHex(a)))
            continue;
        ids.push({ off: i, h: h.toLowerCase() });
    }
    // Remove NX1 page headers (NXHD 20 bytes + 2 null bytes = 22 bytes por pagina
    // de 4096 bytes) intercalados com os dados de imagem no NX1 binario.
    const removerNxhd = (from, to) => {
        const nxhd = [];
        for (let i = from; i + 20 <= to; i++) {
            if (buf[i] === 0x4e && buf[i + 1] === 0x58 && buf[i + 2] === 0x48 && buf[i + 3] === 0x44)
                nxhd.push(i);
        }
        if (nxhd.length === 0) return buf.slice(from, to);
        const cleanLen = to - from - nxhd.length * 22;
        if (cleanLen <= 0) return buf.slice(from, to);
        const out = Buffer.allocUnsafe(cleanLen);
        let w = 0, r = from;
        for (const nx of nxhd) {
            const rmStart = nx - 2;
            if (rmStart > r) { buf.copy(out, w, r, rmStart); w += rmStart - r; }
            r = nx + 20;
        }
        if (r < to) { buf.copy(out, w, r, to); w += to - r; }
        return out.slice(0, w);
    };
    // 3) associa cada Id à imagem do MESMO registro (foto logo ANTES do campo
    //    ImagemMD5/ImagemUrl), com distância limitada p/ não roubar do registro anterior.
    const WIN = 1 * 1024 * 1024;
    for (const id of ids) {
        let lo = 0, hi = starts.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid].off <= id.off) lo = mid + 1; else hi = mid; }
        const antes = lo - 1;
        if (antes < 0)
            continue;
        const s = starts[antes];
        const d = id.off - s.off;
        if (d < 64 || d > WIN)
            continue;
        const fim = s.ext === 'png' ? fimPng(s.off) : fimJpg(s.off);
        if (fim === -1 || fim <= s.off + 50)
            continue;
        const bytes = removerNxhd(s.off, fim);
        if (!assina(s.off))
            continue;
        if (!map.has(id.h))
            map.set(id.h, bytes);
    }
    return map;
}

// Parseia blobs JSON UTF-16LE do catalogo_json.nx1 (campo `{` + 0x00), igual ao
// importador. Devolve lista de objetos de produto com os campos do Nex.
function extrairCatalogoJson(buf) {
    const tam = buf.length;
    const produtos = [];
    let i = buf.indexOf(0x7b);
    while (i !== -1 && i + 1 < tam) {
        if (buf[i + 1] !== 0x00) { i = buf.indexOf(0x7b, i + 1); continue; }
        let fim = -1;
        let depth = 0;
        let inStr = false;
        let esc = false;
        for (let j = i; j + 1 < tam; j += 2) {
            const code = buf[j] | (buf[j + 1] << 8);
            if (inStr) {
                if (esc) esc = false;
                else if (code === 0x5c) esc = true;
                else if (code === 0x22) inStr = false;
            }
            else {
                if (code === 0x22) inStr = true;
                else if (code === 0x7b) depth++;
                else if (code === 0x7d) {
                    depth--;
                    if (depth === 0) { fim = j + 2; break; }
                }
            }
        }
        if (fim === -1) { i = buf.indexOf(0x7b, i + 1); continue; }
        const texto = buf.toString('utf16le', i, fim);
        let parsed = null;
        try { parsed = JSON.parse(texto); } catch { i = buf.indexOf(0x7b, i + 1); continue; }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const p = parsed;
            if (p.ProductName || p.ProductCode) produtos.push(p);
        }
        i = buf.indexOf(0x7b, fim + 1);
    }
    return produtos;
}

const normalizarHash = (s) => String(s ?? '').trim().toLowerCase().replace(/[{}]/g, '');

async function main() {
    console.log(`Lendo ${arquivoProduto}...`);
    const t0 = Date.now();
    const imagens = (() => {
        const bufProduto = fs.readFileSync(arquivoProduto);
        return extrairImagensProdutoNx1(bufProduto);
    })(); // buffer grande liberado ao sair do escopo
    console.log(`Scan Produto.nx1: ${imagens.size} imagens em ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    console.log(`Lendo ${arquivoCatalogo}...`);
    const bufCatalogo = fs.readFileSync(arquivoCatalogo);
    const produtos = extrairCatalogoJson(bufCatalogo);
    console.log(`Catalogo: ${produtos.length} produtos`);

    fs.mkdirSync(destino, { recursive: true });
    let gravadas = 0;
    let jaExistem = 0;
    const fotos = {};
    for (const [hash, bytes] of imagens) {
        const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
        const ext = png ? '.png' : '.jpg';
        const nome = hash + ext;
        const caminho = path.join(destino, nome);
        const ex = fs.existsSync(caminho);
        if (!ex) {
            fs.writeFileSync(caminho, bytes);
            gravadas++;
        }
        else {
            const tamanho = fs.statSync(caminho).size;
            if (tamanho !== bytes.length) {
                fs.writeFileSync(caminho, bytes);
                gravadas++;
            }
            else {
                jaExistem++;
            }
        }
        fotos[hash] = { arquivo: nome, bytes: bytes.length };
    }

    // Liga hash -> produtos do catálogo (um hash pode servir a vários produtos)
    const hashParaProdutos = new Map();
    const registros = [];
    for (const p of produtos) {
        const hashes = [];
        const prim = normalizarHash(p.ProductImg);
        if (prim) hashes.push(prim);
        const photos = p.Photos;
        if (Array.isArray(photos)) {
            for (const ph of photos) {
                const k = normalizarHash(ph);
                if (k) hashes.push(k);
            }
        }
        if (hashes.length === 0) continue;
        const codigo = p.ProductCode != null ? String(p.ProductCode).trim() : null;
        const nome = p.ProductName != null ? String(p.ProductName).trim() : null;
        const guid = p.ProductUId != null ? String(p.ProductUId).replace(/[{}]/g, '').toLowerCase() : null;
        const ean = p.ProductEAN != null ? String(p.ProductEAN).trim() : (p.EAN != null ? String(p.EAN).trim() : null);
        const registro = {
            codigo,
            nome,
            ean,
            guid,
            categoria: p.Category != null ? String(p.Category).trim() : null,
            marca: p.Brand != null ? String(p.Brand).trim() : null,
            preco_venda: p.SalePrice != null ? p.SalePrice : null,
            estoque: p.CurrentStock != null ? p.CurrentStock : null,
            hashes
        };
        registros.push(registro);
        for (const h of hashes) {
            if (!hashParaProdutos.has(h)) hashParaProdutos.set(h, []);
            hashParaProdutos.get(h).push({ codigo, nome, guid });
        }
    }

    const comFoto = registros.filter((r) => r.hashes.some((h) => imagens.has(h)));
    const semFoto = registros.filter((r) => !r.hashes.some((h) => imagens.has(h)));
    const codigosSemFoto = [];
    for (const r of semFoto) {
        for (const h of r.hashes) if (!imagens.has(h)) codigosSemFoto.push({ codigo: r.codigo, nome: r.nome, hash: h });
    }

    const manifesto = {
        gerado_em: new Date().toISOString(),
        origem: origem,
        estatisticas: {
            produtos: registros.length,
            produtos_com_foto: comFoto.length,
            produtos_sem_foto: semFoto.length,
            fotos_unicas: fotos,
            fotos_referenciadas_sem_arquivo: codigosSemFoto.length,
        },
        fotos,
        fotos_referenciadas_sem_arquivo: codigosSemFoto.slice(0, 5000),
        produtos_com_foto: comFoto,
        produtos_sem_foto: semFoto,
        hash_para_produtos: Object.fromEntries(hashParaProdutos)
    };
    fs.writeFileSync(path.join(destino, 'manifesto.json'), JSON.stringify(manifesto, null, 2));

    console.log('---');
    console.log(`Fotos gravadas       : ${gravadas}`);
    console.log(`Ja existiam iguais   : ${jaExistem}`);
    console.log(`Total arquivos fotos : ${imagens.size}`);
    console.log(`Produtos catalogados : ${registros.length}`);
    console.log(`Produtos com foto    : ${comFoto.length}`);
    console.log(`Produtos sem foto    : ${semFoto.length}`);
    console.log(`Hashes referenciados sem arquivo: ${codigosSemFoto.length}`);
    console.log(`Destino: ${destino}`);
    if (codigosSemFoto.length) {
        console.log('  Ex.:', codigosSemFoto.slice(0, 5).map((x) => `${x.codigo ?? '?'} ${x.nome ?? ''} -> ${x.hash}`).join(' | '));
    }
}

main().catch((e) => { console.error(e); process.exit(1); });