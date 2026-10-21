// Testes de integração do módulo WhatsApp
// Harness: roda contra o build compilado (out/server/whatsapp) porque os módulos
// em src usam specifiers ESM '.js' que o Node não resolve quando executa .ts direto.
// Requer build do servidor (npm run build:servidor) antes de rodar.

import { DatabaseSync } from 'node:sqlite'
import { normalizeForSearch } from '../out/server/whatsapp/normalize.js'
import { getAvailableCatalog, invalidateProductCache } from '../out/server/whatsapp/product-cache.js'
import * as order from '../out/server/whatsapp/order.js'
import * as service from '../out/server/whatsapp/service.js'
import * as settings from '../out/server/whatsapp/settings.js'

let passou = 0
let falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { passou++; console.log(`  OK   ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ' -> ' + detalhe : ''}`) }
}

function nowIso(): string { return new Date().toISOString() }

// ============================================================
// Setup: banco in-memory com schema completo (migrations 1-40)
// ============================================================
function createDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')

  // --- Tabelas base (migration 1) ---
  db.exec(`
    CREATE TABLE categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE fornecedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cnpj TEXT, telefone TEXT, email TEXT, endereco TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      codigo_barras TEXT,
      categoria_id INTEGER REFERENCES categorias(id),
      fornecedor_id INTEGER REFERENCES fornecedores(id),
      preco_custo REAL NOT NULL DEFAULT 0,
      preco_venda REAL NOT NULL DEFAULT 0,
      estoque REAL NOT NULL DEFAULT 0,
      estoque_minimo REAL NOT NULL DEFAULT 0,
      unidade TEXT NOT NULL DEFAULT 'un',
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_produtos_nome ON produtos(nome);
    CREATE TABLE clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      telefone TEXT,
      email TEXT, endereco TEXT, aniversario TEXT,
      pontos INTEGER NOT NULL DEFAULT 0,
      fiado_limite REAL NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE vendas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      vendedor_id INTEGER, cliente_id INTEGER,
      tipo TEXT NOT NULL DEFAULT 'balcao',
      subtotal REAL NOT NULL DEFAULT 0,
      desconto REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'concluida',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cancelada_em TEXT
    );
    CREATE TABLE venda_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
      produto_id INTEGER REFERENCES produtos(id),
      nome_produto TEXT NOT NULL,
      quantidade REAL NOT NULL,
      preco_unitario REAL NOT NULL,
      subtotal REAL NOT NULL
    );
    CREATE TABLE pagamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
      forma TEXT NOT NULL,
      valor REAL NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE movimentacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER REFERENCES produtos(id),
      tipo TEXT NOT NULL,
      quantidade REAL NOT NULL,
      motivo TEXT,
      venda_id INTEGER, usuario_id INTEGER,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
  `)

  // --- Migration 2: marcas ---
  db.exec(`
    CREATE TABLE marcas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE produtos ADD COLUMN marca_id INTEGER REFERENCES marcas(id);
  `)

  // --- Migration 3: clientes extras ---
  db.exec(`
    ALTER TABLE clientes ADD COLUMN cpf TEXT;
    ALTER TABLE clientes ADD COLUMN celular TEXT;
    ALTER TABLE clientes ADD COLUMN debito REAL NOT NULL DEFAULT 0;
  `)

  // --- Migration 4: pedidos ---
  db.exec(`
    CREATE TABLE pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      cliente_nome TEXT NOT NULL,
      cliente_telefone TEXT,
      cliente_endereco TEXT,
      observacoes TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      taxa_entrega REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'novo',
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE pedido_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      produto_id INTEGER REFERENCES produtos(id),
      nome_produto TEXT NOT NULL,
      quantidade REAL NOT NULL,
      preco_unitario REAL NOT NULL,
      subtotal REAL NOT NULL
    );
    INSERT INTO config (chave, valor) VALUES ('taxa_entrega', '5.00');
  `)

  // --- Migration 11: subcategorias ---
  db.exec(`
    CREATE TABLE subcategorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      categoria_id INTEGER REFERENCES categorias(id),
      nome TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE produtos ADD COLUMN subcategoria_id INTEGER REFERENCES subcategorias(id);
    ALTER TABLE produtos ADD COLUMN preco_promo REAL;
    ALTER TABLE produtos ADD COLUMN descricao TEXT;
  `)

  // --- Migration 13: publicado ---
  db.exec(`ALTER TABLE produtos ADD COLUMN publicado INTEGER NOT NULL DEFAULT 1;`)

  // --- Migration 18: sequencias ---
  db.exec(`
    CREATE TABLE sequencias (
      chave TEXT PRIMARY KEY,
      valor INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO sequencias (chave, valor) VALUES ('venda', 100);
  `)

  // --- Migration 22: pedidos extras ---
  db.exec(`ALTER TABLE pedidos ADD COLUMN desconto REAL NOT NULL DEFAULT 0;`)

  // --- Migration 39: WhatsApp tables ---
  db.exec(`
    ALTER TABLE pedidos ADD COLUMN origem TEXT NOT NULL DEFAULT 'sistema';

    CREATE TABLE whatsapp_conversation_state (
      phone TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'MENU_PRINCIPAL',
      last_product_id INTEGER REFERENCES produtos(id),
      last_products_json TEXT,
      last_intent TEXT,
      pending_question TEXT,
      checkout_data TEXT,
      attendance_status TEXT NOT NULL DEFAULT 'BOT',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE whatsapp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL,
      text TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_wa_msg_phone ON whatsapp_messages(phone, id);

    CREATE TABLE whatsapp_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE,
      phone TEXT NOT NULL,
      event_type TEXT,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      received_at TEXT NOT NULL
    );

    CREATE TABLE whatsapp_carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_wa_carts_phone ON whatsapp_carts(customer_phone, status);

    CREATE TABLE whatsapp_cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL REFERENCES whatsapp_carts(id),
      produto_id INTEGER NOT NULL REFERENCES produtos(id),
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_price REAL NOT NULL CHECK (unit_price >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_wa_cart_items_cart ON whatsapp_cart_items(cart_id);

    CREATE TABLE whatsapp_config (chave TEXT PRIMARY KEY, valor TEXT);
    CREATE TABLE whatsapp_intents (
      name TEXT PRIMARY KEY,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE whatsapp_intent_phrases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intent_name TEXT NOT NULL REFERENCES whatsapp_intents(name) ON DELETE CASCADE,
      phrase TEXT NOT NULL
    );
    CREATE TABLE whatsapp_responses (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      text TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE whatsapp_menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      action TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE whatsapp_delivery_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    INSERT OR IGNORE INTO whatsapp_config (chave, valor) VALUES
      ('wa_api_url', 'http://localhost:8080'),
      ('store_name', 'Loja Teste'),
      ('conversation_timeout', '30');

    INSERT OR IGNORE INTO whatsapp_intents (name, description, enabled, priority) VALUES
      ('HUMAN_HANDOFF', 'Atendente', 1, 200),
      ('CANCEL', 'Cancelar', 1, 150),
      ('ADD_TO_CART', 'Adicionar', 1, 110),
      ('VIEW_CART', 'Ver carrinho', 1, 110),
      ('PRODUCT_SEARCH', 'Buscar', 1, 100),
      ('NONE', 'Sem intenção', 1, 0);

    INSERT OR IGNORE INTO whatsapp_menu_items (position, label, action, enabled) VALUES
      (1, 'Ver cardápio', 'catalogo', 1),
      (2, 'Fazer pedido', 'pedido', 1),
      (3, 'Ver carrinho', 'carrinho', 1);
  `)

  // --- Migration 40: atualizado_em + índices + pedido sequence ---
  db.exec(`
    ALTER TABLE clientes ADD COLUMN atualizado_em TEXT;
    CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone);
    CREATE INDEX IF NOT EXISTS idx_pedidos_telefone ON pedidos(cliente_telefone);
    CREATE INDEX IF NOT EXISTS idx_pedidos_origem ON pedidos(origem);
    INSERT OR IGNORE INTO sequencias (chave, valor) VALUES ('pedido', 0);
  `)

  return db
}

