export interface DbApi {
  all: (sql: string, params?: unknown[]) => Promise<unknown[]>
  get: (sql: string, params?: unknown[]) => Promise<unknown>
  run: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number }>
  exec: (sql: string) => Promise<void>
  transacao: (statements: { sql: string; params?: unknown[] }[]) => Promise<{
    ok: boolean
    resultados?: { changes: number; lastInsertRowid: number }[]
    indice?: number
    erro?: string
  }>
}

export interface VendasCancelApi {
  cancelar: (vendaId: number, usuarioId: number) => Promise<{ ok: boolean; numero?: string; itens_devolvidos?: number; erro?: string }>
  finalizar: (dados: {
    itens: { produto_id: number; nome: string; quantidade: number; preco_unitario: number; desconto?: number; observacao?: string | null }[]
    pagamentos: { forma: string; valor: number }[]
    subtotal: number
    desconto: number
    total: number
    vendedor_id?: number | null
    caixa_id?: number | null
    usuario_id?: number | null
    cliente_id?: number | null
    observacoes?: string | null
    taxa_entrega?: number
    cliente_endereco?: string | null
  }) => Promise<{ ok: boolean; numero: string; venda_id: number; erro?: string; codigo?: string }>
}

export interface PedidosCancelApi {
  cancelar: (pedidoId: number, usuarioId: number) => Promise<{ ok: boolean; estoque_devolvido?: boolean; erro?: string }>
}

export function getVendasCancelApi(): VendasCancelApi {
  const win = window as unknown as { api: { vendas: VendasCancelApi } }
  return win.api.vendas
}

export function getPedidosCancelApi(): PedidosCancelApi {
  const win = window as unknown as { api: { pedidosApi: PedidosCancelApi } }
  return win.api.pedidosApi
}

export interface Usuario {
  id: number
  nome: string
  login: string
  perfil: string
  comissao_percent: number
}

export interface AuthApi {
  login: (login: string, senha: string) => Promise<{ ok: boolean; erro?: string; usuario?: Usuario }>
  logout: () => Promise<void>
  session: () => Promise<Usuario | null>
  usuarios: () => Promise<{ id: number; nome: string; login: string; perfil: string }[]>
  criarUsuario: (dados: {
    nome: string
    login: string
    senha: string
    perfil: string
    comissao: number
  }) => Promise<{ ok: boolean; id?: number }>
  alterarSenha: (usuarioId: number, novaSenha: string) => Promise<{ ok: boolean }>
  atualizarUsuario: (dados: {
    usuarioId: number
    nome: string
    login: string
    perfil: string
    comissao: number
    senha?: string
  }) => Promise<{ ok: boolean }>
  atualizarOpcoes: (dados: {
    usuarioId: number
    usar_web: boolean
    usar_app: boolean
    limitar_desconto: boolean
    desconto_max_percent: number
  }) => Promise<{ ok: boolean }>
  atualizarPermissoes: (dados: { usuarioId: number; modulos: string[] }) => Promise<{ ok: boolean }>
  ativarDesativar: (dados: { usuarioId: number; ativo: boolean }) => Promise<{ ok: boolean }>
  deletar: (dados: { usuarioId: number }) => Promise<{ ok: boolean }>
}

export interface AppApi {
  db: DbApi
  auth: AuthApi
}

export function getDbApi(): DbApi {
  const win = window as unknown as { api: AppApi }
  return win.api.db
}

export function getAuthApi(): AuthApi {
  const win = window as unknown as { api: AppApi }
  return win.api.auth
}

export function hasDbApi(): boolean {
  return !!(window as unknown as { api?: { db?: unknown } }).api?.db
}

export async function fazerBackupManual(): Promise<string> {
  const win = window as unknown as { api: { backup: { manual: () => Promise<{ ok: boolean; arquivo: string }> } } }
  const res = await win.api.backup.manual()
  return res.ok ? `Backup salvo: ${res.arquivo}` : `Falha no backup: ${res.arquivo}`
}

export function setFullscreen(ativo: boolean): Promise<void> {
  const win = window as unknown as { api: { janela: { fullscreen: (a: boolean) => Promise<void> } } }
  return win.api.janela.fullscreen(ativo)
}

export interface ImagemApi {
  definir: (produtoId: number) => Promise<string | null>
  get: (produtoId: number) => Promise<string | null>
  list: () => Promise<Record<number, string>>
  listPorIds: (ids: number[]) => Promise<Record<number, string>>
  remover: (produtoId: number) => Promise<{ ok: boolean }>
}

export function getImagemApi(): ImagemApi {
  const win = window as unknown as { api: { imagem: ImagemApi } }
  return win.api.imagem
}

export interface ImportarApi {
  lerArquivo: () => Promise<{ arquivo: string; colunas: string[]; linhas: Record<string, unknown>[]; erro?: string } | null>
}

export function getImportarApi(): ImportarApi {
  const win = window as unknown as { api: { importar: ImportarApi } }
  return win.api.importar
}

export interface ZonasApi {
  exportar: () => Promise<{ ok: boolean; erro?: string; arquivo?: string }>
  importar: () => Promise<{ ok: boolean; erro?: string; qtd?: number }>
}

