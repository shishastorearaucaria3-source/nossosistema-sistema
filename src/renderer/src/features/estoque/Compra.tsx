import { useEffect, useMemo, useRef, useState } from 'react'
import { getDbApi, getEstoqueApi, getNfeApi } from '../../shared/db'
import PdvEstoque from './PdvEstoque'

interface ProdutoLite {
  id: number
  nome: string
  codigo_barras: string | null
  codigo_interno: string | null
  preco_custo: number
  preco_venda: number
  estoque: number
  unidade: string
}

interface ItemCompra {
  seq: number
  produto_id: number
  nome: string
  codigo: string
  quantidade: string
  preco: string
}

type Modo = 'menu' | 'manual' | 'xml' | 'emitir'

export default function CompraModal({
  usuarioId,
  onFechar,
  onConcluido
}: {
  usuarioId: number
  onFechar: () => void
  onConcluido: (msg: string) => void
}) {
  const [modo, setModo] = useState<Modo>('menu')

  const [fornecedores, setFornecedores] = useState<{ id: number; nome: string; cnpj: string | null }[]>([])
  const [fornecedorId, setFornecedorId] = useState('')
  const [mostrarNovoFornecedor, setMostrarNovoFornecedor] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoCnpj, setNovoCnpj] = useState('')

  const [busca, setBusca] = useState('')
  const [qtdNovo, setQtdNovo] = useState('1')
  const [resultados, setResultados] = useState<ProdutoLite[]>([])
  const [itens, setItens] = useState<ItemCompra[]>([])
  const seqRef = useRef(0)
  const buscaRef = useRef<HTMLInputElement>(null)
  const qtdNovoRef = useRef<HTMLInputElement>(null)
  const descontoRef = useRef<HTMLInputElement>(null)

  const [descontoPct, setDescontoPct] = useState('')
  const [obs, setObs] = useState('')
  const [documento, setDocumento] = useState('')

  const [mostrarTransporte, setMostrarTransporte] = useState(false)
  const [mostrarObs, setMostrarObs] = useState(false)
  const [transportadora, setTransportadora] = useState('')
  const [placa, setPlaca] = useState('')
  const [uf, setUf] = useState('')
  const [volumes, setVolumes] = useState('')
  const [peso, setPeso] = useState('')

  const [selIdx, setSelIdx] = useState<number | null>(null)
  const [erro, setErro] = useState('')
  const [gravando, setGravando] = useState(false)
  const [usuarioNome, setUsuarioNome] = useState('')

  // Ler XML
  const [xmlInfo, setXmlInfo] = useState<{ ok: boolean; arquivo?: string; conteudo?: string; erro?: string } | null>(null)

  useEffect(() => {
    getDbApi().all('SELECT id, nome, cnpj FROM fornecedores WHERE ativo = 1 ORDER BY nome').then((rows) => {
      setFornecedores(rows as unknown as { id: number; nome: string; cnpj: string | null }[])
    }).catch(() => {})
    getDbApi().get('SELECT nome FROM usuarios WHERE id = ?', [usuarioId]).then((u) => {
      if (u) setUsuarioNome((u as { nome: string }).nome)
    }).catch(() => {})
  }, [usuarioId])

  useEffect(() => {
    const termo = busca.trim()
    if (termo.length < 2) { setResultados([]); return }
    const t = setTimeout(() => {
      getDbApi()
        .all(
          `SELECT id, nome, codigo_barras, codigo_interno, preco_custo, preco_venda, estoque, unidade FROM produtos
           WHERE ativo = 1 AND (nome LIKE ? OR codigo_barras LIKE ? OR codigo_interno LIKE ?)
           ORDER BY nome LIMIT 8`,
          [`%${termo}%`, `%${termo}%`, `%${termo}%`]
        )
        .then((rows) => setResultados(rows as unknown as ProdutoLite[]))
        .catch(() => setResultados([]))
    }, 180)
    return () => clearTimeout(t)
  }, [busca])

  const adicionar = (p: ProdutoLite) => {
    seqRef.current += 1
    const qtd = Number(qtdNovo) > 0 ? String(qtdNovo).trim() : '1'
    setItens((prev) => [...prev, {
      seq: seqRef.current,
      produto_id: p.id,
      nome: p.nome,
      codigo: p.codigo_barras || '',
      quantidade: qtd,
      preco: p.preco_custo ? String(p.preco_custo) : ''
    }])
    setResultados([])
    setBusca('')
    setQtdNovo('1')
    buscaRef.current?.focus()
  }

  const subtotal = itens.reduce((s, i) => s + (Number(i.quantidade) || 0) * (Number(i.preco) || 0), 0)
  const desconto = (Number(descontoPct) || 0) > 0 ? subtotal * (Number(descontoPct) / 100) : 0
  const total = subtotal - desconto

  const limparNovoFornecedor = () => {
    setNovoNome('')
    setNovoCnpj('')
    setMostrarNovoFornecedor(false)
  }

  const salvarNovoFornecedor = async () => {
    setErro('')
    if (!novoNome.trim()) { setErro('Informe o nome do fornecedor.'); return }
    try {
      const r = await getDbApi().run('INSERT INTO fornecedores (nome, cnpj, ativo) VALUES (?, ?, 1)', [novoNome.trim(), novoCnpj.trim() || null])
      const id = r.lastInsertRowid
      setFornecedores((prev) => [...prev, { id, nome: novoNome.trim(), cnpj: novoCnpj.trim() || null }].sort((a, b) => a.nome.localeCompare(b.nome)))
      setFornecedorId(String(id))
      limparNovoFornecedor()
    } catch (e) {
      setErro(`Falha ao cadastrar fornecedor: ${(e as Error).message}`)
    }
  }

  const salvar = async () => {
    setErro('')
    if (itens.length === 0) { setErro('Adicione ao menos um produto.'); return }
    if (!fornecedorId) { setErro('Selecione o fornecedor (F5).'); return }
    const itensEnviar = itens.map((i) => ({
      produto_id: i.produto_id,
      quantidade: Number(i.quantidade),
      preco_custo: i.preco ? Number(i.preco) : null
    }))
    setGravando(true)
    try {
      const transporte = [transportadora.trim(), placa.trim() ? `Placa ${placa.trim()}` : '', uf.trim() ? `UF ${uf.trim()}` : '', volumes.trim() ? `${volumes.trim()} vol` : '', peso.trim() ? `${peso.trim()} kg` : ''].filter(Boolean).join(' · ')
      const r = await getEstoqueApi().movimentar({
        tipo: 'entrada',
        categoria: 'compra',
        itens: itensEnviar,
        fornecedor_id: Number(fornecedorId),
        documento: documento.trim() || undefined,
        motivo: obs.trim() || (transporte || undefined),
        origem: transporte || undefined,
        usuario_id: usuarioId
      })
      if (!r.ok) { setErro(r.erro || 'Falha ao registrar a compra.'); return }
      onConcluido(`Compra registrada (${r.documento}) — ${r.itens} item(ns), total R$ ${r.total.toFixed(2)}.`)
      onFechar()
    } catch (e) {
      setErro(`Erro: ${(e as Error).message}`)
    } finally {
      setGravando(false)
    }
  }

  const lerXml = async () => {
    setErro('')
    setXmlInfo(null)
    const r = await getNfeApi().lerXml()
    setXmlInfo(r)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modo !== 'manual') return
      if (e.key === 'F1') { e.preventDefault(); buscaRef.current?.focus() }
      else if (e.key === 'F3') { e.preventDefault(); descontoRef.current?.focus() }
      else if (e.key === 'F4') { e.preventDefault(); setMostrarObs((v) => !v) }
      else if (e.key === 'F5') { e.preventDefault(); setMostrarNovoFornecedor((v) => !v) }
      else if (e.key === 'F9') { e.preventDefault(); setMostrarTransporte((v) => !v) }
      else if (e.key === 'F10') { e.preventDefault(); if (selIdx != null) setModoEdicao() }
      else if (e.key === 'F12') { e.preventDefault(); qtdNovoRef.current?.focus() }
      else if (e.key === 'F2') { e.preventDefault(); if (itens.length > 0 && fornecedorId) salvar() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, itens, fornecedorId, selIdx])

  const setModoEdicao = () => {
    if (selIdx == null) return
    const el = document.querySelector<HTMLInputElement>(`[data-compra-qtd="${selIdx}"]`)
    el?.focus()
    el?.select()
  }

  const selecionarResultado = () => {
    if (resultados.length > 0) adicionar(resultados[0])
  }

  const formato = useMemo(() => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [])

  if (modo === 'manual') {
    return (
      <PdvEstoque
        usuarioId={usuarioId}
        tipo="entrada"
        categoria="compra"
        onFechar={onFechar}
        onConcluido={onConcluido}
      />
    )
  }

  return (
    <div className="modal-overlay" onClick={() => !gravando && onFechar()}>
      <div className="modal modal-estoque" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <h3>Compra{modo === 'xml' ? ' — Ler XML' : modo === 'emitir' ? ' — Emitir NF-e de Compra' : ''}</h3>
          <button className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="compra-corpo">
          {modo === 'menu' && (
            <div className="compra-modo">
              <button className="compra-modo-card" onClick={() => setModo('manual')}>
                <span className="compra-modo-badge">Manual</span>
                <strong>Entrada Manual</strong>
                <small>Lançamento de estoque por produtos, fornecedor e valores</small>
              </button>
              <button className="compra-modo-card" onClick={() => setModo('xml')}>
                <span className="compra-modo-badge">XML</span>
                <strong>Ler XML</strong>
                <small>Importar os dados da nota a partir do XML da NF-e</small>
              </button>
              <button className="compra-modo-card" onClick={() => setModo('emitir')}>
                <span className="compra-modo-badge">NF-e</span>
                <strong>Emitir NF-e de compra</strong>
                <small>Emitir nota fiscal eletrônica da compra</small>
              </button>
            </div>
          )}

          {modo === 'xml' && (
            <div className="compra-xml">
              <p className="compra-os">Importar dados da nota a partir do XML da NF-e.</p>
              <button className="btn-primario" onClick={lerXml}>Selecionar arquivo XML</button>
              {!xmlInfo && <p className="sem-resultado">Clique em "Selecionar arquivo XML" para escolher o arquivo.</p>}
              {xmlInfo && xmlInfo.ok && xmlInfo.conteudo && (
                <div className="compra-xml-resultado">
                  <p>Arquivo: <b>{xmlInfo.arquivo}</b></p>
                  <textarea readOnly value={xmlInfo.conteudo} rows={10} className="compra-xml-conteudo" />
                  <p className="aviso">
                    Estrutura de leitura do XML implementada. A extração automática de itens/valores
                    a partir do XML será disponibilizada na próxima etapa do módulo fiscal.
                  </p>
                  <button className="btn-secundario" onClick={() => { setModo('manual'); setXmlInfo(null) }}>Ir para Entrada Manual</button>
                </div>
              )}
              {xmlInfo && !xmlInfo.ok && <p className="mensagem" style={{ color: '#dc2626' }}>{xmlInfo.erro || 'Não foi possível ler o arquivo.'}</p>}
            </div>
          )}

          {modo === 'emitir' && (
            <div className="compra-emitir">
              <p className="compra-os">Emissão de NF-e de compra</p>
              <div className="compra-grid">
                <label className="config-campo">Fornecedor
                  <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                    <option value="">— selecione —</option>
                    {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                </label>
                <label className="config-campo">Número
                  <input value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="Número da nota" />
                </label>
              </div>
              <p className="aviso">
                A emissão de NF-e junto à SEFAZ requer certificado digital e configuração do módulo
                fiscal. Esta tela é a estrutura para o lançamento da nota emitida.
              </p>
              <button className="btn-primario" disabled title="Emissão pela SEFAZ será habilitada quando o módulo fiscal estiver configurado">Emitir NF-e</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
