/*
 * E2E final — Pedido Online (homologação, sem nuvem).
 *
 * Sobe um "stand-in" HTTP que replica o Worker+D1 do catálogo (mesma lógica de
 * catalogo-worker/src/orders.ts: cria pedido, recalcula preços, aplica zona via
 * CEP, numero sequencial) e o ERP real (código compilado em out/server/server)
 * num banco TEMPORÁRIO isolado, para NÃO tocar o PDV/banco real.
 *
 * Fluxo testado:
 *   cliente (POST /api/catalogo/pedido, corpo=PedidoOnlineEnvio do front)
 *     -> stand-in Worker+D1 persiste
 *     -> ERP real puxaPedidosOnline() importa (idempotente) e baixa estoque
 */
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')

const TOKEN = 'e2e-token-pedidos-online'

// ---------------------------------------------------------------------------
// Stand-in "Worker + D1"
// ---------------------------------------------------------------------------
function somenteDigitos(v) {
  return String(v ?? '').replace(/\D/g, '')
}

function cepPertence(cep, ceps) {
  const alvo = somenteDigitos(cep)
  if (!alvo || alvo.length < 3) return false
  const lista = Array.isArray(ceps) ? ceps : []
  if (lista.length === 0) return false
  return lista.some((c) => {
    const entrada = somenteDigitos(c)
    if (!entrada || entrada.length < 3) return false
    const idx = Math.min(entrada.length, 8, alvo.length)
    return alvo.slice(0, idx) === entrada.slice(0, idx)
  })
}

function zonaPorCep(cep, zonas) {
  const limpo = somenteDigitos(cep)
  if (!limpo || limpo.length < 3) return undefined
  return zonas.find((z) => cepPertence(limpo, z.ceps))
}

