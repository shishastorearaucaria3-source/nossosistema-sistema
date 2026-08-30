// Supervisor do Réle local do catálogo (Fase 9C-1)
//
// Responsável por manter o réle (out/server/server/relay.js) vivo e monitorado
// dentro da instalação SERVIDOR, sem depender de Node.js instalado na máquina
// destino: o réle é spawnado com ELECTRON_RUN_AS_NODE=1 usando o próprio exe
// do produto (ou process.execPath em dev/testes).
//
// - CANAL IPC: o réle avisa "pronto" quando ligou a porta; recebe
//   { tipo: 'encerrar' } para saída limpa; e se desconecta (pai morreu) para
//   sair sozinho — sem processos órfãos e sem kill de PID arbitrário.
// - PIDFILE: <dataDir>/relay.pid apenas para impedir supervisor duplicado.
//   Contém somente { supervisorPid, relayPid, iniciadoEm } — NUNCA token.
// - NÃO interfere em :3210 (Express) — o réle é um processo separado.
//
// A escolha do banco continua sendo 100% do réle (getDefaultDbPath). Aqui o
// mesmo dir de dados é usado apenas para o pidfile; nenhum override é aplicado.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDataDir } from '../shared/data-dir'

export const ATRASOS_PADRAO_MS = [1000, 2000, 5000, 10000, 30000] as const
export const TEMPO_FORCAR_ENCERRAMENTO_MS = 3000

export interface OpcoesSupervisorRelay {
  /** Caminho do executável que roda o réle. Padrão: process.execPath (dev) ou o exe do produto. */
  executavelRelay?: string
  /** Caminho do relay.js. Padrão: localizado automaticamente. */
  scriptRelay?: string
  /** Diretório do pidfile. Padrão: getDataDir(). */
  dirDados?: string
  /** Porta do réle (repassada via CATALOGO_RELAY_PORT para o filho). Padrão 3211. */
  porta?: number
  /** Sequência de backoff (ms) por falha consecutiva. */
  atrasosMs?: readonly number[]
  /** Log de eventos do ciclo de vida (stdout/stderr do réle e do supervisor). */
  log?: (linha: string) => void
  /** Tempo máximo (ms) esperando o réle sair após pedir encerramento. */
  forcarEncerramentoMs?: number
}

export type EstadoSupervisor = 'iniciando' | 'rodando' | 'erro' | 'parado'

/** Próximo atraso de reinício conforme o nº de falhas consecutivas (0 = primeira tentativa). */
export function proximoAtrasoMs(indiceFalha: number, atrasos: readonly number[] = ATRASOS_PADRAO_MS): number {
  if (atrasos.length === 0) return 1000
  const i = Math.max(0, Math.min(indiceFalha, atrasos.length - 1))
  return atrasos[i]
}

function pidVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Caminhos candidatos para achar o relay.js compilado (modo dev/testes + empacotado). */
export function caminhoRelayPadrao(): string | null {
  const candidatos = [
    join(__dirname, 'relay.js'),
    join(process.cwd(), 'out', 'server', 'server', 'relay.js'),
    join((process as unknown as { resourcesPath?: string }).resourcesPath ?? '', 'app.asar', 'out', 'server', 'server', 'relay.js'),
    join((process as unknown as { resourcesPath?: string }).resourcesPath ?? '', 'app.asar.unpacked', 'out', 'server', 'server', 'relay.js'),
    join(process.cwd(), 'out', 'server', 'relay.js'),
  ]
  for (const c of candidatos) {
    if (c && existsSync(c)) return c
  }
  return null
}

export class SupervisorRelay {
  private child: ChildProcess | null = null
  private estado: EstadoSupervisor = 'parado'
  private falhasConsecutivas = 0
  private parando = false
  private timer: NodeJS.Timeout | null = null
  private pidfileAtual = ''

  readonly opcoes: OpcoesSupervisorRelay

  constructor(opcoes: OpcoesSupervisorRelay = {}) {
    this.opcoes = opcoes
  }

  getEstado(): EstadoSupervisor {
    return this.estado
  }

  getPidRelay(): number | null {
    return this.child?.pid ?? null
  }

  private registar(linha: string): void {
    try {
      this.opcoes.log?.(linha)
    } catch { /* log nunca derruba o supervisor */ }
  }

  private dirDados(): string {
    return this.opcoes.dirDados ?? getDataDir()
  }

  private caminhoPidfile(): string {
    if (!this.pidfileAtual) this.pidfileAtual = join(this.dirDados(), 'relay.pid')
    return this.pidfileAtual
  }

