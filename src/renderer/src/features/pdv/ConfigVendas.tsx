import { useEffect, useState, useCallback } from 'react'
import { getDbApi } from '../../shared/db'

interface Forma {
  id: number
  nome: string
  tipo: string
  permite_troco: number
  permite_parcelas: number
  max_parcelas: number
  taxa: number
  dias_receber: number
  ativo: number
  troco_credito_conta: number
}

const TIPOS: { valor: string; label: string }[] = [
  { valor: 'dinheiro', label: 'Dinheiro' },
  { valor: 'pix', label: 'Pix' },
  { valor: 'cartao', label: 'Cartão' },
  { valor: 'fiado', label: 'Fiado' },
  { valor: 'outro', label: 'Outro' }
]

export default function ConfigVendas({ onFechar }: { onFechar: () => void }) {
  const [formas, setFormas] = useState<Forma[]>([])
  const [trocoMax, setTrocoMax] = useState('')
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [form, setForm] = useState<{
    nome: string
    tipo: string
    permite_troco: number
    troco_credito_conta: number
    ativo: number
  }>({ nome: '', tipo: 'dinheiro', permite_troco: 0, troco_credito_conta: 1, ativo: 1 })
  const [novoAberto, setNovoAberto] = useState(false)
  const [mensagem, setMensagem] = useState('')

  const carregar = useCallback(async () => {
    const db = getDbApi()
    const rows = (await db.all(`SELECT * FROM formas_pagamento ORDER BY id`)) as unknown as Forma[]
    setFormas(rows)
    const ciclo = (await db.get(`SELECT valor FROM config WHERE chave = 'vendas_troco_max'`)) as
      | { valor: string | null }
      | undefined
    const raw = ciclo?.valor ?? '0'
    setTrocoMax(raw === '0' ? '' : raw)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const persistirTroco = async (valor: string) => {
    await getDbApi()
      .run(
        `INSERT INTO config (chave, valor) VALUES ('vendas_troco_max', ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [valor]
      )
      .catch(() => {})
    try { localStorage.setItem('vendas_troco_max', valor) } catch { /* ignore */ }
  }

  const salvarTroco = () => {
    const digitos = trocoMax.replace(/\D/g, '').slice(0, 12)
    const valor = digitos ? (Number(digitos) / 100).toFixed(2) : '0'
    setTrocoMax(valor === '0' ? '' : valor)
    persistirTroco(valor)
    setMensagem('Limite de troco salvo. Se o troco exceder o limite, a venda exigirá autorização do supervisor.')
  }

  const alternarAtivo = async (f: Forma) => {
    await getDbApi().run(`UPDATE formas_pagamento SET ativo = ? WHERE id = ?`, [f.ativo ? 0 : 1, f.id])
    carregar()
  }

  const salvarForma = async () => {
    if (!form.nome.trim()) {
      setMensagem('Informe o nome do meio de pagamento.')
      return
    }
    const db = getDbApi()
    const params = [
      form.nome.trim(),
      form.tipo,
      form.permite_troco ? 1 : 0,
      form.troco_credito_conta ? 1 : 0,
      form.ativo ? 1 : 0
    ]
    if (editandoId) {
      await db.run(
        `UPDATE formas_pagamento SET nome=?, tipo=?, permite_troco=?, troco_credito_conta=?, ativo=? WHERE id=?`,
        [...params, editandoId]
      )
      setMensagem('Meio de pagamento atualizado.')
    } else {
      await db.run(
        `INSERT INTO formas_pagamento (nome, tipo, permite_troco, permite_parcelas, max_parcelas, taxa, dias_receber, ativo, troco_credito_conta)
         VALUES (?, ?, ?, 0, 1, 0, 0, ?, ?)`,
        [form.nome.trim(), form.tipo, form.permite_troco ? 1 : 0, form.ativo ? 1 : 0, form.troco_credito_conta ? 1 : 0]
      )
      setMensagem('Meio de pagamento criado.')
    }
    setNovoAberto(false)
    setForm({ nome: '', tipo: 'dinheiro', permite_troco: 0, troco_credito_conta: 1, ativo: 1 })
    setEditandoId(null)
    carregar()
  }

  const abrirEdicao = (f: Forma) => {
    setForm({ nome: f.nome, tipo: f.tipo, permite_troco: f.permite_troco, troco_credito_conta: f.troco_credito_conta, ativo: f.ativo })
    setEditandoId(f.id)
    setNovoAberto(true)
    setMensagem('')
  }

return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal modal-tela-cheia config-vendas" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <h3>Configurações de Vendas</h3>
          <button className="btn-icone" onClick={onFechar}>✕</button>
        </div>
        <div className="modal-corpo">
          {mensagem && <div className="mensagem">{mensagem}</div>}

          <div className="config-vendas-secao">
            <h4>37. Meios de Pagamento</h4>
            <p className="nota-config">Os meios ativos aparecem no pagamento do PDV (F2) e alimentam as transações do caixa. Inativos ficam listados tachados e não podem ser usados em novas vendas.</p>
            <div className="config-vendas-acoes">
              <button className="btn-primario" onClick={() => { setEditandoId(null); setForm({ nome: '', tipo: 'dinheiro', permite_troco: 0, troco_credito_conta: 1, ativo: 1 }); setNovoAberto(true); setMensagem('') }}>
                + Novo
              </button>
            </div>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Ícone</th>
                  <th>Nome</th>
                  <th>Pode voltar troco?</th>
                  <th>Pode troco como crédito?</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {formas.map((f) => (
                  <tr key={f.id} className={!f.ativo ? 'linha-cancelada' : ''}>
                    <td className="td-icone">
                      {f.tipo === 'dinheiro' ? '💵' : f.tipo === 'pix' ? '⚡' : f.tipo === 'cartao' ? '💳' : f.tipo === 'fiado' ? '📒' : '💠'}
                    </td>
                    <td>{f.nome}</td>
                    <td>{f.permite_troco ? 'Sim' : 'Não'}</td>
                    <td>{f.troco_credito_conta ? 'Sim' : 'Não'}</td>
                    <td>{f.ativo ? 'Ativo' : 'Inativo'}</td>
                    <td className="td-acoes">
                      <button className="btn-mini" onClick={() => abrirEdicao(f)}>Editar</button>
                      <button className="btn-mini" onClick={() => alternarAtivo(f)}>{f.ativo ? 'Inativar' : 'Ativar'}</button>
                    </td>
                  </tr>
                ))}
                {formas.length === 0 && (
                  <tr><td colSpan={6} className="sem-resultado">Nenhum meio cadastrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="config-vendas-secao">
            <h4>38. Limite de Troco</h4>
            <p className="nota-config">Define o troco máximo que pode ser devolvido em espécie em uma venda. Se o troco ultrapassar o limite, a venda será bloqueada até a confirmação de um supervisor.</p>
            <div className="config-vendas-troco">
              <label>
                Troco máximo permitido (R$)
                <input
                  value={trocoMax}
                  onChange={(e) => setTrocoMax(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="0,00 (sem limite)"
                  inputMode="numeric"
                />
                <small className="nota-config">Digite somente números. Ex: 100 = R$ 1,00. Deixe vazio para não limitar.</small>
              </label>
              <button className="btn-primario" onClick={salvarTroco}>Salvar limite</button>
            </div>
          </div>
        </div>

        {novoAberto && (
          <div className="modal-overlay config-vendas-form-overlay" onClick={(e) => e.stopPropagation()}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>{editandoId ? 'Editar meio de pagamento' : 'Novo meio de pagamento'}</h3>
              <div className="form-grid">
                <label>Nome
                  <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
                </label>
                <label>Tipo
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                    {TIPOS.map((t) => (
                      <option key={t.valor} value={t.valor}>{t.label}</option>
                    ))}
                  </select>
                </label>
                <label>Pode voltar troco?
                  <select value={form.permite_troco} onChange={(e) => setForm({ ...form, permite_troco: Number(e.target.value) })}>
                    <option value={0}>Não</option>
                    <option value={1}>Sim</option>
                  </select>
                </label>
                <label>Pode troco como crédito em conta?
                  <select value={form.troco_credito_conta} onChange={(e) => setForm({ ...form, troco_credito_conta: Number(e.target.value) })}>
                    <option value={0}>Não</option>
                    <option value={1}>Sim</option>
                  </select>
                </label>
                <label>Ativo
                  <select value={form.ativo} onChange={(e) => setForm({ ...form, ativo: Number(e.target.value) })}>
                    <option value={1}>Sim</option>
                    <option value={0}>Não</option>
                  </select>
                </label>
              </div>
              <div className="modal-acoes">
                <button className="btn-secundario" onClick={() => { setNovoAberto(false); setEditandoId(null) }}>Cancelar</button>
                <button className="btn-primario" onClick={salvarForma}>Salvar</button>
              </div>
            </div>
          </div>
        )}

        <div className="modal-rodape">
          <div className="modal-acoes-direita">
            <button className="btn-primario" onClick={onFechar}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