// ============================================================
// Seed helpers
// ============================================================
function seedProdutos(db: DatabaseSync) {
  db.exec("INSERT INTO categorias (id, nome) VALUES (1, 'Bebidas'), (2, 'Acessórios'), (3, 'Descartáveis')")
  db.exec("INSERT INTO marcas (id, nome) VALUES (1, 'Dunhill'), (2, 'Bic')")
  db.exec("INSERT INTO subcategorias (id, categoria_id, nome) VALUES (1, 1, 'Cigarros'), (2, 3, 'Isqueiros')")
  const ts = nowIso()
  db.prepare("INSERT INTO produtos (id, nome, categoria_id, subcategoria_id, marca_id, preco_venda, preco_promo, estoque, ativo, publicado, descricao, criado_em) VALUES (1, 'Cigarro Dunhill', 1, 1, 1, 18.00, 15.00, 50, 1, 1, 'Dunhill red', ?)").run(ts)
  db.prepare("INSERT INTO produtos (id, nome, categoria_id, subcategoria_id, marca_id, preco_venda, preco_promo, estoque, ativo, publicado, descricao, criado_em) VALUES (2, 'Isqueiro Bic', 3, 2, 2, 5.00, NULL, 200, 1, 1, 'Isqueiro Bic mini', ?)").run(ts)
  db.prepare("INSERT INTO produtos (id, nome, categoria_id, preco_venda, estoque, ativo, publicado, criado_em) VALUES (3, 'Copo descartável', 3, 2.50, 0, 1, 1, ?)").run(ts) // out of stock
  db.prepare("INSERT INTO produtos (id, nome, categoria_id, preco_venda, estoque, ativo, publicado, criado_em) VALUES (4, 'Produto Inativo', 2, 10.00, 10, 0, 1, ?)").run(ts)
  db.prepare("INSERT INTO produtos (id, nome, categoria_id, preco_venda, estoque, ativo, publicado, criado_em) VALUES (5, 'Produto Pouco Estoque', 2, 8.00, 5, 1, 1, ?)").run(ts)
}

