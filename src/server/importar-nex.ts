// @ts-nocheck
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const index_1 = require("./index");
const servidor_1 = require("./servidor");
const nex_binary_1 = require("./nex-binary");
const adm_zip_1 = __importDefault(require("adm-zip"));
const unzipper_1 = require("unzipper");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
// Arquivos que o importador realmente lê. O resto é preservado cru (e os
// grandes, como cloud_cache/cloud_json/Doc/~500MB, NÃO são descompactados:
// carregavam ~4GB de buffers na memória e travavam o servidor).
const ARQUIVOS_NECESSARIOS = new Set([
    'catalogo_json.nx1', 'cliente.nx1', 'categoria.nx1', 'marca.nx1', 'subcategoria.nx1',
    'unidade.nx1', 'usuario.nx1', 'caixa.nx1', 'produto.nx1', 'card.nx1', 'ncm.nx1', 'br_cest.nx1',
    'cfop.nx1', 'tran.nx1', 'movest.nx1', 'pagespecies.nx1', 'registrosremovidos.nx1',
    'syslog.nx1', 'terminal.nx1'
]);
const NAO_CARCAR_ACIMA_DE = 150 * 1024 * 1024;
let progresso = { ativo: false, etapa: '', atual: 0, total: 0, mensagem: '', iniciadoEm: 0 };
function getProgressoNex() {
    return {
        ...progresso,
        desde: progresso.iniciadoEm,
        decorrido: progresso.ativo ? Date.now() - progresso.iniciadoEm : 0
    };
}
function atualizarProgresso(p) {
    const antes = progresso.ativo;
    progresso = { ...progresso, ...p };
    if (!antes && progresso.ativo)
        progresso.iniciadoEm = Date.now();
}
const pausar = () => new Promise((resolve) => setImmediate(resolve));
// Cooperação: cede o event loop periodicamente durante varreduras longas para a
// janela do servidor continuar respondendo ao poll de progresso (setImmediate
// sozinho não basta em loops CPU-intensivos de buffers de centenas de MB).
let ultimoYield = 0;
async function cooperar(contador, inicio) {
    if (contador % 2000 === 0 || Date.now() - ultimoYield > 60) {
        ultimoYield = Date.now();
        await pausar();
    }
    void inicio;
}
function decodificarUtf16(buf, off, maxBytes) {
    let s = '';
    const fim = Math.min(buf.length, off + maxBytes);
    for (let i = off; i + 1 < fim; i += 2) {
        const code = buf[i] | (buf[i + 1] << 8);
        if (code === 0)
            break;
        s += String.fromCharCode(code);
    }
    return s;
}
function extrairStringsUtf16(buf) {
    const strs = [];
    for (let i = 0; i + 1 < buf.length; i++) {
        const code = buf[i] | (buf[i + 1] << 8);
        if ((code >= 0x20 && code < 0x7f) || (code >= 0x00c0 && code <= 0x00ff)) {
            let j = i;
            const chars = [];
            while (j + 1 < buf.length) {
                const c = buf[j] | (buf[j + 1] << 8);
                if (c >= 0x20 && c < 0x7f) {
                    chars.push(c);
                    j += 2;
                }
                else if (c >= 0x00c0 && c <= 0x00ff) {
                    chars.push(c);
                    j += 2;
                }
                else
                    break;
            }
            if (chars.length >= 3) {
                strs.push({ off: i, par: i % 2, s: String.fromCharCode(...chars), len: chars.length });
                i = j - 1;
            }
        }
    }
    return strs;
}
// Detecta a paridade canônica (offset em que costumam começar as strings de
// texto UTF-16 alinhado) e reextrai apenas as strings dessa paridade.
// No Cliente.nx1, por exemplo, os nomes/campos alinhados ficam em offsets
// ímpares precedidos do byte-flag 0xFE; ler a partir da outra paridade gera
// lixo desalinhado (prefixo "ü", nomes concatenados tipo "Adriano abriel...").
function extrairStringsUtf16Alinhado(buf) {
    const crudes = extrairStringsUtf16(buf);
    if (!crudes.length)
        return crudes;
    let comFe = [0, 0], total = [0, 0];
    for (const s of crudes) {
        total[s.par]++;
        if (s.off > 0 && buf[s.off - 1] === 0xfe)
            comFe[s.par]++;
    }
    // Paridade canônica = aquela cujas strings quase todas são precedidas do flag.
    const parada = comFe[1] >= comFe[0] ? 1 : 0;
    return crudes.filter(s => s.par === parada);
}
function extrairProdutosDoCatalogo(buf) {
    const tam = buf.length;
    const produtos = [];
    for (let i = 0; i + 1 < tam; i++) {
        if (buf[i] === 0x7b && buf[i + 1] === 0x00) {
            let fim = -1;
            let depth = 0;
            let inStr = false;
            let esc = false;
            for (let j = i; j + 1 < tam; j += 2) {
                const code = buf[j] | (buf[j + 1] << 8);
                if (inStr) {
                    if (esc)
                        esc = false;
                    else if (code === 0x5c)
                        esc = true;
                    else if (code === 0x22)
                        inStr = false;
                }
                else {
                    if (code === 0x22)
                        inStr = true;
                    else if (code === 0x7b)
                        depth++;
                    else if (code === 0x7d) {
                        depth--;
                        if (depth === 0) {
                            fim = j + 2;
                            break;
                        }
                    }
                }
            }
            if (fim === -1)
                continue;
            const texto = decodificarUtf16(buf, i, fim - i);
            let parsed = null;
            try {
                parsed = JSON.parse(texto);
            }
            catch {
                continue;
            }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const p = parsed;
                if (p.ProductName || p.ProductCode)
                    produtos.push(p);
            }
            i = fim;
        }
    }
    return produtos;
}
function ehCPF(s) { return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(s) || /^\d{11}$/.test(s); }
function ehRG(s) { return /^\d[\d.]*\d-\d$/.test(s) && s.length >= 6; }
function ehCEP(s) { return /^\d{5}-\d{3}$/.test(s); }
function ehUF(s) { return UFS.has(s.toUpperCase()) && s.length === 2; }
function ehEmail(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }
function ehRua(s) { return /^(R\.|Rua|Av\.|Avenida|Travessa|Alameda|Rod\.|Rodovia|Estrada|Praça)/i.test(s); }
function ehNome(s) { return /^[A-Za-zÀ-ÿ]/.test(s) && s.length > 3 && !ehCPF(s) && !ehRG(s) && !ehCEP(s) && !ehUF(s) && !ehEmail(s) && !/^\d{1,6}$/.test(s); }
function ehRuido(s) { return s.length === 2 && /[^A-Za-zÀ-ÿ0-9 .\-/,()+]/.test(s); }
function ehTelDig(s) { return /^\d{8,11}$/.test(s); }
async function extrairClientes(buf) {
    const strs = extrairStringsUtf16Alinhado(buf);
    const registros = [];
    for (const s of strs) {
        const m = s.s.match(/^(\d{1,7})([A-Za-zÀ-ÿ].*)$/);
        const t = s.s.trim();
        const soLetras1Palavra = /^[A-Za-zÀ-ÿ]{3,22}$/.test(t);
        const multiPalavra = /\s/.test(t) && /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'\-]*$/.test(t)
            && !/^(R\.|Rua|Av\.|Avenida|Travessa|Alameda|Rod\.|Rodovia|Estrada|Praça)/i.test(t)
            && !/@/.test(t);
        const nomePuro = soLetras1Palavra || multiPalavra;
        if ((m && m[2].length >= 3 && m[2].length <= 90 && /[a-zà-ÿ]/.test(m[2]))
            || (nomePuro && t.length <= 90 && /[a-zà-ÿA-ZÀ-Ý]/.test(t)))
            registros.push(s);
    }
    registros.sort((a, b) => a.off - b.off);
    const clientes = [];
    let resp = 0;
    for (let i = 0; i < registros.length; i++) {
        await cooperar(++resp, i);
        const reg = registros[i];
        const fim = Math.min(i + 1 < registros.length ? registros[i + 1].off : buf.length, reg.off + 700);
        const m = reg.s.match(/^(\d{1,3})([A-Za-zÀ-ÿ].*)$/);
        const campos = [];
        for (const s of strs) {
            if (s.off > reg.off && s.off < fim)
                campos.push(s.s);
        }
        const cli = {
            codigo: m?.[1] ?? null,
            nome: (m?.[2] ?? reg.s).trim(),
            cpf: null,
            rg: null,
            telefone: null,
            email: null,
            pai: null,
            mae: null,
            endereco: null,
            numero: null,
            bairro: null,
            cidade: null,
            uf: null,
            cep: null,
            observacoes: null
        };
        const limpo = campos.filter(c => c !== 'BR' && c !== 'N' && c !== 'O' && !ehRuido(c));
        const idxCEP = [];
        limpo.forEach((c, idx) => { if (ehCEP(c))
            idxCEP.push(idx); });
        const usados = new Set();
        const enderecos = [];
        for (const cepIdx of idxCEP) {
            const end = { rua: null, numero: null, bairro: null, cidade: null, uf: null, cep: limpo[cepIdx], resto: [] };
            usados.add(cepIdx);
            if (cepIdx - 1 >= 0 && ehUF(limpo[cepIdx - 1])) {
                end.uf = limpo[cepIdx - 1].toUpperCase();
                usados.add(cepIdx - 1);
            }
            const nomesAntes = [];
            for (let k = cepIdx - 2; k >= 0 && k >= cepIdx - 10; k--) {
                if (usados.has(k))
                    continue;
                if (ehNome(limpo[k]) || /^\d{1,6}$/.test(limpo[k]))
                    nomesAntes.push({ idx: k, v: limpo[k] });
                else
                    break;
            }
            const nomes = nomesAntes.reverse();
            for (const item of nomes) {
                if (/^\d{1,6}$/.test(item.v) && !end.numero) {
                    end.numero = item.v;
                    usados.add(item.idx);
                }
                else if (ehNome(item.v)) {
                    if (!end.cidade) {
                        end.cidade = item.v;
                        usados.add(item.idx);
                    }
                    else if (!end.bairro) {
                        end.bairro = item.v;
                        usados.add(item.idx);
                    }
                }
            }
            for (let k = cepIdx - 4; k >= 0 && k >= cepIdx - 10; k--) {
                if (ehRua(limpo[k])) {
                    end.rua = limpo[k];
                    usados.add(k);
                    break;
                }
            }
            enderecos.push(end);
        }
        const restantes = [];
        limpo.forEach((c, idx) => { if (!usados.has(idx))
            restantes.push(c); });
        let viCPF = false;
        for (const c of restantes) {
            if (ehCPF(c) && !cli.cpf) {
                cli.cpf = c;
                viCPF = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(c);
            }
            else if (/^\d{11}$/.test(c) && viCPF) {
                viCPF = false;
            }
            else if (ehRG(c) && !cli.rg) {
                cli.rg = c;
                viCPF = false;
            }
            else if (ehEmail(c) && !cli.email) {
                cli.email = c;
                viCPF = false;
            }
            else if (ehTelDig(c)) {
                const telAtual = cli.telefone ? String(cli.telefone) : '';
                cli.telefone = telAtual ? telAtual + ',' + c : c;
                viCPF = false;
            }
            else if (/^\+\d+$/.test(c)) { /* country code */ }
            else if (ehNome(c)) {
                if (!cli.pai)
                    cli.pai = c;
                else if (!cli.mae)
                    cli.mae = c;
                else
                    cli.observacoes = cli.observacoes ? String(cli.observacoes) + '; ' + c : c;
                viCPF = false;
            }
        }
        const prim = enderecos[0];
        if (prim) {
            cli.endereco = prim.rua;
            cli.numero = prim.numero;
            cli.bairro = prim.bairro;
            cli.cidade = prim.cidade;
            cli.uf = prim.uf;
            cli.cep = prim.cep;
        }
        clientes.push(cli);
    }
    // O arquivo traz cada cliente repetido em várias passagens/índices (mesmo
    // nome em diferente posições). Dedup por nome normalizado, ficando com a
    // ocorrência mais bem preenchida.
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
    const melhores = new Map();
    for (const c of clientes) {
        const n = norm(c.nome);
        if (!n) continue;
        const chave = n;
        const prev = melhores.get(chave);
        if (!prev || preenchido(c) > preenchido(prev))
            melhores.set(chave, c);
    }
    return [...melhores.values()];
}
function preenchido(c) {
    let total = 0;
    for (const k of ['nome', 'cpf', 'rg', 'telefone', 'email', 'endereco', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'observacoes'])
        if (c[k]) total++;
    return total;
}
function extrairNomesSimples(buf) {
    const strs = extrairStringsUtf16(buf);
    const nomes = strs.filter(s => /[A-Za-zÀ-ÿ]/.test(s.s) && /^[\x20-\x7eÀ-ÿ0-9 .,\-/'":()%]+$/.test(s.s));
    const unicos = [];
    const vistos = new Set();
    for (const s of nomes) {
        const t = s.s.trim();
        if (t.length >= 2 && !vistos.has(t.toLowerCase())) {
            vistos.add(t.toLowerCase());
            unicos.push(t);
        }
    }
    return unicos;
}
const EPOCA_NET = 62135596800000;
function converterDataNex(v) {
    if (!v)
        return null;
    const m = v - EPOCA_NET;
    if (m > 0 && m < 4102444800000)
        return new Date(m).toISOString();
    return null;
}
// --- EXTRAÇÃO DE VENDAS (Tran.nx1) ---
function extrairVendas(buf) {
    const tam = buf.length;
    const vendas = [];
    // procurar TranNome "Venda" em UTF-16
    const s = 'Venda';
    const vendaUtf16 = Buffer.from(s, 'utf16le');
    for (let i = 0; i <= tam - vendaUtf16.length; i++) {
        let ok = true;
        for (let k = 0; k < s.length; k++) {
            if (buf[i + k * 2] !== s.charCodeAt(k) || buf[i + k * 2 + 1] !== 0) {
                ok = false;
                break;
            }
        }
        if (!ok)
            continue;
        // validar que é TranNome: byte imediatamente antes é 0x04
        if (i - 1 < 0 || buf[i - 1] !== 0x04) {
            i += s.length * 2 - 1;
            continue;
        }
        // data: .NET datetime em offset relativo preferencial (-13 = DataHora da venda,
        // -39 = IncluidoEm); fallback para qualquer .NET datetime na janela
        let dataHora = null;
        for (const rel of [-13, -14, -12, -39, -40, -38]) {
            const o = i + rel;
            if (o >= 0 && o + 8 <= tam) {
                const d = converterDataNex(buf.readDoubleLE(o));
                if (d) {
                    const ano = Number(d.slice(0, 4));
                    if (ano >= 2010 && ano <= 2027) {
                        dataHora = d;
                        break;
                    }
                }
            }
        }
        if (!dataHora) {
            for (let o = i - 40; o <= i - 4; o++) {
                if (o + 8 <= tam) {
                    const d = converterDataNex(buf.readDoubleLE(o));
                    if (d) {
                        const ano = Number(d.slice(0, 4));
                        if (ano >= 2010 && ano <= 2027) {
                            dataHora = d;
                            break;
                        }
                    }
                }
            }
        }
        if (dataHora)
            vendas.push({ data: dataHora, operador: null, idNex: null, offset: i });
        i += s.length * 2 - 1;
    }
    return vendas;
}
// Vendas do Tran.nx1 pelo parser binário (id + caixa), enriquecidas com a data
// extraída pela heurística legada. Retorna uma entrada por venda com id, uid, caixa,
// data (quando disponível) e o mapa id->data para pareamento exato por tran.
async function extrairVendasComId(buf) {
    const bin = (0, nex_binary_1.lerVendasTran)(buf);
    // data por venda (heurística legada): id lido no offset binário
    const datas = new Map();
    // operador (vendedor) por venda: string ANSI (nome) a ~+491 bytes do marcador
    const operadores = new Map();
    const vendaUtf16 = Buffer.from('Venda', 'utf16le');
    // Buffer.indexOf é nativo (bem mais rápido que o loop char-a-char em arquivos
    // de centenas de MB como o Tran.nx1 — a varredura manual travava o servidor).
    let idx = buf.indexOf(vendaUtf16);
    let resp = 0;
    while (idx !== -1) {
        await cooperar(++resp, idx);
        if (idx - 1 >= 0 && buf[idx - 1] === 0x04) {
            const id = buf.readInt32LE(idx - 138);
            let dataHora = null;
            for (const rel of [-13, -14, -12, -39, -40, -38]) {
                const o = idx + rel;
                if (o >= 0 && o + 8 <= buf.length) {
                    const d = converterDataNex(buf.readDoubleLE(o));
                    if (d) {
                        const ano = Number(d.slice(0, 4));
                        if (ano >= 2010 && ano <= 2027) {
                            dataHora = d;
                            break;
                        }
                    }
                }
            }
            if (!dataHora) {
                for (let o = idx - 40; o <= idx - 4; o++) {
                    if (o + 8 <= buf.length) {
                        const d = converterDataNex(buf.readDoubleLE(o));
                        if (d) {
                            const ano = Number(d.slice(0, 4));
                            if (ano >= 2010 && ano <= 2027) {
                                dataHora = d;
                                break;
                            }
                        }
                    }
                }
            }
            if (id > 0 && id < 5e8) {
                if (dataHora)
                    datas.set(id, dataHora);
                let operador = null;
                for (let o = idx + 460; o < idx + 560 && o < buf.length; o++) {
                    const c = buf[o];
                    if (c >= 0x20 && c < 0x7f) {
                        let j = o;
                        const ch = [];
                        while (j < buf.length && buf[j] >= 0x20 && buf[j] < 0x7f && ch.length < 40) {
                            ch.push(buf[j]);
                            j++;
                        }
                        const s = Buffer.from(ch).toString('latin1').trim();
                        if (ch.length >= 3 && /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .\-_]*$/.test(s)) {
                            operador = s;
                            o = j;
                            break;
                        }
                        o = j - 1;
                    }
                }
                if (operador)
                    operadores.set(id, operador);
            }
        }
        idx = buf.indexOf(vendaUtf16, idx + 10);
    }
    return bin.map((v) => ({
        id: v.id,
        uid: v.uid,
        caixa: v.caixa,
        data: datas.get(v.id) ?? null,
        operador: operadores.get(v.id) ?? null,
    }));
}
// Itens do MovEst.nx1 pelo parser binário (produto/quant/unit/total), vinculados
// à venda pelo campo tran (id da venda). Substitui a extração falha do ITran.
function extrairItensMovEst(buf) {
    return (0, nex_binary_1.lerItensMovEst)(buf).map((it) => ({
        tran: it.tran,
        produtoNex: it.produtoId,
        produtoUid: it.produtoUid,
        quant: it.quant,
        unit: it.unit,
        total: it.total,
        uid: it.uid,
    }));
}
// --- EXTRAÇÃO DE ITENS (ITran.nx1) ---
// Detecta o formato físico do ITran (168B legado do ZIP ou 232B variável da pasta Dados)
// e extrai os itens de forma best-effort, preservando a referência de produto (+160).
function extrairItens(buf) {
    const itens = [];
    // amostra de marcadores para detectar o stride dominante
    const gaps = {};
    let ultimo = -1;
    let amostras = 0;
    for (let x = 24576; x + 4 < buf.length && amostras < 20000; x++) {
        if (buf[x] === 0x28 && buf[x + 1] === 0x00 && buf[x + 2] === 0x10 && buf[x + 3] === 0xc0) {
            if (ultimo >= 0) {
                const g = x - ultimo;
                gaps[g] = (gaps[g] || 0) + 1;
            }
            ultimo = x;
            amostras++;
            x += 3;
        }
    }
    let stride = 168;
    if (Object.keys(gaps).length > 0) {
        const dom = Object.entries(gaps).sort((a, b) => b[1] - a[1])[0];
        stride = Number(dom[0]);
    }
    const variado = stride >= 200;
    // Formato legado (168B, ZIP): campos em offsets fixos com data
    if (!variado) {
        let i = 24576;
        while (i < buf.length - 168) {
            if (buf[i] === 0x28 && buf[i + 1] === 0x00 && buf[i + 2] === 0x10 && buf[i + 3] === 0xc0) {
                const id = buf.readUInt32LE(i + 4);
                const venda = buf.readUInt32LE(i + 24);
                const produto = buf.readUInt32LE(i + 160);
                const tipo = buf.readUInt32LE(i + 164);
                const caixa = buf.readUInt32LE(i + 28);
                const data = converterDataNex(buf.readDoubleLE(i + 44));
                if (id > 0 && id < 1000000 && venda < 1000000) {
                    itens.push({
                        idNex: id,
                        vendaNex: venda,
                        produtoNex: produto,
                        tipo,
                        caixa,
                        data,
                        bytesBrutos: buf.slice(i, i + 168).toString('hex')
                    });
                }
                i += 168;
            }
            else {
                i += 2;
            }
        }
        return itens;
    }
    // Formato variado (232B, pasta Dados): andar por cada marcador e validar
    // pelo caixa (+176) e id do item (+12); produto (+160) fica best-effort.
    for (let i = 24576; i + 240 < buf.length; i++) {
        if (buf[i] === 0x28 && buf[i + 1] === 0x00 && buf[i + 2] === 0x10 && buf[i + 3] === 0xc0) {
            const id = buf.readUInt32LE(i + 12);
            const caixa = buf.readUInt32LE(i + 176);
            if (id > 0 && id < 1000000000 && caixa >= 1000 && caixa < 10000) {
                const venda = buf.readUInt32LE(i + 28);
                const produto = buf.readUInt32LE(i + 160);
                const produto2 = buf.readUInt32LE(i + 84);
                itens.push({
                    idNex: id,
                    vendaNex: venda > 0 && venda < 1000000000 ? venda : null,
                    produtoNex: produto > 0 && produto < 1000000000 ? produto : null,
                    produtoNex2: produto2 > 0 && produto2 < 1000000000 ? produto2 : null,
                    tipo: null,
                    caixa: caixa > 0 && caixa < 1000000000 ? caixa : null,
                    data: null,
                    bytesBrutos: buf.slice(i, i + 240).toString('hex')
                });
                i += 3;
            }
        }
    }
    return itens;
}
// --- EXTRAÇÃO DE PAGAMENTOS (PagEspecies.nx1) ---
async function extrairPagamentos(buf) {
    const pagamentos = [];
    let resp = 0;
    for (let o = 24576; o < buf.length - 56; o += 2) {
        await cooperar(++resp, o);
        const d = buf.readDoubleLE(o + 32);
        if (!converterDataNex(d))
            continue;
        let entropia = 0;
        for (let k = o; k < o + 32; k++) {
            const b = buf[k];
            if (b !== 0 && !(b >= 0x20 && b < 0x7f))
                entropia++;
        }
        if (entropia < 12)
            continue;
        const venda = buf.readUInt32LE(o + 40);
        const valor = buf.readUInt32LE(o + 48);
        const forma = buf.readUInt32LE(o + 44);
        const troco = buf.readUInt32LE(o + 56);
        pagamentos.push({
            vendaNex: venda,
            data: converterDataNex(d),
            valorCentavos: valor < 1000000000 ? valor : null,
            forma,
            trocoCentavos: troco < 1000000000 ? troco : null,
            bytesBrutos: buf.slice(o, o + 72).toString('hex')
        });
    }
    return pagamentos;
}
// --- EXTRAÇÃO RegistrosRemovidos (histórico de remoções) ---
function extrairRemocoes(buf) {
    const strs = extrairStringsUtf16(buf).filter(s => s.s.length >= 3);
    const remocoes = [];
    const tabelas = new Set(['Produtos', 'Clientes', 'Vendas', 'Compras', 'Categorias', 'Marcas', 'Fornecedores', 'Usuarios', 'Orcamentos']);
    // âncora: cada registro começa com a TableOrigem (ex: "Produtos")
    for (let i = 0; i < strs.length; i++) {
        const t = strs[i].s.trim();
        if (!tabelas.has(t))
            continue;
        const descricao = strs[i + 1]?.s ?? null;
        const removidoPor = strs[i + 2]?.s ?? null;
        const fimReg = i + 3 < strs.length ? strs[i + 3].off : buf.length;
        let data = null;
        for (let o = strs[i].off - 20; o < Math.min(fimReg, strs[i].off + 200); o += 2) {
            const d = converterDataNex(buf.readDoubleLE(o));
            if (d)
                data = d;
        }
        remocoes.push({
            tabela_origem: t,
            descricao,
            removido_por: removidoPor,
            data,
            campos_extras: [],
            bytes_brutos: buf.slice(strs[i].off - 20, Math.min(fimReg, strs[i].off + 200)).toString('hex')
        });
        i += 2;
    }
    return remocoes;
}
// --- EXTRAÇÃO syslog ---
function extrairSyslog(buf) {
    const EXCLUIR = /^(NX!2|NXHD|NXSH|nx1xDefault|Stream|Blob|Record|AutoInc|Tnx|FilesDescriptor|LocaleDescriptor|RecordDescriptor|HeapDescriptor|BlockHeapDescriptor|FieldsDescriptor|FieldDescriptor|nxt[A-Z]|Data\/DataDict)/;
    const infos = [];
    for (let i = 20000; i < buf.length - 4; i++) {
        if (buf[i] >= 0x20 && buf[i] < 0x7f) {
            let j = i, ch = [];
            while (j < buf.length && buf[j] >= 0x20 && buf[j] < 0x7f) {
                ch.push(buf[j]);
                j++;
            }
            const s = Buffer.from(ch).toString('latin1');
            if (ch.length >= 4 && !EXCLUIR.test(s) && /^[A-Za-zÀ-ÿ_][A-Za-z0-9À-ÿ_.\- ]*$/.test(s) && s.length >= 4)
                infos.push(s);
            i = j - 1;
        }
    }
    return infos.map(info => ({ info, origem: 'syslog', bytes_brutos: null }));
}
// --- EXTRAÇÃO Terminal ---
function extrairTerminais(buf) {
    // strings de configuração + nome do terminal
    const strs = extrairStringsUtf16(buf).filter(s => s.s.length >= 3);
    const configs = strs.map(s => s.s);
    const termId = null; // GUID não isolado com segurança
    return [{
            term_id: termId,
            nome: null,
            opcoes: configs.join('\n'),
            bytes_brutos: buf.toString('hex').slice(0, 2000)
        }];
}
function extrairUsuarios(buf) {
    const strs = extrairStringsUtf16(buf);
    const candidatos = strs.filter(s => /^[A-Za-zÀ-ÿ]/.test(s.s) && s.s.length >= 3 && s.s.length <= 40 &&
        !/^\d+=/.test(s.s) && !s.s.includes('@'));
    const ehGuid = (off) => {
        if (off - 16 < 0)
            return false;
        const bytes = buf.slice(off - 16, off);
        let naoNulos = 0;
        for (const b of bytes)
            if (b !== 0 && !(b >= 0x20 && b < 0x7f))
                naoNulos++;
        return naoNulos >= 6;
    };
    const registros = candidatos.filter(c => ehGuid(c.off)).sort((a, b) => a.off - b.off);
    const usuarios = [];
    for (let i = 0; i < registros.length; i++) {
        const r = registros[i];
        const fim = i + 1 < registros.length ? registros[i + 1].off : buf.length;
        const internas = strs.filter(s => s.off > r.off && s.off < fim && !s.s.includes('@') && !/^\d+=/.test(s.s) && !/^\d+$/.test(s.s));
        const emails = strs.filter(s => s.off > r.off && s.off < fim && s.s.includes('@'));
        let admin = 0;
        for (let o = r.off + 60; o < Math.min(fim, r.off + 130); o++) {
            if (buf[o] === 0x01 && buf[o + 1] === 0x00 && buf[o + 2] === 0x00 && buf[o + 3] === 0x00 && buf[o + 4] < 20) {
                admin = 1;
                break;
            }
        }
        const username = r.s;
        const nome = internas[0] ? internas[0].s : username;
        const email = emails[0] ? emails[0].s : null;
        usuarios.push({ username, nome, email, admin });
    }
    return usuarios;
}
function extrairCaixas(buf) {
    const caixas = [];
    for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b < 0x41 || b >= 0x7f)
            continue;
        let j = i;
        const ch = [];
        while (j < buf.length && buf[j] >= 0x20 && buf[j] < 0x7f && j - i < 40) {
            ch.push(buf[j]);
            j++;
        }
        const nome = Buffer.from(ch).toString('latin1');
        if (nome.length < 2 || !/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ._-]*$/.test(nome)) {
            i = j - 1;
            continue;
        }
        const fimNome = j;
        let aberto = '';
        let abertoOff = -1;
        for (let o = fimNome + 5; o < fimNome + 45 && o + 8 <= buf.length; o++) {
            const d = converterDataNex(buf.readDoubleLE(o));
            if (d) {
                aberto = d;
                abertoOff = o;
                break;
            }
        }
        let fechado = null;
        if (abertoOff >= 0) {
            for (let o = abertoOff + 4; o < abertoOff + 20 && o + 8 <= buf.length; o++) {
                const d = converterDataNex(buf.readDoubleLE(o));
                if (d) {
                    fechado = d;
                    break;
                }
            }
        }
        if (aberto) {
            caixas.push({
                usuario: nome.toLowerCase(),
                aberto_em: aberto.slice(0, 19).replace('T', ' '),
                fechado_em: fechado ? fechado.slice(0, 19).replace('T', ' ') : null
            });
        }
        i = fimNome - 1;
    }
    return caixas;
}
function extrairProdutosNx1(buf) {
    const tam = buf.length;
    const strs = [];
    for (let i = 0; i < tam - 2; i += 2) {
        const code = buf[i] | (buf[i + 1] << 8);
        if ((code >= 0x20 && code < 0x7f) || (code >= 0xc0 && code <= 0xff)) {
            let j = i, chars = [];
            while (j + 1 < tam) {
                const c = buf[j] | (buf[j + 1] << 8);
                if (c >= 0x20 && c < 0x7f || c >= 0xc0 && c <= 0xff) {
                    chars.push(c);
                    j += 2;
                }
                else
                    break;
            }
            if (chars.length >= 6) {
                strs.push({ off: i, s: String.fromCharCode(...chars), fim: j });
            }
            i = j - 2;
        }
    }
    const nomes = strs.filter(s => /[A-Za-zÀ-ÿ]/.test(s.s) && /\s/.test(s.s) && s.s.length <= 200 &&
        /^[\x20-\x7eÀ-ÿ0-9 .,\-/'":()%+/#&]+$/.test(s.s) &&
        !/^Essências /.test(s.s) && !/^Vasos /.test(s.s) && !/^Piteiras /i.test(s.s) &&
        !/VALORES PROMOCIONAIS/.test(s.s) && !/Google Inc/.test(s.s));
    const EXCLUIR = /^(Carvões e Fogareiros|Essencias|Essências|Pro Hookah|gold smoke|Vasos|Piteiras|HeadShop|Tabacos|Stem)/;
    const ehEAN = (s) => /^\d{8,14}$/.test(s);
    const ehNomeCampo = (s) => /^[A-Za-zÀ-ÿ@]/.test(s) && !ehEAN(s) && s.length >= 2 && !/^[\da-f]{24,}$/.test(s);
    const ehGuidBytes = (b) => {
        let n = 0;
        for (const x of b)
            if (x !== 0 && !(x >= 0x20 && x < 0x7f))
                n++;
        return n >= 6;
    };
    const vistos = new Set();
    const produtos = [];
    for (const item of nomes) {
        const nome = item.s.trim();
        const chave = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
        if (EXCLUIR.test(nome) || nome.length < 8 || vistos.has(chave))
            continue;
        vistos.add(chave);
        const offNome = item.off;
        const inicio = Math.max(0, offNome - 400);
        const fim = Math.min(tam, offNome + 20);
        const antes = strs.filter(s => s.off < offNome && s.off >= inicio).sort((a, b) => a.off - b.off);
        const eans = antes.filter(s => ehEAN(s.s)).map(s => s.s);
        const ean = eans[0] || null;
        const codigo2 = eans.length > 1 ? eans[1] : null;
        const idxPrimeiroEan = antes.findIndex(s => ehEAN(s.s));
        const nomesAteEan = idxPrimeiroEan >= 0 ? antes.slice(0, idxPrimeiroEan).filter(s => ehNomeCampo(s.s) && !/^[\da-f]{24,}$/.test(s.s)).map(s => s.s) : [];
        const categoria = nomesAteEan[0] || null;
        const subcategoria = nomesAteEan[1] || null;
        const marca = nomesAteEan[2] || null;
        const unidade = nomesAteEan[3] || null;
        let guid = null;
        const primStr = antes[0];
        if (primStr) {
            for (let o = primStr.off - 50; o < primStr.off - 4; o++) {
                if (o >= 0 && ehGuidBytes(buf.slice(o, o + 16)) && !ehGuidBytes(buf.slice(o + 1, o + 17))) {
                    guid = buf.slice(o, o + 16).toString('hex');
                    break;
                }
            }
        }
        produtos.push({ nome, guid, categoria, subcategoria, marca, unidade, ean, codigo2 });
    }
    return produtos;
}
async function extrairCadastroAscii(buf, padrao) {
    const tam = buf.length;
    const strs = [];
    let resp = 0;
    for (let i = 0; i < tam - 4; i++) {
        await cooperar(++resp, i);
        if (buf[i] >= 0x20 && buf[i] < 0x7f) {
            let j = i, chars = [];
            while (j < tam && buf[j] >= 0x20 && buf[j] < 0x7f) {
                chars.push(buf[j]);
                j++;
            }
            if (chars.length >= 4) {
                strs.push({ off: i, s: Buffer.from(chars).toString('latin1') });
            }
            i = j - 1;
        }
    }
    const pares = [];
    for (let i = 0; i < strs.length; i++) {
        if (padrao.test(strs[i].s) && i + 1 < strs.length) {
            pares.push({ codigo: strs[i].s, desc: strs[i + 1].s });
        }
    }
    return pares;
}
// --- PARSE ESTRUTURADO COM GUIDs (NexusDB) ---
// Extrai os 16 bytes imediatamente antes de cada string-nome (chave GUID da tabela ou referência)
function parsearTabelaGuid(buf) {
    const nomes = extrairStringsUtf16(buf).filter(s => s.s.length >= 3 && /[A-Za-zÀ-ÿ]/.test(s.s));
    const regs = [];
    for (const s of nomes) {
        const o = s.off;
        if (o - 16 < 0)
            continue;
        regs.push({ nome: s.s.trim(), guid: Buffer.from(buf.slice(o - 16, o)).toString('hex'), off: o });
    }
    return regs;
}
// Categorias do Categoria.nx1: guid = 16 bytes antes do nome
function extrairCategorias(buf) {
    return parsearTabelaGuid(buf).map(({ nome, guid }) => ({ nome, guid }));
}
// Subcategorias do Subcategoria.nx1: UID_categoria (guid da categoria) = 16 bytes antes do nome;
// guid da própria subcategoria = 16 bytes antes do UID_categoria
function extrairSubcategorias(buf) {
    const nomes = extrairStringsUtf16(buf).filter(s => s.s.length >= 3 && /[A-Za-zÀ-ÿ]/.test(s.s));
    const regs = [];
    for (const s of nomes) {
        const o = s.off;
        if (o - 32 < 0)
            continue;
        const uidCategoria = Buffer.from(buf.slice(o - 16, o)).toString('hex');
        const guid = Buffer.from(buf.slice(o - 32, o - 16)).toString('hex');
        regs.push({ nome: s.s.trim(), guid, uidCategoria });
    }
    return regs;
}
// Produtos estruturados do catalogo_json.nx1 (JSON UTF-16)
function extrairCatalogoJson(buf) {
    const tam = buf.length;
    const produtos = [];
    // Pula direto entre os bytes '{' (0x7b) via indexOf nativo — a varredura
    // byte-a-byte de um arquivo de ~564MB travava o servidor.
    let i = buf.indexOf(0x7b);
    while (i !== -1 && i + 1 < tam) {
        if (buf[i + 1] !== 0x00) {
            i = buf.indexOf(0x7b, i + 1);
            continue;
        }
        let fim = -1;
        let depth = 0;
        let inStr = false;
        let esc = false;
        for (let j = i; j + 1 < tam; j += 2) {
            const code = buf[j] | (buf[j + 1] << 8);
            if (inStr) {
                if (esc)
                    esc = false;
                else if (code === 0x5c)
                    esc = true;
                else if (code === 0x22)
                    inStr = false;
            }
            else {
                if (code === 0x22)
                    inStr = true;
                else if (code === 0x7b)
                    depth++;
                else if (code === 0x7d) {
                    depth--;
                    if (depth === 0) {
                        fim = j + 2;
                        break;
                    }
                }
            }
        }
        if (fim === -1) {
            i = buf.indexOf(0x7b, i + 1);
            continue;
        }
        const texto = decodificarUtf16(buf, i, fim - i);
        let parsed = null;
        try {
            parsed = JSON.parse(texto);
        }
        catch {
            i = buf.indexOf(0x7b, i + 1);
            continue;
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const p = parsed;
            if (p.ProductName || p.ProductCode)
                produtos.push(p);
        }
        i = buf.indexOf(0x7b, fim + 1);
    }
    return produtos;
}
// Fornecedores do Card.nx1: cada card de produto traz objetos Suppliers no
// formato JSON UTF-16 {"SupplierCode":N,"SupplierName":"...","Email":"...","ContactPhone":...}.
// Varre com indexOf (rápido) e faz parse do pequeno trecho JSON de cada
// fornecedor, deduplicando por SupplierCode (evita nomes duplicados/incorretos).
async function extrairFornecedoresCard(buf) {
    const nam = Buffer.from('SupplierName', 'utf16le');
    const scm = Buffer.from('SupplierCode', 'utf16le');
    const fornecedores = new Map();
    const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    let pos = 0;
    let resp = 0;
    while (pos !== -1) {
        pos = buf.indexOf(nam, pos);
        if (pos === -1)
            break;
        let start = -1;
        for (let k = Math.max(0, pos - 300); k < pos - 1; k += 2) {
            if (buf[k] === 0x7b && buf[k + 1] === 0x00)
                start = k;
        }
        if (start !== -1 && buf.includes(scm, start, pos)) {
            let fim = -1, depth = 0, inStr = false, esc = false;
            for (let k = start; k + 1 < Math.min(buf.length, start + 800); k += 2) {
                const code = buf[k] | (buf[k + 1] << 8);
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
                        if (depth === 0) { fim = k + 2; break; }
                    }
                }
            }
            if (fim !== -1 && fim - start < 1000) {
                let parsed = null;
                try { parsed = JSON.parse(decodificarUtf16(buf, start, fim - start)); } catch { /* objeto inválido */ }
                if (parsed && typeof parsed === 'object') {
                    const cod = parsed.SupplierCode != null ? Number(parsed.SupplierCode) : null;
                    const nome = String(parsed.SupplierName ?? '').trim();
                    const chave = cod != null ? String(cod) : 'n:' + norm(nome);
                    if (!fornecedores.has(chave)) {
                        fornecedores.set(chave, {
                            codigo: cod,
                            nome,
                            email: vazioParaNull(String(parsed.Email ?? '').trim()),
                            telefone: vazioParaNull(String(parsed.ContactPhone ?? '').trim())
                        });
                    }
                }
            }
        }
        pos += nam.length;
        if (++resp % 1000 === 0)
            await cooperar(1, pos);
    }
    return [...fornecedores.values()];
}
function vazioParaNull(s) {
    return s ? s : null;
}
// Produtos do Produto.nx1 ancorados pelos GUIDs das categorias conhecidas.
// Cada registro do produto contém: [GUID categoria][nome categoria][GUID subcategoria][nome subcategoria][código][EAN][nome produto]
async function extrairProdutosNx1Guid(buf, catGuids, catNomesNorm, subNomesNorm) {
    const strs = extrairStringsUtf16(buf);
    const catGuidArr = [...catGuids.keys()].map((h) => Buffer.from(h, 'hex'));
    const first4 = new Set(catGuidArr.map((g) => g.readUInt32BE(0)));
    const anchors = [];
    let resp = 0;
    for (let i = 0; i + 16 <= buf.length; i++) {
        await cooperar(++resp, i);
        if (i & 1)
            continue;
        if (first4.has(buf.readUInt32BE(i))) {
            const b = buf.slice(i, i + 16);
            const h = b.toString('hex');
            if (catGuids.has(h)) {
                anchors.push({ off: i, guid: h, catNome: catGuids.get(h) });
                i += 15;
            }
        }
    }
    anchors.sort((a, b) => a.off - b.off);
    const offs = strs.map((s) => s.off);
    const rangeStr = (ini, fim) => {
        const res = [];
        let lo = 0;
        let hi = offs.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (offs[mid] < ini)
                lo = mid + 1;
            else
                hi = mid;
        }
        let p = lo;
        while (p < offs.length && offs[p] < fim) {
            res.push(strs[p].s);
            p++;
        }
        return res;
    };
    const ehNumero = (s) => /^[\d.\-]+$/.test(s);
    const ehEan = (s) => /^\d{8,14}$/.test(s);
    const ehNomeProd = (s) => /[A-Za-zÀ-ÿ]/.test(s) && s.trim().length >= 3;
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const produtos = [];
    const vistos = new Set();
    let resp2 = 0;
    for (let idx = 0; idx < anchors.length; idx++) {
        await cooperar(++resp2, idx);
        const a = anchors[idx];
        const fimRecord = idx + 1 < anchors.length ? anchors[idx + 1].off : buf.length;
        const campos = rangeStr(a.off + 16, fimRecord);
        if (campos.length === 0)
            continue;
        const nomesCandidatos = [];
        const numericos = [];
        let subNome = null;
        for (let k = 0; k < campos.length; k++) {
            const c = campos[k];
            if (ehNumero(c) && c.length >= 4) {
                numericos.push(c);
                continue;
            }
            if (c.length < 3 || !/^[A-Za-zÀ-ÿ]/.test(c))
                continue;
            const n = norm(c);
            if (catNomesNorm.has(n) || subNomesNorm.has(n)) {
                if (subNomesNorm.has(n) && !subNome)
                    subNome = c;
                continue;
            }
            if (ehNomeProd(c))
                nomesCandidatos.push(c);
        }
        // O nome real do produto é a 1ª string válida logo após o bloco de números do
        // registro ([código][EAN]...). Depois do nome vêm a descrição/specs e dados de
        // imagem ("sRGB", "Google Inc.", "& Creamteado..."), que o pick de "última
        // string" anterior importava como se fossem produtos.
        const ean = numericos.find(ehEan) || null;
        const primeiroNum = campos.findIndex((c) => ehNumero(c) && c.length >= 4);
        let idxBase = primeiroNum;
        const ehDescricao = (s) => /^v?\s*valores?\s*promocionais|caracter[ií]sticas|\bdescri[cç][aã]o\b/i.test(s);
        const ehMetaImagem = (s) => /Google Inc|sRGB|iCCP|mCCP|gAMA|cHRM|bKGD|tRNS|tEXt|\bSRGB\b/.test(s);
        let nomeProd = null;
        for (let k = idxBase + 1; k < campos.length; k++) {
            const c = campos[k];
            if (catNomesNorm.has(norm(c)) || subNomesNorm.has(norm(c)))
                continue;
            if (!ehNomeProd(c) || ehDescricao(c) || ehMetaImagem(c))
                continue;
            nomeProd = c;
            break;
        }
        if (!nomeProd) {
            nomeProd = [...nomesCandidatos].reverse().find((c) => !ehDescricao(c) && !ehMetaImagem(c)) ?? nomesCandidatos[nomesCandidatos.length - 1];
        }
        if (!nomeProd)
            continue;
        const n = norm(nomeProd.trim());
        if (vistos.has(n))
            continue;
        vistos.add(n);
        const codigo = numericos.find((x) => !ehEan(x)) || null;
        produtos.push({ nome: nomeProd.trim(), cat: a.catNome, sub: subNome, ean, codigo });
    }
    return produtos;
}
// Extrai as FOTO dos produtos embutidas no Produto.nx1, mapeadas pelo hash do
// catálogo (campo ProductImg / Photos, 32 hex). Cada imagem fica no arquivo como
// [hash ASCII][bytes PNG/JPG][fim]. Devolve Map hash→Buffer (bytes crus do arquivo).
async function extrairImagensProdutoNx1(buf) {
    const map = new Map();
    const total = buf.length;
    let resp = 0;
    const ehHex = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x61 && b <= 0x66) || (b >= 0x41 && b <= 0x46);
    const assina = (off) => {
        const png = buf[off] === 0x89 && buf[off + 1] === 0x50 && buf[off + 2] === 0x4e && buf[off + 3] === 0x47;
        const jpg = buf[off] === 0xff && buf[off + 1] === 0xd8 && buf[off + 2] === 0xff;
        return png ? 'png' : jpg ? 'jpg' : null;
    };
    const fimPng = (off) => {
        const fim = Math.min(total, off + 8 * 1024 * 1024);
        for (let p = off + 8; p + 12 <= fim; p++) {
            if (buf[p] === 0x49 && buf[p + 1] === 0x45 && buf[p + 2] === 0x4e && buf[p + 3] === 0x44 &&
                buf[p - 4] === 0 && buf[p - 3] === 0 && buf[p - 2] === 0 && buf[p - 1] === 0) {
                return p + 8;
            }
        }
        return -1;
    };
    const fimJpg = (off) => {
        const fim = Math.min(total, off + 8 * 1024 * 1024);
        for (let p = off + 2; p + 2 <= fim; p++) {
            if (buf[p] === 0xff && buf[p + 1] === 0xd9)
                return p + 2;
        }
        return -1;
    };
    // 1) todos os inícios de imagem
    const starts = [];
    for (let i = 0; i + 8 <= total; i++) {
        if ((i & 0xfffff) === 0)
            await cooperar(++resp, i);
        const ext = assina(i);
        if (ext)
            starts.push({ off: i, ext });
    }
    // 2) todos os Ids de imagem (ImagemMD5/ImagemUrl = run 32 hex isolado)
    const ids = [];
    for (let i = 0; i + 32 <= total; i++) {
        if ((i & 0xfffff) === 0)
            await cooperar(++resp, i);
        const h = buf.toString('ascii', i, i + 32);
        if (!/^[0-9a-fA-F]{32}$/.test(h))
            continue;
        const b = i > 0 ? buf[i - 1] : -1;
        const a = i + 32 < total ? buf[i + 32] : -1;
        if ((b !== -1 && ehHex(b)) || (a !== -1 && ehHex(a)))
            continue;
        ids.push({ off: i, h: h.toLowerCase() });
    }
    // 3) associa cada Id à imagem do MESMO registro: a foto fica logo ANTES do
    //    campo ImagemMD5/ImagemUrl (layout padrão do Nex). Janela ampla (sem
    //    truncar blobs grandes) limitada por distância p/ não roubar do registro anterior.
    //    NX1 binário: cada 4096 bytes alinhados há um header NXHD (20 bytes)
    //    preceded by 2 null bytes que são intercalados com os dados da imagem.
    //    Esses headers são removidos para gerar imagens limpas.
    const removerNxhd = (from, to) => {
        const nxhd = [];
        for (let i = from; i + 20 <= to; i++) {
            if (buf[i] === 0x4e && buf[i + 1] === 0x58 && buf[i + 2] === 0x48 && buf[i + 3] === 0x44)
                nxhd.push(i);
        }
        if (nxhd.length === 0)
            return buf.slice(from, to);
        const cleanLen = to - from - nxhd.length * 22;
        if (cleanLen <= 0)
            return buf.slice(from, to);
        const out = Buffer.allocUnsafe(cleanLen);
        let w = 0, r = from;
        for (const nx of nxhd) {
            const rmStart = nx - 2;
            if (rmStart > r) {
                buf.copy(out, w, r, rmStart);
                w += rmStart - r;
            }
            r = nx + 20;
        }
        if (r < to) {
            buf.copy(out, w, r, to);
            w += to - r;
        }
        return out.slice(0, w);
    };
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
async function montarImportacao(carregar, opcoes) {
    const passo = async (arquivo) => { atualizarProgresso({ ativo: true, etapa: 'lendo', atual: 1, total: 1, mensagem: `Lendo ${arquivo}...` }); await pausar(); };
    let produtos = [];
    if (await carregar('catalogo_json.nx1')) {
        await passo('catalogo_json.nx1');
        produtos = extrairCatalogoJson((await carregar('catalogo_json.nx1')));
    }
    let clientes = [];
    if (await carregar('Cliente.nx1')) {
        await passo('Cliente.nx1');
        clientes = await extrairClientes((await carregar('Cliente.nx1')));
    }
    let categorias = [];
    if (await carregar('Categoria.nx1')) {
        await passo('Categoria.nx1');
        categorias = extrairCategorias((await carregar('Categoria.nx1')));
    }
    let marcas = [];
    if (await carregar('Marca.nx1')) {
        await passo('Marca.nx1');
        marcas = extrairNomesSimples((await carregar('Marca.nx1')));
    }
    let subcategorias = [];
    if (await carregar('Subcategoria.nx1')) {
        await passo('Subcategoria.nx1');
        subcategorias = extrairSubcategorias((await carregar('Subcategoria.nx1')));
    }
        let unidades = [];
    if (await carregar('Unidade.nx1')) {
        await passo('Unidade.nx1');
        unidades = extrairNomesSimples((await carregar('Unidade.nx1')));
    }
    let usuarios = [];
    if (await carregar('Usuario.nx1')) {
        await passo('Usuario.nx1');
        usuarios = extrairUsuarios((await carregar('Usuario.nx1')));
    }
    let caixas = [];
    if (await carregar('Caixa.nx1')) {
        await passo('Caixa.nx1');
        caixas = extrairCaixas((await carregar('Caixa.nx1')));
    }
    let fornecedores = [];
    if (await carregar('Card.nx1')) {
        await passo('Card.nx1');
        fornecedores = await extrairFornecedoresCard((await carregar('Card.nx1')));
    }
    const catGuids = new Map(categorias.map((c) => [c.guid, c.nome]));
    const catNomesNorm = new Set(categorias.map((c) => normalizarNome(c.nome)));
    const subNomesNorm = new Set(subcategorias.map((s) => normalizarNome(s.nome)));
    let produtosNx1 = [];
    let imagens = new Map();
    const bufProdutoNx1 = await carregar('Produto.nx1');
    if (bufProdutoNx1) {
        await passo('Produto.nx1');
        produtosNx1 = await extrairProdutosNx1Guid(bufProdutoNx1, catGuids, catNomesNorm, subNomesNorm);
        imagens = await extrairImagensProdutoNx1(bufProdutoNx1);
    }
    // Fotos extraídas para disco (scripts/extrair-fotos-nex.js) reutilizáveis nas
    // próximas importações. Se opcoes.pastaFotos apontar para `fotos_nex`, cada
    // <hash>.png/.jpg vira um candidato (hash -> bytes) que preenche produtos sem
    // imagem embutida no Produto.nx1.
    const pastaFotos = opcoes?.pastaFotos;
    if (pastaFotos) {
        let nomes = [];
        try {
            nomes = (0, node_fs_1.readdirSync)(pastaFotos).filter((f) => /\.(png|jpe?g)$/i.test(f));
        }
        catch { nomes = []; }
        let carregadas = 0;
        for (const nome of nomes) {
            const hash = nome.replace(/\.(png|jpe?g)$/i, '').toLowerCase();
            if (!hash || imagens.has(hash)) continue;
            try {
                const buf = (0, node_fs_1.readFileSync)((0, node_path_1.join)(pastaFotos, nome));
                imagens.set(hash, buf);
                carregadas++;
            }
            catch { /* ignora arquivo ilegível */ }
            if (carregadas % 200 === 0) await pausar();
        }
        atualizarProgresso({ ativo: true, etapa: 'lendo', atual: 1, total: 1, mensagem: `Lendo ${carregadas} fotos de ${pastaFotos}...` });
    }
    let ncmCadastro = [];
    if (await carregar('NCM.nx1')) {
        await passo('NCM.nx1');
        ncmCadastro = await extrairCadastroAscii((await carregar('NCM.nx1')), /^\d{8}$/);
    }
    let cestCadastro = [];
    if (await carregar('br_cest.nx1')) {
        await passo('br_cest.nx1');
        cestCadastro = await extrairCadastroAscii((await carregar('br_cest.nx1')), /^\d{7}$/);
    }
    let cfopCadastro = [];
    if (await carregar('CFOP.nx1')) {
        await passo('CFOP.nx1');
        cfopCadastro = await extrairCadastroAscii((await carregar('CFOP.nx1')), /^\d{4}$/);
    }
    let vendas = [];
    if (await carregar('Tran.nx1')) {
        await passo('Tran.nx1');
        vendas = await extrairVendasComId((await carregar('Tran.nx1')));
    }
    let itens = [];
    if (await carregar('MovEst.nx1')) {
        await passo('MovEst.nx1');
        itens = extrairItensMovEst((await carregar('MovEst.nx1')));
    }
    let pagamentos = [];
    if (await carregar('PagEspecies.nx1')) {
        await passo('PagEspecies.nx1');
        pagamentos = await extrairPagamentos((await carregar('PagEspecies.nx1')));
    }
    const naoInterpretados = [];
    let remocoes = [];
    if (await carregar('RegistrosRemovidos.nx1')) {
        await passo('RegistrosRemovidos.nx1');
        remocoes = extrairRemocoes((await carregar('RegistrosRemovidos.nx1')));
    }
    let syslogs = [];
    if (await carregar('syslog.nx1')) {
        await passo('syslog.nx1');
        syslogs = extrairSyslog((await carregar('syslog.nx1')));
    }
    let terminais = [];
    if (await carregar('Terminal.nx1')) {
        await passo('Terminal.nx1');
        terminais = extrairTerminais((await carregar('Terminal.nx1')));
    }
    return { produtos, clientes, categorias, marcas, subcategorias, unidades, usuarios, caixas, fornecedores, produtosNx1, imagens, ncmCadastro, cestCadastro, cfopCadastro, vendas, itens, pagamentos, naoInterpretados, remocoes, syslogs, terminais };
}
function normalizarNome(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}
function ehNomeGarbage(s) {
    if (!s || s.trim().length < 4) return true;
    const t = s.trim();
    if (/^[!+\-&"@=\[\]#%*]/.test(t)) return true;
    const c = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const toks = c.split(/\s+/).filter(x => x.length >= 3 && /[A-Za-z]/.test(x));
    const seen = new Set<string>();
    let wordRepeat = false;
    for (const tk of toks) {
        const lo = tk.toLowerCase();
        if (seen.has(lo)) { wordRepeat = true; break; }
        seen.add(lo);
    }
    let garbledTail = false;
    const m = c.match(/[a-z]{4,}/g);
    if (m) {
        for (const run of m) {
            const idx = c.indexOf(run);
            if (idx < 0) continue;
            const before = idx === 0 ? ' ' : c[idx - 1];
            const after = idx + run.length >= c.length ? ' ' : c[idx + run.length];
            const boundStart = before === ' ' || before === '-' || before === '/' || before === '(' || before === '[';
            const boundEnd = after === ' ' || after === '-' || after === '/' || after === ')' || after === ']' || after === '.' || after === ',';
            if (!(boundStart && boundEnd)) { garbledTail = true; break; }
        }
    }
    if (wordRepeat && garbledTail) return true;
    if (garbledTail && t.length > 50) return true;
    return false;
}
function filtrarFornecedoresValidos(fornecedores) {
    return fornecedores.filter(f => {
        const t = String(f?.nome ?? f ?? '').trim();
        if (!t || t.length < 3) return false;
        if (/^[!+\-&"@=\[\]#%*]/.test(t)) return false;
        if (/[^\x20-\x7eÀ-ÿ0-9\s\.\-\/\(\)&,']/.test(t)) return false;
        if (/^(FORNECEDOR|FORNECED|FORNEC|ou|beb|ajuste|Ra|arte|old|zin|Murilo)$/i.test(t)) return false;
        return true;
    });
}
// Extrai o dicionário de campos de um arquivo .nx1 (nomes e tipos de campo)
function extrairDicionario(buf) {
    const fieldTypes = new Set([
        'nxtAutoInc', 'nxtGuid', 'nxtWord32', 'nxtWideString', 'nxtString', 'nxtInt32',
        'nxtBoolean', 'nxtDateTime', 'nxtFloat32', 'nxtFloat64', 'nxtWord16', 'nxtByte',
        'nxtInt16', 'nxtInt64', 'nxtBlob', 'nxtBlobMemo', 'nxtBlobGraphic', 'nxtArray',
        'nxtWideMemo', 'nxtBlobWideMemo', 'nxtNullString', 'nxtDouble'
    ]);
    const ascii = [];
    let cur = [], start = 0;
    for (let i = 0; i < Math.min(buf.length, 200000); i++) {
        const b = buf[i];
        if (b >= 0x20 && b < 0x7f) {
            if (cur.length === 0)
                start = i;
            cur.push(b);
        }
        else {
            if (cur.length >= 4)
                ascii.push({ off: start, s: Buffer.from(cur).toString('ascii') });
            cur = [];
        }
    }
    if (cur.length >= 4)
        ascii.push({ off: start, s: Buffer.from(cur).toString('ascii') });
    const fields = [];
    for (let i = 0; i < ascii.length; i++) {
        if (ascii[i].s === 'TnxFieldDescriptor') {
            let nome = null, tipo = null;
            for (let j = i + 1; j < ascii.length && j < i + 6; j++) {
                if (!nome && !fieldTypes.has(ascii[j].s) && ascii[j].s !== 'TnxFieldDescriptor') {
                    nome = ascii[j].s;
                    continue;
                }
                if (nome && fieldTypes.has(ascii[j].s)) {
                    tipo = ascii[j].s;
                    break;
                }
            }
            if (nome && tipo)
                fields.push({ nome, tipo });
        }
    }
    // deduplicar preservando ordem
    const vistos = new Set();
    const unicos = [];
    for (const f of fields) {
        const k = f.nome + '|' + f.tipo;
        if (!vistos.has(k)) {
            vistos.add(k);
            unicos.push(f);
        }
    }
    return unicos;
}
// Conta blocos de dados NXHD
function contarBlocos(buf) {
    let n = 0;
    for (let i = 0; i + 4 < buf.length; i++) {
        if (buf.toString('ascii', i, i + 4) === 'NXHD') {
            n++;
            i += 4095;
        }
    }
    return n;
}
async function importarNex(zipBuffer, nomeZip, opcoes) {
    const erros = [];
    const zip = new adm_zip_1.default(zipBuffer);
    const entries = zip.getEntries().filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.nx1'));
    // NÃO descomprimimos mais tudo de uma vez num Map (travava por memória:
    // zip de 757MB + ~2GB de buffers simultâneos). Cada arquivo é lido sob demanda
    // (descomprime -> parseia -> descarta) via carregar().
    const porNome = new Map();
    const arquivos = [];
    const pulados = [];
    for (const entry of entries) {
        const nomeBase = entry.entryName.split(/[\\/]/).pop();
        const tamanho = entry.header?.size ?? 0;
        if (!ARQUIVOS_NECESSARIOS.has(nomeBase.toLowerCase()) && tamanho > NAO_CARCAR_ACIMA_DE) {
            pulados.push(`${nomeBase} (${(tamanho / 1048576).toFixed(0)}MB)`);
            continue;
        }
        porNome.set(nomeBase.toLowerCase(), entry);
        arquivos.push(nomeBase);
    }
    const carregar = (nomeArquivo) => {
        const e = porNome.get(nomeArquivo.toLowerCase());
        if (!e)
            return undefined;
        try {
            return e.getData();
        }
        catch (err) {
            erros.push(`Falha ao ler ${nomeArquivo}: ${err.message}`);
            return undefined;
        }
    };
    atualizarProgresso({ ativo: true, etapa: 'lendo', atual: 0, total: 1, mensagem: `Lendo dados do ZIP (${entries.length} arquivos .nx1)...` });
    const r = await importarNexComCarregador(carregar, arquivos, nomeZip, opcoes);
    if (pulados.length) {
        const nota = `${pulados.length} arquivo(s) grande(s) ignorado(s) para não travar o servidor: ${pulados.join(', ')}`;
        r.resumo = { ...(r.resumo || {}), arquivosGrandesIgnorados: pulados.length };
        r.erros = [...(r.erros || []), nota];
        r.relatorio = { ...(r.relatorio || {}), arquivosGrandesIgnorados: pulados };
    }
    return r;
}
// Lê uma entrada do ZIP inteira (descomprimida) a partir do arquivo em disco.
// O ZIP NUNCA é carregado inteiro na memória (um Dados.zip de 757MB + buffers
// descomprimidos de ~2GB simultâneos travavam o servidor em máquinas sem RAM).
async function lerEntradaUnzipper(entry) {
    if (!entry.stream)
        return null;
    try {
        const stream = entry.stream();
        const chunks = [];
        return await new Promise((resolve, reject) => {
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    }
    catch {
        return null;
    }
}
function montarNotaArquivosGrandes(r, pulados) {
    if (pulados.length) {
        const nota = `${pulados.length} arquivo(s) grande(s) ignorado(s) para não travar o servidor: ${pulados.join(', ')}`;
        r.resumo = { ...(r.resumo || {}), arquivosGrandesIgnorados: pulados.length };
        r.erros = [...(r.erros || []), nota];
        r.relatorio = { ...(r.relatorio || {}), arquivosGrandesIgnorados: pulados };
    }
}
// Importação a partir de um arquivo ZIP em disco (streaming, sem carregar o zip na RAM)
async function importarNexDeZip(caminhoZip, nomeZip, opcoes?) {
    const erros = [];
    const dir = await unzipper_1.Open.file(caminhoZip);
    const porNome = new Map();
    const arquivos = [];
    const pulados = [];
    for (const entry of dir.files) {
        if (entry.type !== 'File' || !entry.path.toLowerCase().endsWith('.nx1'))
            continue;
        if (entry.path.includes('__MACOSX'))
            continue;
        const nomeBase = entry.path.split(/[\\/]/).pop();
        const tamanho = entry.uncompressedSize ?? entry.compressedSize ?? 0;
        if (!ARQUIVOS_NECESSARIOS.has(nomeBase.toLowerCase()) && tamanho > NAO_CARCAR_ACIMA_DE) {
            pulados.push(`${nomeBase} (${(tamanho / 1048576).toFixed(0)}MB)`);
            continue;
        }
        porNome.set(nomeBase.toLowerCase(), entry);
        arquivos.push(nomeBase);
    }
    const carregar = async (nomeArquivo) => {
        const entry = porNome.get(nomeArquivo.toLowerCase());
        if (!entry)
            return undefined;
        const buf = await lerEntradaUnzipper(entry);
        if (!buf)
            erros.push(`Falha ao ler ${nomeArquivo} do ZIP`);
        return buf ?? undefined;
    };
    atualizarProgresso({ ativo: true, etapa: 'lendo', atual: 0, total: 1, mensagem: `Lendo dados do ZIP (${arquivos.length} arquivos .nx1)...` });
    const r = await importarNexComCarregador(carregar, arquivos, nomeZip, opcoes);
    if (erros.length)
        r.erros = [...(r.erros || []), ...erros];
    montarNotaArquivosGrandes(r, pulados);
    return r;
}
// Importa direto de uma pasta com os arquivos .nx1 soltos (formato da pasta Dados do Nex)
async function importarNexDePasta(pasta, opcoes) {
    const { readdirSync, statSync } = await Promise.resolve().then(() => __importStar(require('node:fs')));
    const arquivos = [];
    const pulados = [];
    for (const f of readdirSync(pasta).filter((x) => x.toLowerCase().endsWith('.nx1'))) {
        let tam = 0;
        try {
            tam = statSync((0, node_path_1.join)(pasta, f)).size;
        }
        catch { /* ignora */ }
        if (!ARQUIVOS_NECESSARIOS.has(f.toLowerCase()) && tam > NAO_CARCAR_ACIMA_DE) {
            pulados.push(`${f} (${(tam / 1048576).toFixed(0)}MB)`);
            continue;
        }
        arquivos.push(f);
    }
    const carregar = (nomeArquivo) => {
        try {
            return (0, node_fs_1.readFileSync)((0, node_path_1.join)(pasta, nomeArquivo));
        }
        catch {
            return undefined;
        }
    };
    const r = await importarNexComCarregador(carregar, arquivos, pasta, opcoes);
    montarNotaArquivosGrandes(r, pulados);
    return r;
}
// Importa UM arquivo .nx1 avulso (arquivo por arquivo, sem ZIP nem pasta completa).
// O nome do arquivo define a tabela (Tran.nx1 → vendas, MovEst.nx1 → itens, Produto.nx1,
// Categoria.nx1, etc.). Aceita extensão .nx ou .nx1 — normaliza para o nome canônico .nx1
// que o montarImportacao usa como chave.
async function importarNexDeArquivo(caminhoArquivo, nomeArquivo, opcoes = {}) {
    const baseOriginal = (nomeArquivo || '').replace(/\\/g, '/').split('/').pop() || 'arquivo.nx';
    const tabela = baseOriginal.replace(/\.nx1?$/i, '');
    const nomeBase = tabela ? `${tabela}.nx1` : baseOriginal;
    const padrao = nomeBase.toLowerCase();
    const carregar = (nomeProcurado) => {
        if (String(nomeProcurado || '').toLowerCase() !== padrao)
            return undefined;
        try {
            return node_fs_1.readFileSync(caminhoArquivo);
        }
        catch {
            return undefined;
        }
    };
    const r = await importarNexComCarregador(carregar, [nomeBase], nomeBase, opcoes);
    return r;
}
async function importarNexComCarregador(carregar, arquivos, nomeZip, opcoes) {
    const erros = [];
    try {
        const db = (0, index_1.getDb)();
        db.exec('BEGIN');
        atualizarProgresso({ ativo: true, etapa: 'lendo', atual: 0, total: 1, mensagem: `Lendo dados ${nomeZip}...` });
        const dados = await montarImportacao(carregar, opcoes);
        // Preservar estruturas do Nex sem suporte no sistema (zero perda de dados).
        // Cada buffer é lido um por vez e descartado em seguida — sem segurar tudo na RAM.
        atualizarProgresso({ ativo: true, etapa: 'dados_brutos', atual: 0, total: Math.max(1, arquivos.length), mensagem: 'Preservando dados brutos de estruturas sem suporte...' });
        let brutosPreservados = 0;
        // Arquivos acima deste tamanho NÃO viram base64 + blob no SQLite (causava
        // travamento do servidor: blockava o event loop e estourava memória com
        // cloud_cache/cloud_json de ~500MB–1.4GB). São gravados íntegros em disco
        // e registrados em nex_dados_brutos com a referência do caminho.
        const LIMITE_PRESERVACAO_DISCO = 50 * 1024 * 1024;
        const tabelasSuportadas = new Set([
            'Cliente', 'Produto', 'catalogo_json', 'Categoria', 'Subcategoria', 'Marca', 'Unidade',
            'Usuario', 'Caixa', 'Tran', 'ITran', 'PagEspecies', 'MovEst', 'NCM', 'RegistrosRemovidos',
            'syslog', 'Terminal', 'br_cest', 'CFOP'
        ]);
        for (const nomeArquivo of arquivos) {
            const tabela = nomeArquivo.replace(/\.nx1$/i, '');
            if (tabelasSuportadas.has(tabela))
                continue;
            const buf = await carregar(nomeArquivo);
            if (!buf)
                continue;
            const grande = buf.length > LIMITE_PRESERVACAO_DISCO;
            const blocos = grande ? 1 : contarBlocos(buf);
            if (blocos === 0)
                continue;
            try {
                if (grande) {
                    const dirRaw = (0, node_path_1.join)((0, index_1.getDefaultDbPath)(), '..', 'nex_nao_interpretados');
                    (0, node_fs_1.mkdirSync)(dirRaw, { recursive: true });
                    const caminho = (0, node_path_1.join)(dirRaw, nomeArquivo);
                    (0, node_fs_1.writeFileSync)(caminho, buf);
                    db.prepare(`INSERT INTO nex_dados_brutos (tabela_origem, registro, dados_json, bytes_brutos, motivo)
            VALUES (?, 'arquivo_inteiro_disco', ?, NULL, 'Arquivo grande preservado integralmente em disco (evita travamento)')`)
                        .run(tabela, JSON.stringify({ tamanhoBytes: buf.length, caminho }));
                }
                else {
                    db.prepare(`INSERT INTO nex_dados_brutos (tabela_origem, registro, dados_json, bytes_brutos, motivo)
            VALUES (?, 'bloco_completo', NULL, ?, 'Estrutura sem suporte no sistema — preservada integralmente')`)
                        .run(tabela, buf.toString('base64'));
                }
                brutosPreservados++;
            }
            catch (e) {
                erros.push(`Preservação ${tabela}: ${e.message}`);
            }
            atualizarProgresso({ atual: (brutosPreservados + 1) });
            if (brutosPreservados % 5 === 0)
                await pausar();
        }
        atualizarProgresso({ ativo: true, etapa: 'ncm', atual: 0, total: dados.ncmCadastro.length, mensagem: `Importando cadastro NCM (${dados.ncmCadastro.length})...` });
        let ncmImportados = 0;
        for (let i = 0; i < dados.ncmCadastro.length; i++) {
            const n = dados.ncmCadastro[i];
            try {
                const ex = db.prepare(`SELECT id FROM ncm_cadastro WHERE ncm = ?`).get(n.codigo);
                if (!ex) {
                    db.prepare(`INSERT INTO ncm_cadastro (ncm, descricao) VALUES (?, ?)`).run(n.codigo, n.desc);
                    ncmImportados++;
                }
            }
            catch { /* ignore */ }
            if ((i + 1) % 500 === 0) {
                atualizarProgresso({ atual: i + 1 });
                await pausar();
            }
        }
        atualizarProgresso({ ativo: true, etapa: 'cest', atual: 0, total: dados.cestCadastro.length, mensagem: `Importando cadastro CEST (${dados.cestCadastro.length})...` });
        let cestImportados = 0;
        for (let i = 0; i < dados.cestCadastro.length; i++) {
            const n = dados.cestCadastro[i];
            try {
                const ex = db.prepare(`SELECT id FROM cest_cadastro WHERE cest = ?`).get(n.codigo);
                if (!ex) {
                    db.prepare(`INSERT INTO cest_cadastro (cest, descricao) VALUES (?, ?)`).run(n.codigo, n.desc);
                    cestImportados++;
                }
            }
            catch { /* ignore */ }
            if ((i + 1) % 500 === 0) {
                atualizarProgresso({ atual: i + 1 });
                await pausar();
            }
        }
        atualizarProgresso({ ativo: true, etapa: 'cfop', atual: 0, total: dados.cfopCadastro.length, mensagem: `Importando cadastro CFOP (${dados.cfopCadastro.length})...` });
        let cfopImportados = 0;
        for (let i = 0; i < dados.cfopCadastro.length; i++) {
            const n = dados.cfopCadastro[i];
            try {
                const ex = db.prepare(`SELECT id FROM cfop_cadastro WHERE cfop = ?`).get(n.codigo);
                if (!ex) {
                    db.prepare(`INSERT INTO cfop_cadastro (cfop, descricao) VALUES (?, ?)`).run(n.codigo, n.desc);
                    cfopImportados++;
                }
            }
            catch { /* ignore */ }
            if ((i + 1) % 500 === 0) {
                atualizarProgresso({ atual: i + 1 });
                await pausar();
            }
        }
        const normNome = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
        // Parse robusto de preços Nex: aceita number, string com vírgula ("12,90"),
        // símbolo de moeda ("R$ 12,90") e campos alternativos do JSON.
        const extrairPreco = (...candidatos) => {
            for (const raw of candidatos) {
                if (raw == null) continue;
                if (typeof raw === 'number' && raw > 0) return raw;
                const s = String(raw).trim();
                if (!s || s === '0') continue;
                const limpo = s.replace(/[R$\s]/g, '').replace(/,/g, '.');
                const n = Number(limpo);
                if (!isNaN(n) && n > 0) return n;
            }
            return 0;
        };
        // Gera código sequencial de produto (sem ProductCode no Nex).
        // Atualiza a tabela sequencias para ficar consistente com o frontend.
        let seqProduto = 0;
        const initSeqProduto = () => {
            const maxRow = db.prepare(`SELECT COALESCE(MAX(CAST(codigo_interno AS INTEGER)), 0) AS m FROM produtos WHERE codigo_interno GLOB '[0-9]*'`).get();
            const base = Math.max(Number(maxRow?.m ?? 0), 0);
            const seqRow = db.prepare(`SELECT valor FROM sequencias WHERE chave = 'produto_codigo'`).get();
            seqProduto = Math.max(base, Number(seqRow?.valor ?? 0));
        };
        initSeqProduto();
        const proximoCodigoProduto = () => {
            seqProduto++;
            return String(seqProduto).padStart(6, '0');
        };
        // Gera código sequencial de cliente (sem código no Nex).
        let seqCliente = 0;
        const initSeqCliente = () => {
            const maxRow = db.prepare(`SELECT COALESCE(MAX(CAST(codigo AS INTEGER)), 0) AS m FROM clientes WHERE codigo GLOB '[0-9]*'`).get();
            seqCliente = Math.max(Number(maxRow?.m ?? 0), 0);
        };
        initSeqCliente();
        const proximoCodigoCliente = () => {
            seqCliente++;
            return String(seqCliente).padStart(6, '0');
        };
        // Fornecedores do Card.nx1 (lista Suppliers dos cards de produto)
        const fornecedoresValidos = filtrarFornecedoresValidos(dados.fornecedores);
        atualizarProgresso({ ativo: true, etapa: 'fornecedores', atual: 0, total: fornecedoresValidos.length, mensagem: `Importando fornecedores (${fornecedoresValidos.length})...` });
        const mapaFornecedores = new Map();
        for (let i = 0; i < fornecedoresValidos.length; i++) {
            const f = fornecedoresValidos[i];
            const nome = String(f?.nome ?? '').trim();
            if (!nome)
                continue;
            try {
                const ex = db.prepare(`SELECT id FROM fornecedores WHERE nome = ?`).get(nome) as { id: number } | undefined;
                let id = ex?.id ?? null;
                if (id == null) {
                    id = Number(db.prepare(`INSERT INTO fornecedores (nome, cnpj, telefone, email, endereco, observacoes) VALUES (?, NULL, ?, ?, NULL, 'Importado do Nex (Card.nx1)')`).run(nome, f?.telefone ?? null, f?.email ?? null).lastInsertRowid);
                }
                else if (f?.email || f?.telefone) {
                    db.prepare(`UPDATE fornecedores SET email = COALESCE(NULLIF(email, ''), ?), telefone = COALESCE(NULLIF(telefone, ''), ?) WHERE id = ?`).run(f.email ?? '', f.telefone ?? '', id);
                }
                mapaFornecedores.set(nome.toLowerCase(), id);
                mapaFornecedores.set(normNome(nome), id);
            }
            catch (e) {
                erros.push(`Fornecedor ${nome}: ${e.message}`);
            }
            atualizarProgresso({ atual: i + 1 });
            if ((i + 1) % 100 === 0)
                await pausar();
        }
        // Categorias (com GUID do Nex preservado em nex_uid)
        const mapaCategorias = new Map();
        const mapaCategoriasGuid = new Map();
        for (let i = 0; i < dados.categorias.length; i++) {
            const c = dados.categorias[i];
            try {
                const nome = c.nome.trim();
                if (!nome)
                    continue;
                let id = mapaCategoriasGuid.get(c.guid);
                if (!id) {
                    const ex = db.prepare(`SELECT id FROM categorias WHERE nex_uid = ?`).get(c.guid);
                    if (ex)
                        id = ex.id;
                }
                if (!id) {
                    const exNome = db.prepare(`SELECT id FROM categorias WHERE nome = ?`).get(nome);
                    if (exNome)
                        id = exNome.id;
                }
                if (!id) {
                    id = Number(db.prepare(`INSERT INTO categorias (nome, nex_uid) VALUES (?, ?)`).run(nome, c.guid).lastInsertRowid);
                }
                else {
                    db.prepare(`UPDATE categorias SET nex_uid = ? WHERE id = ?`).run(c.guid, id);
                }
                mapaCategorias.set(normNome(nome), id);
                mapaCategoriasGuid.set(c.guid, id);
            }
            catch (e) {
                erros.push(`Categoria ${c.nome}: ${e.message}`);
            }
            atualizarProgresso({ atual: i + 1 });
            if ((i + 1) % 100 === 0)
                await pausar();
        }
        // Subcategorias (link à categoria via UID_categoria GUID)
        atualizarProgresso({ ativo: true, etapa: 'subcategorias', atual: 0, total: dados.subcategorias.length, mensagem: 'Importando subcategorias...' });
        const mapaSubcategorias = new Map();
        let subcategoriasSemCat = 0;
        let subcategoriasComCat = 0;
        for (let i = 0; i < dados.subcategorias.length; i++) {
            const s = dados.subcategorias[i];
            try {
                const nome = s.nome.trim();
                if (!nome)
                    continue;
                const categoriaId = mapaCategoriasGuid.get(s.uidCategoria) ?? null;
                const existenteGuid = db.prepare(`SELECT id FROM subcategorias WHERE nex_uid = ?`).get(s.guid);
                let id = existenteGuid?.id;
                if (!id) {
                    const exNome = db.prepare(`SELECT id FROM subcategorias WHERE nome = ? AND categoria_id IS ?`).get(nome, categoriaId);
                    id = exNome?.id;
                }
                if (!id) {
                    id = Number(db.prepare(`INSERT INTO subcategorias (categoria_id, nome, nex_uid) VALUES (?, ?, ?)`)
                        .run(categoriaId, nome, s.guid).lastInsertRowid);
                }
                else {
                    db.prepare(`UPDATE subcategorias SET categoria_id = ?, nex_uid = ? WHERE id = ?`).run(categoriaId, s.guid, id);
                }
                if (categoriaId)
                    subcategoriasComCat++;
                else
                    subcategoriasSemCat++;
                mapaSubcategorias.set(`${normNome(nome)}|${categoriaId ?? ''}`, id);
                mapaSubcategorias.set(normNome(nome), id);
            }
            catch (e) {
                erros.push(`Subcategoria ${s.nome}: ${e.message}`);
            }
            atualizarProgresso({ atual: i + 1 });
        }
        atualizarProgresso({ ativo: true, etapa: 'marcas', atual: 0, total: dados.marcas.length, mensagem: 'Importando marcas...' });
        const mapaMarcas = new Map();
        for (let i = 0; i < dados.marcas.length; i++) {
            const nome = String(dados.marcas[i]);
            const ex = db.prepare(`SELECT id FROM marcas WHERE nome = ?`).get(nome);
            const id = ex?.id ?? Number(db.prepare(`INSERT INTO marcas (nome) VALUES (?)`).run(nome).lastInsertRowid);
            mapaMarcas.set(nome.toLowerCase(), id);
            mapaMarcas.set(normNome(nome), id);
            atualizarProgresso({ atual: i + 1 });
        }
        const catNomesNorm = new Set(dados.categorias.map((c) => normNome(c.nome)));
        const subNomesNorm = new Set(dados.subcategorias.map((s) => normNome(s.nome)));
        atualizarProgresso({ ativo: true, etapa: 'produtos', atual: 0, total: dados.produtos.length, mensagem: 'Importando produtos do catálogo...' });
        let criados = 0;
        let atualizados = 0;
        let catSemSub = 0;
        let catComSub = 0;
        let produtosNomeSubcat = 0;
        const nomesJaImportados = new Set();
        const imagens = dados.imagens instanceof Map ? dados.imagens : new Map();
        // Mapa nome normalizado -> produto existente (dedup consistente com normalizarNome,
        // que remove acentos/pontuação — a query SQL lower(replace(...,' ','')) não casa esses casos).
        const mapaNomesProdutos = new Map();
        const mapaProdutoNex = new Map(); // produtoNex -> id (para MovEst)
        const mapaInfoProduto = new Map(); // codigo_interno / id -> {id, nome} (para itens de venda sem SQL)
        for (const reg of db.prepare(`SELECT id, nome, codigo_interno, codigo_barras, codigo_extra FROM produtos`).all()) {
            if (reg.id != null) { mapaNomesProdutos.set(normalizarNome(String(reg.id)), reg.id); mapaProdutoNex.set(String(reg.id), reg.id); mapaInfoProduto.set(String(reg.id), { id: reg.id, nome: reg.nome }); }
            if (reg.codigo_interno != null && reg.codigo_interno !== '') { mapaNomesProdutos.set(normNome(String(reg.codigo_interno)), reg.id); mapaProdutoNex.set(String(reg.codigo_interno), reg.id); mapaInfoProduto.set(String(reg.codigo_interno), { id: reg.id, nome: reg.nome }); }
            if (reg.codigo_barras != null && reg.codigo_barras !== '') { mapaNomesProdutos.set(normNome(String(reg.codigo_barras)), reg.id); mapaProdutoNex.set(String(reg.codigo_barras), reg.id); }
            if (reg.codigo_extra != null && reg.codigo_extra !== '') { mapaNomesProdutos.set(normNome(String(reg.codigo_extra)), reg.id); mapaProdutoNex.set(String(reg.codigo_extra), reg.id); }
        }
        for (let i = 0; i < dados.produtos.length; i++) {
            const p = dados.produtos[i];
            try {
                const nome = String(p.ProductName ?? '').trim();
                if (!nome)
                    continue;
                const chave = normNome(nome);
                if (subNomesNorm.has(chave) || catNomesNorm.has(chave)) {
                    produtosNomeSubcat++;
                    continue;
                }
                const codigo = String(p.ProductCode ?? '').trim() || null;
                // Todo produto precisa de um código. Se o Nex não trouxe, gera um
                // sequencial e o usa como codigo_interno (visível na coluna Código).
                const codigoInterno = codigo || proximoCodigoProduto();
                const categoriaNome = String(p.Category ?? '').trim();
                const subcategoriaNome = String(p.SubCategory ?? '').trim() || null;
                const marcaNome = String(p.Brand ?? '').trim();
                const unidade = String(p.Unit ?? '').trim() || 'un';
                // Preço de venda robusto: tenta SalePrice e campos alternativos do Nex,
                // aceitando número ou string com vírgula/símbolo. Nunca deixa 0 por parsing errado.
                const preco = extrairPreco(p.SalePrice, p.ListPrice, p.PrecoVenda, p.Price, p.SalePriceText);
                const precoPromo = extrairPreco(p.PromoSalePrice, p.PromotionalPrice) || null;
                const custo = extrairPreco(p.CostPrice, p.PurchasePrice, p.PrecoCusto, p.PrecoCompra, p.Cost, p.PrecoMinimo);
                const estoque = p.CurrentStock != null ? Number(p.CurrentStock) : 0;
                const estoqueMin = p.CurrentStock != null ? Number(p.CurrentStock) : 0;
                const inativo = (
                    p.Inactive === true || p.Inactive === 1 || p.Inactive === '1' || p.Inactive === 'true' || p.Inactive === 'S' || p.Inactive === 'Sim' ||
                    p.ProductInactive === true || p.ProductInactive === 1 || p.ProductInactive === '1' || p.ProductInactive === 'true' ||
                    p.InactiveFlag === true || p.InactiveFlag === 1 ||
                    p.Deleted === true || p.Deleted === 1 || p.Deleted === '1' || p.Deleted === 'true' || p.Deleted === 'Sim' ||
                    p.Excluido === true || p.Excluido === 1 || p.Excluido === '1' || p.Excluido === 'true' || p.Excluido === 'Sim' ||
                    p.Inativo === true || p.Inativo === 1 || p.Inativo === '1' || p.Inativo === 'true' || p.Inativo === 'Sim'
                ) ? 1 : 0;
                const publicado = p.ProductPublished === true || p.ProductPublished === 1 || p.ProductPublished === '1' ? 1 : 0;
                const descricao = p.ProductDescr != null ? String(p.ProductDescr) : null;
                const observacoes = p.Observations != null ? String(p.Observations) : null;
                const categoriaId = categoriaNome ? (mapaCategorias.get(normNome(categoriaNome)) ?? null) : null;
                const marcaId = marcaNome ? (mapaMarcas.get(normNome(marcaNome)) ?? null) : null;
                const promoAtiva = p.PromoActive === true ? 1 : 0;
                const guidProduto = p.ProductUId != null ? String(p.ProductUId).replace(/[{}]/g, '').toLowerCase() : null;
                // Foto do produto: ProductImg é o hash de 32 hex que indexa o blob dentro do Produto.nx1;
                // fallback para o primeiro hash do campo Photos (array), se existir.
                let imagemNex = null;
                const hashImg = String(p.ProductImg ?? '').trim().toLowerCase().replace(/[{}]/g, '');
                if (hashImg && imagens.has(hashImg))
                    imagemNex = imagens.get(hashImg);
                if (!imagemNex) {
                    const photos = p.Photos;
                    if (Array.isArray(photos)) {
                        for (const ph of photos) {
                            const k = String(ph ?? '').trim().toLowerCase().replace(/[{}]/g, '');
                            if (k && imagens.has(k)) { imagemNex = imagens.get(k); break; }
                        }
                    }
                }
                let subcategoriaId = null;
                if (subcategoriaNome) {
                    subcategoriaId = mapaSubcategorias.get(`${normNome(subcategoriaNome)}|${categoriaId ?? ''}`)
                        ?? mapaSubcategorias.get(normNome(subcategoriaNome))
                        ?? null;
                }
                if (subcategoriaId)
                    catComSub++;
                else
                    catSemSub++;
                const existente = codigoInterno
                    ? db.prepare(`SELECT id FROM produtos WHERE codigo_barras = ?`).get(codigoInterno)
                    : undefined;
                const porNome = existente ? undefined : mapaNomesProdutos.get(chave);
                const agora = new Date().toISOString();
                const precoParaSalvar = preco > 0 ? preco : null;
                const dadosSql = [
                    nome, codigoInterno, imagemNex, categoriaId, marcaId, null, precoParaSalvar, estoque, estoqueMin, unidade,
                    inativo ? 0 : 1, descricao, precoPromo, promoAtiva, null, null, null, observacoes,
                    custo, codigoInterno, null, null, null, null, 1, 0, 1, 1, subcategoriaId, null, null, 0, 0, agora, guidProduto
                ];
                const alvo = existente ?? porNome;
                if (alvo) {
                    const alvoId = (alvo && typeof alvo === 'object') ? (alvo as { id: number }).id : (alvo as number);
                    const precoAtual = db.prepare(`SELECT preco_venda FROM produtos WHERE id = ?`).get(alvoId) as { preco_venda: number } | undefined;
                    const precoFinal = preco > 0 ? preco : (precoAtual?.preco_venda ?? 0);
                    db.prepare(`UPDATE produtos SET nome=?, codigo_barras=?, imagem=?, categoria_id=?, marca_id=?, fornecedor_id=?, preco_venda=?, estoque=?, estoque_minimo=?, unidade=?, ativo=?, descricao=?, preco_promo=?, promocional=?, peso_liq=?, peso_bruto=?, localizacao=?, observacoes=?, preco_custo=?, codigo_interno=?, codigo_extra=?, ncm=?, cest=?, estoque_maximo=?, controla_estoque=?, permite_fracionado=?, publicado=?, catalogo_publicado=?, subcategoria_id=?, preco_atacado1=?, preco_atacado2=?, qtd_min_atacado1=?, qtd_min_atacado2=?, alterado_em=?, nex_uid=? WHERE id=?`).run(
                        ...dadosSql.slice(0, 6), precoFinal, ...dadosSql.slice(7), alvoId
                    );
                    atualizados++;
                }
                else {
                    const novoId = Number(db.prepare(`INSERT INTO produtos (nome, codigo_barras, imagem, categoria_id, marca_id, fornecedor_id, preco_venda, estoque, estoque_minimo, unidade, ativo, descricao, preco_promo, promocional, peso_liq, peso_bruto, localizacao, observacoes, preco_custo, codigo_interno, codigo_extra, ncm, cest, estoque_maximo, controla_estoque, permite_fracionado, publicado, catalogo_publicado, subcategoria_id, preco_atacado1, preco_atacado2, qtd_min_atacado1, qtd_min_atacado2, alterado_em, nex_uid)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...dadosSql).lastInsertRowid);
                    mapaNomesProdutos.set(chave, novoId);
                    criados++;
                }
                nomesJaImportados.add(chave);
            }
            catch (e) {
                erros.push(`Produto ${String(p.ProductName ?? '')}: ${e.message}`);
            }
            atualizarProgresso({ atual: i + 1, mensagem: `Importando produtos do catálogo ${i + 1} de ${dados.produtos.length}...` });
            if ((i + 1) % 200 === 0)
                await pausar();
        }
        // Mapa de preço do catálogo JSON para usar no Produto.nx1 (busca por EAN ou nome normalizado)
        const precoCatalogoPorEan = new Map();
        const precoCatalogoPorNome = new Map();
        const custoCatalogoPorEan = new Map();
        const custoCatalogoPorNome = new Map();
        const inativoCatalogoPorEan = new Map();
        const inativoCatalogoPorNome = new Map();
        for (const p of dados.produtos) {
            const preco = extrairPreco(p.SalePrice, p.ListPrice, p.PrecoVenda, p.Price, p.SalePriceText);
            const custo = extrairPreco(p.CostPrice, p.PurchasePrice, p.PrecoCusto, p.PrecoCompra, p.Cost, p.PrecoMinimo);
            const inativo2 = (
                p.Inactive === true || p.Inactive === 1 || p.Inactive === '1' || p.Inactive === 'true' || p.Inactive === 'S' || p.Inactive === 'Sim' ||
                p.ProductInactive === true || p.ProductInactive === 1 || p.ProductInactive === '1' ||
                p.Deleted === true || p.Deleted === 1 || p.Deleted === '1' || p.Deleted === 'true' ||
                p.Excluido === true || p.Excluido === 1 || p.Excluido === '1' || p.Excluido === 'true' ||
                p.Inativo === true || p.Inativo === 1 || p.Inativo === '1' || p.Inativo === 'true'
            ) ? 1 : 0;
            const ean = String(p.ProductCode ?? '').trim();
            const nome = String(p.ProductName ?? '').trim();
            const chave = normNome(nome);
            if (ean) {
                if (preco > 0) precoCatalogoPorEan.set(ean, preco);
                if (custo > 0) custoCatalogoPorEan.set(ean, custo);
                inativoCatalogoPorEan.set(ean, inativo2);
            }
            if (nome) {
                if (preco > 0) precoCatalogoPorNome.set(chave, preco);
                if (custo > 0) custoCatalogoPorNome.set(chave, custo);
                inativoCatalogoPorNome.set(chave, inativo2);
            }
        }
        atualizarProgresso({ ativo: true, etapa: 'produtos_nx1', atual: 0, total: dados.produtosNx1.length, mensagem: 'Importando produtos do Produto.nx1...' });
        let nx1Criados = 0;
        let nx1Duplicados = 0;
        let nx1SemCat = 0;
        let nx1ComSub = 0;
        let nx1SemSub = 0;
        for (let i = 0; i < dados.produtosNx1.length; i++) {
            const p = dados.produtosNx1[i];
            try {
                const nome = p.nome.trim();
                if (!nome)
                    continue;
                if (ehNomeGarbage(nome)) {
                    nx1Duplicados++;
                    continue;
                }
                const chave = normNome(nome);
                if (subNomesNorm.has(chave) || catNomesNorm.has(chave)) {
                    produtosNomeSubcat++;
                    continue;
                }
                const ean = p.ean != null ? String(p.ean) : null;
                const existente = ean
                    ? db.prepare(`SELECT id FROM produtos WHERE codigo_barras = ?`).get(ean)
                    : undefined;
                const porNome = existente ? undefined : mapaNomesProdutos.get(chave);
                if (existente || porNome || nomesJaImportados.has(chave)) {
                    nx1Duplicados++;
                    continue;
                }
                const catId = p.cat ? (mapaCategorias.get(normNome(p.cat)) ?? null) : null;
                if (!catId)
                    nx1SemCat++;
                let subcategoriaId = null;
                if (p.sub) {
                    subcategoriaId = mapaSubcategorias.get(`${normNome(p.sub)}|${catId ?? ''}`)
                        ?? mapaSubcategorias.get(normNome(p.sub))
                        ?? null;
                }
                const codigoNx1 = p.codigo != null && String(p.codigo).trim() ? String(p.codigo).trim() : (ean || proximoCodigoProduto());
                // Buscar preço/custo/status no catálogo JSON (por EAN ou nome normalizado)
                const precoCatalogo = ean ? precoCatalogoPorEan.get(ean) : null;
                const precoFinal = precoCatalogo ?? (precoCatalogoPorNome.get(chave) ?? 0);
                const custoFinal = (ean ? custoCatalogoPorEan.get(ean) : null) ?? (custoCatalogoPorNome.get(chave) ?? 0);
                const inativoNx1 = (ean ? inativoCatalogoPorEan.get(ean) : null) ?? (inativoCatalogoPorNome.get(chave) ?? 0) ?? 0;
                const novoId = Number(db.prepare(`INSERT INTO produtos (nome, codigo_barras, categoria_id, subcategoria_id, preco_custo, preco_venda, estoque, estoque_minimo, unidade, ativo, descricao, codigo_interno, codigo_extra, controla_estoque, publicado, catalogo_publicado, nex_uid)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'un', ?, NULL, ?, ?, 0, 0, 0, NULL)`).run(nome, ean, catId, subcategoriaId, custoFinal, precoFinal, inativoNx1 ? 0 : 1, codigoNx1, codigoNx1).lastInsertRowid);
                mapaNomesProdutos.set(chave, novoId);
                if (subcategoriaId)
                    nx1ComSub++;
                else
                    nx1SemSub++;
                nomesJaImportados.add(chave);
                nx1Criados++;
            }
            catch (e) {
                erros.push(`ProdutoNx1 ${p.nome}: ${e.message}`);
            }
            atualizarProgresso({ atual: i + 1, mensagem: `Produtos Produto.nx1 ${i + 1} de ${dados.produtosNx1.length}...` });
            if ((i + 1) % 200 === 0)
                await pausar();
        }
        atualizarProgresso({ ativo: true, etapa: 'clientes', atual: 0, total: dados.clientes.length, mensagem: 'Importando clientes...' });
        let clientesCriados = 0;
        let clientesDedup = 0;
        // dedup por nome normalizado (a UI não lista por CPF; nomes repetidos poluem a busca)
        const mapaNomesClientes = new Map();
        for (const reg of db.prepare(`SELECT id, nome FROM clientes`).all()) {
            const k = normNome(String(reg.nome));
            if (k && !mapaNomesClientes.has(k))
                mapaNomesClientes.set(k, reg.id);
        }
        for (let i = 0; i < dados.clientes.length; i++) {
            const c = dados.clientes[i];
            try {
                const nome = String(c.nome ?? '').trim();
                if (!nome)
                    continue;
                const cpf = String(c.cpf ?? '').replace(/\D/g, '') || null;
                const chaveNome = normNome(nome);
                const existente = cpf && cpf.length === 11
                    ? db.prepare(`SELECT id FROM clientes WHERE cpf = ?`).get(cpf)
                    : undefined;
                const porNome = existente ? undefined : mapaNomesClientes.get(chaveNome);
                const observacoes = c.observacoes != null ? String(c.observacoes).slice(0, 400) : null;
                const codigoCliente = c.codigo != null && String(c.codigo).trim() ? String(c.codigo).trim() : proximoCodigoCliente();
                const dadosCli = [
                    nome, c.telefone != null ? String(c.telefone) : null, c.email != null ? String(c.email) : null,
                    c.endereco != null ? String(c.endereco) : null, c.cpf != null ? String(c.cpf) : null,
                    null, null, c.rg != null ? String(c.rg) : null, null, 0, null,
                    observacoes,
                    c.numero != null ? String(c.numero) : null, c.bairro != null ? String(c.bairro) : null,
                    c.cidade != null ? String(c.cidade) : null, c.uf != null ? String(c.uf) : null,
                    c.cep != null ? String(c.cep) : null, c.pai != null ? String(c.pai) : null,
                    c.mae != null ? String(c.mae) : null, codigoCliente
                ];
                const alvo = existente ?? porNome;
                const alvoId = (alvo && typeof alvo === 'object') ? (alvo as { id: number }).id : (alvo as number);
                const agoraCli = new Date().toISOString();
                if (alvo) {
                    db.prepare(`UPDATE clientes SET nome=?, telefone=?, email=?, endereco=?, cpf=?, celular=?, data_nascimento=?, rg=?, genero=?, empresa=?, cnpj=?, observacoes=?, numero=?, bairro=?, cidade=?, uf=?, cep=?, pai=?, mae=?, codigo=?, criado_em=? WHERE id=?`).run(...dadosCli, agoraCli, alvoId);
                    if (!existente && porNome)
                        clientesDedup++;
                    if (!mapaNomesClientes.has(chaveNome))
                        mapaNomesClientes.set(chaveNome, alvoId);
                }
                else {
                    const novoId = Number(db.prepare(`INSERT INTO clientes (nome, telefone, email, endereco, cpf, celular, data_nascimento, rg, genero, empresa, cnpj, observacoes, numero, bairro, cidade, uf, cep, pai, mae, codigo, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...dadosCli, agoraCli).lastInsertRowid);
                    clientesCriados++;
                    mapaNomesClientes.set(chaveNome, novoId);
                }
            }
            catch (e) {
                erros.push(`Cliente ${String(c.nome ?? '')}: ${e.message}`);
            }
            atualizarProgresso({ atual: i + 1, mensagem: `Importando clientes ${i + 1} de ${dados.clientes.length}...` });
            if ((i + 1) % 100 === 0)
                await pausar();
        }
        atualizarProgresso({ ativo: true, etapa: 'usuarios', atual: 0, total: dados.usuarios.length + 1, mensagem: 'Importando usuários...' });
        let usuariosCriados = 0;
        // Perfil vendedor padrão: mesmas permissões da tela de Usuários (sem ações de admin/gerente).
        const MODULOS_VENDEDOR = [
            'caixa_ver_anteriores', 'caixa_suprimento', 'caixa_sangria', 'caixa_abrir_fechar',
            'caixa_ver_totalizacao', 'caixa_ver_colunas_valores', 'caixa_ver_transacoes', 'caixa_ver_canais_venda',
            'clientes_cadastrar', 'clientes_acessar', 'clientes_receber_debitos',
            'gerais_imprimir_exportar', 'gerais_abrir_gaveta',
            'produtos_acessar', 'produtos_cadastro_rapido',
            'estoque_acessar', 'estoque_movimentar',
            'vendas_acessar', 'vendas_editar_pagamento',
            'relatorios_acessar'
        ];
        const mapaOperadorId = new Map();
        const garantirUsuario = (nome, login, admin) => {
            const existente = db.prepare(`SELECT id, perfil FROM usuarios WHERE login = ?`).get(login);
            if (existente) {
                if (admin)
                    db.prepare(`UPDATE usuarios SET perfil = 'admin', ativo = 1, usar_web = 1, usar_app = 1 WHERE id = ?`).run(existente.id);
                return existente.id;
            }
            const perfil = admin ? 'admin' : 'vendedor';
            const senha = admin ? (0, index_1.hashSenha)('admin123') : '';
            const id = Number(db.prepare(`INSERT INTO usuarios (nome, login, senha_hash, perfil, comissao_percent, ativo, usar_web, usar_app)
            VALUES (?, ?, ?, ?, 0, 1, 1, 1)`).run(nome, login, senha, perfil).lastInsertRowid);
            usuariosCriados++;
            if (!admin) {
                const insPerm = db.prepare(`INSERT OR IGNORE INTO permissoes (usuario_id, modulo) VALUES (?, ?)`);
                for (const m of MODULOS_VENDEDOR)
                    insPerm.run(id, m);
            }
            return id;
        };
        const liLogin = (s) => String(s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._ -]/g, '').replace(/\s+/g, '_').slice(0, 40) || 'operador';
        // operadores vistos nas vendas (Tran.nx1). 'admin' (operador do Nex) vira o admin do sistema.
        for (const nome of [...new Set(dados.vendas.map((v) => String(v.operador ?? '').trim()).filter((x) => x))]) {
            try {
                const login = nome.toLowerCase() === 'admin' ? 'admin' : liLogin(nome);
                const id = garantirUsuario(nome, login, nome.toLowerCase() === 'admin');
                mapaOperadorId.set(normNome(nome), id);
                mapaOperadorId.set(nome.toLowerCase(), id);
            }
            catch (e) {
                erros.push(`Operador ${nome}: ${e.message}`);
            }
        }
        // usuários cadastrados do Usuario.nx1 (quando houver)
        for (let i = 0; i < dados.usuarios.length; i++) {
            const u = dados.usuarios[i];
            try {
                const login = String(u.username ?? '').trim().toLowerCase();
                if (!login || login === 'admin')
                    continue;
                const nome = String(u.nome ?? u.username ?? '').trim() || login;
                const id = garantirUsuario(nome, login, false);
                mapaOperadorId.set(normNome(nome), id);
                mapaOperadorId.set(normNome(login), id);
                mapaOperadorId.set(login, id);
            }
            catch (e) {
                erros.push(`Usuário ${String(u.username ?? '')}: ${e.message}`);
            }
            atualizarProgresso({ atual: i + 2 });
        }
        // garante o admin (login para o dono da loja)
        const adminId = garantirUsuario('Administrador', 'admin', true);
        mapaOperadorId.set('admin', adminId);
        // Cada número de caixa do Nex agrupa uma sessão (aberto->fechado). As vendas carregam
        // data + número; derivamos a janela da sessão (min/max) das próprias vendas e criamos
        // um caixa real por sessão, guardando número->id para vincular as vendas à página de
        // caixas. Antes, caixa_id recebia o número do Nex (1..1685) e quebrava o FK de caixas
        // (PRAGMA foreign_keys ON), então TODAS as vendas falhavam e "as transações não importavam".
        atualizarProgresso({ ativo: true, etapa: 'caixas', atual: 0, total: dados.vendas.length, mensagem: 'Organizando caixas a partir das vendas...' });
        const caixaIdPorNumero = new Map();
        const sessaoPorNumero = new Map();
        for (const vv of dados.vendas) {
            const v = vv;
            const num = Number(v.caixa);
            if (!(num > 0))
                continue;
            const t = Date.parse(String(v.data ?? '').replace('T', ' ').replace('Z', '').slice(0, 19));
            if (isNaN(t))
                continue;
            const s = sessaoPorNumero.get(num);
            if (!s)
                sessaoPorNumero.set(num, { min: t, max: t, ops: new Map(), comItens: false });
            else {
                if (t < s.min)
                    s.min = t;
                if (t > s.max)
                    s.max = t;
            }
        }
        // operador dominante + marcador "tem vendas sem data com itens" por sessão
        for (const vv of dados.vendas) {
            const v = vv;
            const num = Number(v.caixa);
            if (!(num > 0))
                continue;
            const s = sessaoPorNumero.get(num);
            if (s && v.operador) {
                const op = String(v.operador).trim().toLowerCase();
                s.ops.set(op, (s.ops.get(op) || 0) + 1);
            }
        }
        const toSql = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
        // data de referência de cada sessão (usada para vendas sem data própria)
        const dataSessaoPorNumero = new Map();
        for (const [num, s] of sessaoPorNumero)
            dataSessaoPorNumero.set(num, toSql(s.min));
        let caixasCriados = 0;
        let caixaCont = 0;
        for (const [num, s] of [...sessaoPorNumero.entries()].sort((a, b) => a[0] - b[0])) {
            try {
                const abertoEm = toSql(s.min);
                const fechadoEm = toSql(s.max);
                const opPrincipal = [...s.ops.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
                const usuarioId = opPrincipal ? (mapaOperadorId.get(normNome(opPrincipal)) ?? mapaOperadorId.get(opPrincipal) ?? null) : null;
                const ex = db.prepare(`SELECT id FROM caixas WHERE aberto_em = ? AND fechado_em = ?`).get(abertoEm, fechadoEm);
                if (ex) {
                    caixaIdPorNumero.set(num, ex.id);
                    if (usuarioId)
                        db.prepare(`UPDATE caixas SET usuario_id = ?, usuario_fechamento = ? WHERE id = ?`).run(usuarioId, usuarioId, ex.id);
                }
                else {
                    const id = Number(db.prepare(`INSERT INTO caixas (usuario_id, usuario_fechamento, aberto, saldo_inicial, total_vendas, total_sangrias, total_suprimentos, descontos, cancelamentos, qtd_vendas, aberto_em, fechado_em)
            VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`).run(usuarioId, usuarioId, abertoEm, fechadoEm).lastInsertRowid);
                    caixaIdPorNumero.set(num, id);
                    caixasCriados++;
                }
            }
            catch (e) {
                erros.push(`Caixa ${num}: ${e.message}`);
            }
            caixaCont++;
            atualizarProgresso({ atual: caixaCont });
            if (caixaCont % 100 === 0)
                await pausar();
        }
        atualizarProgresso({ ativo: true, etapa: 'vendas', atual: 0, total: dados.vendas.length, mensagem: `Importando vendas (${dados.vendas.length})...` });
        let vendasCriadas = 0;
        let vendasSemPag = 0;
        let vendasSemItem = 0;
        let itensImportados = 0;
        let pagamentosImportados = 0;
        // correlação de itens -> venda por vínculo EXATO (item.tran == venda.id),
        // em vez da antiga janela de tempo de 60s (que gerava vínculos faltantes/errados).
        const itensDaVenda = new Map();
        for (const it of dados.itens) {
            const tran = Number(it.tran);
            if (!(tran > 0))
                continue;
            if (!itensDaVenda.has(tran))
                itensDaVenda.set(tran, []);
            itensDaVenda.get(tran).push(it);
        }
        // pagamentos: correlação por tempo (segundo mais próximo à data da venda)
        const normData = (d) => d ? String(d).slice(0, 19) : '';
        const vendaIdPorIdx = new Map();
        dados.vendas.forEach((vv, idx) => vendaIdPorIdx.set(idx, Number(vv.id)));
        const vendasTempo = dados.vendas
            .map((vv, idx) => ({ idx, t: Date.parse(normData(String(vv.data ?? ''))) }))
            .filter((x) => !isNaN(x.t))
            .sort((a, b) => a.t - b.t);
        const temposVenda = vendasTempo.map((x) => x.t);
        const indicesVenda = vendasTempo.map((x) => x.idx);
        const vendaMaisProxima = (t) => {
            let lo = 0, hi = temposVenda.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (temposVenda[mid] < t)
                    lo = mid + 1;
                else
                    hi = mid - 1;
            }
            let melhor = -1, melhorD = 60 * 1000;
            for (const cand of [hi, lo]) {
                if (cand < 0 || cand >= temposVenda.length)
                    continue;
                const d = Math.abs(temposVenda[cand] - t);
                if (d < melhorD) {
                    melhorD = d;
                    melhor = indicesVenda[cand];
                }
            }
            return melhor;
        };
        const pagsDaVenda = new Map();
        for (const p of dados.pagamentos) {
            const t = Date.parse(normData(String(p.data ?? '')));
            const vi = isNaN(t) ? -1 : vendaMaisProxima(t);
            if (vi < 0)
                continue;
            const vendaId = vendaIdPorIdx.get(vi);
            if (vendaId === undefined)
                continue;
            if (!pagsDaVenda.has(vendaId))
                pagsDaVenda.set(vendaId, []);
            pagsDaVenda.get(vendaId).push(p);
        }
        // idempotência: já importadas? (numero NEX-{id da venda})
        const vendasJaImportadas = new Set();
        db.prepare(`SELECT numero FROM vendas WHERE numero LIKE 'NEX-%'`).all().forEach(r => {
            const m = r.numero.match(/NEX-(\d+)/);
            if (m)
                vendasJaImportadas.add(Number(m[1]));
        });
        const vendaIdPorNex = new Map();
        let vendasDescartadas = 0;
        let vendasSemDataPropria = 0;
        // Mapa em memória de produto por código/id: evita um SELECT full-scan por item
        // (124k itens × milhares de produtos travava a importação em dezenas de minutos).
        const mapaProdutoInfoFinal = new Map();
        for (const reg of db.prepare(`SELECT id, nome, codigo_interno FROM produtos`).all()) {
            mapaProdutoInfoFinal.set(String(reg.id), { id: reg.id, nome: reg.nome });
            if (reg.codigo_interno != null && reg.codigo_interno !== '')
                mapaProdutoInfoFinal.set(String(reg.codigo_interno), { id: reg.id, nome: reg.nome });
        }
        for (let i = 0; i < dados.vendas.length; i++) {
            const v = dados.vendas[i];
            try {
                let dataIso = String(v.data ?? '');
                const idNex = Number(v.id);
                if (!(idNex > 0))
                    continue;
                const numero = `NEX-${idNex}`;
                if (vendasJaImportadas.has(idNex))
                    continue;
                const itensVenda = itensDaVenda.get(idNex) || [];
                const pagsVenda = pagsDaVenda.get(idNex) || [];
                // documento sem data e sem itens/pagamentos = NÃO é venda (Compra, Ajuste,
                // Orçamento, tabela de doc. genéricos do Tran). Importá-los inflava o
                // dashboard (bastava "hoje" virar o dia da importação) e os totais por caixa.
                const ehVendaReal = itensVenda.length > 0 || pagsVenda.length > 0;
                if (!ehVendaReal) {
                    vendasDescartadas++;
                    continue;
                }
                let data = dataIso.replace('T', ' ').replace('Z', '');
                if (!data) {
                    const dtSessao = dataSessaoPorNumero.get(Number(v.caixa));
                    if (!dtSessao) {
                        vendasDescartadas++;
                        continue;
                    }
                    data = dtSessao;
                    dataIso = dtSessao;
                    vendasSemDataPropria++;
                }
                if (pagsVenda.length === 0)
                    vendasSemPag++;
                if (itensVenda.length === 0)
                    vendasSemItem++;
                // total/subtotal da venda = soma dos totais dos itens reais (fonte MovEst)
                const somaItens = itensVenda.reduce((s, it) => s + (Number(it.total) || 0), 0);
                const total = somaItens > 0 ? Math.round(somaItens * 100) / 100 : 0;
                const subtotal = total;
                const caixaIdReal = Number(v.caixa) > 0 ? (caixaIdPorNumero.get(Number(v.caixa)) ?? null) : null;
                const nomeOperador = String(v.operador ?? '').trim();
                const vendedorId = nomeOperador
                    ? (mapaOperadorId.get(normNome(nomeOperador)) ?? mapaOperadorId.get(nomeOperador.toLowerCase()) ?? null)
                    : null;
                const vendaId = Number(db.prepare(`INSERT INTO vendas (numero, vendedor_id, cliente_id, tipo, subtotal, desconto, total, status, created_at, caixa_id, observacoes)
          VALUES (?, ?, NULL, 'balcao', ?, 0, ?, 'concluida', ?, ?, ?)`)
                    .run(numero, vendedorId, subtotal, total, data, caixaIdReal, `Importado do Nex. Data original: ${dataIso}`).lastInsertRowid);
                vendaIdPorNex.set(idNex, vendaId);
                vendasCriadas++;
                // itens (com produto, quantidade e preço reais do MovEst)
                for (const it of itensVenda) {
                    const produtoNex = Number(it.produtoNex) || 0;
                    const quant = Number(it.quant) || 0;
                    const unit = Number(it.unit) || 0;
                    const totIt = Number(it.total) || 0;
                    const prodEncontrado = produtoNex > 0 ? mapaProdutoInfoFinal.get(String(produtoNex)) : undefined;
                    const prodId = prodEncontrado?.id ?? null;
                    const nomeProduto = prodId != null && prodEncontrado?.nome ? prodEncontrado.nome : `produto#${produtoNex || 'desconhecido'}`;
                    db.prepare(`INSERT INTO venda_itens (venda_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal)
            VALUES (?, ?, ?, ?, ?, ?)`)
                        .run(vendaId, prodId, nomeProduto, quant, unit, totIt);
                    itensImportados++;
                }
                // pagamentos
                for (const p of pagsVenda) {
                    const forma = String(p.forma ?? '');
                    const valor = p.valorCentavos != null ? Number(p.valorCentavos) / 100 : 0;
                    db.prepare(`INSERT INTO pagamentos (venda_id, forma, valor, criado_em) VALUES (?, ?, ?, ?)`)
                        .run(vendaId, `NEX-forma-${forma}`, valor, data);
                    pagamentosImportados++;
                }
            }
            catch (e) {
                erros.push(`Venda ${String(v.data ?? '')}: ${e.message}`);
            }
            atualizarProgresso({ atual: i + 1, mensagem: `Vendas ${i + 1} de ${dados.vendas.length}...` });
            if ((i + 1) % 200 === 0)
                await pausar();
        }
        // Totais reais por caixa a partir das vendas importadas (a página de caixas
        // mostra esses valores; antes ficavam sempre zerados).
        db.prepare(`UPDATE caixas SET
            total_vendas = COALESCE((SELECT SUM(total) FROM vendas WHERE vendas.caixa_id = caixas.id AND vendas.status != 'cancelada'), 0),
            descontos = COALESCE((SELECT SUM(desconto) FROM vendas WHERE vendas.caixa_id = caixas.id AND vendas.status != 'cancelada'), 0),
            qtd_vendas = (SELECT COUNT(*) FROM vendas WHERE vendas.caixa_id = caixas.id AND vendas.status != 'cancelada')`).run();
        // Movimentações de estoque a partir do MovEst: item vinculado a uma venda
        // importada = SAÍDA (na data da venda); item de outro documento = ENTRADA.
        atualizarProgresso({ ativo: true, etapa: 'movimentacoes', atual: 0, total: dados.itens.length, mensagem: `Importando movimentações de estoque (${dados.itens.length})...` });
        const dataVendaPorId = new Map();
        for (const reg of db.prepare(`SELECT id, created_at FROM vendas`).all())
            dataVendaPorId.set(reg.id, String(reg.created_at ?? ''));
        const insMov = db.prepare(`INSERT INTO movimentacoes (produto_id, tipo, quantidade, motivo, venda_id, criado_em)
            VALUES (?, ?, ?, 'Importada do Nex (MovEst)', ?, ?)`);
        let movimentacoesImportadas = 0;
        for (let i = 0; i < dados.itens.length; i++) {
            const it = dados.itens[i];
            try {
                const quantidade = Number(it.quant);
                if (!(quantidade > 0))
                    continue;
                const produtoId = mapaProdutoNex.get(String(it.produtoNex ?? '')) ?? null;
                if (!produtoId)
                    continue;
                const vendaId = vendaIdPorNex.get(Number(it.tran)) ?? null;
                const tipo = vendaId ? 'saida' : 'entrada';
                const criado = vendaId
                    ? (dataVendaPorId.get(vendaId) ?? null)
                    : '2000-01-01 00:00:00';
                insMov.run(produtoId, tipo, quantidade, vendaId, criado);
                movimentacoesImportadas++;
            }
            catch (e) {
                erros.push(`Movimentação ${String(it.uid ?? '')}: ${e.message}`);
            }
            atualizarProgresso({ atual: i + 1 });
            if ((i + 1) % 500 === 0)
                await pausar();
        }
        // Custo de produto derivado das ENTRADAS do MovEst: itens sem venda
        // vinculada (compras/ajustes) carregam o valor unitário de entrada, que
        // é o custo. A última entrada no arquivo vence (ordem ≈ cronológica).
        const custoPorProduto = new Map();
        for (let i = 0; i < dados.itens.length; i++) {
            const it = dados.itens[i];
            if (!(Number(it.quant) > 0))
                continue;
            const vendaId = vendaIdPorNex.get(Number(it.tran)) ?? null;
            if (vendaId)
                continue; // só entradas (compra/ajuste) representam custo
            const produtoId = mapaProdutoNex.get(String(it.produtoNex ?? '')) ?? null;
            if (!produtoId)
                continue;
            const unit = Number(it.unit);
            if (unit > 0 && unit < 1e6)
                custoPorProduto.set(produtoId, unit);
        }
        const updCusto = db.prepare(`UPDATE produtos SET preco_custo = ? WHERE id = ? AND (preco_custo IS NULL OR preco_custo <= 0)`);
        let custosAplicados = 0;
        for (const [pid, custo] of custoPorProduto) {
            const r = updCusto.run(custo, pid);
            if (r.changes && r.changes > 0)
                custosAplicados++;
        }
        atualizarProgresso({ ativo: true, etapa: 'remocoes', atual: 0, total: dados.remocoes.length, mensagem: `Importando histórico de remoções (${dados.remocoes.length})...` });
        let remocoesImportadas = 0;
        for (const r of dados.remocoes) {
            try {
                const ex = db.prepare(`SELECT id FROM historico_remocoes WHERE uid_ref IS NULL AND descricao = ? AND data = ?`).get(r.descricao != null ? String(r.descricao) : null, r.data != null ? String(r.data) : null);
                if (!ex) {
                    db.prepare(`INSERT INTO historico_remocoes (uid_ref, id_ref, tabela_origem, descricao, removido_por, data, bytes_brutos) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                        .run(r.uid_ref != null ? String(r.uid_ref) : null, r.id_ref != null ? Number(r.id_ref) : null, r.tabela_origem != null ? String(r.tabela_origem) : null, r.descricao != null ? String(r.descricao) : null, r.removido_por != null ? String(r.removido_por) : null, r.data != null ? String(r.data) : null, r.bytes_brutos != null ? String(r.bytes_brutos) : null);
                    remocoesImportadas++;
                }
            }
            catch (e) {
                erros.push(`Remoção ${String(r.descricao ?? '')}: ${e.message}`);
            }
        }
        atualizarProgresso({ ativo: true, etapa: 'syslog', atual: 0, total: dados.syslogs.length, mensagem: `Importando logs do sistema (${dados.syslogs.length})...` });
        let syslogsImportados = 0;
        for (const s of dados.syslogs) {
            try {
                db.prepare(`INSERT INTO logs_sistema (data, info, origem, bytes_brutos) VALUES (NULL, ?, 'nex_syslog', NULL)`).run(s.info != null ? String(s.info) : null);
                syslogsImportados++;
            }
            catch (e) {
                erros.push(`Syslog: ${e.message}`);
            }
            if (syslogsImportados % 500 === 0)
                await pausar();
        }
        atualizarProgresso({ ativo: true, etapa: 'terminais', atual: 0, total: dados.terminais.length, mensagem: `Importando terminais (${dados.terminais.length})...` });
        let terminaisImportados = 0;
        for (const t of dados.terminais) {
            try {
                db.prepare(`INSERT INTO terminais (term_id, nome, opcoes, bytes_brutos) VALUES (?, ?, ?, ?)`)
                    .run(t.term_id != null ? String(t.term_id) : null, t.nome != null ? String(t.nome) : null, t.opcoes != null ? String(t.opcoes) : null, t.bytes_brutos != null ? String(t.bytes_brutos) : null);
                terminaisImportados++;
            }
            catch (e) {
                erros.push(`Terminal: ${e.message}`);
            }
        }
        atualizarProgresso({ ativo: true, etapa: 'nao_interpretados', atual: 0, total: dados.naoInterpretados.length, mensagem: 'Registrando dados não interpretados...' });
        // preservar dados não interpretados em JSON bruto
        if (dados.naoInterpretados.length > 0) {
            try {
                const dirRaw = (0, node_path_1.join)((0, index_1.getDefaultDbPath)(), '..', 'nex_nao_interpretados');
                (0, node_fs_1.mkdirSync)(dirRaw, { recursive: true });
                (0, node_fs_1.writeFileSync)((0, node_path_1.join)(dirRaw, 'nao_interpretados.json'), JSON.stringify(dados.naoInterpretados, null, 1));
            }
            catch { /* ignore */ }
        }
        const nomesSubcategoriasDistintos = new Set(dados.subcategorias.map((s) => normNome(s.nome))).size;
        // Quando o Nex traz categorias/subcategorias, as padrões do seed
        // (Cigarros, Charutos, Tabaco, Acessorios, Bebidas) saem — ficam só as importadas.
        // Antes de apagar, desvincula produtos e subcategorias que apontavam para elas.
        if (dados.categorias.length > 0 || dados.subcategorias.length > 0) {
            db.prepare(`UPDATE produtos SET categoria_id = NULL WHERE categoria_id IN (SELECT id FROM categorias WHERE nex_uid IS NULL)`).run();
            db.prepare(`UPDATE subcategorias SET categoria_id = NULL WHERE categoria_id IN (SELECT id FROM categorias WHERE nex_uid IS NULL)`).run();
            db.prepare(`DELETE FROM categorias WHERE nex_uid IS NULL`).run();
            db.prepare(`DELETE FROM subcategorias WHERE nex_uid IS NULL`).run();
        }
        else {
            // Sem categorias no Nex: apenas limpa as do seed que não estão em uso.
            db.prepare(`DELETE FROM categorias WHERE nex_uid IS NULL
       AND id NOT IN (SELECT COALESCE(categoria_id, 0) FROM produtos)
       AND id NOT IN (SELECT COALESCE(categoria_id, 0) FROM subcategorias)`).run();
        }
        db.exec('COMMIT');
        // Persiste os contadores de sequência gerados na importação para manter
        // consistência com os códigos criados no frontend.
        try {
            db.prepare(`INSERT OR IGNORE INTO sequencias (chave, valor) VALUES ('produto_codigo', 0)`).run();
            db.prepare(`UPDATE sequencias SET valor = ? WHERE chave = 'produto_codigo'`).run(seqProduto);
            db.prepare(`INSERT OR IGNORE INTO sequencias (chave, valor) VALUES ('cliente_codigo', 0)`).run();
            db.prepare(`UPDATE sequencias SET valor = ? WHERE chave = 'cliente_codigo'`).run(seqCliente);
        }
        catch { /* sequencias pode não existir em bases antigas */ }
        atualizarProgresso({ ativo: false, etapa: 'concluido', atual: 1, total: 1, mensagem: `Concluído: ${criados} produtos catálogo, ${nx1Criados} Produto.nx1, ${clientesCriados} clientes, ${usuariosCriados} usuários, ${caixasCriados} caixas, ${vendasCriadas} vendas, ${movimentacoesImportadas} movimentações` });
        (0, servidor_1.registrarLog)('SUCCESS', `Importação Nex concluída: ${criados} produtos de catálogo, ${nx1Criados} Produto.nx1, ${clientesCriados} clientes, ${usuariosCriados} usuários, ${caixasCriados} caixas, ${vendasCriadas} vendas, ${itensImportados} itens, ${pagamentosImportados} pagamentos, ${movimentacoesImportadas} movimentações`);
        const relatorio = {
            modo: 'importacao',
            estrutura: {
                categorias: dados.categorias.length,
                categoriasCriadas: mapaCategorias.size,
                subcategorias: dados.subcategorias.length,
                subcategoriasDistintas: nomesSubcategoriasDistintos,
                subcategoriasComCategoria: subcategoriasComCat,
                subcategoriasSemCategoria: subcategoriasSemCat,
                produtosCatalogo: dados.produtos.length,
                produtosCatalogoCriados: criados,
                produtosCatalogoAtualizados: atualizados,
                produtosNx1Registros: dados.produtosNx1.length,
                produtosNx1Criados: nx1Criados,
                produtosNx1Duplicados: nx1Duplicados,
                produtosNx1SemCategoria: nx1SemCat,
                produtosComSubcategoria: catComSub + nx1ComSub,
                produtosSemSubcategoria: catSemSub + nx1SemSub,
                produtosNomeDeSubcategoriaDescartados: produtosNomeSubcat,
                produtosTotal: criados + nx1Criados
            },
            importado: {
                produtos: criados,
                produtosNx1: nx1Criados,
                fornecedores: mapaFornecedores.size,
                clientes: clientesCriados,
                clientesDedup,
                usuarios: usuariosCriados,
                caixas: caixasCriados,
                categorias: dados.categorias.length,
                marcas: dados.marcas.length,
                subcategorias: dados.subcategorias.length,
                unidades: dados.unidades.length,
                ncm: ncmImportados,
                cest: cestImportados,
                cfop: cfopImportados,
                vendas: vendasCriadas,
                vendasDescartadas: vendasDescartadas,
                itens: itensImportados,
                pagamentos: pagamentosImportados,
                movimentacoes: movimentacoesImportadas,
                remocoes: remocoesImportadas,
                syslogs: syslogsImportados,
                terminais: terminaisImportados,
                brutosPreservados
            },
            identificado: {
                vendas: dados.vendas.length,
                itens: dados.itens.length,
                pagamentos: dados.pagamentos.length,
                remocoes: dados.remocoes.length,
                syslogs: dados.syslogs.length,
                terminais: dados.terminais.length,
                produtosBackup: dados.produtos.length + dados.produtosNx1.length,
                clientesBackup: dados.clientes.length
            },
            naoInterpretados: dados.naoInterpretados.length,
            semEquivalente: [],
            naoImportado: {
                itensSemVenda: dados.itens.length - itensImportados,
                pagamentosSemVenda: dados.pagamentos.length - pagamentosImportados,
                vendasSemPagamento: vendasSemPag,
                vendasSemItem: vendasSemItem,
                documentosNaoVenda: vendasDescartadas,
                vendasSemDataPropria: vendasSemDataPropria,
                erros: erros.length
            },
            motivos: erros.slice(0, 200)
        };
        return {
            ok: true,
            resumo: {
                produtos: dados.produtos.length,
                produtosCriados: criados,
                produtosAtualizados: atualizados,
                produtosNx1: dados.produtosNx1.length,
                produtosNx1Criados: nx1Criados,
                produtosNx1Duplicados: nx1Duplicados,
                subcategoriasDistintas: nomesSubcategoriasDistintos,
                subcategoriasComCategoria: subcategoriasComCat,
                subcategoriasSemCategoria: subcategoriasSemCat,
                produtosComSubcategoria: catComSub + nx1ComSub,
                produtosSemSubcategoria: catSemSub + nx1SemSub,
                produtosNomeDeSubcategoriaDescartados: produtosNomeSubcat,
                clientes: dados.clientes.length,
                clientesCriados,
                clientesDedup,
                fornecedores: dados.fornecedores.length,
                usuarios: dados.usuarios.length,
                usuariosCriados,
                caixas: dados.caixas.length,
                caixasCriados,
                categorias: dados.categorias.length,
                marcas: dados.marcas.length,
                subcategorias: dados.subcategorias.length,
                unidades: dados.unidades.length,
                ncm: ncmImportados,
                cest: cestImportados,
                cfop: cfopImportados,
                vendasEncontradas: dados.vendas.length,
                vendasCriadas,
                vendasDescartadas,
                vendasSemDataPropria,
                vendasSemPagamento: vendasSemPag,
                vendasSemItem: vendasSemItem,
                itensEncontrados: dados.itens.length,
                itensImportados,
                pagamentosEncontrados: dados.pagamentos.length,
                pagamentosImportados,
                remocoesEncontradas: dados.remocoes.length,
                remocoesImportadas,
                syslogsEncontrados: dados.syslogs.length,
                syslogsImportados,
                terminaisEncontrados: dados.terminais.length,
                terminaisImportados,
                brutosPreservados,
                naoInterpretados: dados.naoInterpretados.length,
                erros: erros.length
            },
            erros,
            relatorio
        };
    }
    catch (err) {
        try {
            const db2 = (0, index_1.getDb)();
            db2.exec('ROLLBACK');
        }
        catch { /* ignore */ }
        atualizarProgresso({ ativo: false, etapa: 'erro', mensagem: `Falha na importação: ${err.message}` });
        (0, servidor_1.registrarLog)('ERROR', `Importação Nex falhou: ${err.message}`);
        return { ok: false, erros: [`${err.message}`] };
    }
}
// Estruturas do nosso sistema (para classificar o que existe)
const ESTRUTURAS_SISTEMA = new Set([
    'produtos', 'clientes', 'usuarios', 'caixas', 'vendas', 'venda_itens', 'pagamentos',
    'movimentacoes', 'categorias', 'subcategorias', 'marcas', 'unidades', 'fornecedores',
    'ncm_cadastro', 'cest_cadastro', 'cfop_cadastro', 'produtos_fiscais', 'historico_remocoes',
    'logs_sistema', 'terminais', 'contas', 'orcamentos', 'pedidos', 'config'
]);
// Mapeamento de tabelas Nex para estruturas do sistema
const TABELAS_NEX_EQUIVALENTES = {
    'Cliente': 'clientes', 'Produto': 'produtos', 'catalogo_json': 'produtos',
    'Categoria': 'categorias', 'Subcategoria': 'subcategorias', 'Marca': 'marcas',
    'Unidade': 'unidades', 'Usuario': 'usuarios', 'Caixa': 'caixas',
    'Tran': 'vendas', 'ITran': 'venda_itens', 'PagEspecies': 'pagamentos',
    'MovEst': 'movimentacoes', 'stock': 'movimentacoes', 'EstoquePosicao': 'movimentacoes',
    'NCM': 'ncm_cadastro', 'br_cest': 'cest_cadastro', 'CFOP': 'cfop_cadastro',
    'RegistrosRemovidos': 'historico_remocoes', 'syslog': 'logs_sistema', 'Terminal': 'terminais',
    'Especie': 'formas_pagamento', 'CP': 'contas', 'Recebiveis': 'contas',
    'DadosFiscais': 'produtos_fiscais', 'endereco': 'clientes'
};
function analisarEntradaNx1(nomeBase, buf) {
    const tabela = nomeBase.replace(/\.nx1$/i, '');
    const dicionario = extrairDicionario(buf);
    const blocos = contarBlocos(buf);
    const temDados = blocos > 0;
    const equivalente = TABELAS_NEX_EQUIVALENTES[tabela];
    const status = equivalente
        ? (ESTRUTURAS_SISTEMA.has(equivalente) ? 'suportada' : 'necessita_criar')
        : (temDados ? 'necessita_criar' : 'sem_dados');
    return {
        tabela,
        tamanhoBytes: buf.length,
        blocosDados: blocos,
        temDados,
        campos: dicionario.slice(0, 30).map(f => `${f.nome}:${f.tipo}`),
        totalCampos: dicionario.length,
        equivalente,
        status
    };
}
// Analisa um ZIP em disco (streaming) sem importar nada
async function analisarNexDeZip(caminhoZip, nomeZip) {
    const erros = [];
    try {
        atualizarProgresso({ ativo: true, etapa: 'analisando', atual: 0, total: 1, mensagem: `Analisando ${nomeZip}...` });
        const dir = await unzipper_1.Open.file(caminhoZip);
        const rows = [];
        const excessivos = [];
        for (const entry of dir.files) {
            if (entry.type !== 'File' || !entry.path.toLowerCase().endsWith('.nx1'))
                continue;
            if (entry.path.includes('__MACOSX'))
                continue;
            const nomeBase = entry.path.split(/[\\/]/).pop();
            const tamanho = entry.uncompressedSize ?? entry.compressedSize ?? 0;
            if (!ARQUIVOS_NECESSARIOS.has(nomeBase.toLowerCase()) && tamanho > NAO_CARCAR_ACIMA_DE) {
                excessivos.push(`${nomeBase} (${(tamanho / 1048576).toFixed(0)}MB)`);
                continue;
            }
            rows.push({ entry, nomeBase, tamanho });
        }
        const estruturas = [];
        for (let i = 0; i < rows.length; i++) {
            const buf = await lerEntradaUnzipper(rows[i].entry);
            if (buf)
                estruturas.push(analisarEntradaNx1(rows[i].nomeBase, buf));
            if ((i + 1) % 5 === 0 || i === rows.length - 1)
                await pausar();
        }
        estruturas.sort((a, b) => Number(b.blocosDados) - Number(a.blocosDados));
        const suportadas = estruturas.filter(e => e.status === 'suportada');
        const necessitamCriar = estruturas.filter(e => e.status === 'necessita_criar');
        const semDados = estruturas.filter(e => e.status === 'sem_dados');
        atualizarProgresso({ ativo: false, etapa: 'analisado', atual: 1, total: 1, mensagem: `Análise concluída: ${suportadas.length} estruturas suportadas, ${necessitamCriar.length} necessitam criação` });
        return {
            ok: true,
            relatorio: {
                arquivo: nomeZip,
                totalArquivosNx1: rows.length,
                estruturasEncontradas: estruturas.length,
                estruturasSuportadas: suportadas.map(e => e.tabela),
                novasEstruturasNecessarias: necessitamCriar.map(e => ({
                    tabela: e.tabela,
                    blocos: e.blocosDados,
                    campos: e.campos,
                    motivo: e.equivalente ? `Existe no Nex como ${e.equivalente}` : 'Sem equivalente no nosso sistema'
                })),
                estruturasSemDados: semDados.map(e => e.tabela),
                arquivosGrandesIgnorados: excessivos,
                detalhes: estruturas,
                erros
            },
            erros
        };
    }
    catch (err) {
        atualizarProgresso({ ativo: false, etapa: 'erro', mensagem: `Falha na análise: ${err.message}` });
        return { ok: false, relatorio: { erro: err.message }, erros: [`${err.message}`] };
    }
}
// Analisa o backup .nx1 (ZIP) e reporta estruturas sem importar nada
async function analisarNex(zipBuffer, nomeZip) {
    const erros = [];
    try {
        atualizarProgresso({ ativo: true, etapa: 'analisando', atual: 0, total: 1, mensagem: `Analisando ${nomeZip}...` });
        const zip = new adm_zip_1.default(zipBuffer);
        const entries = zip.getEntries().filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.nx1'));
        const estruturas = [];
        const excessivos = [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const tamanho = entry.header?.size ?? 0;
            const nomeBase = entry.entryName.split(/[\\/]/).pop();
            if (!ARQUIVOS_NECESSARIOS.has(nomeBase.toLowerCase()) && tamanho > NAO_CARCAR_ACIMA_DE) {
                excessivos.push(`${nomeBase} (${(tamanho / 1048576).toFixed(0)}MB)`);
                if ((i + 1) % 10 === 0)
                    await pausar();
                continue;
            }
            try {
                // Lê e descarta um arquivo por vez (sem Map de todos os buffers)
                const buf = entry.getData();
                if (!buf)
                    continue;
                const tabela = nomeBase.replace(/\.nx1$/i, '');
                const dicionario = extrairDicionario(buf);
                const blocos = contarBlocos(buf);
                const temDados = blocos > 0;
                const equivalente = TABELAS_NEX_EQUIVALENTES[tabela];
                const status = equivalente
                    ? (ESTRUTURAS_SISTEMA.has(equivalente) ? 'suportada' : 'necessita_criar')
                    : (temDados ? 'necessita_criar' : 'sem_dados');
                estruturas.push({
                    tabela,
                    tamanhoBytes: buf.length,
                    blocosDados: blocos,
                    temDados,
                    campos: dicionario.slice(0, 30).map(f => `${f.nome}:${f.tipo}`),
                    totalCampos: dicionario.length,
                    equivalente,
                    status
                });
            }
            catch (e) {
                erros.push(`Falha ao ler ${entry.entryName}: ${e.message}`);
            }
            if ((i + 1) % 5 === 0 || i === entries.length - 1)
                await pausar();
        }
        estruturas.sort((a, b) => Number(b.blocosDados) - Number(a.blocosDados));
        const suportadas = estruturas.filter(e => e.status === 'suportada');
        const necessitamCriar = estruturas.filter(e => e.status === 'necessita_criar');
        const semDados = estruturas.filter(e => e.status === 'sem_dados');
        atualizarProgresso({ ativo: false, etapa: 'analisado', atual: 1, total: 1, mensagem: `Análise concluída: ${suportadas.length} estruturas suportadas, ${necessitamCriar.length} necessitam criação` });
        return {
            ok: true,
            relatorio: {
                arquivo: nomeZip,
                totalArquivosNx1: entries.length,
                estruturasEncontradas: estruturas.length,
                estruturasSuportadas: suportadas.map(e => e.tabela),
                novasEstruturasNecessarias: necessitamCriar.map(e => ({
                    tabela: e.tabela,
                    blocos: e.blocosDados,
                    campos: e.campos,
                    motivo: e.equivalente ? `Existe no Nex como ${e.equivalente}` : 'Sem equivalente no nosso sistema'
                })),
                estruturasSemDados: semDados.map(e => e.tabela),
                arquivosGrandesIgnorados: excessivos,
                detalhes: estruturas,
                erros
            },
            erros
        };
    }
    catch (err) {
        atualizarProgresso({ ativo: false, etapa: 'erro', mensagem: `Falha na análise: ${err.message}` });
        return { ok: false, relatorio: { erro: err.message }, erros: [`${err.message}`] };
    }
}

export { getProgressoNex, normalizarNome, importarNex, importarNexDeZip, importarNexDePasta, importarNexDeArquivo, analisarNexDeZip, analisarNex, extrairImagensProdutoNx1 };