  iniciar(): { ok: boolean; motivo?: string } {
    if (this.child || this.estado !== 'parado') {
      return { ok: false, motivo: 'ja_em_execucao' }
    }

    const dirDados = this.dirDados()
    mkdirSync(dirDados, { recursive: true })

    // Guarda de supervisor duplicado via pidfile (só supervisor PID; nunca
    // PID arbitrário, nunca token). O pidfile herdado de um supervisor morto é
    // sobrescrito pela nova instância (a guarda real é single-instance da app).
    const pidfile = this.caminhoPidfile()
    if (existsSync(pidfile)) {
      try {
        const antigo = JSON.parse(readFileSync(pidfile, 'utf8')) as { supervisorPid?: unknown }
        if (typeof antigo.supervisorPid === 'number' && pidVivo(antigo.supervisorPid)) {
          return { ok: false, motivo: 'outro_supervisor_em_execucao' }
        }
      } catch {
        // pidfile corrompido — sobrescrever.
      }
    }

    const script = this.opcoes.scriptRelay ?? caminhoRelayPadrao()
    if (!script) return { ok: false, motivo: 'relay_nao_encontrado' }

    const exec = this.opcoes.executavelRelay ?? process.execPath
    this.parando = false
    this.estado = 'iniciando'
    this.spawnar(exec, script)
    return { ok: true }
  }

  private spawnar(exec: string, script: string): void {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      CATALOGO_RELAY_PORT: String(this.opcoes.porta ?? 3211),
    }

    const child = spawn(exec, [script], {
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    this.child = child

    child.stdout?.on('data', (d) => this.registar(`[relay:stdout] ${String(d).trimEnd()}`))
    child.stderr?.on('data', (d) => this.registar(`[relay:stderr] ${String(d).trimEnd()}`))
    child.on('message', (msg) => {
      if (msg && typeof msg === 'object' && (msg as { tipo?: string }).tipo === 'pronto') {
        this.estado = 'rodando'
        this.falhasConsecutivas = 0
        this.escreverPidfile(child)
        this.registar(`[relay] pronto (pid ${child.pid})`)
      }
    })
    child.on('error', (err) => {
      this.registar(`[relay] erro ao spawnar: ${err.message}`)
    })
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null
      const saiuLimpo = this.parando || code === 0
      if (saiuLimpo) {
        this.estado = 'parado'
        this.limparPidfile(child)
        return
      }
      this.falhasConsecutivas += 1
      this.estado = 'erro'
      this.registar(`[relay] saiu inesperadamente (code=${code} signal=${signal})`)
      if (this.parando) return
      const atraso = proximoAtrasoMs(Math.max(0, this.falhasConsecutivas - 1), this.opcoes.atrasosMs)
      this.registar(`[relay] reiniciando em ${atraso}ms`)
      this.timer = setTimeout(() => {
        if (this.parando) return
        if (this.child) return
        this.estado = 'iniciando'
        this.spawnar(exec, script)
      }, atraso)
    })
  }

  private escreverPidfile(child: ChildProcess): void {
    try {
      writeFileSync(
        this.caminhoPidfile(),
        JSON.stringify({ supervisorPid: process.pid, relayPid: child.pid, iniciadoEm: new Date().toISOString() }),
        'utf8',
      )
    } catch { /* pidfile é best-effort */ }
  }

  private limparPidfile(child: ChildProcess): void {
    if (this.pidfileAtual) {
      try {
        if (existsSync(this.pidfileAtual)) {
          const lido = JSON.parse(readFileSync(this.pidfileAtual, 'utf8')) as { relayPid?: unknown }
          if (typeof lido.relayPid === 'number' && lido.relayPid === child.pid) {
            unlinkSync(this.pidfileAtual)
          }
        }
      } catch { /* ignore */ }
    }
  }

  /**
   * Encerra o réle de forma graciosa (IPC) e, se ele não sair no prazo,
   * envia kill apenas para o processo filho supervisionado (nunca PID
   * arbitrário). Após o await o supervisor fica parado.
   */
  async parar(): Promise<void> {
    this.parando = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const child = this.child
    if (!child) {
      this.estado = 'parado'
      return
    }
    const saido = new Promise<boolean>((resolve) => {
      child.once('exit', () => resolve(true))
      setTimeout(() => resolve(false), this.opcoes.forcarEncerramentoMs ?? TEMPO_FORCAR_ENCERRAMENTO_MS)?.unref?.()
    })
    try {
      child.send?.({ tipo: 'encerrar' })
    } catch { /* canal caído — cai no kill do child após o prazo */ }
    const ok = await saido
    if (!ok && this.child === child) {
      try {
        this.registar(`[relay] não saiu após encerramento — kill do child ${child.pid} (processo controlado por este supervisor)`)
        child.kill()
      } catch { /* ignore */ }
    }
    this.child = null
    this.estado = 'parado'
  }
}