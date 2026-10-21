import { useState, useEffect } from 'react'
import { getDbApi } from '../../shared/db'

type ModoQuantidade = 'opcional' | 'produto' | 'quantidade'

export default function ConfigPdv({ onFechar }: { onFechar: () => void }) {
  const [agrupar, setAgrupar] = useState<boolean>(() => localStorage.getItem('pdv_agrupar_iguais') !== '0')
  // Fonte oficial é a tabela config (o servidor aplica a regra na venda).
  // O localStorage mantém apenas o valor para exibição imediata.
  const [permitirSemEstoque, setPermitirSemEstoque] = useState<boolean>(() => localStorage.getItem('pdv_permitir_sem_estoque') === '1')
  const [modoQuantidade, setModoQuantidade] = useState<ModoQuantidade>(() => (localStorage.getItem('pdv_modo_quantidade') as ModoQuantidade) || 'opcional')
  const [casasDecimais, setCasasDecimais] = useState<number>(() => {
    const v = localStorage.getItem('pdv_casas_decimais')
    return v === null || v === '' ? 0 : Number(v)
  })

  useEffect(() => {
    getDbApi()
      .all(`SELECT chave, valor FROM config WHERE chave IN ('pdv_permitir_sem_estoque', 'pdv_modo_quantidade', 'pdv_casas_decimais')`)
      .then((rows) => {
        const mapa: Record<string, string> = {}
        for (const r of rows as unknown as { chave: string; valor: string }[]) mapa[r.chave] = r.valor
        if (mapa['pdv_permitir_sem_estoque'] != null) {
          const v = mapa['pdv_permitir_sem_estoque']
          setPermitirSemEstoque(v === '1')
          try { localStorage.setItem('pdv_permitir_sem_estoque', v) } catch { /* ignore */ }
        }
        if (mapa['pdv_modo_quantidade'] != null) {
          const m = mapa['pdv_modo_quantidade'] as ModoQuantidade
          if (m === 'opcional' || m === 'produto' || m === 'quantidade') {
            setModoQuantidade(m)
            try { localStorage.setItem('pdv_modo_quantidade', m) } catch { /* ignore */ }
          }
        }
        if (mapa['pdv_casas_decimais'] != null) {
          const c = Number(mapa['pdv_casas_decimais'])
          if (c === 0 || c === 2) {
            setCasasDecimais(c)
            try { localStorage.setItem('pdv_casas_decimais', String(c)) } catch { /* ignore */ }
          }
        }
      })
      .catch(() => {})
  }, [])

  const persistirConfig = (chave: string, valor: string) => {
    const db = getDbApi()
    return db
      .run(
        `INSERT INTO config (chave, valor) VALUES (?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [chave, valor]
      )
      .catch(() => {})
  }

  const toggleAgrupar = (v: boolean) => {
    setAgrupar(v)
    try { localStorage.setItem('pdv_agrupar_iguais', v ? '1' : '0') } catch { /* ignore */ }
  }

  const toggleSemEstoque = (v: boolean) => {
    setPermitirSemEstoque(v)
    try { localStorage.setItem('pdv_permitir_sem_estoque', v ? '1' : '0') } catch { /* ignore */ }
    persistirConfig('pdv_permitir_sem_estoque', v ? '1' : '0')
  }

  const escolherModoQuantidade = (m: ModoQuantidade) => {
    setModoQuantidade(m)
    try { localStorage.setItem('pdv_modo_quantidade', m) } catch { /* ignore */ }
    persistirConfig('pdv_modo_quantidade', m)
  }

  const escolherCasasDecimais = (c: number) => {
    setCasasDecimais(c)
    try { localStorage.setItem('pdv_casas_decimais', String(c)) } catch { /* ignore */ }
    persistirConfig('pdv_casas_decimais', String(c))
  }

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal modal-tela-cheia" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <h3>Configurações do PDV</h3>
          <button className="btn-icone" onClick={onFechar}>✕</button>
        </div>
        <div className="modal-corpo">
          <div className="config-pdv-lista">
            <div className="config-pdv-item">
              <div className="config-pdv-info">
                <strong>Agrupar produtos iguais na venda</strong>
                <span>Quando ativo, adicionar o mesmo produto soma na quantidade. Desative para cada adição virar um item separado (negociações diferentes).</span>
              </div>
              <label className="switch">
                <input type="checkbox" checked={agrupar} onChange={(e) => toggleAgrupar(e.target.checked)} />
                <span className="slider" />
              </label>
            </div>
            <div className="config-pdv-item">
              <div className="config-pdv-info">
                <strong>Permitir venda sem estoque</strong>
                <span>Permite adicionar produtos sem estoque direto (sem aviso).</span>
              </div>
              <label className="switch">
                <input type="checkbox" checked={permitirSemEstoque} onChange={(e) => toggleSemEstoque(e.target.checked)} />
                <span className="slider" />
              </label>
            </div>
            <div className="config-pdv-item">
              <div className="config-pdv-info">
                <strong>Comportamento da quantidade</strong>
                <span>Define como a quantidade é informada ao adicionar produtos no PDV.</span>
              </div>
              <select
                className="config-pdv-select"
                value={modoQuantidade}
                onChange={(e) => escolherModoQuantidade(e.target.value as ModoQuantidade)}
                title="Como a quantidade é informada no PDV"
              >
                <option value="opcional">Não passar pela quantidade (Quantidade Opcional)</option>
                <option value="produto">Começar pelo Produto e depois informar a Quantidade</option>
                <option value="quantidade">Começar pela Quantidade e depois informar o Produto</option>
              </select>
            </div>
            <div className="config-pdv-item">
              <div className="config-pdv-info">
                <strong>Casas decimais na quantidade</strong>
                <span>Permite ou não quantidade com casas decimais (ex.: 1,50).</span>
              </div>
              <select
                className="config-pdv-select"
                value={casasDecimais}
                onChange={(e) => escolherCasasDecimais(Number(e.target.value))}
                title="Casas decimais permitidas na quantidade"
              >
                <option value={0}>Inteiro (sem decimais)</option>
                <option value={2}>2 casas decimais (0,01 a 99,99)</option>
              </select>
            </div>
          </div>
        </div>
        <div className="modal-rodape">
          <div className="modal-acoes-direita">
            <button className="btn-primario" onClick={onFechar}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
