import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDataDir } from './data-dir'

const NOME_ARQUIVO = 'catalogo-relay.token'

export function caminhoTokenRelay(): string {
  return join(getDataDir(), NOME_ARQUIVO)
}

export function lerTokenRelay(): string {
  const doEnv = (process.env.CATALOGO_RELAY_TOKEN || '').trim()
  if (doEnv) return doEnv
  try {
    const f = process.env.CATALOGO_RELAY_TOKEN_FILE || caminhoTokenRelay()
    if (existsSync(f)) return readFileSync(f, 'utf8').trim()
  } catch { /* ignore */ }
  return ''
}

export function garantirTokenRelay(): string {
  const existente = lerTokenRelay()
  if (existente) return existente
  const token = randomBytes(32).toString('hex')
  try {
    const f = process.env.CATALOGO_RELAY_TOKEN_FILE || caminhoTokenRelay()
    mkdirSync(getDataDir(), { recursive: true })
    writeFileSync(f, token + '\n', 'utf8')
  } catch { /* ignore */ }
  return token
}