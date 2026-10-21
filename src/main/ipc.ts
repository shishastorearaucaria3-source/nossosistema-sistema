import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import * as XLSX from 'xlsx'
import { servidorClient, obterIpsRede, configurarConexaoServidor, testarServidor, getServidorUrl, definirSessao, limparSessao, descobrirServidor } from './servidor'

export interface Sessao {
  id: number
  nome: string
  login: string
  perfil: string
  comissao_percent: number
}

let sessaoAtual: Sessao | null = null

export function getSessao(): Sessao | null {
  return sessaoAtual
}

export function registerDbHandlers(): void {
  ipcMain.handle('db:all', (_e, sql: string, params: unknown[]) => {
    return servidorClient.all(sql, params ?? [])
  })

  ipcMain.handle('db:get', (_e, sql: string, params: unknown[]) => {
    return servidorClient.get(sql, params ?? [])
  })

  ipcMain.handle('db:run', (_e, sql: string, params: unknown[]) => {
    return servidorClient.run(sql, params ?? [])
  })

  ipcMain.handle('db:exec', (_e, sql: string) => {
    return servidorClient.exec(sql)
  })

  ipcMain.handle('auth:login', async (_e, login: string, senha: string) => {
    const res = await servidorClient.authLogin(login, senha)
    if (res.ok && res.usuario) {
      sessaoAtual = res.usuario
      if (res.token) definirSessao(res.token)
    }
    return res
  })

  ipcMain.handle('auth:logout', async () => {
    sessaoAtual = null
    try { await servidorClient.authLogout() } catch { /* servidor indisponível */ }
    limparSessao()
  })

  ipcMain.handle('auth:session', () => {
    return sessaoAtual
  })

  ipcMain.handle('auth:sessao', async () => {
    // Valida o token de sessão diretamente no servidor. Lança (401/erro de rede)
    // se a sessão foi invalidada — usado pelo terminal para voltar ao login na
    // hora, inclusive após importações que apagam as sessões.
    return await servidorClient.authSessao()
  })

  ipcMain.handle('auth:verificarSenhaSupervisor', async (_e, senha: string) => {
    return await servidorClient.authVerificarSupervisor(senha)
  })

  ipcMain.handle('auth:usuarios', async () => {
    // Lista pública de usuários para a tela de login (id/nome/login/perfil).
    // Não requer sessão — acessível na LAN como o ping.
    try {
      return await servidorClient.authUsuarios()
    } catch {
      return []
    }
  })

  ipcMain.handle('auth:criarUsuario', (_e, dados: { nome: string; login: string; senha: string; perfil: string; comissao: number }) => {
    return servidorClient.authCriarUsuario(dados)
  })

  ipcMain.handle('auth:alterarSenha', (_e, usuarioId: number, novaSenha: string) => {
    return servidorClient.authAlterarSenha(usuarioId, novaSenha)
  })

  ipcMain.handle('auth:alterarMinhaSenha', (_e, senhaAtual: string, novaSenha: string) => {
    return servidorClient.authAlterarMinhaSenha(senhaAtual, novaSenha)
  })

  ipcMain.handle('auth:atualizarUsuario', (_e, dados: { usuarioId: number; nome: string; login: string; perfil: string; comissao: number; senha?: string }) => {
    return servidorClient.authAtualizarUsuario(dados)
  })

  ipcMain.handle('auth:atualizarOpcoes', (_e, dados: { usuarioId: number; usar_web: boolean; usar_app: boolean; limitar_desconto: boolean; desconto_max_percent: number }) => {
    return servidorClient.authAtualizarOpcoes(dados)
  })

  ipcMain.handle('auth:atualizarPermissoes', (_e, dados: { usuarioId: number; modulos: string[] }) => {
    return servidorClient.authAtualizarPermissoes(dados)
  })

  ipcMain.handle('auth:ativarDesativar', (_e, dados: { usuarioId: number; ativo: boolean }) => {
    return servidorClient.authAtivarDesativar(dados)
  })

  ipcMain.handle('auth:deletar', (_e, dados: { usuarioId: number }) => {
    return servidorClient.authDeletar(dados)
  })

  ipcMain.handle('imagem:definir', async (_e, produtoId: number) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Selecionar imagem do produto',
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const buf = await readFile(res.filePaths[0])
    await servidorClient.imagemDefinir(produtoId, buf.toString('base64'))
    return buf.toString('base64')
  })

  ipcMain.handle('imagem:get', (_e, produtoId: number) => {
    return servidorClient.imagemGet(produtoId)
  })

  ipcMain.handle('imagem:list', () => {
    return servidorClient.imagemList()
  })

  ipcMain.handle('imagem:listPorIds', (_e, ids: number[]) => {
    return servidorClient.imagemListPorIds(ids)
  })

  ipcMain.handle('imagem:remover', (_e, produtoId: number) => {
    return servidorClient.imagemRemover(produtoId)
  })

  ipcMain.handle('importar:lerArquivo', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Selecionar planilha de produtos',
      filters: [
        { name: 'Planilhas', extensions: ['xlsx', 'xls', 'csv'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const caminho = res.filePaths[0]
    const buffer = await readFile(caminho)
    const ext = extname(caminho).toLowerCase()
    let linhas: Record<string, unknown>[]
    try {
      if (ext === '.csv') {
        const texto = buffer.toString('utf-8')
        const wb = XLSX.read(texto, { type: 'string' })
        linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      } else {
        const wb = XLSX.read(buffer, { type: 'buffer' })
        linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      }
    } catch (err) {
      if (ext === '.xls') {
        const texto = buffer.toString('utf-8')
        const primeira = texto.trim().slice(0, 200)
        if (primeira.startsWith('<')) {
          try {
            const wb = XLSX.read(texto, { type: 'string' })
            linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
          } catch {
            return { arquivo: caminho, colunas: [], linhas: [], erro: 'O arquivo .xls parece estar em formato antigo. Salve como .xlsx ou .csv e tente de novo.' }
          }
        } else {
          return { arquivo: caminho, colunas: [], linhas: [], erro: 'O arquivo .xls é do formato legado (binário), não suportado. Abra no Excel e salve como .xlsx ou .csv.' }
        }
      } else {
        return { arquivo: caminho, colunas: [], linhas: [], erro: `Falha ao ler o arquivo: ${(err as Error).message}` }
      }
    }
    const colunas = linhas.length ? Object.keys(linhas[0]) : []
    return { arquivo: caminho, colunas, linhas }
  })

  ipcMain.handle('zonas:exportar', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Exportar zonas de entrega',
      defaultPath: `zonas_entrega_${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, erro: 'Cancelado' }
    const zonas = await servidorClient.all(`SELECT id, nome, preco, poligono, ativo, ceps FROM zonas_entrega ORDER BY id`)
    await writeFile(res.filePath, JSON.stringify(zonas, null, 2), 'utf-8')
    return { ok: true, arquivo: res.filePath }
  })

  ipcMain.handle('zonas:importar', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Importar zonas de entrega',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, erro: 'Cancelado' }
    const caminho = res.filePaths[0]
    const texto = await readFile(caminho, 'utf-8')
    const dados = JSON.parse(texto) as { nome: string; preco: number; poligono: string; ativo?: number; ceps?: string | string[] }[]
    if (!Array.isArray(dados) || dados.length === 0) {
      return { ok: false, erro: 'Arquivo sem zonas' }
    }
    let importadas = 0
    for (const z of dados) {
      if (!z.nome || !z.poligono) continue
      const cepsValor = Array.isArray(z.ceps)
        ? JSON.stringify(z.ceps)
        : typeof z.ceps === 'string' && z.ceps
          ? z.ceps
          : '[]'
      await servidorClient.run(
        `INSERT INTO zonas_entrega (nome, preco, poligono, ativo, ceps) VALUES (?, ?, ?, ?, ?)`,
        [z.nome, Number(z.preco) || 0, z.poligono, z.ativo === 0 ? 0 : 1, cepsValor]
      )
      importadas++
    }
    return { ok: true, qtd: importadas }
  })

  ipcMain.handle('caixas:exportar', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Exportar caixas',
      defaultPath: `caixas_${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, erro: 'Cancelado' }
    const caixas = (await servidorClient.all(`SELECT * FROM caixas ORDER BY id`)) as { id: number }[]
    const ids = caixas.map((c) => c.id)
    const movs = ids.length
      ? await servidorClient.all(`SELECT * FROM movimentos_caixa WHERE caixa_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids)
      : []
    const vendas = ids.length
      ? await servidorClient.all(`SELECT * FROM vendas WHERE caixa_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids)
      : []
    await writeFile(res.filePath, JSON.stringify({ caixas, movimentos_caixa: movs, vendas }, null, 2), 'utf-8')
    return { ok: true, arquivo: res.filePath, qtd: caixas.length }
  })

  ipcMain.handle('caixas:importar', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Importar caixas',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, erro: 'Cancelado' }
    const texto = await readFile(res.filePaths[0], 'utf-8')
    const dados = JSON.parse(texto) as {
      caixas: Record<string, unknown>[]
      movimentos_caixa?: Record<string, unknown>[]
      vendas?: Record<string, unknown>[]
    }
    if (!Array.isArray(dados.caixas) || dados.caixas.length === 0) {
      return { ok: false, erro: 'Arquivo sem caixas' }
    }
    try {
      let importados = 0
      for (const c of dados.caixas) {
        const c2 = c as { id: number; usuario_id: number | null; saldo_inicial: number; total_vendas: number; total_sangrias: number; total_suprimentos: number; descontos: number; cancelamentos: number; qtd_vendas: number; aberto_em: string; fechado_em: string | null; aberto: number; usuario_fechamento: number | null }
        await servidorClient.run(
          `INSERT INTO caixas (id, usuario_id, aberto, saldo_inicial, total_vendas, total_sangrias, total_suprimentos, descontos, cancelamentos, qtd_vendas, aberto_em, fechado_em, usuario_fechamento)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             usuario_id=excluded.usuario_id, aberto=excluded.aberto, saldo_inicial=excluded.saldo_inicial,
             total_vendas=excluded.total_vendas, total_sangrias=excluded.total_sangrias,
             total_suprimentos=excluded.total_suprimentos, descontos=excluded.descontos,
             cancelamentos=excluded.cancelamentos, qtd_vendas=excluded.qtd_vendas,
             aberto_em=excluded.aberto_em, fechado_em=excluded.fechado_em, usuario_fechamento=excluded.usuario_fechamento`,
          [c2.id, c2.usuario_id, c2.aberto === 0 ? 0 : 1, c2.saldo_inicial || 0, c2.total_vendas || 0, c2.total_sangrias || 0, c2.total_suprimentos || 0, c2.descontos || 0, c2.cancelamentos || 0, c2.qtd_vendas || 0, c2.aberto_em, c2.fechado_em, c2.usuario_fechamento]
        )
        importados++
      }
      const delMov = async (caixaId: number) => servidorClient.run(`DELETE FROM movimentos_caixa WHERE caixa_id = ?`, [caixaId])
      for (const c of dados.caixas) {
        const cid = (c as { id: number }).id
        await delMov(cid)
        for (const m of dados.movimentos_caixa ?? []) {
          const m2 = m as { caixa_id: number; id: number; tipo: string; valor: number; motivo: string | null; usuario_id: number | null; criado_em: string }
          if (m2.caixa_id === cid) {
            await servidorClient.run(
              `INSERT INTO movimentos_caixa (id, caixa_id, tipo, valor, motivo, usuario_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo, valor=excluded.valor, motivo=excluded.motivo, usuario_id=excluded.usuario_id, criado_em=excluded.criado_em`,
              [m2.id, m2.caixa_id, m2.tipo, m2.valor || 0, m2.motivo, m2.usuario_id, m2.criado_em]
            )
          }
        }
      }
      if (Array.isArray(dados.vendas) && dados.vendas.length) {
        for (const v of dados.vendas) {
          const v2 = v as { id: number; caixa_id: number | null }
          if (v2.caixa_id != null) {
            await servidorClient.run(`UPDATE vendas SET caixa_id = ? WHERE id = ?`, [v2.caixa_id, v2.id])
          }
        }
      }
      return { ok: true, qtd: importados }
    } catch (err) {
      return { ok: false, erro: (err as Error).message }
    }
  })

  ipcMain.handle('catalogo:getExibicao', async () => {
    try {
      return await servidorClient.catalogoGetExibicao()
    } catch {
      return {}
    }
  })

  ipcMain.handle('catalogo:salvarExibicao', async (_e, dados: Record<string, unknown>) => {
    return servidorClient.catalogoSalvarExibicao(dados ?? {})
  })

  ipcMain.handle('servidor:status', async () => {
    try {
      return await servidorClient.servidorStatus()
    } catch {
      return { ok: false, online: false, api: 'desconectada', erro: 'Servidor indisponível.' }
    }
  })

  ipcMain.handle('servidor:logs', async () => {
    try {
      return await servidorClient.servidorLogs()
    } catch {
      return { ok: false, logs: [] }
    }
  })

  ipcMain.handle('servidor:limparLogs', async () => {
    return servidorClient.servidorLimparLogs()
  })

  ipcMain.handle('servidor:backupInfo', async () => {
    try {
      return await servidorClient.servidorBackupInfo()
    } catch {
      return { ok: false, dir: '', backups: [] }
    }
  })

  ipcMain.handle('servidor:diagnostico', async () => {
    return servidorClient.servidorDiagnostico()
  })

  ipcMain.handle('servidor:corrigir', async () => {
    return servidorClient.servidorCorrigir()
  })

  ipcMain.handle('servidor:zerar', async (_e, alvos: string[]) => {
    return servidorClient.servidorZerar(Array.isArray(alvos) ? alvos : [])
  })

  ipcMain.handle('servidor:restaurar', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Selecionar backup para restaurar',
      filters: [{ name: 'Backup do sistema', extensions: ['sqlite', 'db'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, erro: 'Cancelado' }
    return servidorClient.servidorRestaurar(res.filePaths[0])
  })

  ipcMain.handle('servidor:conexao', async () => {
    const url = getServidorUrl()
    return {
      ips: obterIpsRede(),
      url,
      local: url.startsWith('http://localhost')
    }
  })

  ipcMain.handle('servidor:configurarConexao', async (_e, opcoes: { local?: boolean; ip?: string; url?: string }) => {
    const r = configurarConexaoServidor(opcoes ?? {})
    return { ok: true, url: r.url, ips: r.ips }
  })

  ipcMain.handle('servidor:descobrir', async () => {
    return descobrirServidor()
  })

  ipcMain.handle('db:transacao', (_e, statements: { sql: string; params?: unknown[] }[]) => {
    return servidorClient.dbTransacao(statements ?? [])
  })

  ipcMain.handle('vendas:cancelar', (_e, vendaId: number, usuarioId: number) => {
    return servidorClient.vendasCancelar(vendaId, usuarioId)
  })

  ipcMain.handle('vendas:finalizar', (_e, dados: Record<string, unknown>) => {
    return servidorClient.vendasFinalizar(dados as Parameters<typeof servidorClient.vendasFinalizar>[0])
  })

  ipcMain.handle('pedidos:cancelar', (_e, pedidoId: number, usuarioId: number) => {
    return servidorClient.pedidosCancelar(pedidoId, usuarioId)
  })

  ipcMain.handle('pedidosOnline:puxar', () => {
    return servidorClient.pedidosOnlinePuxar()
  })

  ipcMain.handle('pedidosOnline:listar', (_e, filtro?: { busca?: string; status?: string; de?: string; ate?: string }) => {
    return servidorClient.pedidosOnlineListar(filtro)
  })

  ipcMain.handle('pedidosOnline:detalhe', (_e, id: string) => {
    return servidorClient.pedidosOnlineDetalhe(id)
  })

  ipcMain.handle('pedidosOnline:status', (_e, id: string, status: string) => {
    return servidorClient.pedidosOnlineStatus(id, status)
  })

  ipcMain.handle('catalogo:status', () => {
    return servidorClient.catalogoStatus()
  })

  ipcMain.handle('catalogo:repair', () => {
    return servidorClient.catalogoRepair()
  })

  ipcMain.handle('catalogo:syncStatus', () => {
    return servidorClient.catalogoSyncStatus()
  })

  ipcMain.handle('catalogo:autoSync', (_e, dados: { ativo?: boolean; intervalo_seg?: number }) => {
    return servidorClient.catalogoAutoSync(dados)
  })

  ipcMain.handle('servidor:apiKeyGet', async () => {
    return servidorClient.apiKeyGet()
  })

  ipcMain.handle('servidor:apiKeyRegenerar', async () => {
    return servidorClient.apiKeyRegenerar()
  })

  ipcMain.handle('servidor:testar', async () => {
    return testarServidor()
  })

  ipcMain.handle('estoque:movimentar', (_e, dados: Record<string, unknown>) => {
    return servidorClient.estoqueMovimentar(dados ?? {})
  })

  ipcMain.handle('estoque:inventarioAbrir', (_e, dados: { produtos: number[]; usuario_id?: number | null; observacao?: string | null }) => {
    return servidorClient.estoqueInventarioAbrir(dados ?? { produtos: [] })
  })

  ipcMain.handle('estoque:inventarioFinalizar', (_e, dados: { inventario_id: number; usuario_id?: number | null }) => {
    return servidorClient.estoqueInventarioFinalizar(dados ?? { inventario_id: 0 })
  })

  ipcMain.handle('estoque:inventarioCancelar', (_e, dados: { inventario_id: number }) => {
    return servidorClient.estoqueInventarioCancelar(dados ?? { inventario_id: 0 })
  })
  ipcMain.handle('estoque:compraCancelar', (_e, dados: { compra_id: number; usuario_id?: number | null }) => {
    return servidorClient.estoqueCompraCancelar(dados ?? { compra_id: 0 })
  })
  ipcMain.handle('nfe:lerXml', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Selecionar XML de Nota Fiscal',
      filters: [
        { name: 'Arquivos XML de NF-e', extensions: ['xml'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, erro: 'Nenhum arquivo selecionado.' }
    const caminho = res.filePaths[0]
    try {
      const texto = await readFile(caminho, 'utf-8')
      return { ok: true, arquivo: caminho, conteudo: texto }
    } catch (err) {
      return { ok: false, arquivo: caminho, erro: `Não foi possível ler o XML: ${(err as Error).message}` }
    }
  })

  ipcMain.handle('whatsapp:get', (_e, path: string) => {
    return servidorClient.whatsapp.get(path)
  })
  ipcMain.handle('whatsapp:post', (_e, path: string, body: unknown) => {
    return servidorClient.whatsapp.post(path, body)
  })
  ipcMain.handle('whatsapp:status', () => {
    return servidorClient.whatsappStatus()
  })
}