export const SCHEMA_VERSION = 42

export const migrations: Record<number, string> = {
  1: `
    CREATE TABLE usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      login TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      perfil TEXT NOT NULL DEFAULT 'vendedor',
      comissao_percent REAL NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE fornecedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cnpj TEXT,
      telefone TEXT,
      email TEXT,
      endereco TEXT,
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
      email TEXT,
      endereco TEXT,
      aniversario TEXT,
      pontos INTEGER NOT NULL DEFAULT 0,
      fiado_limite REAL NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE vendas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      vendedor_id INTEGER REFERENCES usuarios(id),
      cliente_id INTEGER REFERENCES clientes(id),
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
      venda_id INTEGER REFERENCES vendas(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fornecedor_id INTEGER REFERENCES fornecedores(id),
      numero TEXT NOT NULL UNIQUE,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'paga',
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE compra_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
      produto_id INTEGER REFERENCES produtos(id),
      quantidade REAL NOT NULL,
      preco_custo REAL NOT NULL,
      subtotal REAL NOT NULL
    );

    CREATE TABLE contas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      valor REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'aberta',
      vencimento TEXT,
      fornecedor_id INTEGER REFERENCES fornecedores(id),
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE config (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );

    INSERT INTO config (chave, valor) VALUES ('nome_loja', 'Minha Tabacaria');
    INSERT INTO config (chave, valor) VALUES ('moeda', 'R$');
  `,
  2: `
    CREATE TABLE marcas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE produtos ADD COLUMN marca_id INTEGER REFERENCES marcas(id);

    INSERT INTO marcas (nome) VALUES ('Dunhill');
    INSERT INTO marcas (nome) VALUES ('Marlboro');
    INSERT INTO marcas (nome) VALUES ('Camel');
    INSERT INTO marcas (nome) VALUES ('Lucky Strike');
    INSERT INTO marcas (nome) VALUES ('Hollywood');
    INSERT INTO marcas (nome) VALUES ('Bic');
    INSERT INTO marcas (nome) VALUES ('Monte Pascoal');
  `,
  3: `
    ALTER TABLE clientes ADD COLUMN cpf TEXT;
    ALTER TABLE clientes ADD COLUMN celular TEXT;
    ALTER TABLE clientes ADD COLUMN debito REAL NOT NULL DEFAULT 0;
  `,
  4: `
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
    INSERT INTO config (chave, valor) VALUES ('horario_funcionamento', '10:00 - 22:00');
    INSERT INTO config (chave, valor) VALUES ('telefone_loja', '');
    INSERT INTO config (chave, valor) VALUES ('endereco_loja', '');
  `,
  5: `
    CREATE TABLE zonas_entrega (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      preco REAL NOT NULL DEFAULT 0,
      poligono TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO config (chave, valor) VALUES ('loja_lat', '');
    INSERT INTO config (chave, valor) VALUES ('loja_lng', '');
  `,
  6: `
    ALTER TABLE pedidos ADD COLUMN zona TEXT;
  `,
  7: `
    ALTER TABLE pedidos ADD COLUMN cep TEXT;
    ALTER TABLE pedidos ADD COLUMN lat REAL;
    ALTER TABLE pedidos ADD COLUMN lng REAL;
  `,
  8: `
    CREATE TABLE caixas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id),
      aberto INTEGER NOT NULL DEFAULT 1,
      saldo_inicial REAL NOT NULL DEFAULT 0,
      total_vendas REAL NOT NULL DEFAULT 0,
      total_sangrias REAL NOT NULL DEFAULT 0,
      total_suprimentos REAL NOT NULL DEFAULT 0,
      descontos REAL NOT NULL DEFAULT 0,
      cancelamentos REAL NOT NULL DEFAULT 0,
      qtd_vendas INTEGER NOT NULL DEFAULT 0,
      aberto_em TEXT NOT NULL DEFAULT (datetime('now')),
      fechado_em TEXT,
      usuario_fechamento INTEGER REFERENCES usuarios(id)
    );

    CREATE TABLE movimentos_caixa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caixa_id INTEGER NOT NULL REFERENCES caixas(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      valor REAL NOT NULL,
      motivo TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE formas_pagamento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'outro',
      permite_troco INTEGER NOT NULL DEFAULT 0,
      permite_parcelas INTEGER NOT NULL DEFAULT 0,
      max_parcelas INTEGER NOT NULL DEFAULT 1,
      taxa REAL NOT NULL DEFAULT 0,
      dias_receber INTEGER NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1
    );

    INSERT INTO formas_pagamento (nome, tipo, permite_troco, permite_parcelas, max_parcelas, taxa, dias_receber) VALUES
      ('Dinheiro', 'dinheiro', 1, 0, 1, 0, 0),
      ('Pix', 'pix', 0, 0, 1, 0, 0),
      ('Cartão', 'cartao', 0, 1, 12, 0, 1),
      ('Fiado', 'fiado', 0, 0, 1, 0, 0);

    CREATE TABLE alteracoes_preco (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id),
      tipo TEXT NOT NULL,
      valor REAL NOT NULL,
      observacao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE alteracoes_preco_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alteracao_id INTEGER NOT NULL REFERENCES alteracoes_preco(id) ON DELETE CASCADE,
      produto_id INTEGER NOT NULL REFERENCES produtos(id),
      preco_antigo REAL NOT NULL,
      preco_novo REAL NOT NULL
    );

    ALTER TABLE vendas ADD COLUMN caixa_id INTEGER REFERENCES caixas(id);
  `,
  9: `
    ALTER TABLE produtos ADD COLUMN imagem BLOB;
  `,
  10: `
    ALTER TABLE vendas ADD COLUMN observacoes TEXT;
  `,
  11: `
    CREATE TABLE subcategorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      categoria_id INTEGER REFERENCES categorias(id),
      nome TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE produtos ADD COLUMN codigo_interno TEXT;
    ALTER TABLE produtos ADD COLUMN codigo_extra TEXT;
    ALTER TABLE produtos ADD COLUMN codigo_automatico INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE produtos ADD COLUMN subcategoria_id INTEGER REFERENCES subcategorias(id);
    ALTER TABLE produtos ADD COLUMN peso_liq REAL;
    ALTER TABLE produtos ADD COLUMN peso_bruto REAL;
    ALTER TABLE produtos ADD COLUMN localizacao TEXT;
    ALTER TABLE produtos ADD COLUMN observacoes TEXT;
    ALTER TABLE produtos ADD COLUMN preco_automatico INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE produtos ADD COLUMN preco_alteravel INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE produtos ADD COLUMN promocional INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE produtos ADD COLUMN preco_promo REAL;
    ALTER TABLE produtos ADD COLUMN controla_estoque INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE produtos ADD COLUMN estoque_maximo REAL;
    ALTER TABLE produtos ADD COLUMN permite_fracionado INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE produtos ADD COLUMN unidade_medida TEXT;
  `,
  12: `
    ALTER TABLE produtos ADD COLUMN ncm TEXT;
    ALTER TABLE produtos ADD COLUMN cest TEXT;
    ALTER TABLE produtos ADD COLUMN exportar_balanca INTEGER NOT NULL DEFAULT 0;
  `,
  13: `
    ALTER TABLE produtos ADD COLUMN publicado INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE produtos ADD COLUMN descricao TEXT;
  `,
  14: `
    INSERT INTO config (chave, valor) VALUES ('pedidos_ativos', '1');
    INSERT INTO config (chave, valor) VALUES ('aceita_entrega', '1');
    INSERT INTO config (chave, valor) VALUES ('aceita_retirada', '0');
  `,
  15: `
    ALTER TABLE produtos ADD COLUMN preco_atacado1 REAL;
    ALTER TABLE produtos ADD COLUMN preco_atacado2 REAL;
    ALTER TABLE produtos ADD COLUMN qtd_min_atacado1 REAL NOT NULL DEFAULT 0;
    ALTER TABLE produtos ADD COLUMN qtd_min_atacado2 REAL NOT NULL DEFAULT 0;
  `,
  16: `
    CREATE TABLE listas_pdv (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE lista_pdv_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lista_id INTEGER NOT NULL REFERENCES listas_pdv(id) ON DELETE CASCADE,
      produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
      UNIQUE(lista_id, produto_id)
    );
  `,
  17: `
    INSERT INTO config (chave, valor) VALUES ('manutencao_ativos', '0');
  `,
  18: `
    CREATE TABLE sequencias (
      chave TEXT PRIMARY KEY,
      valor INTEGER NOT NULL DEFAULT 0
    );

    INSERT INTO sequencias (chave, valor) VALUES ('venda', 56780);
  `,
  19: `
    ALTER TABLE caixas ADD COLUMN saldo_informado REAL;
    ALTER TABLE caixas ADD COLUMN quebra REAL;
  `,
  20: `
    ALTER TABLE caixas ADD COLUMN reaberto_em TEXT;
    ALTER TABLE caixas ADD COLUMN reaberto_por INTEGER REFERENCES usuarios(id);
  `,
  21: `
    CREATE TABLE permissoes (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      modulo TEXT NOT NULL,
      PRIMARY KEY (usuario_id, modulo)
    );
  `,
  22: `
    ALTER TABLE pedidos ADD COLUMN vendedor_id INTEGER REFERENCES usuarios(id);
    ALTER TABLE pedidos ADD COLUMN desconto REAL NOT NULL DEFAULT 0;
  `,
  23: `
    CREATE TABLE orcamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      cliente_nome TEXT,
      cliente_telefone TEXT,
      cliente_endereco TEXT,
      observacoes TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      desconto REAL NOT NULL DEFAULT 0,
      taxa_entrega REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'orcamento',
      vendedor_id INTEGER REFERENCES usuarios(id),
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE orcamento_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
      produto_id INTEGER REFERENCES produtos(id),
      nome_produto TEXT NOT NULL,
      quantidade REAL NOT NULL,
      preco_unitario REAL NOT NULL,
      subtotal REAL NOT NULL
    );
  `,
  24: `
    ALTER TABLE venda_itens ADD COLUMN desconto REAL NOT NULL DEFAULT 0;
    ALTER TABLE venda_itens ADD COLUMN observacao TEXT;
    ALTER TABLE pedido_itens ADD COLUMN desconto REAL NOT NULL DEFAULT 0;
    ALTER TABLE pedido_itens ADD COLUMN observacao TEXT;
    ALTER TABLE orcamento_itens ADD COLUMN desconto REAL NOT NULL DEFAULT 0;
    ALTER TABLE orcamento_itens ADD COLUMN observacao TEXT;
  `,
  25: `
    CREATE TABLE categorias_clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE clientes ADD COLUMN categoria_id INTEGER REFERENCES categorias_clientes(id);
  `,
  26: `
    ALTER TABLE clientes ADD COLUMN codigo TEXT;
    ALTER TABLE clientes ADD COLUMN data_nascimento TEXT;
    ALTER TABLE clientes ADD COLUMN rg TEXT;
    ALTER TABLE clientes ADD COLUMN genero TEXT;
    ALTER TABLE clientes ADD COLUMN empresa INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE clientes ADD COLUMN cnpj TEXT;
    ALTER TABLE clientes ADD COLUMN observacoes TEXT;
    ALTER TABLE clientes ADD COLUMN info_extras TEXT;
    ALTER TABLE clientes ADD COLUMN foto BLOB;
    ALTER TABLE clientes ADD COLUMN vip INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE clientes ADD COLUMN categoria_compra TEXT NOT NULL DEFAULT 'varejo';
  `,
  27: `
    ALTER TABLE alteracoes_preco ADD COLUMN campo TEXT NOT NULL DEFAULT 'preco_venda';
    ALTER TABLE alteracoes_preco_itens ADD COLUMN campo TEXT NOT NULL DEFAULT 'preco_venda';
  `,
  28: `
    ALTER TABLE usuarios ADD COLUMN usar_web INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE usuarios ADD COLUMN usar_app INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE usuarios ADD COLUMN limitar_desconto INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE usuarios ADD COLUMN desconto_max_percent REAL NOT NULL DEFAULT 0;
  `,
  29: `
    ALTER TABLE fornecedores ADD COLUMN cpf TEXT;
    ALTER TABLE fornecedores ADD COLUMN celular TEXT;
    ALTER TABLE fornecedores ADD COLUMN pessoa_fisica INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE fornecedores ADD COLUMN nao_contribuinte_icms INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE fornecedores ADD COLUMN ie TEXT;
    ALTER TABLE fornecedores ADD COLUMN isento_ie INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE fornecedores ADD COLUMN regime_especial_icms INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE fornecedores ADD COLUMN observacoes TEXT;
    ALTER TABLE fornecedores ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1;
  `,
  30: `
    CREATE TABLE separacoes_dinheiro (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fornecedor_id INTEGER REFERENCES fornecedores(id),
      valor REAL NOT NULL,
      data TEXT NOT NULL DEFAULT (date('now')),
      destinacao TEXT,
      observacao TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE fornecedores ADD COLUMN regra_reposicao INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE fornecedores ADD COLUMN regra_reposicao_valor REAL NOT NULL DEFAULT 100;
  `,
  31: `
    ALTER TABLE contas ADD COLUMN categoria TEXT;
    ALTER TABLE contas ADD COLUMN centro_custo TEXT;
    ALTER TABLE contas ADD COLUMN origem TEXT DEFAULT 'manual';
    ALTER TABLE contas ADD COLUMN compra_id INTEGER;
    ALTER TABLE contas ADD COLUMN forma_pagamento TEXT;
    ALTER TABLE contas ADD COLUMN valor_pago REAL NOT NULL DEFAULT 0;
    ALTER TABLE contas ADD COLUMN data_pagamento TEXT;
    ALTER TABLE contas ADD COLUMN prioridade TEXT NOT NULL DEFAULT 'media';
    ALTER TABLE contas ADD COLUMN observacao TEXT;

    CREATE TABLE reservas_contas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      valor REAL NOT NULL,
      data TEXT NOT NULL DEFAULT (date('now')),
      destinacao TEXT,
      observacao TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
  32: `
    ALTER TABLE clientes ADD COLUMN numero TEXT;
    ALTER TABLE clientes ADD COLUMN bairro TEXT;
    ALTER TABLE clientes ADD COLUMN cidade TEXT;
    ALTER TABLE clientes ADD COLUMN uf TEXT;
    ALTER TABLE clientes ADD COLUMN cep TEXT;
    ALTER TABLE clientes ADD COLUMN pai TEXT;
    ALTER TABLE clientes ADD COLUMN mae TEXT;
    ALTER TABLE clientes ADD COLUMN ultima_visita TEXT;
    ALTER TABLE clientes ADD COLUMN fid_total REAL NOT NULL DEFAULT 0;
    ALTER TABLE clientes ADD COLUMN tem_credito INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE clientes ADD COLUMN valor_cred REAL NOT NULL DEFAULT 0;
  `,
  33: `
    CREATE TABLE catalogo_sync (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );

    CREATE TABLE catalogo_fila (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL DEFAULT 'alteracao',
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE produtos ADD COLUMN catalogo_ordem INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE produtos ADD COLUMN catalogo_publicado INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE produtos ADD COLUMN alterado_em TEXT;

    INSERT INTO catalogo_sync (chave, valor) VALUES ('ultima_sync', '');
    INSERT INTO catalogo_sync (chave, valor) VALUES ('ultimo_erro', '');
    INSERT INTO catalogo_sync (chave, valor) VALUES ('status', 'nunca_sincronizado');
  `,
  34: `
    CREATE TABLE ncm_cadastro (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ncm TEXT NOT NULL UNIQUE,
      descricao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE cest_cadastro (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cest TEXT NOT NULL UNIQUE,
      descricao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE cfop_cadastro (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cfop TEXT NOT NULL UNIQUE,
      descricao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE produtos_fiscais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
      ncm TEXT,
      cest TEXT,
      cfop TEXT,
      origem TEXT,
      csosn TEXT,
      cst TEXT,
      icms REAL,
      observacoes TEXT,
      atualizado_em TEXT,
      UNIQUE(produto_id)
    );
  `,
  35: `
    CREATE TABLE historico_remocoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid_ref TEXT,
      id_ref INTEGER,
      tabela_origem TEXT,
      descricao TEXT,
      removido_por TEXT,
      data TEXT,
      bytes_brutos TEXT,
      importado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE logs_sistema (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT,
      info TEXT,
      origem TEXT,
      bytes_brutos TEXT,
      importado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE terminais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term_id TEXT UNIQUE,
      nome TEXT,
      opcoes TEXT,
      bytes_brutos TEXT,
      importado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
  36: `
    CREATE TABLE nex_dados_brutos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tabela_origem TEXT,
      registro TEXT,
      dados_json TEXT,
      bytes_brutos TEXT,
      motivo TEXT,
      importado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE comissoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendedor_id INTEGER REFERENCES usuarios(id),
      venda_id INTEGER REFERENCES vendas(id),
      valor REAL NOT NULL DEFAULT 0,
      percentual REAL NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
  37: `
    ALTER TABLE categorias ADD COLUMN nex_uid TEXT;
    ALTER TABLE subcategorias ADD COLUMN nex_uid TEXT;
    ALTER TABLE produtos ADD COLUMN nex_uid TEXT;
  `,
  38: `
    ALTER TABLE produtos ADD COLUMN data_validade TEXT;
    ALTER TABLE produtos ADD COLUMN data_fabricacao TEXT;
    ALTER TABLE produtos ADD COLUMN lote TEXT;

    ALTER TABLE movimentacoes ADD COLUMN categoria TEXT;
    ALTER TABLE movimentacoes ADD COLUMN documento TEXT;
    ALTER TABLE movimentacoes ADD COLUMN valor REAL NOT NULL DEFAULT 0;
    ALTER TABLE movimentacoes ADD COLUMN origem TEXT;
    ALTER TABLE movimentacoes ADD COLUMN destino TEXT;
    ALTER TABLE movimentacoes ADD COLUMN cliente_id INTEGER REFERENCES clientes(id);
    ALTER TABLE movimentacoes ADD COLUMN fornecedor_id INTEGER REFERENCES fornecedores(id);

    CREATE TABLE inventarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      usuario_id INTEGER REFERENCES usuarios(id),
      status TEXT NOT NULL DEFAULT 'aberto',
      observacao TEXT,
      total_itens INTEGER NOT NULL DEFAULT 0,
      total_conferidos INTEGER NOT NULL DEFAULT 0,
      total_divergencias INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      finalizado_em TEXT
    );

    CREATE TABLE inventario_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventario_id INTEGER NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
      produto_id INTEGER NOT NULL REFERENCES produtos(id),
      estoque_sistema REAL NOT NULL DEFAULT 0,
      quantidade_fisica REAL,
      diferenca REAL NOT NULL DEFAULT 0,
      conferido INTEGER NOT NULL DEFAULT 0,
      UNIQUE(inventario_id, produto_id)
    );

    CREATE INDEX idx_mov_documento ON movimentacoes(documento);
    CREATE INDEX idx_mov_categoria ON movimentacoes(categoria);
  `,
  39: `
    -- ============================================================
    -- MIGRATION 39: WhatsApp Attendance Module
    -- Tabelas novas (prefixo whatsapp_) + coluna origem em pedidos
    -- ============================================================

    -- Coluna para rastrear origem do pedido (sistema, whatsapp, catalogo)
    ALTER TABLE pedidos ADD COLUMN origem TEXT NOT NULL DEFAULT 'sistema';

    -- Estado da conversa WhatsApp (por telefone)
    CREATE TABLE IF NOT EXISTS whatsapp_conversation_state (
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

    -- Mensagens da conversa (histórico)
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL,
      text TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_msg_phone ON whatsapp_messages(phone, id);

    -- Eventos do webhook (dedup)
    CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE,
      phone TEXT NOT NULL,
      event_type TEXT,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      received_at TEXT NOT NULL
    );

    -- Carrinho do WhatsApp
    CREATE TABLE IF NOT EXISTS whatsapp_carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_carts_phone ON whatsapp_carts(customer_phone, status);

    -- Itens do carrinho
    CREATE TABLE IF NOT EXISTS whatsapp_cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL REFERENCES whatsapp_carts(id),
      produto_id INTEGER NOT NULL REFERENCES produtos(id),
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_price REAL NOT NULL CHECK (unit_price >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_cart_items_cart ON whatsapp_cart_items(cart_id);

    -- Configurações do WhatsApp (chave/valor)
    CREATE TABLE IF NOT EXISTS whatsapp_config (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );

    -- Intents configuráveis
    CREATE TABLE IF NOT EXISTS whatsapp_intents (
      name TEXT PRIMARY KEY,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100
    );

    CREATE TABLE IF NOT EXISTS whatsapp_intent_phrases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intent_name TEXT NOT NULL REFERENCES whatsapp_intents(name) ON DELETE CASCADE,
      phrase TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_intent_phrases ON whatsapp_intent_phrases(intent_name);

    -- Mensagens configuráveis
    CREATE TABLE IF NOT EXISTS whatsapp_responses (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      text TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    -- Menu dinâmico
    CREATE TABLE IF NOT EXISTS whatsapp_menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      action TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    -- Configurações de entrega WhatsApp
    CREATE TABLE IF NOT EXISTS whatsapp_delivery_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Seed de configurações padrão WhatsApp
    INSERT OR IGNORE INTO whatsapp_config (chave, valor) VALUES
      ('wa_api_url', 'http://localhost:8080'),
      ('wa_api_key', ''),
      ('wa_webhook_token', ''),
      ('wa_mock', 'false'),
      ('conversation_timeout', '30'),
      ('admin_user', 'admin'),
      ('admin_password', 'admin123'),
      ('store_name', 'Loja Tabacaria'),
      ('attendance_status', 'BOT');

    -- Seed de intents padrão
    INSERT OR IGNORE INTO whatsapp_intents (name, description, enabled, priority) VALUES
      ('HUMAN_HANDOFF', 'Solicitar atendente humano', 1, 200),
      ('CANCEL', 'Cancelar operação atual', 1, 150),
      ('BACK', 'Voltar ao passo anterior', 1, 150),
      ('MENU', 'Ver menu principal', 1, 120),
      ('ORDER', 'Fazer pedido', 1, 110),
      ('ADD_TO_CART', 'Adicionar item ao carrinho', 1, 110),
      ('VIEW_CART', 'Ver carrinho', 1, 110),
      ('LIST', 'Listar produtos', 1, 100),
      ('PRODUCT_SEARCH', 'Buscar produto', 1, 100),
      ('SMALLTALK', 'Conversa casual', 1, 50),
      ('NUMERIC', 'Resposta numérica contextual', 1, 80),
      ('NONE', 'Sem intenção detectada', 1, 0);
  `,
  40: `
    -- ============================================================
    -- MIGRATION 40: WhatsApp Integration Fixes
    -- Coluna atualizado_em em clientes, índices, sequência pedido
    -- ============================================================

    -- Coluna para rastreamento de atualização de clientes (usada pelo WhatsApp)
    ALTER TABLE clientes ADD COLUMN atualizado_em TEXT;

    -- Índices para performance do WhatsApp (busca por telefone)
    CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone);
    CREATE INDEX IF NOT EXISTS idx_pedidos_telefone ON pedidos(cliente_telefone);
    CREATE INDEX IF NOT EXISTS idx_pedidos_origem ON pedidos(origem);

    -- Sequência para números de pedido WhatsApp
    INSERT OR IGNORE INTO sequencias (chave, valor) VALUES ('pedido', 0);
  `,
  41: `
    -- ============================================================
    -- MIGRATION 41: PDV - dados de cliente, observação e entrega em vendas
    -- ============================================================

    ALTER TABLE vendas ADD COLUMN taxa_entrega REAL NOT NULL DEFAULT 0;
    ALTER TABLE vendas ADD COLUMN cliente_endereco TEXT;
  `,
  42: `
    -- ============================================================
    -- MIGRATION 42: Remoção da integração antiga do catálogo (GitHub Pages)
    -- Remove o token/repo/branch do GitHub armazenados em catalogo_sync.config
    -- (token ficava em texto puro). Nenhuma coluna/tabela de produto é alterada.
    -- ============================================================

    UPDATE catalogo_sync
    SET valor = json_remove(valor, '$.github_token', '$.github_repo', '$.github_branch')
    WHERE chave = 'config' AND json_valid(valor)
      AND (json_extract(valor, '$.github_token') IS NOT NULL
           OR json_extract(valor, '$.github_repo') IS NOT NULL
           OR json_extract(valor, '$.github_branch') IS NOT NULL);
  `
}