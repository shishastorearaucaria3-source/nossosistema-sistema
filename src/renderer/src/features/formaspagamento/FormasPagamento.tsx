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

const TIPOS = [
  { valor: 'dinheiro', label: 'Dinheiro' },
  { valor: 'pix', label: 'Pix' },
  { valor: 'cartao', label: 'Cartão' },
  { valor: 'fiado', label: 'Fiado' },
  { valor: 'outro', label: 'Outro' }
]

const formaVazia = {
  nome: '',
  tipo: 'dinheiro',
  permite_troco: 0,
  permite_parcelas: 0,
  max_parcelas: 1,
  taxa: '',
  dias_receber: 0,
  ativo: 1,
  troco_credito_conta: 1
}

export default function FormasPagamento() {
  const [formas, setFormas] = useState<Forma[]>([])
  const [form, setForm] = useState({ ...formaVazia })
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [formAberto, setFormAberto] = useState(false)
  const [mensagem, setMensagem] = useState('')

  const carregar = useCallback(async () => {
    const rows = (await getDbApi().all(
      `SELECT * FROM formas_pagamento ORDER BY id`
    )) as unknown as Forma[]
    setFormas(rows)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const abrirNovo = () => {
    setForm({ ...formaVazia })
    setEditandoId(null)
    setFormAberto(true)
    setMensagem('')
  }

  const abrirEdicao = (f: Forma) => {
    setForm({
      nome: f.nome,
      tipo: f.tipo,
      permite_troco: f.permite_troco,
      permite_parcelas: f.permite_parcelas,
      max_parcelas: f.max_parcelas,
      taxa: String(f.taxa),
      dias_receber: f.dias_receber,
      ativo: f.ativo,
      troco_credito_conta: f.troco_credito_conta
    })
    setEditandoId(f.id)
    setFormAberto(true)
    setMensagem('')
  }

  const salvar = async () => {
    if (!form.nome.trim()) {
      setMensagem('Informe o nome da forma de pagamento.')
      return
    }
    const db = getDbApi()
    const params = [
      form.nome.trim(),
      form.tipo,
      form.permite_troco,
      form.permite_parcelas,
      form.permite_parcelas ? Math.max(1, Number(form.max_parcelas) || 1) : 1,
      Number(form.taxa) || 0,
      Number(form.dias_receber) || 0,
      form.ativo,
      form.troco_credito_conta ? 1 : 0
    ]
    if (editandoId) {
      await db.run(
        `UPDATE formas_pagamento SET nome=?, tipo=?, permite_troco=?, permite_parcelas=?, max_parcelas=?, taxa=?, dias_receber=?, ativo=?, troco_credito_conta=? WHERE id=?`,
        [...params, editandoId]
      )
    } else {
      await db.run(
        `INSERT INTO formas_pagamento (nome, tipo, permite_troco, permite_parcelas, max_parcelas, taxa, dias_receber, ativo, troco_credito_conta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      )
    }
    setFormAberto(false)
    setForm({ ...formaVazia })
    setMensagem(editandoId ? 'Forma atualizada!' : 'Forma criada!')
    carregar()
  }

  const alternarAtivo = async (f: Forma) => {
    await getDbApi().run(`UPDATE formas_pagamento SET ativo = ? WHERE id = ?`, [f.ativo ? 0 : 1, f.id])
    carregar()
  }

  const excluir = async (f: Forma) => {
    if (!confirm(`Excluir a forma "${f.nome}"?`)) return
    await getDbApi().run(`DELETE FROM formas_pagamento WHERE id = ?`, [f.id])
    carregar()
  }

  const criarRapida = async (tipo: string, sufixo: string, permite_parcelas = 0) => {
    const nome = `${tipo}${sufixo}`
    const existe = formas.some((f) => f.nome === nome)
    if (existe) {
      setMensagem(`"${nome}" já existe.`)
      return
    }
    await getDbApi().run(
      `INSERT INTO formas_pagamento (nome, tipo, permite_troco, permite_parcelas, max_parcelas, taxa, dias_receber, ativo, troco_credito_conta)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [nome, tipo.toLowerCase(), tipo === 'Dinheiro' ? 1 : 0, permite_parcelas, permite_parcelas ? 12 : 1, 0, 0, 1]
    )
    setMensagem(`"${nome}" criada.`)
    carregar()
  }

  const labelTipo = (t: string) => TIPOS.find((x) => x.valor === t)?.label ?? t

  return (
    <div className="page">
      <div className="page-header">
        <h2>Formas de pagamento</h2>
        <div className="page-acoes">
          <button className="btn-primario" onClick={abrirNovo}>+ Nova forma</button>
        </div>
      </div>
      {mensagem && <div className="mensagem">{mensagem}</div>}
      <p className="nota-config">
        Essas formas aparecem no PDV (menu de pagamento com F2). Crie entradas por banco/terminal, ex:
        "Pix banco1", "Pix banco2", "Crédito banco1" — cada uma vira um pagamento separado no balcão.
      </p>

      <div className="painel-form">
        <span className="formas-rapidas-titulo">Criar rápida:</span>
        <button className="btn-secundario" onClick={() => criarRapida('Pix', '')}>Pix</button>
        <button className="btn-secundario" onClick={() => criarRapida('Pix', ' banco1')}>Pix banco1</button>
        <button className="btn-secundario" onClick={() => criarRapida('Pix', ' banco2')}>Pix banco2</button>
        <button className="btn-secundario" onClick={() => criarRapida('Crédito', ' banco1', 1)}>Crédito banco1</button>
        <button className="btn-secundario" onClick={() => criarRapida('Crédito', ' banco2', 1)}>Crédito banco2</button>
        <button className="btn-secundario" onClick={() => criarRapida('Débito', ' banco1')}>Débito banco1</button>
        <button className="btn-secundario" onClick={() => criarRapida('Dinheiro', '')}>Dinheiro</button>
        <button className="btn-secundario" onClick={() => criarRapida('Fiado', '')}>Fiado</button>
      </div>

      {formAberto && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>{editandoId ? 'Editar forma' : 'Nova forma de pagamento'}</h3>
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
              <label>Permite troco
                <select value={form.permite_troco} onChange={(e) => setForm({ ...form, permite_troco: Number(e.target.value) })}>
                  <option value={0}>Não</option>
                  <option value={1}>Sim</option>
                </select>
              </label>
              <label>Deixar troco como crédito em conta
                <select value={form.troco_credito_conta} onChange={(e) => setForm({ ...form, troco_credito_conta: Number(e.target.value) })}>
                  <option value={0}>Não</option>
                  <option value={1}>Sim</option>
                </select>
                <small className="nota-config">Quando o pagamento sobra troco e não há troco em espécie, pode virar crédito na conta do cliente.</small>
              </label>
              <label>Permite parcelas
                <select value={form.permite_parcelas} onChange={(e) => setForm({ ...form, permite_parcelas: Number(e.target.value) })}>
                  <option value={0}>Não</option>
                  <option value={1}>Sim</option>
                </select>
              </label>
              <label>Máx. parcelas
                <input type="number" min="1" max="48" value={form.max_parcelas} disabled={!form.permite_parcelas}
                  onChange={(e) => setForm({ ...form, max_parcelas: Number(e.target.value) || 1 })} />
              </label>
              <label>Taxa (%)
                <input type="number" step="0.01" value={form.taxa} onChange={(e) => setForm({ ...form, taxa: e.target.value })} placeholder="Ex: 3.5 para cartão" />
              </label>
              <label>Dias para receber
                <input type="number" value={form.dias_receber} onChange={(e) => setForm({ ...form, dias_receber: Number(e.target.value) || 0 })} placeholder="Ex: 1 (cartão)" />
              </label>
              <label>Ativo
                <select value={form.ativo} onChange={(e) => setForm({ ...form, ativo: Number(e.target.value) })}>
                  <option value={1}>Sim</option>
                  <option value={0}>Não</option>
                </select>
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setFormAberto(false)}>Cancelar</button>
              <button className="btn-primario" onClick={salvar}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      <table className="tabela">
        <thead>
          <tr>
            <th>Forma</th>
            <th>Tipo</th>
            <th>Pode voltar troco?</th>
            <th>Pode troco como crédito em conta?</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {formas.map((f) => (
            <tr key={f.id} className={!f.ativo ? 'linha-cancelada' : ''}>
              <td>{f.nome}</td>
              <td>{labelTipo(f.tipo)}</td>
              <td>{f.permite_troco ? 'Sim' : 'Não'}</td>
              <td>{f.troco_credito_conta ? 'Sim' : 'Não'}</td>
              <td>{f.ativo ? 'Ativa' : 'Inativa'}</td>
              <td className="td-acoes">
                <button className="btn-mini" onClick={() => abrirEdicao(f)}>Editar</button>
                <button className="btn-mini" onClick={() => alternarAtivo(f)}>{f.ativo ? 'Desativar' : 'Ativar'}</button>
                <button className="btn-mini" onClick={() => excluir(f)}>Excluir</button>
              </td>
            </tr>
          ))}
          {formas.length === 0 && (
            <tr><td colSpan={6} className="sem-resultado">Nenhuma forma cadastrada.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
