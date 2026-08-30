import { ReactNode } from 'react'
import EmptyState from './EmptyState'

export interface UiColuna<T> {
  chave: string
  titulo: string
  alinhar?: 'esquerda' | 'direita'
  render?: (linha: T) => ReactNode
}

export interface UiTabelaProps<T> {
  colunas: UiColuna<T>[]
  linhas: T[]
  chaveLinha: (linha: T) => string | number
  vazio?: ReactNode
}

export default function Table<T>({ colunas, linhas, chaveLinha, vazio }: UiTabelaProps<T>) {
  if (linhas.length === 0) {
    return <div className="ui-tabela-envolve">{vazio ?? <EmptyState descricao="Nenhum registro encontrado." />}</div>
  }
  return (
    <div className="ui-tabela-envolve">
      <table className="ui-tabela">
        <thead>
          <tr>
            {colunas.map((c) => (
              <th key={c.chave} className={c.alinhar === 'direita' ? 'alinhar-direita' : ''}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr key={chaveLinha(linha)}>
              {colunas.map((c) => (
                <td key={c.chave} className={c.alinhar === 'direita' ? 'alinhar-direita' : ''}>
                  {c.render ? c.render(linha) : String((linha as Record<string, unknown>)[c.chave] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}