export function getZonasApi(): ZonasApi {
  const win = window as unknown as { api: { zonas: ZonasApi } }
  return win.api.zonas
}

export interface CaixasApi {
  exportar: () => Promise<{ ok: boolean; erro?: string; arquivo?: string; qtd?: number }>
  importar: () => Promise<{ ok: boolean; erro?: string; qtd?: number }>
}

export function getCaixasApi(): CaixasApi {
  const win = window as unknown as { api: { caixas: CaixasApi } }
  return win.api.caixas
}

export interface CatalogoApi {
  getExibicao: () => Promise<{
    mostrar_estoque: boolean
    sem_estoque: 'despublicar' | 'manter'
    aceitar_pedidos_sem_estoque: boolean
    destacar_promocoes: boolean
  }>
  salvarExibicao: (dados: {
    mostrar_estoque: boolean
    sem_estoque: 'despublicar' | 'manter'
    aceitar_pedidos_sem_estoque: boolean
    destacar_promocoes: boolean
  }) => Promise<{ ok: boolean; exibicao: unknown }>
}

export function getCatalogoApi(): CatalogoApi {
  const win = window as unknown as { api: { catalogo: CatalogoApi } }
  return win.api.catalogo
}

export interface ServidorApi {
  status: () => Promise<Record<string, unknown>>
  logs: () => Promise<{ ok: boolean; logs: { hora: string; nivel: string; msg: string }[] }>
  limparLogs: () => Promise<{ ok: boolean }>
  backupInfo: () => Promise<{ ok: boolean; dir: string; backups: { nome: string; data: string; tamanho: number }[] }>
  diagnostico: () => Promise<{ ok: boolean; itens: { nome: string; status: string; detalhe: string }[] }>
  corrigir: () => Promise<{ ok: boolean; correcoes: string[] }>
  zerar: (alvos: string[]) => Promise<{ ok: boolean; removidos: string[]; erro?: string }>
  restaurar: () => Promise<{ ok: boolean; erro?: string }>
  conexao: () => Promise<{ ips: string[]; url: string; local: boolean }>
  descobrir: () => Promise<{ servidores: string[]; porta: number }>
  configurarConexao: (opcoes: { local?: boolean; ip?: string; url?: string }) => Promise<{ ok: boolean; url: string; ips: string[] }>
  testar: () => Promise<{ ok: boolean; url: string; erro?: string }>
  apiKeyGet: () => Promise<{ ok: boolean; api_key: string }>
  apiKeyRegenerar: () => Promise<{ ok: boolean; api_key: string }>
}

export function getServidorApi(): ServidorApi {
  const win = window as unknown as { api: { servidor: ServidorApi } }
  return win.api.servidor
}

export interface UpdateApi {
  verificar: () => Promise<{
    ativo: boolean
    atual: string
    nova?: string
    disponivel: boolean
    obrigatoria: boolean
    notas: string[]
    erro?: string
  }>
  instalar: () => Promise<{ ok: boolean; erro?: string }>
  getConfig: () => Promise<string>
  setConfig: (url: string) => Promise<unknown>
}

export function getUpdateApi(): UpdateApi {
  const win = window as unknown as { api: { update: UpdateApi } }
  return win.api.update
}

export function getVersao(): Promise<string> {
  const win = window as unknown as { api: { versao: () => Promise<string> } }
  return win.api.versao()
}

export interface MovimentarItem {
  produto_id: number
  quantidade: number
  preco_custo?: number | null
  lote?: string | null
  data_validade?: string | null
  data_fabricacao?: string | null
}

export interface EstoqueApi {
  movimentar: (dados: {
    tipo: 'entrada' | 'saida'
    categoria: string
    itens: MovimentarItem[]
    fornecedor_id?: number | null
    cliente_id?: number | null
    origem?: string
    destino?: string
    documento?: string
    motivo?: string
    data?: string
    usuario_id?: number | null
  }) => Promise<{ ok: boolean; documento: string; total: number; itens: number; tipo: string; categoria: string; erro?: string }>
  inventarioAbrir: (dados: { produtos: number[]; usuario_id?: number | null; observacao?: string | null }) => Promise<{
    ok: boolean
    inventario_id: number
    numero: string
    itens: number
    erro?: string
  }>
  inventarioFinalizar: (dados: { inventario_id: number; usuario_id?: number | null }) => Promise<{
    ok: boolean
    inventario_id: number
    numero: string
    divergencias: number
    ajustados: number
    conferidos: number
    erro?: string
  }>
  inventarioCancelar: (dados: { inventario_id: number }) => Promise<{ ok: boolean; erro?: string }>
}

export function getEstoqueApi(): EstoqueApi {
  const win = window as unknown as { api: { estoque: EstoqueApi } }
  return win.api.estoque
}

export interface WhatsAppApi {
  get: (path: string) => Promise<Record<string, unknown>>
  post: (path: string, body: unknown) => Promise<Record<string, unknown>>
  status: () => Promise<{ ok: boolean; running: boolean; configured: boolean }>
}

export function getWhatsAppApi(): WhatsAppApi {
  const win = window as unknown as { api: { whatsapp: WhatsAppApi } }
  return win.api.whatsapp
}