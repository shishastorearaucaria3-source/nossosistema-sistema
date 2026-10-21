import { app, shell, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron'
import { join, dirname, basename, resolve } from 'node:path'
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { execSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { registerDbHandlers } from './ipc'
import { servidorClient, getServidorUrl, configurarServidor, lerPortaGravada, descobrirServidor } from './servidor'
import { gravarLogServidor } from './log'
import { versaoAtual, verificarAtualizacao, instalarAtualizacao, getUpdateBaseUrl, setUpdateBaseUrl, tipoInstalacaoAtual } from './update'
import { getUpdateMarkerPath, getLogFilePath } from '../shared/data-dir'
import { garantirTokenRelay, caminhoTokenRelay, lerTokenRelay } from '../shared/relay-token'

const PRODUTO = 'NossoSistema'
const APP_ID = 'br.com.lojatabacaria.sistema'

let mainWindow: BrowserWindow | null = null
let bandeja: Tray | null = null
let janelaServidor: BrowserWindow | null = null
let modoServidor = false
let encerrando = false
let supervisorRelay: SupervisorRelayInstancia | null = null

interface SupervisorRelayInstancia {
  iniciar: () => { ok: boolean; motivo?: string }
  parar: () => Promise<void>
}

// Captura qualquer erro de processo principal para o log e (em produção)
// mostra um aviso — senão o app "não abre" e ninguém sabe o motivo.
function registrarErroGlobal(): void {
  const erroFatal = (titulo: string, e: unknown): void => {
    const msg = e instanceof Error ? `${e.message}\n\n${e.stack ?? ''}` : String(e)
    gravarLogServidor(`${titulo}: ${msg}`)
    try {
      dialog.showMessageBoxSync(mainWindow ?? undefined!, {
        type: 'error',
        title: `${PRODUTO} — erro ao iniciar`,
        message: `${titulo}:\n\n${msg}\n\nRegistro: ${getLogFilePath()}`
      })
    } catch { /* ignore */ }
  }
  process.on('uncaughtException', (e) => erroFatal('Erro inesperado', e))
  process.on('unhandledRejection', (e) => erroFatal('Erro inesperado (promessa)', e))
}

// Fecha o ciclo observável da atualização (R3): o app relançado pelo launcher
// confere o marcador deixado pelo updater e registra SUCESSO/FALHA com as
// versões envolvidas. Roda antes de qualquer outra inicialização.
function validarAtualizacaoPendente(): void {
  try {
    const f = getUpdateMarkerPath()
    if (!existsSync(f)) return
    const m = JSON.parse(readFileSync(f, 'utf8')) as { versaoEsperada?: string; etapas?: string[]; iniciadoEm?: string }
    const atual = app.getVersion()
    const sucesso = !!m.versaoEsperada && atual === m.versaoEsperada
    gravarLogServidor(
      `[update] pós-atualização: instalada=${atual} esperada=${m.versaoEsperada ?? '?'} => ${sucesso ? 'SUCESSO' : 'FALHA'} (início: ${m.iniciadoEm ?? '?'})`
    )
    try { rmSync(f) } catch { /* ignore */ }
    try { writeFileSync(f + '.ultimo', JSON.stringify({ ...m, status: sucesso ? 'concluida' : 'falhou', versaoFinal: atual }, null, 2), 'utf8') } catch { /* ignore */ }
  } catch { /* ignore */ }
}

// Remove atalhos, autostart, firewall, registro e a pasta de instalação (via
// cmd destacado, pois não dá para apagar o próprio exe em execução). Os dados
// do sistema (sistema-loja-tabacaria: banco, backups, configurações e token
// do catálogo) são SEMPRE preservados quando o usuário escolhe "Manter dados" —
// nunca são apagados silenciosamente.
function desinstalar(): void {
  try {
    // Mata TODOS os processos desta instalação (Por caminho, nunca outras
    // instalações): o NossoSistema.exe e a cópia NossoSistema-Servidor.exe.
    // O réle do catálogo encerra sozinho ao perceber a queda do supervisor
    // (canal IPC 'disconnect') — sem órfãos, sem matar PID de terceiros.
    const dirUninstall = dirname(resolve(process.execPath)).replace(/'/g, "''")
    const ps = `$dir='${dirUninstall}';Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dir, [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force`
    spawn('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true })
  } catch { /* ignore */ }
  try {
    try {
      execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${PRODUTO} Servidor" /f`, { windowsHide: true })
    } catch { /* ignore */ }
    // Remove SOMENTE a regra de firewall criada pelo NossoSistema. Nunca
    // regras/serviços de outros programas (nem Cloudflare/WARP/túneis).
    try {
      execSync(`netsh advfirewall firewall delete rule name="${PRODUTO} Servidor"`, { windowsHide: true })
    } catch { /* ignore */ }
    const menu = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUTO)
    if (existsSync(menu)) rmSync(menu, { recursive: true, force: true })
    const desktop = join(process.env.USERPROFILE || '.', 'Desktop')
    for (const nome of [`${PRODUTO}.lnk`, `${PRODUTO}-Servidor.lnk`, 'Servidor.lnk', 'Iniciar Servidor.lnk', 'Parar Servidor.lnk']) {
      const p = join(desktop, nome)
      if (existsSync(p)) rmSync(p, { force: true })
    }
  } catch { /* ignore */ }
  try {
    execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" /f`, { windowsHide: true })
  } catch { /* ignore */ }
  try {
    const dir = dirname(resolve(process.execPath))
    if (dir && existsSync(dir)) {
      const dadosDir = join(dir, 'sistema-loja-tabacaria')
      const temDados = existsSync(dadosDir)
      let apagarDados = !temDados
      if (temDados) {
        // Pergunta SEMPRE quando existe pasta de dados. Por segurança, qualquer
        // erro no diálogo mantém os dados (nunca apagar silenciosamente).
        try {
          const r = dialog.showMessageBoxSync({
            type: 'question',
            buttons: ['Manter dados', 'Apagar dados'],
            defaultId: 0,
            cancelId: 0,
            title: `${PRODUTO} — desinstalação`,
            message: 'Deseja manter os dados do sistema?',
            detail: `Banco (tabacaria.sqlite), backups, configurações e token do catálogo:\n${dadosDir}`
          })
          apagarDados = r === 1
        } catch { /* mantém dados */ }
      }
      // Apaga a pasta via cmd destacado (o exe em execução trava os arquivos).
      // "Manter dados": remove a aplicação mas preserva sistema-loja-tabacaria\
      // (banco, backups\ e catalogo-relay.token). "Apagar dados": remove tudo.
      const bat = join(tmpdir(), `desinstalar-${Date.now()}.bat`)
      const linhas = [
        '@echo off',
        // Aguarda o app encerrar (timeout não funciona com stdin fechado).
        `>nul ping -n 3 127.0.0.1`,
        `set "DIR=${dir}"`,
        `if /I "${apagarDados}"=="true" goto :apagar_tudo`,
        `for /d %%D in ("%DIR%\\*") do if /I not "%%~nxD"=="sistema-loja-tabacaria" rmdir /s /q "%%~D" >nul 2>&1`,
        `for %%F in ("%DIR%\\*") do del /q /f "%%~F" >nul 2>&1`,
        `goto :fim`,
        `:apagar_tudo`,
        `rmdir /s /q "%DIR%" >nul 2>&1`,
        `:fim`,
        `del "%~f0"`
      ].join('\r\n')
      writeFileSync(bat, linhas, 'utf8')
      spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      setTimeout(() => app.exit(0), 1500)
      return
    }
  } catch { /* ignore */ }
  app.exit(0)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  app.setAppUserModelId(APP_ID)

  let timerMostrar: NodeJS.Timeout | null = null
  const mostrar = (): void => {
    if (timerMostrar) clearTimeout(timerMostrar)
    timerMostrar = null
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.maximize()
    }
  }

  mainWindow.on('ready-to-show', mostrar)
  // Garante que a janela apareça mesmo se ready-to-show demorar/não disparar
  // (GPU/renderer lento em alguns PCs), senão o app parece "não abrir".
  timerMostrar = setTimeout(mostrar, 4000)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function servidorRespondendo(): Promise<boolean> {
  return new Promise((resolve) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    fetch(`${getServidorUrl()}/api/config`, { signal: ctrl.signal })
      .then(() => resolve(true))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer))
  })
}

