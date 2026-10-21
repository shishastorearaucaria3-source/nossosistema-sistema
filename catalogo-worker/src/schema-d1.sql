-- Schema D1 para catálogo público (Cloudflare D1)
-- Execute: npx wrangler d1 execute catalogo-db --file=src/schema-d1.sql

CREATE TABLE IF NOT EXISTS loja_config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  categoria_id INTEGER,
  subcategoria TEXT,
  marca TEXT,
  preco REAL NOT NULL DEFAULT 0,
  preco_promo REAL,
  tem_promo INTEGER NOT NULL DEFAULT 0,
  disponivel INTEGER NOT NULL DEFAULT 1,
  estoque INTEGER NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0,
  imagem_key TEXT
);

CREATE TABLE IF NOT EXISTS zonas_entrega (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  preco REAL NOT NULL DEFAULT 0,
  ceps TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sync_meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Pedidos criados pelo catálogo online (público). O ERP busca por aqui via
-- GET /api/catalogo/pedidos com o token de sync e grava localmente (idempotente
-- pelo id). Nunca confiar em preço/total do front: o worker recalcula no backend.
CREATE TABLE IF NOT EXISTS pedidos_online (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL DEFAULT 0,
  cliente_nome TEXT NOT NULL,
  cliente_whatsapp TEXT NOT NULL,
  modalidade TEXT NOT NULL DEFAULT 'entrega',
  endereco TEXT,
  cep TEXT,
  zona_nome TEXT,
  taxa_entrega REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  desconto REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  forma_pagamento TEXT NOT NULL DEFAULT '',
  observacao TEXT,
  status TEXT NOT NULL DEFAULT 'novo',
  ip TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedidos_online_criado
  ON pedidos_online (criado_em);

CREATE TABLE IF NOT EXISTS pedido_itens_online (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id TEXT NOT NULL REFERENCES pedidos_online(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL,
  nome_produto TEXT NOT NULL,
  quantidade INTEGER NOT NULL,
  preco_unitario REAL NOT NULL,
  subtotal REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_online_pedido
  ON pedido_itens_online (pedido_id);

-- Dados iniciais da loja
INSERT INTO loja_config (chave, valor) VALUES ('nome_loja', 'Loja');
INSERT INTO sync_meta (chave, valor) VALUES ('ultima_sync', '');
INSERT INTO sync_meta (chave, valor) VALUES ('versao', '0');
