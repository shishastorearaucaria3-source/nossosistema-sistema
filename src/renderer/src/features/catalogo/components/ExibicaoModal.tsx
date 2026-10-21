import { useEffect, useState } from 'react'
import { getCatalogoApi } from '../../../shared/db'

export interface ConfigExibicao {
  mostrar_estoque: boolean
  sem_estoque: 'despublicar' | 'manter'
  aceitar_pedidos_sem_estoque: boolean
  destacar_promocoes: boolean
}

export default function ExibicaoModal({
  onSalvar,
  onFechar
}: {
  onSalvar: (c: ConfigExibicao) => void
  onFechar: () => void
}) {
  const [form, setForm] = useState<ConfigExibicao>({
    mostrar_estoque: true,
    sem_estoque: 'despublicar',
    aceitar_pedidos_sem_estoque: false,
    destacar_promocoes: true
  })
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    getCatalogoApi()
      .getExibicao()
      .then((c) =>
        setForm({
          mostrar_estoque: c.mostrar_estoque ?? true,
          sem_estoque: c.sem_estoque === 'manter' ? 'manter' : 'despublicar',
          aceitar_pedidos_sem_estoque: c.aceitar_pedidos_sem_estoque ?? false,
          destacar_promocoes: c.destacar_promocoes ?? true
        })
      )
      .catch(() => {})
  }, [])

  const manterPublicados = form.sem_estoque === 'manter'

  const salvar = async () => {
    setOcupado(true)
    try {
      const cfg: ConfigExibicao = {
        ...form,
        // despublicar implica em não aceitar pedidos sem estoque
        aceitar_pedidos_sem_estoque: manterPublicados ? form.aceitar_pedidos_sem_estoque : false
      }
      await getCatalogoApi().salvarExibicao(cfg)
      onSalvar(cfg)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal modal-tela-cheia modal-exibicao" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <h3>Como seus produtos serão exibidos?</h3>
          <button className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-corpo">
          <div className="config-item-linha">
            <div>
              <strong>Mostrar estoque dos produtos</strong>
              <span>Exibe "Estoque: X unid." nos cards. O controle interno continua funcionando normalmente.</span>
            </div>
            <button
              className={`cat-switch ${form.mostrar_estoque ? 'ligado' : ''}`}
              role="switch"
              aria-checked={form.mostrar_estoque}
              onClick={() => setForm({ ...form, mostrar_estoque: !form.mostrar_estoque })}
            >
              <span className="cat-switch-bola" />
            </button>
          </div>

          <div className="exibicao-secao">
            <strong className="exibicao-secao-titulo">Produtos sem estoque:</strong>

            <button
              className={`config-forma ${form.sem_estoque === 'despublicar' ? 'ativa' : ''}`}
              onClick={() => setForm({ ...form, sem_estoque: 'despublicar', aceitar_pedidos_sem_estoque: false })}
            >
              <span className="config-forma-check">{form.sem_estoque === 'despublicar' ? '●' : ''}</span>
              <span>
                <strong>Despublicar itens automaticamente ao zerar o estoque</strong>
                <small>O produto deixa de aparecer no catálogo quando estoque = 0 e volta quando tiver estoque.</small>
              </span>
            </button>

            <button
              className={`config-forma ${form.sem_estoque === 'manter' ? 'ativa' : ''}`}
              onClick={() => setForm({ ...form, sem_estoque: 'manter' })}
            >
              <span className="config-forma-check">{form.sem_estoque === 'manter' ? '●' : ''}</span>
              <span>
                <strong>Manter itens publicados mesmo sem estoque</strong>
                <small>O card indica "Sem estoque" mas o produto continua visível.</small>
              </span>
            </button>

            <label className={`exibicao-checkbox ${manterPublicados ? '' : 'desabilitado'}`}>
              <button
                className={`config-forma-check exibicao-checkmark ${manterPublicados && form.aceitar_pedidos_sem_estoque ? 'ativa' : ''}`}
                disabled={!manterPublicados}
                onClick={() => manterPublicados && setForm({ ...form, aceitar_pedidos_sem_estoque: !form.aceitar_pedidos_sem_estoque })}
              >
                {manterPublicados && form.aceitar_pedidos_sem_estoque ? '✓' : ''}
              </button>
              <span>
                <strong>Aceitar pedidos mesmo sem estoque</strong>
                <small>{manterPublicados ? 'Permite adicionar ao pedido produtos com estoque zerado.' : 'Disponível apenas quando "Manter itens publicados" está selecionado.'}</small>
              </span>
            </label>
          </div>

          <div className="exibicao-secao">
            <strong className="exibicao-secao-titulo">Produtos em promoção:</strong>

            <label className="exibicao-checkbox">
              <button
                className={`config-forma-check exibicao-checkmark ${form.destacar_promocoes ? 'ativa' : ''}`}
                onClick={() => setForm({ ...form, destacar_promocoes: !form.destacar_promocoes })}
              >
                {form.destacar_promocoes ? '✓' : ''}
              </button>
              <span>
                <strong>Destacar produtos em promoção</strong>
                <small>Adiciona a etiqueta "PROMO", destaca o preço e risca o preço anterior.</small>
              </span>
            </label>
          </div>
        </div>

        <div className="modal-rodape">
          <div className="modal-acoes-direita">
            <button className="btn-secundario" onClick={onFechar}>Cancelar</button>
            <button className="btn-primario" onClick={salvar} disabled={ocupado}>Salvar</button>
          </div>
        </div>
      </div>
    </div>
  )
}