// No modo servidor a saúde deve ser checada na porta local, NUNCA no
// servidor.url (que pode ter ficado com um endereço remoto de uma
// configuração cliente anterior — senão o servidor inicia mas a checagem
// mira outro IP e o app fecha achando que não subiu).
function servidorLocalRespondendo(porta: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    fetch(`http://localhost:${porta}/api/config`, { signal: ctrl.signal })
      .then(() => resolve(true))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer))
  })
}

async function caminhoServidor(): Promise<string | null> {
  const candidatos: string[] = []
  if (app.isPackaged) {
    // Empacotado: server roda in-process. Require de DENTRO do asar (Electron
    // resolve node_modules do asar; sharp nativo sai via app.asar.unpacked).
    candidatos.push(join(process.resourcesPath, 'app.asar', 'out', 'server', 'server', 'index.js'))
    candidatos.push(join(process.resourcesPath, 'app.asar.unpacked', 'out', 'server', 'server', 'index.js'))
  }
  candidatos.push(
    // Desenvolvimento: compilado pelo tsc ao lado do node_modules do projeto
    join(__dirname, '..', '..', 'server', 'server', 'index.js'),
    join(process.cwd(), 'out', 'server', 'server', 'index.js')
  )
  for (const c of candidatos) {
    if (existsSync(c)) return c
  }
  return null
}