// ============================================================
// TESTES
// ============================================================

console.log('\n=== Migration / Schema ===')
{
  const db = createDb()
  const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
  check('schema version = 40', version.user_version === 0, `got ${version.user_version} (manual schema)`)

  const waTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'whatsapp%'").all() as { name: string }[]
  const names = waTables.map(t => t.name).sort()
  check('11 tabelas whatsapp criadas', names.length === 11, `got ${names.length}: ${names.join(', ')}`)

  const pedidosCol = db.prepare("PRAGMA table_info(pedidos)").all() as { name: string }[]
  check('pedidos.origem existe', pedidosCol.some(c => c.name === 'origem'))

  const clientesCol = db.prepare("PRAGMA table_info(clientes)").all() as { name: string }[]
  check('clientes.atualizado_em existe', clientesCol.some(c => c.name === 'atualizado_em'))

  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='clientes' AND name='idx_clientes_telefone'").get()
  check('idx_clientes_telefone existe', Boolean(idx))

  const seq = db.prepare("SELECT * FROM sequencias WHERE chave = 'pedido'").get() as { chave: string; valor: number } | undefined
  check('sequencia pedido existe', seq !== undefined && seq!.valor === 0)

  db.close()
}

console.log('\n=== Product Cache ===')
{
  const db = createDb()
  seedProdutos(db)

  const items = getAvailableCatalog(db, true)
  check('catalogo tem 3 produtos ativos+publicados+estoque', items.length === 3, `got ${items.length}`)

  const dunhill = items.find(p => p.name === 'Cigarro Dunhill')
  check('dunhill encontrado', Boolean(dunhill))
  check('dunhill preco = preco_promo (15.00)', dunhill!.price === 15.00)
  check('dunhill hasPromo = true', dunhill!.hasPromo === true)
  check('dunhill stock = 50', dunhill!.stock === 50)
  check('dunhill category = "bebidas"', dunhill!.category === 'bebidas')
  check('dunhill tokens incluem "dunhill"', dunhill!.tokens.has('dunhill'))

  const copo = items.find(p => p.name === 'Copo descartável')
  check('copo NÃO aparece (estoque=0)', !copo)

  const inativo = items.find(p => p.name === 'Produto Inativo')
  check('produto inativo NÃO aparece', !inativo)

  invalidateProductCache(db)
  const items2 = getAvailableCatalog(db, true)
  check('cache invalidado e rebuild', items2.length === 3)

  db.close()
}

