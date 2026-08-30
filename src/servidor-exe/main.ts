import { app, Tray, Menu, nativeImage, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getDb, getPorta, initDb, seed, iniciarServidor } from '../server/index'

let tray: Tray | null = null
let janela: BrowserWindow | null = null

function caminhoIcone(): string {
  const candidatos = [
    join(__dirname, '..', '..', '..', '..', 'build', 'icones', 'servidor.png'),
    join(process.resourcesPath, 'app.asar', 'build', 'icones', 'servidor.png'),
    join(process.resourcesPath, 'build', 'icones', 'servidor.png')
  ]
  for (const c of candidatos) {
    if (existsSync(c)) return c
  }
  return ''
}

function criarIcone(): Electron.NativeImage {
  const caminho = caminhoIcone()
  if (caminho) {
    const img = nativeImage.createFromPath(caminho)
    if (!img.isEmpty()) return img
  }
  const svg = Buffer.from(
    `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="7" fill="#1d4ed8"/><rect x="6" y="6" width="20" height="8" rx="2" fill="#0f172a"/><rect x="6" y="18" width="20" height="8" rx="2" fill="#0f172a"/><circle cx="9" cy="10" r="1.6" fill="#22c55e"/><circle cx="13" cy="10" r="1.6" fill="#f59e0b"/><circle cx="9" cy="22" r="1.6" fill="#22c55e"/><circle cx="13" cy="22" r="1.6" fill="#f59e0b"/></svg>`
  )
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${svg.toString('base64')}`)
}

function criarJanela(): void {
  janela = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 720,
    minHeight: 560,
    title: 'Servidor do Sistema',
    autoHideMenuBar: true,
    show: true,
    icon: criarIcone(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.js')
    }
  })

  const html = join(__dirname, 'index.html')
  if (existsSync(html)) {
    janela.loadFile(html, { query: { porta: String(getPorta() || 3210) } })
  }

  janela.on('closed', () => {
    janela = null
  })
}

function aguardarPorta(cb: () => void): void {
  const t0 = Date.now()
  const checar = (): void => {
    if (getPorta() > 0) {
      cb()
      return
    }
    if (Date.now() - t0 > 10000) {
      cb()
      return
    }
    setTimeout(checar, 100)
  }
  checar()
}

app.disableHardwareAcceleration()

ipcMain.on('janela:minimizar', () => {
  if (janela) janela.minimize()
})

ipcMain.on('janela:fechar', () => {
  if (janela) janela.close()
})

ipcMain.on('janela:encerrar', () => {
  app.quit()
})

app.whenReady().then(() => {
  try {
    initDb()
    seed(getDb())
    iniciarServidor(Number(process.env.TABACARIA_PORTA) || 3210)

    aguardarPorta(() => {
      criarJanela()

      tray = new Tray(criarIcone())
      tray.setToolTip('Servidor do Sistema — Online')
      const menu = Menu.buildFromTemplate([
        { label: 'Servidor Online', enabled: false },
        { type: 'separator' },
        { label: 'Abrir servidor', click: () => { if (!janela) criarJanela(); else janela.show() } },
        { label: 'Sair do servidor', click: () => app.quit() }
      ])
      tray.setContextMenu(menu)
      console.log(`[servidor-exe] Servidor iniciado com interface (porta ${getPorta()}).`)
    })
  } catch (err) {
    console.error('[servidor-exe] Falha ao iniciar:', (err as Error).message)
  }
})

app.on('window-all-closed', () => {
  // mantém rodando em segundo plano (bandeja)
})