async function iniciarServidorSeNecessario(): Promise<boolean> {
  gravarLogServidor('verificando servidor...')
  const porta = lerPortaGravada() || 3210
  if (await servidorLocalRespondendo(porta)) {
    gravarLogServidor('já respondendo')
    return true
  }
  const caminho = await caminhoServidor()
  if (!caminho) {
    console.error('[sistema] Servidor não compilado. Rode: npm run build:servidor')
    gravarLogServidor('servidor não compilado/encontrado')
    return false
  }
  gravarLogServidor(`caminho: ${caminho}`)
  try {
    // O servidor só se auto-inicia quando é o entry point (require.main).
    // Aqui (in-process) chamamos a inicialização explicitamente.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const servidorMod = require(caminho) as {
      initDb: () => unknown
      getDb: () => unknown
      seed: (db: unknown) => void
      iniciarServidor: (porta?: number) => void
    }
    servidorMod.initDb()
    servidorMod.seed(servidorMod.getDb())
    servidorMod.iniciarServidor(porta)
    gravarLogServidor('servidor inicializado')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[sistema] Falha ao iniciar servidor in-process:', msg)
    gravarLogServidor(`ERRO iniciar servidor: ${msg}`)
    return false
  }
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await servidorLocalRespondendo(porta)) {
      gravarLogServidor('servidor respondendo')
      return true
    }
  }
gravarLogServidor('tempo esgotado aguardando servidor')
  return false
}

// ---------- Supervisor do Réle (Fase 9C-1) ----------
// Mantém o réle do catálogo (:3211) vivo dentro da instalação SERVIDOR.
// O réle é um processo à parte (spawnado com ELECTRON_RUN_AS_NODE=1); aqui só
// carregamos o módulo compilado e ligamos/desligamos o supervisor. Em
// instalações cliente o supervisor NUNCA inicia (o réle também não, via
// fail-closed no próprio relay.js).

function caminhoSupervisorRelay(): string | null {
  const candidatos: string[] = []
  if (app.isPackaged) {
    candidatos.push(join(process.resourcesPath, 'app.asar', 'out', 'server', 'server', 'relay-supervisao.js'))
    candidatos.push(join(process.resourcesPath, 'app.asar.unpacked', 'out', 'server', 'server', 'relay-supervisao.js'))
  }
  candidatos.push(
    // Desenvolvimento: compilado pelo tsc ao lado do node_modules do projeto.
    join(__dirname, '..', '..', 'server', 'server', 'relay-supervisao.js'),
    join(process.cwd(), 'out', 'server', 'server', 'relay-supervisao.js')
  )
  for (const c of candidatos) {
    if (existsSync(c)) return c
  }
  return null
}