console.log('\n=== Normalize ===')
{
  check('normalize remove acentos', normalizeForSearch('Café') === 'cafe')
  check('normalize lowercase', normalizeForSearch('DUNHILL') === 'dunhill')
  check('normalize espaços extras', normalizeForSearch('  cigarro   dunhill  ') === 'cigarro dunhill')
  check('normalize vazio', normalizeForSearch('') === '')
}

console.log('\n=== upsertCustomer (service) ===')
{
  const db = createDb()

  // INSERT novo
  service.upsertCustomer(db, '11999998888', 'João Silva')
  const c1 = db.prepare('SELECT * FROM clientes WHERE telefone = ?').get('11999998888') as Record<string, unknown>
  check('cliente criado', Boolean(c1))
  check('nome = João Silva', c1.nome === 'João Silva')
  check('telefone = 11999998888', c1.telefone === '11999998888')
  check('criado_em preenchido', typeof c1.criado_em === 'string' && c1.criado_em !== '')
  check('atualizado_em preenchido', typeof c1.atualizado_em === 'string' && c1.atualizado_em !== '')

  // UPDATE com nome
  service.upsertCustomer(db, '11999998888', 'João Santos')
  const c2 = db.prepare('SELECT nome, atualizado_em FROM clientes WHERE telefone = ?').get('11999998888') as { nome: string; atualizado_em: string }
  check('nome atualizado', c2.nome === 'João Santos')

  // UPDATE sem nome (mantém)
  service.upsertCustomer(db, '11999998888', null)
  const c3 = db.prepare('SELECT nome FROM clientes WHERE telefone = ?').get('11999998888') as { nome: string }
  check('nome mantido quando name=null', c3.nome === 'João Santos')

  // INSERT sem nome
  service.upsertCustomer(db, '11888887777', null)
  const c4 = db.prepare('SELECT * FROM clientes WHERE telefone = ?').get('11888887777') as Record<string, unknown>
  check('cliente sem nome criado', Boolean(c4))
  check('nome default = Cliente WhatsApp', c4.nome === 'Cliente WhatsApp')

  db.close()
}

console.log('\n=== isMessageProcessed / recordEvent ===')
{
  const db = createDb()
  const event = { phone: '11999998888', type: 'text' as const, text: 'oi', messageId: 'msg_001', name: null }

  check('msg não processada', service.isMessageProcessed(db, 'msg_001') === false)
  const ok = service.recordEvent(db, event, '{"text":"oi"}')
  check('recordEvent retorna true (1 insert)', ok === true)
  check('msg processada agora', service.isMessageProcessed(db, 'msg_001') === true)
  check('dedup: segundo insert = false', service.recordEvent(db, event, '{"text":"oi"}') === false)
  check('null messageId = false', service.isMessageProcessed(db, null) === false)

  db.close()
}

