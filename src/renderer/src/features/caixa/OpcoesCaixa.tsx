import { useEffect, useState, useCallback } from 'react'
import { getDbApi } from '../../shared/db'

interface Opcoes {
  saldo_abertura: 'informar' | 'zerado' | 'anterior'
  exigir_saldo_final: boolean
  gerar_csv: boolean
  relatorio_auto: boolean
  fechamento_por: 'forma' | 'total'
  rel_itens: { estoque: boolean; minimo: boolean; descontos: boolean; canceladas: boolean; observacoes: boolean; todas_transacoes: boolean; vendas_por_categoria: boolean }
  impressora: string
  formato: 'folha' | 'bobina'
}

const PADRAO: Opcoes = {
  saldo_abertura: 'anterior',
  exigir_saldo_final: true,
  gerar_csv: false,
  relatorio_auto: false,
  fechamento_por: 'total',
  rel_itens: { estoque: true, minimo: false, descontos: true, canceladas: true, observacoes: false, todas_transacoes: false, vendas_por_categoria: true },
  impressora: '',
  formato: 'bobina'
}

const CHAVES = [
  'caixa_saldo_abertura',
  'caixa_exigir_saldo_final',
  'caixa_gerar_csv',
  'caixa_relatorio_auto',
  'caixa_fechamento_por',
  'caixa_rel_itens',
  'caixa_impressora',
  'caixa_formato'
]

