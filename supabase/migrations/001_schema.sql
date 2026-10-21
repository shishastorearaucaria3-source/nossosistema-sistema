-- Supabase Migration: Catálogo Online multiempresa
-- Execute no Supabase SQL Editor ou via CLI: supabase db push

-- ============================================================
-- TABELAS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  slug text NOT NULL UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome_loja text NOT NULL DEFAULT 'Loja',
  whatsapp text,
  endereco text,
  horario text,
  manutencao_ativos boolean NOT NULL DEFAULT false,
  pedidos_ativos boolean NOT NULL DEFAULT true,
  aceita_entrega boolean NOT NULL DEFAULT true,
  aceita_retirada boolean NOT NULL DEFAULT false,
  taxa_entrega numeric NOT NULL DEFAULT 0,
  mostrar_estoque boolean NOT NULL DEFAULT true,
  sem_estoque text NOT NULL DEFAULT 'manter',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(empresa_id)
);

CREATE TABLE IF NOT EXISTS public.catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  external_id integer NOT NULL,
  nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  external_id integer NOT NULL,
  nome text NOT NULL,
  slug text NOT NULL,
  descricao text,
  preco numeric NOT NULL DEFAULT 0,
  preco_promo numeric,
  categoria_id uuid REFERENCES public.catalog_categories(id) ON DELETE SET NULL,
  subcategoria text,
  marca text,
  publicado boolean NOT NULL DEFAULT true,
  estoque_publico integer NOT NULL DEFAULT 0,
  ordem integer NOT NULL DEFAULT 0,
  imagem_url text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.catalog_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  desconto_percentual numeric,
  preco_promo numeric,
  ativo boolean NOT NULL DEFAULT true,
  inicio timestamptz,
  fim timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  external_id integer NOT NULL,
  nome text NOT NULL,
  preco numeric NOT NULL DEFAULT 0,
  ceps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.pedidos_online (
  id text PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  numero integer NOT NULL DEFAULT 0,
  cliente_nome text NOT NULL,
  cliente_whatsapp text NOT NULL,
  modalidade text NOT NULL DEFAULT 'entrega',
  endereco text,
  cep text,
  zona_nome text,
  taxa_entrega numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  desconto numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  forma_pagamento text NOT NULL DEFAULT '',
  observacao text,
  status text NOT NULL DEFAULT 'novo',
  ip text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL,
  atualizado_em timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedidos_online_empresa_criado
  ON public.pedidos_online (empresa_id, criado_em);

CREATE TABLE IF NOT EXISTS public.pedido_itens_online (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_id text NOT NULL REFERENCES public.pedidos_online(id) ON DELETE CASCADE,
  produto_id integer NOT NULL,
  nome_produto text NOT NULL,
  quantidade integer NOT NULL,
  preco_unitario numeric NOT NULL,
  subtotal numeric NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_online_pedido
  ON public.pedido_itens_online (pedido_id);

CREATE TABLE IF NOT EXISTS public.sync_meta (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  chave text NOT NULL,
  valor text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(empresa_id, chave)
);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_online ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_itens_online ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_meta ENABLE ROW LEVEL SECURITY;

-- service_role: acesso total (usado pelo Worker e pelo server de sync)
CREATE POLICY "service_role_all_empresas" ON public.empresas
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_settings" ON public.catalog_settings
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_categories" ON public.catalog_categories
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_products" ON public.catalog_products
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_promotions" ON public.catalog_promotions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_zones" ON public.catalog_zones
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_pedidos" ON public.pedidos_online
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_pedido_itens" ON public.pedido_itens_online
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_sync_meta" ON public.sync_meta
  FOR ALL USING (auth.role() = 'service_role');

-- anon: leitura pública (catálogo online)
CREATE POLICY "anon_select_settings" ON public.catalog_settings
  FOR SELECT USING (true);

CREATE POLICY "anon_select_categories" ON public.catalog_categories
  FOR SELECT USING (true);

CREATE POLICY "anon_select_products" ON public.catalog_products
  FOR SELECT USING (true);

CREATE POLICY "anon_select_promotions" ON public.catalog_promotions
  FOR SELECT USING (true);

CREATE POLICY "anon_select_zones" ON public.catalog_zones
  FOR SELECT USING (true);

-- anon: inserção de pedidos (checkout público)
CREATE POLICY "anon_insert_pedidos" ON public.pedidos_online
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_insert_pedido_itens" ON public.pedido_itens_online
  FOR INSERT WITH CHECK (true);

-- anon: leitura de pedidos próprios (após criação)
CREATE POLICY "anon_select_own_pedidos" ON public.pedidos_online
  FOR SELECT USING (true);

CREATE POLICY "anon_select_own_pedido_itens" ON public.pedido_itens_online
  FOR SELECT USING (true);

-- ============================================================
-- TRIGGER: atualiza updated_at automaticamente
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_catalog_settings_updated ON public.catalog_settings;
CREATE TRIGGER trg_catalog_settings_updated
  BEFORE UPDATE ON public.catalog_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_catalog_products_updated ON public.catalog_products;
CREATE TRIGGER trg_catalog_products_updated
  BEFORE UPDATE ON public.catalog_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('produtos', 'produtos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('produtos-privado', 'produtos-privado', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: service_role upload, anon read public
CREATE POLICY "service_role_upload_produtos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'produtos' AND auth.role() = 'service_role');

CREATE POLICY "service_role_delete_produtos" ON storage.objects
  FOR DELETE USING (bucket_id = 'produtos' AND auth.role() = 'service_role');

CREATE POLICY "anon_read_produtos" ON storage.objects
  FOR SELECT USING (bucket_id = 'produtos');

CREATE POLICY "service_role_upload_produtos_privado" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'produtos-privado' AND auth.role() = 'service_role');

CREATE POLICY "service_role_delete_produtos_privado" ON storage.objects
  FOR DELETE USING (bucket_id = 'produtos-privado' AND auth.role() = 'service_role');

CREATE POLICY "anon_read_produtos_privado" ON storage.objects
  FOR SELECT USING (bucket_id = 'produtos-privado');