function gerarId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function criarStandIn() {
  // "D1" em memória
  const lojaConfig = new Map([
    ['pedidos_ativos', '1'],
    ['aceita_entrega', '1'],
    ['aceita_retirada', '1']
  ])
  const produtos = [
    { id: 1, nome: 'Cigarro Premium', preco: 10.0, preco_promo: null, tem_promo: 0, disponivel: 1, estoque: 50 },
    { id: 2, nome: 'Isqueiro', preco: 3.0, preco_promo: 2.5, tem_promo: 1, disponivel: 1, estoque: 20 },
    { id: 3, nome: 'Tabaco Artesanal', preco: 15.0, preco_promo: null, tem_promo: 0, disponivel: 1, estoque: 0 }
  ]
  const zonas = [
    { id: 1, nome: 'Centro', preco: 5.0, ceps: ['01310'] },
    { id: 2, nome: 'Zona Norte', preco: 8.0, ceps: ['02000'] }
  ]
  const pedidos = [] // { ...PedidoOnlineSaida }
  let ultimoNumero = 0

  function processarPedido(corpo) {
    if (lojaConfig.get('pedidos_ativos') === '0') return { status: 400, body: { ok: false, erro: 'pedidos_pausados' } }
    const aceitaEntrega = lojaConfig.get('aceita_entrega') !== '0'
    const aceitaRetirada = lojaConfig.get('aceita_retirada') === '1'
    const modalidade = corpo.modalidade === 'retirada' ? 'retirada' : 'entrega'
    if (modalidade === 'entrega' && !aceitaEntrega) return { status: 400, body: { ok: false, erro: 'modalidade_indisponivel' } }
    if (modalidade === 'retirada' && !aceitaRetirada) return { status: 400, body: { ok: false, erro: 'modalidade_indisponivel' } }

    const nome = (corpo.cliente?.nome || '').trim()
    const whats = somenteDigitos(corpo.cliente?.whatsapp)
    if (!nome) return { status: 400, body: { ok: false, erro: 'nome_obrigatorio' } }
    if (whats.length < 10) return { status: 400, body: { ok: false, erro: 'whatsapp_invalido' } }

    const entrada = Array.isArray(corpo.itens) ? corpo.itens : []
    const itens = []
    for (const i of entrada) {
      const pid = Number(i.produto_id)
      const qtd = Number(i.quantidade)
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(qtd) || qtd <= 0) continue
      itens.push({ produto_id: pid, quantidade: qtd })
    }
    if (itens.length === 0) return { status: 400, body: { ok: false, erro: 'carrinho_vazio' } }

    const linhas = []
    for (const i of itens) {
      const prod = produtos.find((p) => p.id === i.produto_id)
      if (!prod || prod.disponivel !== 1) return { status: 400, body: { ok: false, erro: 'produto_indisponivel' } }
      if (prod.estoque < i.quantidade) return { status: 400, body: { ok: false, erro: 'estoque_insuficiente' } }
      const preco = prod.tem_promo === 1 && prod.preco_promo && prod.preco_promo > 0 ? prod.preco_promo : prod.preco
      linhas.push({ produto_id: prod.id, nome: prod.nome, quantidade: i.quantidade, preco, subtotal: Math.round(preco * i.quantidade * 100) / 100 })
    }
    const subtotal = Math.round(linhas.reduce((s, l) => s + l.subtotal, 0) * 100) / 100

    let taxaEntrega = 0
    let zonaNome = null
    if (modalidade === 'entrega') {
      const cep = somenteDigitos(corpo.cep)
      if (cep.length !== 8) return { status: 400, body: { ok: false, erro: 'cep_invalido' } }
      const zona = zonaPorCep(cep, zonas)
      if (zona) {
        taxaEntrega = Number(zona.preco) || 0
        zonaNome = zona.nome
      }
      if (!zonaNome && !corpo.endereco?.trim()) return { status: 400, body: { ok: false, erro: 'endereco_obrigatorio' } }
      if (!zonaNome) return { status: 400, body: { ok: false, erro: 'cep_fora_zona' } }
    }

    const total = Math.round((subtotal + taxaEntrega) * 100) / 100
    const agora = new Date()
    const agoraIso = agora.toISOString()
    const id = gerarId()
    ultimoNumero += 1
    const numero = ultimoNumero

    const pedido = {
      id,
      numero,
      cliente_nome: nome,
      cliente_whatsapp: whats,
      modalidade,
      endereco: modalidade === 'entrega' ? (corpo.endereco || '').trim() : null,
      cep: modalidade === 'entrega' ? somenteDigitos(corpo.cep) || null : null,
      zona_nome: zonaNome,
      taxa_entrega: taxaEntrega,
      subtotal,
      desconto: 0,
      total,
      forma_pagamento: (corpo.forma_pagamento || '').trim().slice(0, 50),
      observacao: (corpo.observacao || '').trim().slice(0, 500) || null,
      status: 'novo',
      ip: '127.0.0.1',
      criado_em: agoraIso,
      atualizado_em: agoraIso,
      itens: linhas.map((l) => ({ produto_id: l.produto_id, nome_produto: l.nome, quantidade: l.quantidade, preco_unitario: l.preco, subtotal: l.subtotal }))
    }
    pedidos.push(pedido)
    return { status: 201, body: { ok: true, pedido: { id: pedido.id, numero: pedido.numero, total, taxa_entrega: taxaEntrega, subtotal } } }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'POST' && url.pathname === '/api/catalogo/pedido') {
      let dados = ''
      req.on('data', (c) => (dados += c))
      req.on('end', () => {
        let corpo = {}
        try { corpo = JSON.parse(dados || '{}') } catch { corpo = {} }
        const r = processarPedido(corpo)
        res.writeHead(r.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(r.body))
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/catalogo/pedidos') {
      // Requer Bearer (mesmo token do sync/relay)
      const auth = req.headers.authorization || ''
      if (auth !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, erro: 'nao_autorizado' }))
        return
      }
      const desde = url.searchParams.get('desde')
      let lista = pedidos
      if (desde) lista = pedidos.filter((p) => p.criado_em > desde)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, pedidos: lista }))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, erro: 'nao_encontrado' }))
  })

  return { server, db: () => ({ pedidos, produtos, zonas, ultimoNumero }) }
}

// ---------------------------------------------------------------------------
// Helpers de teste
// ---------------------------------------------------------------------------
let falhas = 0
const total = { passou: 0 }
function ok(cond, nome, extra) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`  [${status}] ${nome}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`)
  if (cond) total.passou++
  else {
    falhas++
    console.log('       ^^^^^^ FALHOU')
  }
}

function memo(valor, esperado) {
  return valor === esperado ? `R$ ${Number(valor).toFixed(2)}` : `R$ ${Number(valor).toFixed(2)} (esperado R$ ${Number(esperado).toFixed(2)})`
}

