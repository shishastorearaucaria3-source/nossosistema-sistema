import { join } from 'node:path'

function env(name: string, def: string): string {
  const v = process.env[name]
  return v && v.length ? v : def
}

/** Banco SQLite de produção (somente leitura; nunca alterado). */
export function getProducaoDbPath(): string {
  return env('AUD_PROD_DB', 'C:/NossoSistema/sistema-loja-tabacaria/tabacaria.sqlite')
}

/** Pasta do backup NexusDB bruto (.nx1) — fonte de auditoria primária. */
export function getNxDir(): string {
  return env('AUD_NX_DIR', 'D:\\backup nex\\bakcuptotal 28082026\\Nex\\Dados')
}

/** Pasta com os arquivos .xls exportados do Nex. */
export function getXlsDir(): string {
  return env('AUD_XLS_DIR', 'D:\\backup nex\\backupnex json xml\\29-08-2026')
}

/** Pasta de homologação (snapshots + relatórios). Nunca toca produção. */
export function getHomologDir(): string {
  return env('AUD_HOMOLOG_DIR', join(process.cwd(), 'homologacao'))
}

export function getFiles(): string[] {
  return ['Tran.nx1', 'MovEst.nx1', 'PagEspecies.nx1', 'Cliente.nx1', 'Caixa.nx1', 'ITran.nx1', 'Especie.nx1', 'Recebiveis.nx1', 'catalogo_json.nx1']
}