function iniciarSupervisorRelay(): void {
  try {
    if (tipoInstalacaoAtual() === 'cliente') {
      gravarLogServidor('[relay] instalação cliente — supervisor não iniciado (exclusivo de servidor)')
      return
    }
    const token = garantirTokenRelay()
    gravarLogServidor(`[relay] token do catálogo ${lerTokenRelay() ? 'presente' : 'criado'} em ${caminhoTokenRelay()}`)
    if (!token) {
      gravarLogServidor('[relay] sem token disponível — réle não inicia (fail-closed)')
      return
    }
    const caminho = caminhoSupervisorRelay()
    if (!caminho) {
      gravarLogServidor('[relay] relay-supervisao.js não encontrado — supervisor pulado')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(caminho) as {
      SupervisorRelay: new (opcoes: { log?: (linha: string) => void }) => SupervisorRelayInstancia
    }
    const sup = new mod.SupervisorRelay({ log: (linha: string) => gravarLogServidor(`[relay] ${linha}`) })
    const r = sup.iniciar()
    if (!r.ok) {
      gravarLogServidor(`[relay] supervisor não iniciou: ${r.motivo ?? 'desconhecido'}`)
      return
    }
    supervisorRelay = sup
    gravarLogServidor('[relay] supervisor iniciado (réle :3211 monitorado)')
  } catch (e) {
    gravarLogServidor(`[relay] ERRO supervisor: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function pararSupervisorRelay(): void {
  const sup = supervisorRelay
  supervisorRelay = null
  if (sup) {
    sup.parar().catch(() => {})
  }
}

// Inicia o servidor como PROCESSO SEPARADO (--servidor, com bandeja própria).
// Assim fechar o servidor derruba a conexão e o sistema volta ao login.
// Em desenvolvimento mantém o servidor in-process (electron-vite dev).
async function iniciarServidorExterno(): Promise<boolean> {
  if (!app.isPackaged) {
    gravarLogServidor('dev: servidor in-process')
    return iniciarServidorSeNecessario()
  }
  try {
    const cwd = dirname(resolve(process.execPath))
    // Prefere NossoSistema-Servidor.exe se existir (auto-detecta --servidor
    // pelo nome do exe). Fallback: o próprio app com --servidor (dev/antigo).
    const srvExe = join(cwd, 'NossoSistema-Servidor.exe')
    const serverExec = existsSync(srvExe) ? srvExe : process.execPath
    const serverArgs = existsSync(srvExe) ? [] : ['--servidor']
    const child = spawn(serverExec, serverArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd
    })
    child.unref()
    gravarLogServidor(`servidor externo lançado (pid ${child.pid ?? '?'})`)
  } catch (e) {
    gravarLogServidor(`ERRO spawn servidor: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await servidorLocalRespondendo(lerPortaGravada() || 3210)) {
      gravarLogServidor('servidor externo respondendo')
      return true
    }
  }
  gravarLogServidor('tempo esgotado aguardando servidor externo')
  return false
}

function urlRemota(url: string): boolean {
  return /^https?:\/\/(?!localhost\b|127\.0\.0\.1\b)\S+/.test(url)
}

async function verificarServidor(): Promise<void> {
  const url = getServidorUrl()
  if (await servidorRespondendo()) {
    console.log(`[sistema] Conectado ao servidor em ${url}`)
    return
  }
  if (urlRemota(url) || tipoInstalacaoAtual() === 'cliente') {
    // Instalação cliente: NUNCA sobe servidor local (senão abre um banco
    // vazio deste PC e confunde). O sistema descobre o servidor na LAN
    // automaticamente; se nenhum responde, a tela de login oferece a conexão.
    if (!urlRemota(url)) {
      // Sem URL configurada: tenta descobrir o servidor na LAN.
      const d = await descobrirServidor()
      if (d.servidores.length > 0) {
        configurarServidor(d.servidores[0])
        console.log(`[sistema] Servidor descoberto automaticamente: ${d.servidores[0]}`)
        gravarLogServidor(`servidor descoberto: ${d.servidores[0]}`)
        return
      }
      console.error('[sistema] Instalação cliente sem endereço de servidor configurado')
      gravarLogServidor('cliente sem endereço de servidor configurado')
      dialog.showMessageBoxSync(mainWindow ?? undefined!, {
        type: 'info',
        title: 'Conectar ao servidor',
        message: `Este computador foi instalado como CLIENTE (balcão).\n\nO sistema procurou o servidor na rede e não o encontrou.\nNa tela de login, escolha "Outro (rede)" e digite o IP do servidor (ex.: 192.168.0.117).`
      })
      return
    }
    // URL remota configurada mas sem resposta: tenta descobrir na LAN antes de falhar.
    const d = await descobrirServidor()
    if (d.servidores.length > 0) {
      configurarServidor(d.servidores[0])
      console.log(`[sistema] Servidor descoberto automaticamente: ${d.servidores[0]} (anterior: ${url})`)
      gravarLogServidor(`servidor descoberto: ${d.servidores[0]} (anterior: ${url})`)
      return
    }
    console.error(`[sistema] Servidor remoto indisponível em ${url}`)
    gravarLogServidor(`servidor remoto indisponível: ${url}`)
    dialog.showMessageBoxSync(mainWindow ?? undefined!, {
      type: 'error',
      title: 'Servidor não encontrado',
      message: `Não foi possível conectar ao servidor em:\n\n${url}\n\nVerifique se:\n• o computador servidor está ligado e com o "Servidor" aberto (ícone na bandeja);\n• o endereço está correto.\n\nNa tela de login, escolha "Outro (rede)" para ajustar a conexão.`
    })
    return
  }
  const ok = await iniciarServidorExterno()
  if (!ok) {
    console.error(`[sistema] Não foi possível conectar ao servidor em ${url}`)
    dialog.showMessageBoxSync(mainWindow ?? undefined!, {
      type: 'error',
      title: 'Servidor indisponível',
      message: `Não foi possível iniciar/conectar ao servidor (${url}).` + '\n\nVerifique se a porta 3210 está livre e tente novamente.'
    })
  } else {
    console.log(`[sistema] Conectado ao servidor em ${url}`)
  }
}

function caminhoIconeServidor(): string {
  const candidatos = [
    join(process.resourcesPath, 'servidor.ico'),
    join(__dirname, '..', '..', '..', 'build', 'icones', 'servidor.png'),
    join(process.cwd(), 'build', 'icones', 'servidor.png')
  ]
  for (const c of candidatos) {
    if (existsSync(c)) return c
  }
  return ''
}

function caminhoPainelServidor(): { html: string; preload: string } {
  if (app.isPackaged) {
    return {
      html: join(process.resourcesPath, 'servidor-panel', 'index.html'),
      preload: join(process.resourcesPath, 'servidor-panel', 'preload.js')
    }
  }
  return {
    html: join(process.cwd(), 'src', 'panel-servidor', 'index.html'),
    preload: join(process.cwd(), 'src', 'panel-servidor', 'preload.js')
  }
}

function encerrarApp(): void {
  // Libera o preventDefault do close da janela do servidor — senão app.quit()
  // é abortado (a janela "recusa" fechar) e o processo fica preso no tray,
  // obrigando o usuário a matar no Gerenciador de Tarefas.
  encerrando = true
  app.quit()
}

function criarJanelaServidor(): void {
  if (janelaServidor && !janelaServidor.isDestroyed()) {
    janelaServidor.show()
    janelaServidor.focus()
    return
  }
  const painel = caminhoPainelServidor()
  janelaServidor = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 720,
    minHeight: 560,
    title: 'Servidor do Sistema',
    autoHideMenuBar: true,
    show: false,
    icon: criarIconeServidor(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: painel.preload
    }
  })
  app.setAppUserModelId(`${APP_ID}.servidor`)
  janelaServidor.on('ready-to-show', () => {
    janelaServidor?.show()
    janelaServidor?.focus()
  })
  janelaServidor.on('close', (e) => {
    if (modoServidor && !encerrando) {
      e.preventDefault()
      janelaServidor?.hide()
    }
  })
  janelaServidor.on('closed', () => {
    janelaServidor = null
  })
  janelaServidor.loadFile(painel.html, { query: { porta: String(lerPortaGravada() || 3210) } })
}