function main() {
  return new Promise((resolve) => {
    // -----------------------------------------------------------------------
    // 1) Sobe o stand-in Worker+D1
    // -----------------------------------------------------------------------
    const stand = criarStandIn()
    const server = stand.server
    server.listen(0, '127.0.0.1', async () => {
      const porta = server.address().port
      const urlWorker = `http://127.0.0.1:${porta}`
      console.log(`\n[E2E] Stand-in Worker+D1 em ${urlWorker}`)

      // ---------------------------------------------------------------------
      // 2) Banco ERP temporário isolado
      // ---------------------------------------------------------------------
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-e2e-pedido-'))
      const dbPath = path.join(dir, 'erp.db')
      process.env.CATALOGO_SYNC_TOKEN = TOKEN

      const servidor = require(path.join(__dirname, '..', 'out', 'server', 'server', 'index.js'))
      const pedOn = require(path.join(__dirname, '..', 'out', 'server', 'server', 'pedidos-online.js'))
      const configCatalogo = require(path.join(__dirname, '..', 'out', 'server', 'server', 'config-catalogo.js'))
      const db = servidor.initDb(dbPath)
      servidor.seed(db)

      // Produtos no ERP com os MESMOS ids do stand-in (para baixar estoque certo)
      const prodIds = [1, 2, 3]
      for (const p of prodIds) {
        db.prepare(
          `INSERT INTO produtos (id, nome, preco_venda, estoque, unidade, ativo) VALUES (?, ?, ?, ?, 'un', 1)`
        ).run(p, `Produto ERP ${p}`, p === 1 ? 10 : p === 2 ? 3 : 15, p === 1 ? 50 : p === 2 ? 20 : 0)
      }
      // Zona no ERP (o pull não usa, mas mantém coerência visual)
      db.prepare(
        `INSERT INTO zonas_entrega (nome, preco, poligono, ativo) VALUES (?, ?, '', 1)`
      ).run('Centro', 5)

      // Configura URL do worker via configuração central (a mesma do painel/polling)
      configCatalogo.setUrlWorkerCatalogo(urlWorker)

      const puxar = pedOn.puxarPedidosOnline
      const listar = pedOn.listarPedidosOnline
      const getEstoque = (id) => db.prepare(`SELECT estoque FROM produtos WHERE id = ?`).get(id).estoque

      // ---------------------------------------------------------------------
      // 3) Simula o CLIENTE real do catálogo — pedido de ENTREGA
      //    (corpo = PedidoOnlineEnvio gerado pelo CarrinhoDrawer)
      // ---------------------------------------------------------------------
      console.log('\n[E2E] 3) Cliente cria pedido de ENTREGA (zona Centro, CEP 01310-000)')
      const corpoEntrega = {
        cliente: { nome: 'Maria Silva', whatsapp: '(11) 99888-7766' },
        modalidade: 'entrega',
        endereco: 'Rua das Flores, 123 - Apto 45',
        cep: '01310-000',
        forma_pagamento: 'pix',
        observacao: 'Deixar na portaria',
        itens: [
          { produto_id: 1, quantidade: 2 }, // 2 x 10,00 = 20,00
          { produto_id: 2, quantidade: 1 }  // 1 x 2,50 (promo) = 2,50
        ]
      }
      const r1 = await fetch(`${urlWorker}/api/catalogo/pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpoEntrega)
      })
      const j1 = await r1.json()
      ok(r1.status === 201 && j1.ok === true, 'Pedido de entrega aceito (HTTP 201)')
      ok(j1.pedido && typeof j1.pedido.id === 'string' && j1.pedido.id.length > 0, 'Pedido recebeu id (UUID) no D1')
      ok(j1.pedido && j1.pedido.numero === 1, `Número sequencial no D1 (esperado 1)`)
      ok(j1.pedido && j1.pedido.subtotal === 22.5, `Subtotal recalculado no backend = ${memo(j1.pedido && j1.pedido.subtotal, 22.5)}`)
      ok(j1.pedido && j1.pedido.taxa_entrega === 5, `Taxa de entrega (zona Centro) = ${memo(j1.pedido && j1.pedido.taxa_entrega, 5)}`)
      ok(j1.pedido && j1.pedido.total === 27.5, `Total = ${memo(j1.pedido && j1.pedido.total, 27.5)}`)

      // Confere o pedido "no D1" (stand-in) com TODOS os campos
      const d1 = stand.db().pedidos.find((p) => p.id === j1.pedido.id)
      ok(d1 && d1.cliente_nome === 'Maria Silva', 'D1: cliente_nome')
      ok(d1 && somenteDigitos(d1.cliente_whatsapp) === '11998887766', 'D1: cliente_whatsapp (apenas dígitos)')
      ok(d1 && d1.modalidade === 'entrega', 'D1: modalidade entrega')
      ok(d1 && d1.endereco === 'Rua das Flores, 123 - Apto 45', 'D1: endereco')
      ok(d1 && d1.cep === '01310000', 'D1: cep (somente dígitos)')
      ok(d1 && d1.zona_nome === 'Centro', 'D1: zona_nome = Centro')
      ok(d1 && d1.taxa_entrega === 5, 'D1: taxa_entrega = 5')
      ok(d1 && d1.subtotal === 22.5, 'D1: subtotal = 22.5')
      ok(d1 && d1.total === 27.5, 'D1: total = 27.5')
      ok(d1 && d1.forma_pagamento === 'pix', 'D1: forma_pagamento = pix')
      ok(d1 && d1.observacao === 'Deixar na portaria', 'D1: observacao')
      ok(d1 && d1.itens && d1.itens.length === 2, 'D1: 2 itens')
      const it1 = d1 && d1.itens.find((i) => i.produto_id === 1)
      const it2 = d1 && d1.itens.find((i) => i.produto_id === 2)
      ok(it1 && it1.nome_produto === 'Cigarro Premium' && it1.quantidade === 2 && it1.preco_unitario === 10 && it1.subtotal === 20, 'D1: item 1 (preço, qtd, subtotal)')
      ok(it2 && it2.preco_unitario === 2.5 && it2.subtotal === 2.5, 'D1: item 2 usa PREÇO PROMOCIONAL (2.50)')
      ok(d1 && typeof d1.criado_em === 'string' && d1.criado_em.length > 0, 'D1: criado_em (data do pedido)')
      ok(d1 && d1.status === 'novo', 'D1: status novo')

      // ---------------------------------------------------------------------
      // 4) ERP puxa (manual) e importa
      // ---------------------------------------------------------------------
      console.log('\n[E2E] 4) ERP puxa e importa o pedido')
      const p1 = await puxar(urlWorker)
      ok(p1.ok === true, 'puxarPedidosOnline retorna ok')
      ok(p1.puxados === 1, `puxados = 1 (importou 1 pedido novo)`)

      const lista = listar().pedidos
      ok(lista.length === 1, `ERP: 1 pedido importado`)
      const imp = lista[0]
      ok(imp.numero === 1, `ERP: numero = 1`)
      ok(imp.cliente_nome === 'Maria Silva', 'ERP: cliente_nome')
      ok(imp.cliente_whatsapp === '11998887766', 'ERP: cliente_whatsapp')
      ok(imp.modalidade === 'entrega', 'ERP: modalidade')
      ok(imp.endereco === 'Rua das Flores, 123 - Apto 45', 'ERP: endereco')
      ok(imp.cep === '01310000', 'ERP: cep')
      ok(imp.zona_nome === 'Centro', 'ERP: zona_nome')
      ok(imp.taxa_entrega === 5, 'ERP: taxa_entrega')
      ok(imp.subtotal === 22.5, 'ERP: subtotal')
      ok(imp.desconto === 0, 'ERP: desconto')
      ok(imp.total === 27.5, 'ERP: total')
      ok(imp.forma_pagamento === 'pix', 'ERP: forma_pagamento')
      ok(imp.observacao === 'Deixar na portaria', 'ERP: observacao')
      ok(imp.status === 'novo', 'ERP: status novo')
      ok(imp.criado_em === d1.criado_em, 'ERP: criado_em idêntico ao D1')
      ok(Array.isArray(imp.itens) && imp.itens.length === 2, 'ERP: 2 itens importados')
      const iit1 = imp.itens.find((i) => i.produto_id === 1)
      const iit2 = imp.itens.find((i) => i.produto_id === 2)
      ok(iit1 && iit1.quantidade === 2 && iit1.subtotal === 20, 'ERP: item 1 correto')
      ok(iit2 && iit2.preco_unitario === 2.5 && iit2.subtotal === 2.5, 'ERP: item 2 (promo 2.50) correto')

      // ---------------------------------------------------------------------
      // 5) Estoque baixado + idempotência
      // ---------------------------------------------------------------------
      console.log('\n[E2E] 5) Estoque + idempotência')
      ok(getEstoque(1) === 48, `ERP: estoque produto 1 = 48 (50 - 2)`)
      ok(getEstoque(2) === 19, `ERP: estoque produto 2 = 19 (20 - 1)`)
      ok(getEstoque(3) === 0, `ERP: estoque produto 3 inalterado (0)`)

      const p2 = await puxar(urlWorker)
      ok(p2.ok === true, 'segundo puxar retorna ok')
      ok(p2.puxados === 0, `segundo puxar = 0 (idempotente, não duplicou)`)
      ok(listar().pedidos.length === 1, 'ERP: ainda 1 pedido (sem duplicar)')
      ok(getEstoque(1) === 48 && getEstoque(2) === 19, 'ERP: estoque NÃO baixou 2x')

      // ---------------------------------------------------------------------
      // 6) Pedido de RETIRADA (sem taxa) + rejeição fora da zona
      // ---------------------------------------------------------------------
      console.log('\n[E2E] 6) Retirada e rejeição fora da zona')
      const corpoRetirada = {
        cliente: { nome: 'João Pedro', whatsapp: '(11) 97777-8899' },
        modalidade: 'retirada',
        forma_pagamento: 'dinheiro',
        itens: [{ produto_id: 1, quantidade: 1 }]
      }
      const rR = await fetch(`${urlWorker}/api/catalogo/pedido`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoRetirada)
      })
      const jR = await rR.json()
      ok(rR.status === 201 && jR.ok === true, 'Pedido de retirada aceito')
      ok(jR.pedido && jR.pedido.taxa_entrega === 0, `Retirada: taxa = 0 (${memo(jR.pedido && jR.pedido.taxa_entrega, 0)})`)
      ok(jR.pedido && jR.pedido.total === 10, `Retirada: total = 10,00 ${memo(jR.pedido && jR.pedido.total, 10)}`)
      const dR = stand.db().pedidos.find((p) => p.id === (jR.pedido && jR.pedido.id))
      ok(dR && dR.zona_nome === null && dR.cep === null && dR.endereco === null, 'Retirada: sem zona/cep/endereço')

      // Entrega com CEP fora das zonas (99999-999)
      const corpoFora = {
        cliente: { nome: 'Carlos', whatsapp: '(11) 96666-5544' },
        modalidade: 'entrega',
        endereco: 'Av. Longe, 1',
        cep: '99999-999',
        forma_pagamento: 'cartao_credito',
        itens: [{ produto_id: 1, quantidade: 1 }]
      }
      const rF = await fetch(`${urlWorker}/api/catalogo/pedido`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoFora)
      })
      const jF = await rF.json()
      ok(rF.status === 400 && jF.erro === 'cep_fora_zona', `Entrega fora da zona rejeitada (400, cep_fora_zona)`)
      ok(stand.db().pedidos.filter((p) => p.cep === '99999999').length === 0, 'Pedido fora da zona NÃO foi gravado no D1')

      // Estoque insuficiente (produto 3 tem estoque 0)
      const corpoSemEstoque = {
        cliente: { nome: 'Ana', whatsapp: '(11) 95555-4433' },
        modalidade: 'retirada',
        forma_pagamento: 'pix',
        itens: [{ produto_id: 3, quantidade: 1 }]
      }
      const rE = await fetch(`${urlWorker}/api/catalogo/pedido`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoSemEstoque)
      })
      const jE = await rE.json()
      ok(rE.status === 400 && jE.erro === 'estoque_insuficiente', `Estoque insuficiente rejeitado (400, estoque_insuficiente)`)

      // ---------------------------------------------------------------------
      // 7) ERP puxa também os novos (retirada) e continua idempotente
      // ---------------------------------------------------------------------
      console.log('\n[E2E] 7) Pull final (retirada) + idempotência global')
      const p3 = await puxar(urlWorker)
      ok(p3.ok === true && p3.puxados === 1, `pull importa a retirada (puxados = 1)`)
      ok(listar().pedidos.length === 2, `ERP: agora 2 pedidos (entrega + retirada)`)
      const p4 = await puxar(urlWorker)
      ok(p4.puxados === 0 && listar().pedidos.length === 2, 'pull de novo: 0 novos, sem duplicar')
      ok(getEstoque(1) === 47, `ERP: estoque produto 1 = 47 (48 - 1 da retirada)`)

      // ---------------------------------------------------------------------
      // Resultado + limpeza
      // ---------------------------------------------------------------------
      console.log(`\n[TOTAL] ${total.passou} PASS` + (falhas ? `, ${falhas} FAIL` : ', 0 FAIL'))
      console.log(`[RESULTADO] ${falhas === 0 ? 'APROVADO' : 'REPROVADO'}`)
      server.close(() => {
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
        resolve(falhas === 0 ? 0 : 1)
      })
    })
  })
}

if (require.main === module) {
  main().then((code) => process.exit(code))
}

module.exports = { main }
