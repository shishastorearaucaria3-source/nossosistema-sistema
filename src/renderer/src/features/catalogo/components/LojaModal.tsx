import { useState } from 'react'
import { getDbApi } from '../../../shared/db'

export interface DadosLoja {
  nome: string
  telefone: string
  endereco: string
  horario: string
}

export default function LojaModal({
  dados,
  onSalvar,
  onFechar
}: {
  dados: DadosLoja
  onSalvar: (d: DadosLoja) => void
  onFechar: () => void
}) {
  const [form, setForm] = useState<DadosLoja>({ ...dados })
  const [ocupado, setOcupado] = useState(false)

  const salvar = async () => {
    setOcupado(true)
    const db = getDbApi()
    const gravar = async (chave: string, valor: string) =>
      db.run(
        `INSERT INTO config (chave, valor) VALUES (?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [chave, valor]
      )
    try {
      await gravar('nome_loja', form.nome.trim())
      await gravar('telefone_loja', form.telefone.trim())
      await gravar('endereco_loja', form.endereco.trim())
      await gravar('horario_funcionamento', form.horario.trim())
      onSalvar({ ...form, nome: form.nome.trim(), telefone: form.telefone.trim(), endereco: form.endereco.trim(), horario: form.horario.trim() })
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal modal-config-catalogo" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <h3>Dados da Loja</h3>
          <button className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <p className="nota-config">
          Estas informações aparecem no catálogo público e são usadas no checkout (WhatsApp do pedido) e nas infos da loja.
        </p>

        <label className="config-campo">
          Nome da loja
          <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Shisha Store" />
        </label>

        <label className="config-campo">
          WhatsApp (com DDD)
          <input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="Ex.: (41) 99999-0000" />
        </label>
        <p className="nota-config">
          É neste número que o pedido do cliente é enviado (wa.me) e o link de contato do site.
        </p>

        <label className="config-campo">
          Endereço da loja
          <input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} placeholder="Ex.: Rua das Flores, 123 — Centro" />
        </label>

        <label className="config-campo">
          Horário de funcionamento
          <input value={form.horario} onChange={(e) => setForm({ ...form, horario: e.target.value })} placeholder="Ex.: 10:00 - 22:00" />
        </label>

        <div className="modal-acoes">
          <button className="btn-secundario" onClick={onFechar}>Cancelar</button>
          <button className="btn-primario" onClick={salvar} disabled={ocupado}>Salvar</button>
        </div>
      </div>
    </div>
  )
}