function criarIconeServidor(): Electron.NativeImage {
  const caminho = caminhoIconeServidor()
  if (caminho) {
    const img = nativeImage.createFromPath(caminho)
    if (!img.isEmpty()) return img
  }
  const svg = Buffer.from(
    `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="7" fill="#1d4ed8"/><rect x="6" y="6" width="20" height="8" rx="2" fill="#0f172a"/><rect x="6" y="18" width="20" height="8" rx="2" fill="#0f172a"/><circle cx="9" cy="10" r="1.6" fill="#22c55e"/><circle cx="13" cy="10" r="1.6" fill="#f59e0b"/><circle cx="9" cy="22" r="1.6" fill="#22c55e"/><circle cx="13" cy="22" r="1.6" fill="#f59e0b"/></svg>`
  )
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${svg.toString('base64')}`)
}

function registrarIpc(): void {
  registerDbHandlers()
  ipcMain.handle('backup:manual', async () => {
    const res = await servidorClient.backup()
    return { ok: res.ok, arquivo: res.ok ? `Backup salvo no servidor: ${res.arquivo}` : `Falha no backup: ${res.arquivo}` }
  })
  ipcMain.handle('servidor:info', () => ({ url: getServidorUrl() }))
  ipcMain.handle('app:versao', () => versaoAtual())
  ipcMain.handle('update:verificar', () => verificarAtualizacao())
  ipcMain.handle('update:instalar', () => instalarAtualizacao())
  ipcMain.handle('update:getConfig', () => getUpdateBaseUrl())
  ipcMain.handle('update:setConfig', (_e, url: string) => setUpdateBaseUrl(String(url ?? '')))
  ipcMain.handle('janela:fullscreen', (_e, ativo: boolean) => {
    if (mainWindow) mainWindow.setFullScreen(!!ativo)
  })
  ipcMain.on('janela:minimizar', () => {
    if (modoServidor) {
      janelaServidor?.hide()
    } else {
      janelaServidor?.minimize()
    }
  })
  ipcMain.on('janela:fechar', () => {
    if (modoServidor) {
      janelaServidor?.hide()
    } else {
      janelaServidor?.close()
    }
  })
  ipcMain.on('janela:encerrar', () => {
    encerrarApp()
  })
}

function criarBandejaServidor(): void {
  bandeja = new Tray(criarIconeServidor())
  bandeja.setToolTip('Servidor NossoSistema — Online')
  bandeja.on('double-click', () => {
    if (janelaServidor && !janelaServidor.isDestroyed()) {
      if (janelaServidor.isVisible()) {
        janelaServidor.hide()
      } else {
        janelaServidor.show()
        janelaServidor.focus()
      }
    } else {
      criarJanelaServidor()
    }
  })
  bandeja.on('click', () => {
    if (janelaServidor && !janelaServidor.isDestroyed()) {
      if (janelaServidor.isVisible()) {
        janelaServidor.hide()
      } else {
        janelaServidor.show()
        janelaServidor.focus()
      }
    } else {
      criarJanelaServidor()
    }
  })
  const menu = Menu.buildFromTemplate([
    { label: 'Servidor online', enabled: false },
    { type: 'separator' },
    { label: 'Abrir servidor', click: () => { criarJanelaServidor() } },
    { label: 'Encerrar servidor', click: () => encerrarApp() }
  ])
  bandeja.setContextMenu(menu)
}

// Auto-detect do executável do servidor: se o nome do binário for
// "NossoSistema-Servidor" (ou o antigo "Servidor"), habilita o modo servidor
// (--servidor) sem exigir flag na linha de comando.
const exeName = basename(process.execPath, '.exe')
if ((exeName === 'NossoSistema-Servidor' || exeName === 'Servidor') && !process.argv.includes('--servidor')) {
  process.argv.push('--servidor')
}

// Single-instance lock: only for the GUI (non-servidor) mode.
// The --servidor child is a separate Electron instance and must NOT
// compete for the same lock — otherwise the parent holds it and the
// child quits immediately.
if (!process.argv.includes('--servidor')) {
  const singleLock = app.requestSingleInstanceLock()
  if (!singleLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isVisible()) {
          mainWindow.focus()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    })
  }
}

app.whenReady().then(async () => {
  registrarErroGlobal()
  validarAtualizacaoPendente()
  if (process.argv.includes('--desinstalar')) {
    desinstalar()
    return
  }
  if (process.argv.includes('--servidor')) {
    // Modo servidor com bandeja: sobe a API e fica em segundo plano.
    // Fechar = menu da bandeja "Encerrar servidor".
    try {
      modoServidor = true
      registrarIpc()
      gravarLogServidor('registrarIpc ok')
      const ok = await iniciarServidorSeNecessario()
      if (!ok) {
        gravarLogServidor('servidor não subiu — saindo')
        app.exit(1)
        return
      }
      criarBandejaServidor()
      gravarLogServidor('bandeja criada')
      criarJanelaServidor()
      gravarLogServidor('painel aberto')
      iniciarSupervisorRelay()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    } catch (e) {
      gravarLogServidor(`ERRO modo servidor: ${e instanceof Error ? e.message : String(e)}`)
    }
    return
  }
  if (process.env.TABACARIA_SERVIDOR) configurarServidor(process.env.TABACARIA_SERVIDOR)
  gravarLogServidor(`app iniciando (packaged=${app.isPackaged}, tipo=${tipoInstalacaoAtual()}, url=${getServidorUrl()})`)
  registrarIpc()
  gravarLogServidor('ipc ok')
  try {
    await verificarServidor()
    gravarLogServidor('servidor verificado — criando janela')
    createWindow()
    gravarLogServidor('janela criada')
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
    console.error('[sistema] falha ao iniciar:', msg)
    gravarLogServidor(`ERRO ao iniciar: ${msg}`)
    dialog.showMessageBoxSync(mainWindow ?? undefined!, {
      type: 'error',
      title: `${PRODUTO} — erro ao iniciar`,
      message: `Falha ao iniciar o sistema:\n\n${msg}\n\nRegistro: ${getLogFilePath()}`
    })
  }

  if (process.env.TABACARIA_TEST_UPDATE) {
    setTimeout(async () => {
      try {
        const v = await verificarAtualizacao()
        console.log('[teste:update] verificar=', JSON.stringify({ ativo: v.ativo, atual: v.atual, nova: v.nova, disponivel: v.disponivel }))
        if (!v.disponivel) {
          console.log('[teste:update] SEM NOVA VERSAO (esperado para electron em dev)')
          app.exit(0)
          return
        }
        const r = await instalarAtualizacao()
        console.log('[teste:update] instalar=', JSON.stringify(r))
        if (r.ok) {
          console.log('[teste:update] OK: baixou, validou e disparou instalador')
          app.exit(0)
        } else {
          console.log('[teste:update] FALHA:', r.erro)
          app.exit(1)
        }
      } catch (e) {
        console.error('[teste:update] ERRO:', e)
        app.exit(1)
      }
    }, 3000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // No modo servidor (bandeja) fechar a janela mantém o servidor rodando.
  if (!modoServidor && process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  // O servidor roda em processo próprio (--servidor); no modo cliente ele
  // é encerrado separadamente pela bandeja.
  // Encerra o réle de forma graciosa (IPC); se o processo morrer sem passar
  // aqui, o próprio réle detecta o 'disconnect' e sai sozinho (sem órfãos).
  pararSupervisorRelay()
})