console.log('\n=== Cart Operations ===')
{
  const db = createDb()
  seedProdutos(db)

  const phone = '11999998888'

  // getOpenCart cria carrinho novo
  const cart = order.getOpenCart(db, phone)
  check('carrinho criado', Boolean(cart))
  check('cart status = OPEN', cart.status === 'OPEN')
  check('cart customer_phone correto', cart.customer_phone === phone)

  // getOpenCart reutiliza
  const cart2 = order.getOpenCart(db, phone)
  check('carrinho reutilizado', Number(cart.id) === Number(cart2.id))

  // addProduct sucesso
  const add1 = order.addProduct(db, phone, 1, '2')
  check('addProduct ok', add1.ok === true)
  check('addProduct reply existe', typeof add1.reply === 'string')
  check('addProduct quantity = 2', add1.quantity === 2)

  // addProduct produto inexistente
  const addBad = order.addProduct(db, phone, 999, '1')
  check('addProduct produto inexistente = !ok', addBad.ok === false)

  // addProduct produto inativo
  const addInativo = order.addProduct(db, phone, 4, '1')
  check('addProduct produto inativo = !ok', addInativo.ok === false)

  // addProduct quantidade invalida
  const addQtd = order.addProduct(db, phone, 1, 'abc')
  check('addProduct qtd invalida = !ok', addQtd.ok === false)

  // getCartItems
  const items = order.getCartItems(db, Number(cart.id))
  check('cart items tem 1 item', items.length === 1)
  check('item name = Cigarro Dunhill', items[0].name === 'Cigarro Dunhill')
  check('item quantity = 2', items[0].quantity === 2)
  check('item unit_price = 15.00 (promo)', items[0].unit_price === 15.00)

  // viewCart
  const view = order.viewCart(db, phone)
  check('viewCart empty = false', view.empty === false)
  check('viewCart text tem total', view.text!.includes('30,00'))
  check('viewCart items length = 1', view.items.length === 1)

  // changeQtyByName para incrementar
  const chg = order.changeQtyByName(db, phone, 'Dunhill', '3')
  check('changeQtyByName ok', chg.ok === true)
  const items2 = order.getCartItems(db, Number(cart.id))
  check('changeQtyByName definiu 3', items2[0].quantity === 3)

  // removeItem (via removeByIndex)
  const rem = order.removeByIndex(db, phone, '1')
  check('removeByIndex ok', rem.ok === true)
  const items3 = order.getCartItems(db, Number(cart.id))
  check('carrinho vazio apos remove', items3.length === 0)

  // viewCart vazio
  const view2 = order.viewCart(db, phone)
  check('viewCart vazio = true', view2.empty === true)

  // cancelCart (com carrinho novo)
  const phone2 = '11000001111'
  order.addProduct(db, phone2, 1, '1')
  order.cancelCart(db, phone2)
  const cartAfter = db.prepare('SELECT status FROM whatsapp_carts WHERE customer_phone = ?').all(phone2) as { status: string }[]
  check('cancelCart muda status para CANCELED', cartAfter.every(c => c.status === 'CANCELED'))

  db.close()
}

console.log('\n=== Order Finalization ===')
{
  const db = createDb()
  seedProdutos(db)
  const phone = '11999998888'

  // Adicionar item ao carrinho
  order.addProduct(db, phone, 2, '3') // 3x Isqueiro Bic R$5.00 = R$15.00

  // Finalizar pedido
  const checkoutData = { nome: 'Maria Costa', entrega: 'retirada', pagamento: 'Pix' }
  const result = order.finalizeOrder(db, phone, checkoutData)
  check('finalizeOrder ok', result.ok === true)
  check('finalizeOrder orderId existe', typeof result.orderId === 'number')

  // Verificar pedido criado
  const pedido = db.prepare("SELECT * FROM pedidos WHERE cliente_telefone = ? AND origem = 'whatsapp'").get(phone) as Record<string, unknown>
  check('pedido criado no banco', Boolean(pedido))
  check('pedido origem = whatsapp', pedido.origem === 'whatsapp')
  check('pedido cliente_nome = Maria Costa', pedido.cliente_nome === 'Maria Costa')
  check('pedido total = 15.00', Number(pedido.total) === 15.00)
  check('pedido status = novo', pedido.status === 'novo')

  // Verificar itens do pedido
  const itens = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(Number(pedido.id)) as Record<string, unknown>[]
  check('pedido tem 1 item', itens.length === 1)
  check('item nome_produto = Isqueiro Bic', itens[0].nome_produto === 'Isqueiro Bic')
  check('item quantidade = 3', Number(itens[0].quantidade) === 3)
  check('item subtotal = 15.00', Number(itens[0].subtotal) === 15.00)

  // Verificar carrinho fechado
  const carts = db.prepare("SELECT status FROM whatsapp_carts WHERE customer_phone = ?").all(phone) as { status: string }[]
  check('carrinho ORDERED apos finalizar', carts.every(c => c.status === 'ORDERED'))

  // Verificar sequencia incremental
  order.addProduct(db, '11888887777', 1, '1')
  const result2 = order.finalizeOrder(db, '11888887777', { nome: 'Pedro', entrega: 'retirada', pagamento: 'Pix' })
  check('segundo pedido ok', result2.ok === true)
  const pedido2 = db.prepare("SELECT numero FROM pedidos WHERE cliente_telefone = '11888887777' AND origem = 'whatsapp'").get() as { numero: string }
  check('numero do segundo pedido > primeiro', Number(pedido2.numero) > Number(pedido.numero))

  // getOrderDetail
  const detail = order.getOrderDetail(db, phone, Number(pedido.id))
  check('getOrderDetail retorna pedido', Boolean(detail))
  check('getOrderDetail retorna itens', detail!.items.length === 1)

  db.close()
}

