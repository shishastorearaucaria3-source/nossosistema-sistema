import { contextBridge, ipcRenderer } from 'electron'

const api = {
  db: {
    all: (sql: string, params: unknown[] = []) => ipcRenderer.invoke('db:all', sql, params),
    get: (sql: string, params: unknown[] = []) => ipcRenderer.invoke('db:get', sql, params),
    run: (sql: string, params: unknown[] = []) => ipcRenderer.invoke('db:run', sql, params),
    exec: (sql: string) => ipcRenderer.invoke('db:exec', sql),
    transacao: (statements: { sql: string; params?: unknown[] }[]) => ipcRenderer.invoke('db:transacao', statements)
  },
  auth: {
    login: (login: string, senha: string) => ipcRenderer.invoke('auth:login', login, senha),
    logout: () => ipcRenderer.invoke('auth:logout'),
    session: () => ipcRenderer.invoke('auth:session'),
    usuarios: () => ipcRenderer.invoke('auth:usuarios'),
    criarUsuario: (dados: {
      nome: string
      login: string
      senha: string
      perfil: string
      comissao: number
    }) => ipcRenderer.invoke('auth:criarUsuario', dados),
    alterarSenha: (usuarioId: number, novaSenha: string) =>
      ipcRenderer.invoke('auth:alterarSenha', usuarioId, novaSenha),
    atualizarUsuario: (dados: {
      usuarioId: number
      nome: string
      login: string
      perfil: string
      comissao: number
      senha?: string
    }) => ipcRenderer.invoke('auth:atualizarUsuario', dados),
    atualizarOpcoes: (dados: {
      usuarioId: number
      usar_web: boolean
      usar_app: boolean
      limitar_desconto: boolean
      desconto_max_percent: number
    }) => ipcRenderer.invoke('auth:atualizarOpcoes', dados),
    atualizarPermissoes: (dados: { usuarioId: number; modulos: string[] }) =>
      ipcRenderer.invoke('auth:atualizarPermissoes', dados),
    ativarDesativar: (dados: { usuarioId: number; ativo: boolean }) =>
      ipcRenderer.invoke('auth:ativarDesativar', dados),
    deletar: (dados: { usuarioId: number }) => ipcRenderer.invoke('auth:deletar', dados)
  },
  backup: {
    manual: () => ipcRenderer.invoke('backup:manual')
  },
  versao: () => ipcRenderer.invoke('app:versao') as Promise<string>,
  update: {
    verificar: () => ipcRenderer.invoke('update:verificar'),
    instalar: () => ipcRenderer.invoke('update:instalar'),
    getConfig: () => ipcRenderer.invoke('update:getConfig'),
    setConfig: (url: string) => ipcRenderer.invoke('update:setConfig', url)
  },
  janela: {
    fullscreen: (ativo: boolean) => ipcRenderer.invoke('janela:fullscreen', ativo)
  },
  imagem: {
    definir: (produtoId: number) => ipcRenderer.invoke('imagem:definir', produtoId),
    get: (produtoId: number) => ipcRenderer.invoke('imagem:get', produtoId),
    list: () => ipcRenderer.invoke('imagem:list'),
    listPorIds: (ids: number[]) => ipcRenderer.invoke('imagem:listPorIds', ids),
    remover: (produtoId: number) => ipcRenderer.invoke('imagem:remover', produtoId)
  },
  importar: {
    lerArquivo: () => ipcRenderer.invoke('importar:lerArquivo')
  },
  zonas: {
    exportar: () => ipcRenderer.invoke('zonas:exportar'),
    importar: () => ipcRenderer.invoke('zonas:importar')
  },
  caixas: {
    exportar: () => ipcRenderer.invoke('caixas:exportar'),
    importar: () => ipcRenderer.invoke('caixas:importar')
  },
  catalogo: {
    getExibicao: () => ipcRenderer.invoke('catalogo:getExibicao'),
    salvarExibicao: (dados: Record<string, unknown>) => ipcRenderer.invoke('catalogo:salvarExibicao', dados)
  },
  vendas: {
    cancelar: (vendaId: number, usuarioId: number) => ipcRenderer.invoke('vendas:cancelar', vendaId, usuarioId),
    finalizar: (dados: Record<string, unknown>) => ipcRenderer.invoke('vendas:finalizar', dados)
  },
  pedidosApi: {
    cancelar: (pedidoId: number, usuarioId: number) => ipcRenderer.invoke('pedidos:cancelar', pedidoId, usuarioId)
  },
  servidor: {
    status: () => ipcRenderer.invoke('servidor:status'),
    logs: () => ipcRenderer.invoke('servidor:logs'),
    limparLogs: () => ipcRenderer.invoke('servidor:limparLogs'),
    backupInfo: () => ipcRenderer.invoke('servidor:backupInfo'),
    diagnostico: () => ipcRenderer.invoke('servidor:diagnostico'),
    corrigir: () => ipcRenderer.invoke('servidor:corrigir'),
    zerar: (alvos: string[]) => ipcRenderer.invoke('servidor:zerar', alvos),
    restaurar: () => ipcRenderer.invoke('servidor:restaurar'),
    conexao: () => ipcRenderer.invoke('servidor:conexao'),
    descobrir: () => ipcRenderer.invoke('servidor:descobrir'),
    configurarConexao: (opcoes: { local?: boolean; ip?: string; url?: string }) =>
      ipcRenderer.invoke('servidor:configurarConexao', opcoes),
    testar: () => ipcRenderer.invoke('servidor:testar'),
    apiKeyGet: () => ipcRenderer.invoke('servidor:apiKeyGet'),
    apiKeyRegenerar: () => ipcRenderer.invoke('servidor:apiKeyRegenerar')
  },
  estoque: {
    movimentar: (dados: Record<string, unknown>) => ipcRenderer.invoke('estoque:movimentar', dados),
    inventarioAbrir: (dados: { produtos: number[]; usuario_id?: number | null; observacao?: string | null }) =>
      ipcRenderer.invoke('estoque:inventarioAbrir', dados),
    inventarioFinalizar: (dados: { inventario_id: number; usuario_id?: number | null }) =>
      ipcRenderer.invoke('estoque:inventarioFinalizar', dados),
    inventarioCancelar: (dados: { inventario_id: number }) => ipcRenderer.invoke('estoque:inventarioCancelar', dados)
  },
  whatsapp: {
    get: (path: string) => ipcRenderer.invoke('whatsapp:get', path),
    post: (path: string, body: unknown) => ipcRenderer.invoke('whatsapp:post', path, body),
    status: () => ipcRenderer.invoke('whatsapp:status')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api