export default function OpcoesCaixa({ onFechar }: { onFechar: () => void }) {
  const [opcoes, setOpcoes] = useState<Opcoes>(PADRAO)
  const [mensagem, setMensagem] = useState('')

  const carregar = useCallback(async () => {
    try {
      const rows = (await getDbApi().all(`SELECT chave, valor FROM config WHERE chave IN (${CHAVES.map(() => '?').join(',')})`, CHAVES)) as unknown as { chave: string; valor: string | null }[]
      const mapa: Record<string, string> = {}
      for (const r of rows) mapa[r.chave] = r.valor ?? ''
      setOpcoes({
        saldo_abertura: (mapa['caixa_saldo_abertura'] as Opcoes['saldo_abertura']) || 'anterior',
        exigir_saldo_final: mapa['caixa_exigir_saldo_final'] !== '0',
        gerar_csv: mapa['caixa_gerar_csv'] === '1',
        relatorio_auto: mapa['caixa_relatorio_auto'] === '1',
        fechamento_por: (mapa['caixa_fechamento_por'] as Opcoes['fechamento_por']) || 'total',
        rel_itens: (() => {
          try {
            const j = JSON.parse(mapa['caixa_rel_itens'] || '')
            return { ...PADRAO.rel_itens, ...j }
          } catch {
            return PADRAO.rel_itens
          }
        })(),
        impressora: mapa['caixa_impressora'] || '',
        formato: (mapa['caixa_formato'] as Opcoes['formato']) || 'bobina'
      })
    } catch {
      // usa padrão
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        salvar()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opcoes])

  const persistir = () => {
    const db = getDbApi()
    const pares = [
      ['caixa_saldo_abertura', opcoes.saldo_abertura],
      ['caixa_exigir_saldo_final', opcoes.exigir_saldo_final ? '1' : '0'],
      ['caixa_gerar_csv', opcoes.gerar_csv ? '1' : '0'],
      ['caixa_relatorio_auto', opcoes.relatorio_auto ? '1' : '0'],
      ['caixa_fechamento_por', opcoes.fechamento_por],
      ['caixa_rel_itens', JSON.stringify(opcoes.rel_itens)],
      ['caixa_impressora', opcoes.impressora],
      ['caixa_formato', opcoes.formato]
    ]
    return Promise.all(
      pares.map(([chave, valor]) =>
        db
          .run(
            `INSERT INTO config (chave, valor) VALUES (?, ?)
             ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
            [chave, valor]
          )
          .catch(() => {})
      )
    )
  }

  const toggleRelItem = (chave: keyof Opcoes['rel_itens']) => {
    setOpcoes((o) => ({ ...o, rel_itens: { ...o.rel_itens, [chave]: !o.rel_itens[chave] } }))
  }

  const salvar = async () => {
    await persistir()
    setMensagem('Opções de caixa salvas.')
    setTimeout(onFechar, 500)
  }

  const relItens: { chave: keyof Opcoes['rel_itens']; rotulo: string }[] = [
    { chave: 'estoque', rotulo: 'Estoque' },
    { chave: 'minimo', rotulo: 'Estoque mínimo' },
    { chave: 'descontos', rotulo: 'Descontos' },
    { chave: 'canceladas', rotulo: 'Vendas canceladas' },
    { chave: 'observacoes', rotulo: 'Observações' },
    { chave: 'todas_transacoes', rotulo: 'Todas as transações' },
    { chave: 'vendas_por_categoria', rotulo: 'Vendas por categoria' }
  ]

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal modal-pagamento opcoes-caixa" onClick={(e) => e.stopPropagation()}>
        <h3>Opções de Caixa</h3>
        {mensagem && <div className="mensagem">{mensagem}</div>}

        <div className="config-vendas-secao">
          <h4>Saldo inicial por</h4>
          <div className="opcoes-caixa-radio">
            {([['informar', 'Informar'], ['zerado', 'Zerado'], ['anterior', 'Saldo anterior']] as const).map(([v, l]) => (
              <label key={v} className="opcao-radio">
                <input type="radio" name="saldo_abertura" checked={opcoes.saldo_abertura === v} onChange={() => setOpcoes((o) => ({ ...o, saldo_abertura: v }))} />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="config-pdv-item opcoes-caixa-item">
          <div className="config-pdv-info">
            <strong>Exigir saldo final</strong>
            <span>Obriga informar o saldo físico (que confere o caixa) no fechamento.</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={opcoes.exigir_saldo_final} onChange={(e) => setOpcoes((o) => ({ ...o, exigir_saldo_final: e.target.checked }))} />
            <span className="slider" />
          </label>
        </div>

        <div className="config-vendas-secao">
          <h4>No fechamento</h4>
          <div className="opcoes-caixa-radio">
            {([['forma', 'Por forma de pagamento'], ['total', 'Pelo total']] as const).map(([v, l]) => (
              <label key={v} className="opcao-radio">
                <input type="radio" name="fechamento_por" checked={opcoes.fechamento_por === v} onChange={() => setOpcoes((o) => ({ ...o, fechamento_por: v }))} />
                <span>{l}</span>
              </label>
            ))}
          </div>
          <div className="config-pdv-item opcoes-caixa-item">
            <div className="config-pdv-info">
              <strong>Gerar relatório automaticamente</strong>
              <span>Cria o relatório de caixa assim que ele é fechado.</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={opcoes.relatorio_auto} onChange={(e) => setOpcoes((o) => ({ ...o, relatorio_auto: e.target.checked }))} />
              <span className="slider" />
            </label>
          </div>
          <div className="config-pdv-item opcoes-caixa-item">
            <div className="config-pdv-info">
              <strong>Gerar CSV</strong>
              <span>Exporta o relatório em CSV junto com o fechamento.</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={opcoes.gerar_csv} onChange={(e) => setOpcoes((o) => ({ ...o, gerar_csv: e.target.checked }))} />
              <span className="slider" />
            </label>
          </div>
        </div>

        <div className="config-vendas-secao">
          <h4>Itens do relatório</h4>
          <div className="opcoes-caixa-checklist">
            {relItens.map((item) => (
              <label key={item.chave} className="opcao-checa">
                <input type="checkbox" checked={opcoes.rel_itens[item.chave]} onChange={() => toggleRelItem(item.chave)} />
                <span>{item.rotulo}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="config-vendas-secao">
          <h4>Impressora e formato</h4>
          <div className="form-grid">
            <label>Impressora
              <input value={opcoes.impressora} onChange={(e) => setOpcoes((o) => ({ ...o, impressora: e.target.value }))} placeholder="Nome da impressora / térmica" />
            </label>
            <label>Formato
              <select value={opcoes.formato} onChange={(e) => setOpcoes((o) => ({ ...o, formato: e.target.value as Opcoes['formato'] }))}>
                <option value="folha">Folha (A4)</option>
                <option value="bobina">Bobina (térmica)</option>
              </select>
            </label>
          </div>
        </div>

        <div className="modal-acoes">
          <button className="btn-secundario" onClick={onFechar}>CANCELAR</button>
          <button className="btn-primario" onClick={salvar}>SALVAR <kbd>F2</kbd></button>
        </div>
      </div>
    </div>
  )
}