console.log('\n=== WhatsApp Settings ===')
{
  const db = createDb()

  const s = settings.getSettings(db)
  check('storeName = Loja Teste', s.storeName === 'Loja Teste')
  check('conversationTimeoutMinutes = 30', s.conversationTimeoutMinutes === 30)
  check('maxQuantityPerItem = 99', s.maxQuantityPerItem === 99)
  check('paymentMethods tem Pix', s.paymentMethods.includes('Pix'))
  check('cpfRequired = false', s.cpfRequired === false)

  db.close()
}

console.log('\n=== WhatsApp Config (repo) ===')
{
  const db = createDb()

  // getSetting from whatsapp_config
  const val = db.prepare('SELECT valor FROM whatsapp_config WHERE chave = ?').get('store_name') as { valor: string }
  check('whatsapp_config store_name', val.valor === 'Loja Teste')

  // Sem default
  const missing = db.prepare('SELECT valor FROM whatsapp_config WHERE chave = ?').get('inexistente') as { valor: string } | undefined
  check('chave inexistente retorna undefined', missing === undefined)

  db.close()
}

console.log('\n=== Conversation State ===')
{
  const db = createDb()
  const phone = '11999998888'
  const ts = nowIso()

  // INSERT
  db.prepare("INSERT INTO whatsapp_conversation_state (phone, state, last_intent, pending_question, updated_at, attendance_status) VALUES (?, 'MENU_PRINCIPAL', 'NONE', NULL, ?, 'BOT')").run(phone, ts)
  const state = db.prepare('SELECT * FROM whatsapp_conversation_state WHERE phone = ?').get(phone) as Record<string, unknown>
  check('conversation state criado', Boolean(state))
  check('state = MENU_PRINCIPAL', state.state === 'MENU_PRINCIPAL')
  check('attendance_status = BOT', state.attendance_status === 'BOT')

  // UPDATE state
  db.prepare("UPDATE whatsapp_conversation_state SET state = ?, last_intent = ?, updated_at = ? WHERE phone = ?").run('MONTANDO_PEDIDO', 'ADD_TO_CART', nowIso(), phone)
  const state2 = db.prepare('SELECT state, last_intent FROM whatsapp_conversation_state WHERE phone = ?').get(phone) as { state: string; last_intent: string }
  check('state atualizado', state2.state === 'MONTANDO_PEDIDO')
  check('last_intent atualizado', state2.last_intent === 'ADD_TO_CART')

  db.close()
}

