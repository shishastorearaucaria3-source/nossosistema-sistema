import { useEffect, useState, useCallback, useRef } from 'react'
import { getDbApi, getAuthApi, getPedidosCancelApi } from '../../shared/db'
import EditarPedido from './EditarPedido'

interface Pedido {
  id: number
  numero: string
  cliente_nome: string
  cliente_telefone: string | null
  cliente_endereco: string | null
  observacoes: string | null
  subtotal: number
  taxa_entrega: number
  total: number
  status: string
  criado_em: string
}

interface PedidoItem {
  nome_produto: string
  quantidade: number
  preco_unitario: number
  subtotal: number
}

const PROXIMOS: Record<string, string> = {
  novo: 'aceito',
  aceito: 'em_preparo',
  em_preparo: 'saiu_entrega',
  saiu_entrega: 'entregue'
}

const LABEL: Record<string, string> = {
  novo: 'Aguardando aceitação',
  aceito: 'Aceito',
  em_preparo: 'Em preparo',
  saiu_entrega: 'Saiu p/ entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado'
}

export default function Delivery() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [itens, setItens] = useState<Record<number, PedidoItem[]>>({})
  const [mensagem, setMensagem] = useState('')
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const novosRef = useRef<Set<number>>(new Set())

  const tocarSom = useCallback(() => {
    try {
      const ctx = new AudioContext()
      const notas = [880, 1108.73, 1318.51]
      notas.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const ganho = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        osc.connect(ganho)
        ganho.connect(ctx.destination)
        const t = ctx.currentTime + idx * 0.18
        ganho.gain.setValueAtTime(0.001, t)
        ganho.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
        ganho.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
        osc.start(t)
        osc.stop(t + 0.18)
      })
    } catch {
      // som indisponível
    }
  }, [])

  const carregar = useCallback(async () => {
    const rows = (await getDbApi().all(
      `SELECT * FROM pedidos WHERE status != 'entregue' AND status != 'cancelado'
       ORDER BY CASE status WHEN 'novo' THEN 0 WHEN 'aceito' THEN 1 WHEN 'em_preparo' THEN 2 ELSE 3 END, id DESC`
    )) as unknown as Pedido[]
    setPedidos(rows)

    const mapa: Record<number, PedidoItem[]> = {}
    for (const p of rows) {
      mapa[p.id] = (await getDbApi().all(
        `SELECT nome_produto, quantidade, preco_unitario, subtotal FROM pedido_itens WHERE pedido_id = ?`,
        [p.id]
      )) as unknown as PedidoItem[]
    }
    setItens(mapa)

    const novoTemSom = rows.some((p) => p.status === 'novo' && !novosRef.current.has(p.id))
    for (const p of rows) {
      if (p.status === 'novo') novosRef.current.add(p.id)
    }
    if (novoTemSom) tocarSom()
  }, [tocarSom])

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 5000)
    return () => clearInterval(t)
  }, [carregar])

  const avancarStatus = async (p: Pedido) => {
    const proximo = PROXIMOS[p.status]
    if (!proximo) return
    const db = getDbApi()
    await db.run(`UPDATE pedidos SET status = ? WHERE id = ?`, [proximo, p.id])

    if (p.status === 'novo') {
      const lista = (await db.all(
        `SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?`,
        [p.id]
      )) as unknown as { produto_id: number | null; quantidade: number }[]
      for (const item of lista) {
        if (item.produto_id) {
          await db.run(`UPDATE produtos SET estoque = estoque - ? WHERE id = ?`, [item.quantidade, item.produto_id])
          await db.run(
            `INSERT INTO movimentacoes (produto_id, tipo, quantidade, motivo) VALUES (?, 'saida', ?, ?)`,
            [item.produto_id, item.quantidade, `delivery ${p.numero}`]
          )
        }
      }
    }

    setMensagem(`${p.numero}: ${LABEL[p.status]} → ${LABEL[proximo]}`)
    carregar()
  }

  const cancelar = async (p: Pedido) => {
    if (!confirm(`Cancelar o pedido ${p.numero}?`)) return
    const sessao = await getAuthApi().session()
    if (!sessao) {
      setMensagem('Sessão expirada. Faça login novamente.')
      return
    }
    // Transacional no servidor: se o pedido já tinha baixado estoque (aceito+),
    // devolve e registra movimentação de reversão.
    const res = await getPedidosCancelApi().cancelar(p.id, sessao.id)
    if (!res.ok) {
      setMensagem(res.erro ?? 'Não foi possível cancelar o pedido.')
      return
    }
    setMensagem(`Pedido ${p.numero} cancelado.${res.estoque_devolvido ? ' Estoque devolvido.' : ''}`)
    carregar()
  }

  const recusar = async (p: Pedido) => {
    if (!confirm(`Recusar o pedido ${p.numero} do cliente ${p.cliente_nome}?`)) return
    const sessao = await getAuthApi().session()
    if (!sessao) {
      setMensagem('Sessão expirada. Faça login novamente.')
      return
    }
    const res = await getPedidosCancelApi().cancelar(p.id, sessao.id)
    if (!res.ok) {
      setMensagem(res.erro ?? 'Não foi possível recusar o pedido.')
      return
    }
    setMensagem(`Pedido ${p.numero} recusado.`)
    carregar()
  }

  const simularPedido = async () => {
    const db = getDbApi()
    const clientes = [
      { nome: 'João da Silva', tel: '(41) 99911-2233', end: 'Rua das Flores, 123 - Boqueirão' },
      { nome: 'Maria Oliveira', tel: '(41) 98822-3344', end: 'Av. Marechal Floriano, 456 - Centro' },
      { nome: 'Carlos Souza', tel: '(41) 97733-4455', end: 'Rua XV de Novembro, 789 - Batel' },
      { nome: 'Ana Paula', tel: '(41) 96644-5566', end: 'Rua Iguaçu, 101 - Água Verde' },
      { nome: 'Pedro Santos', tel: '(41) 95555-6677', end: 'Rua Chile, 202 - Rebouças' },
      { nome: 'Julia Lima', tel: '(41) 94466-7788', end: 'Rua Campos Sales, 303 - Cabral' },
      { nome: 'Rafael Costa', tel: '(41) 93377-8899', end: 'Rua João Gualberto, 404 - Juvevê' },
      { nome: 'Fernanda Rocha', tel: '(41) 92288-9900', end: 'Rua Itupava, 505 - Alto da XV' }
    ]
    const obs = ['Sem cebola', 'Deixar na portaria', 'Casa azul', 'Tocar campainha 2x', 'Sem troco', null, null, null]
    const cli = clientes[Math.floor(Math.random() * clientes.length)]
    const obsEsc = obs[Math.floor(Math.random() * obs.length)]

    const produtos = (await db.all(
      `SELECT id, nome, preco_venda, estoque FROM produtos WHERE ativo = 1 AND estoque > 0 ORDER BY RANDOM() LIMIT ${2 + Math.floor(Math.random() * 3)}`
    )) as unknown as { id: number; nome: string; preco_venda: number; estoque: number }[]

    if (produtos.length === 0) {
      setMensagem('Sem produtos com estoque para simular.')
      return
    }

    let subtotal = 0
    const itensSim = produtos.map((p) => {
      const quantidade = 1 + Math.floor(Math.random() * 3)
      const valor = p.preco_venda * quantidade
      subtotal += valor
      return { produto_id: p.id, nome: p.nome, quantidade, preco: p.preco_venda, subtotal: valor }
    })

    const taxaEntrega = Math.round((Math.random() * 3 + 3) * 10) / 10
    const total = subtotal + taxaEntrega
    const seq = (await db.get(
      `INSERT INTO sequencias (chave, valor) VALUES ('pedido_online', 1) ON CONFLICT(chave) DO UPDATE SET valor = valor + 1 RETURNING valor`
    )) as { valor: number }
    const numero = `C-${String(seq.valor).padStart(4, '0')}`
    const agora = new Date().toISOString().slice(0, 19).replace('T', ' ')

    const res = await db.run(
      `INSERT INTO pedidos (numero, cliente_nome, cliente_telefone, cliente_endereco, observacoes, subtotal, taxa_entrega, total, status, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'novo', ?)`,
      [numero, cli.nome, cli.tel, cli.end, obsEsc, subtotal, taxaEntrega, total, agora]
    )
    const pedidoId = Number(res.lastInsertRowid)
    for (const it of itensSim) {
      await db.run(
        `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [pedidoId, it.produto_id, it.nome, it.quantidade, it.preco, it.subtotal]
      )
    }

    setMensagem(`Pedido simulado ${numero} chegou! Cliente: ${cli.nome} • Total R$ ${total.toFixed(2)}`)
    carregar()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Delivery</h2>
        <div className="page-acoes">
          <button className="btn-primario" onClick={simularPedido}>Simular pedido</button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {pedidos.length === 0 && (
        <div className="rel-painel">
          <p className="sem-resultado">Nenhum pedido aguardando. O site de delivery está ativo — pedidos novos aparecem aqui em até 5s.</p>
        </div>
      )}

      <div className="pedidos-grid">
        {pedidos.map((p) => (
          <div key={p.id} className={`pedido-card status-${p.status}`}>
            <div className="pedido-topo">
              <strong>{p.numero}</strong>
              <span className={`pedido-status status-${p.status}`}>{LABEL[p.status]}</span>
            </div>
            <div className="pedido-cliente">
              <strong>{p.cliente_nome}</strong>
              {p.cliente_telefone && <span>{p.cliente_telefone}</span>}
              {p.cliente_endereco && <span>{p.cliente_endereco}</span>}
              {p.observacoes && <span className="pedido-obs">{p.observacoes}</span>}
            </div>
            <div className="pedido-itens">
              {(itens[p.id] ?? []).map((i, idx) => (
                <div key={idx} className="linha">
                  <span>{i.nome_produto} x{i.quantidade}</span>
                  <span>R$ {i.subtotal.toFixed(2)}</span>
                </div>
              ))}
              {p.taxa_entrega > 0 && (
                <div className="linha">
                  <span>Entrega</span>
                  <span>R$ {p.taxa_entrega.toFixed(2)}</span>
                </div>
              )}
              <div className="linha pedido-total">
                <span>Total</span>
                <strong>R$ {p.total.toFixed(2)}</strong>
              </div>
            </div>
            <div className="pedido-acoes">
              {PROXIMOS[p.status] && (
                <button className="btn-primario" onClick={() => avancarStatus(p)}>
                  {p.status === 'novo' ? `Aceitar` : `Avançar: ${LABEL[PROXIMOS[p.status]]}`}
                </button>
              )}
              {p.status === 'novo' && (
                <button className="btn-danger" onClick={() => recusar(p)}>Recusar</button>
              )}
              <button className="btn-mini" onClick={() => setEditandoId(p.id)}>Editar</button>
              <button className="btn-mini" onClick={() => cancelar(p)}>Cancelar</button>
            </div>
          </div>
        ))}
      </div>

      {editandoId != null && (
        <EditarPedido pedidoId={editandoId} onFechar={() => setEditandoId(null)} onSalvo={() => carregar()} />
      )}
    </div>
  )
}