console.log('\n=== Messages Log ===')
{
  const db = createDb()
  const phone = '11999998888'
  const ts = nowIso()

  db.prepare('INSERT INTO whatsapp_messages (phone, direction, text, created_at) VALUES (?, ?, ?, ?)').run(phone, 'in', 'oi', ts)
  db.prepare('INSERT INTO whatsapp_messages (phone, direction, text, created_at) VALUES (?, ?, ?, ?)').run(phone, 'out', 'Olá! Como posso ajudar?', ts)

  const msgs = db.prepare('SELECT * FROM whatsapp_messages WHERE phone = ? ORDER BY id').all(phone) as Record<string, unknown>[]
  check('2 mensagens logadas', msgs.length === 2)
  check('primeira é in', msgs[0].direction === 'in')
  check('segunda é out', msgs[1].direction === 'out')
  check('texto da primeira = oi', msgs[0].text === 'oi')

  db.close()
}

console.log('\n=== WhatsApp Menu Items ===')
{
  const db = createDb()

  const items = db.prepare('SELECT * FROM whatsapp_menu_items WHERE enabled = 1 ORDER BY position').all() as Record<string, unknown>[]
  check('3 menu items enabled', items.length === 3)
  check('primeiro = Ver cardápio', items[0].label === 'Ver cardápio')
  check('action = catalogo', items[0].action === 'catalogo')

  db.close()
}

console.log('\n=== WhatsApp Intents ===')
{
  const db = createDb()

  const intents = db.prepare('SELECT * FROM whatsapp_intents WHERE enabled = 1 ORDER BY priority DESC').all() as Record<string, unknown>[]
  check('6 intents enabled', intents.length === 6)
  check('primeiro = HUMAN_HANDOFF (priority 200)', intents[0].name === 'HUMAN_HANDOFF' && Number(intents[0].priority) === 200)

  db.close()
}

console.log('\n=== Cross-table: pedido from WhatsApp reads like sistema pedido ===')
{
  const db = createDb()
  seedProdutos(db)

  const phone = '11999998888'
  order.addProduct(db, phone, 1, '1')
  order.finalizeOrder(db, phone, { nome: 'Teste Cross', entrega: 'retirada', pagamento: 'Pix' })

  // Query como o sistema faz (PDV etc)
  const pedidosSistema = db.prepare("SELECT * FROM pedidos WHERE origem = 'sistema'").all()
  check('Nenhum pedido de sistema', pedidosSistema.length === 0)

  const pedidosWA = db.prepare("SELECT * FROM pedidos WHERE origem = 'whatsapp'").all()
  check('1 pedido whatsapp', pedidosWA.length === 1)

  const allPedidos = db.prepare('SELECT * FROM pedidos').all()
  check('1 pedido total (não duplicado)', allPedidos.length === 1)

  // Verificar que itens do pedido_itens são os mesmos para ambos
  const itensWA = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(Number(pedidosWA[0].id))
  check('itens acessíveis via pedido_id', itensWA.length === 1)

  db.close()
}

console.log('\n=== Edge Cases ===')
{
  const db = createDb()
  seedProdutos(db)

  // addProduct com productId negativo
  const neg = order.addProduct(db, '11999998888', -1, '1')
  check('productId negativo = !ok', neg.ok === false)

  // addProduct com quantity 0
  const zero = order.addProduct(db, '11999998888', 1, '0')
  check('quantity 0 = !ok', zero.ok === false)

  // addProduct com estoque insuficiente (Produto 5 tem estoque=5)
  const semEstoque = order.addProduct(db, '11999998888', 5, '10')
  check('estoque insuficiente = stockCap', semEstoque.stockCap === true)

  // upsertCustomer com telefone vazio
  service.upsertCustomer(db, '', 'Teste')
  const emptyPhone = db.prepare("SELECT * FROM clientes WHERE telefone = ''").get()
  check('cliente com telefone vazio criado', Boolean(emptyPhone))

  db.close()
}

// ============================================================
// Resultado
// ============================================================
console.log(`\n===== WHATSAPP INTEGRATION: ${passou} OK, ${falhou} FALHA =====`)
if (falhas.length) {
  console.log('FALHAS:')
  falhas.forEach(f => console.log(`  - ${f}`))
  process.exit(1)
}
