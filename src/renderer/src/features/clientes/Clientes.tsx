import { useEffect, useState, useCallback, useRef } from 'react'
import { getDbApi, dataUrlImagem } from '../../shared/db'

interface Cliente {
  id: number
  codigo: string | null
  nome: string
  telefone: string | null
  celular: string | null
  cpf: string | null
  cnpj: string | null
  rg: string | null
  genero: string | null
  email: string | null
  endereco: string | null
  numero: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  pai: string | null
  mae: string | null
  ultima_visita: string | null
  fid_total: number
  tem_credito: number
  valor_cred: number
  aniversario: string | null
  data_nascimento: string | null
  pontos: number
  fiado_limite: number
  debito: number
  empresa: number
  observacoes: string | null
  info_extras: string | null
  vip: number
  categoria_compra: string
  categoria_id: number | null
  categoria_nome: string | null
}

export type { Cliente }

interface ClienteEndereco {
  id?: number
  rotulo?: string
  endereco?: string
  numero?: string
  complemento?: string
  bairro?: string
  cidade?: string
  uf?: string
  cep?: string
  principal?: boolean
}

interface CategoriaCliente {
  id: number
  nome: string
}

const COLUNAS_DISPONIVEIS: { chave: string; label: string }[] = [
  { chave: 'codigo', label: 'Código' },
  { chave: 'nome', label: 'Nome' },
  { chave: 'categoria', label: 'Categoria' },
  { chave: 'tipo_compra', label: 'Compra' },
  { chave: 'vip', label: 'VIP' },
  { chave: 'documento', label: 'CPF/CNPJ' },
  { chave: 'contato', label: 'Celular' },
  { chave: 'telefone', label: 'Telefone' },
  { chave: 'email', label: 'Email' },
  { chave: 'endereco', label: 'Endereço' },
  { chave: 'aniversario', label: 'Nascimento' },
  { chave: 'genero', label: 'Gênero' },
  { chave: 'compras', label: 'Compras' },
  { chave: 'ultima_compra', label: 'Última compra' },
  { chave: 'fiado', label: 'Fiado' }
]

const COLUNAS_PADRAO: Record<string, boolean> = {
  codigo: true, nome: true, categoria: true, tipo_compra: true, vip: true,
  documento: true, contato: true, telefone: false, email: true, endereco: false,
  aniversario: true, genero: false, compras: true, ultima_compra: true, fiado: true
}

const enderecoVazio = (): ClienteEndereco => ({ rotulo: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '', principal: false })

const clienteVazio = {
  codigo: '', nome: '', telefone: '', celular: '', cpf: '', cnpj: '', rg: '',
  genero: '', email: '', endereco: '', numero: '', bairro: '', cidade: '', uf: '', cep: '',
  pai: '', mae: '', data_nascimento: '', pontos: 0, fid_total: 0,
  fiado_limite: '', categoria_id: '', empresa: false, observacoes: '',
  info_extras: '', vip: false, categoria_compra: 'varejo', tem_credito: false, valor_cred: ''
}
const enderecosIniciais = (): ClienteEndereco[] => [enderecoVazio()]

export default function Clientes({ onSelecionar, onFechar, pedirConfig }: { onSelecionar?: (c: Cliente) => void; onFechar?: () => void; pedirConfig?: number }) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [categorias, setCategorias] = useState<CategoriaCliente[]>([])
  const [busca, setBusca] = useState('')
  const [filtroCat, setFiltroCat] = useState('')
  const [form, setForm] = useState({ ...clienteVazio })
  const [enderecos, setEnderecos] = useState<ClienteEndereco[]>(enderecosIniciais())
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [formAberto, setFormAberto] = useState(false)
  const [modo, setModo] = useState<'novo' | 'editar' | 'ver'>('novo')
  const [mensagem, setMensagem] = useState('')
  const [gerenciarCats, setGerenciarCats] = useState(false)
  const [novaCat, setNovaCat] = useState('')
  const [fotoBase64, setFotoBase64] = useState<string | null>(null)
  const fotoInputRef = useRef<HTMLInputElement>(null)
  const [abaDetalhe, setAbaDetalhe] = useState<'fidelidade' | 'transacoes'>('fidelidade')
  const [transacoes, setTransacoes] = useState<{ numero: string; data: string; total: number }[]>([])
  const [ultimaCompra, setUltimaCompra] = useState<{ numero: string; total: number; data: string } | null>(null)
  const [digitosCodigo, setDigitosCodigo] = useState(() => Number(localStorage.getItem('clientes_digitos_codigo')) || 6)
  const [codigoAutomatico, setCodigoAutomatico] = useState(true)
  const [modalConfig, setModalConfig] = useState(false)
  const ultimoPedirConfig = useRef(pedirConfig ?? 0)
  useEffect(() => {
    if ((pedirConfig ?? 0) > ultimoPedirConfig.current) {
      setModalConfig(true)
      ultimoPedirConfig.current = pedirConfig ?? 0
    }
  }, [pedirConfig])
  const [proximoCodigo, setProximoCodigo] = useState('')

  const [menuColunas, setMenuColunas] = useState(false)
  const [colunasAtivas, setColunasAtivas] = useState<Record<string, boolean>>(() => {
    try {
      const s = localStorage.getItem('clientes_colunas')
      if (s) return JSON.parse(s)
    } catch { /* ignore */ }
    return { ...COLUNAS_PADRAO }
  })
  const [larguras, setLarguras] = useState<Record<string, number>>(() => {
    try {
      const s = localStorage.getItem('clientes_larguras')
      return s ? JSON.parse(s) : {}
    } catch { return {} }
  })
  const [redim, setRedim] = useState<{ chave: string; startX: number; startW: number } | null>(null)
  const wrapClientesRef = useRef<HTMLDivElement>(null)
  const scrollbarClientesRef = useRef<HTMLDivElement>(null)
  const sincronizarScrollbarClientes = () => {
    const wrap = wrapClientesRef.current
    const sb = scrollbarClientesRef.current
    if (!wrap || !sb) return
    const temScroll = wrap.scrollWidth > wrap.clientWidth
    sb.style.display = temScroll ? 'block' : 'none'
    if (temScroll) {
      const fill = sb.querySelector('.tabela-scrollbar-fixo-fill') as HTMLElement | null
      if (fill) fill.style.width = `${wrap.scrollWidth}px`
      sb.scrollLeft = wrap.scrollLeft
    }
  }
  const onScrollbarClientes = () => {
    const wrap = wrapClientesRef.current
    const sb = scrollbarClientesRef.current
    if (wrap && sb) wrap.scrollLeft = sb.scrollLeft
  }

  const carregar = useCallback(async () => {
    const db = getDbApi()
    const rows = (await db.all(
      `SELECT c.*, cc.nome AS categoria_nome FROM clientes c
       LEFT JOIN categorias_clientes cc ON cc.id = c.categoria_id
       WHERE (c.nome LIKE ? OR c.cpf LIKE ? OR c.cnpj LIKE ? OR c.codigo LIKE ? OR c.telefone LIKE ? OR c.celular LIKE ? OR ? = '')
         AND (? = '' OR c.categoria_id = ?)
       ORDER BY c.nome`,
      [`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`, busca, filtroCat, filtroCat || 0]
    )) as unknown as Cliente[]
    setClientes(rows)
    const cats = (await db.all(`SELECT id, nome FROM categorias_clientes ORDER BY nome`)) as unknown as CategoriaCliente[]
    setCategorias(cats)
  }, [busca, filtroCat])

  useEffect(() => { carregar() }, [carregar])

  const colunasVisiveis = COLUNAS_DISPONIVEIS.filter((c) => colunasAtivas[c.chave] !== false)

  useEffect(() => {
    const t = setTimeout(() => sincronizarScrollbarClientes(), 200)
    return () => clearTimeout(t)
  }, [clientes.length, colunasVisiveis.length])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!redim) return
      const nova = Math.max(60, redim.startW + (e.clientX - redim.startX))
      setLarguras((prev) => {
        const novo = { ...prev, [redim.chave]: nova }
        try { localStorage.setItem('clientes_larguras', JSON.stringify(novo)) } catch { /* ignore */ }
        return novo
      })
    }
    const onUp = () => setRedim(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [redim])

  const abrirNovo = () => {
    setForm({ ...clienteVazio })
    setEnderecos(enderecosIniciais())
    setEditandoId(null)
    setModo('novo')
    setFotoBase64(null)
    setFormAberto(true)
    setMensagem('')
    atualizarProximoCodigoCliente()
  }

  const abrirEdicao = (c: Cliente) => {
    setForm({
      codigo: c.codigo ?? '', nome: c.nome, telefone: c.telefone ?? '', celular: c.celular ?? '',
      cpf: c.cpf ?? '', cnpj: c.cnpj ?? '', rg: c.rg ?? '', genero: c.genero ?? '',
      email: c.email ?? '', endereco: c.endereco ?? '', numero: c.numero ?? '', bairro: c.bairro ?? '',
      cidade: c.cidade ?? '', uf: c.uf ?? '', cep: c.cep ?? '', pai: c.pai ?? '', mae: c.mae ?? '',
      data_nascimento: c.data_nascimento ?? c.aniversario ?? '',
      pontos: c.pontos, fid_total: c.fid_total, fiado_limite: String(c.fiado_limite), categoria_id: c.categoria_id ? String(c.categoria_id) : '',
      empresa: !!c.empresa, observacoes: c.observacoes ?? '', info_extras: c.info_extras ?? '',
      vip: !!c.vip, categoria_compra: c.categoria_compra || 'varejo', tem_credito: !!c.tem_credito,
      valor_cred: String(c.valor_cred)
    })
    setEditandoId(c.id)
    setModo('editar')
    setFormAberto(true)
    setMensagem('')
    carregarFoto(c.id)
    carregarEnderecos(c.id)
  }

  const carregarEnderecos = async (id: number) => {
    const rows = (await getDbApi().all(
      `SELECT * FROM clientes_enderecos WHERE cliente_id = ? ORDER BY principal DESC, id`
    )) as unknown as ClienteEndereco[]
    const lista = rows.length
      ? rows.map((r) => ({ ...r, principal: !!r.principal }))
      : enderecosIniciais()
    setEnderecos(lista)
  }

  const abrirVer = async (c: Cliente) => {
    setEditandoId(c.id)
    setModo('ver')
    setFormAberto(true)
    setAbaDetalhe('fidelidade')
    setMensagem('')
    carregarFoto(c.id)
    carregarEnderecos(c.id)
    const db = getDbApi()
    const vendas = (await db.all(
      `SELECT numero, total, created_at AS data FROM vendas WHERE cliente_id = ? AND status != 'cancelada' ORDER BY created_at DESC LIMIT 30`,
      [c.id]
    )) as unknown as { numero: string; total: number; data: string }[]
    setTransacoes(vendas)
    setUltimaCompra(vendas[0] ?? null)
  }

  const carregarFoto = async (id: number) => {
    const r = (await getDbApi().get(`SELECT foto FROM clientes WHERE id = ?`, [id])) as { foto: Uint8Array | null } | undefined
    setFotoBase64(r?.foto && r.foto.length ? Buffer.from(r.foto).toString('base64') : null)
  }

  const onFotoSelecionada = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setFotoBase64(String(reader.result).split(',')[1])
    reader.readAsDataURL(f)
  }

  const obterProximoCodigoCliente = async (db: ReturnType<typeof getDbApi>) => {
    const maxRow = (await db.get(
      `SELECT COALESCE(MAX(CAST(codigo AS INTEGER)), 0) AS m FROM clientes WHERE codigo GLOB '[0-9]*'`
    )) as { m: number } | undefined
    const seqRow = (await db.get(`SELECT valor FROM sequencias WHERE chave = 'cliente_codigo'`)) as { valor: number } | undefined
    const base = Math.max(Number(maxRow?.m ?? 0), Number(seqRow?.valor ?? 0))
    await db.run(`INSERT OR IGNORE INTO sequencias (chave, valor) VALUES ('cliente_codigo', ?)`, [base])
    await db.run(`UPDATE sequencias SET valor = valor + 1 WHERE chave = 'cliente_codigo'`)
    const novo = (await db.get(`SELECT valor FROM sequencias WHERE chave = 'cliente_codigo'`)) as { valor: number }
    const digitos = Math.max(1, Math.min(30, digitosCodigo))
    return String(Number(novo.valor)).padStart(digitos, '0')
  }

  const atualizarProximoCodigoCliente = async () => {
    const db = getDbApi()
    const maxRow = (await db.get(
      `SELECT COALESCE(MAX(CAST(codigo AS INTEGER)), 0) AS m FROM clientes WHERE codigo GLOB '[0-9]*'`
    )) as { m: number } | undefined
    const seqRow = (await db.get(`SELECT valor FROM sequencias WHERE chave = 'cliente_codigo'`)) as { valor: number } | undefined
    const base = Math.max(Number(maxRow?.m ?? 0), Number(seqRow?.valor ?? 0))
    const digitos = Math.max(1, Math.min(30, digitosCodigo))
    setProximoCodigo(String(base + 1).padStart(digitos, '0'))
  }

  const salvar = async () => {
    if (!form.nome.trim()) {
      setMensagem('Informe o nome do cliente.')
      return
    }
    const db = getDbApi()
    const foto = fotoBase64 ? Buffer.from(fotoBase64, 'base64') : null
    let codigo = form.codigo.trim()
    if (!codigo && codigoAutomatico) {
      codigo = await obterProximoCodigoCliente(db)
    }
    const params: unknown[] = [
      codigo || null, form.nome.trim(),
      form.empresa ? form.cnpj.trim() || null : form.cpf.trim() || null,
      form.rg.trim() || null, form.telefone.trim() || null, form.celular.trim() || null,
      form.email.trim() || null, form.endereco.trim() || null, form.numero.trim() || null,
      form.bairro.trim() || null, form.cidade.trim() || null, form.uf.trim() || null, form.cep.trim() || null,
      form.pai.trim() || null, form.mae.trim() || null,
      form.data_nascimento.trim() || null, form.genero.trim() || null,
      Number(form.fiado_limite) || 0, Number(form.fid_total) || 0,
      form.categoria_id ? Number(form.categoria_id) : null,
      form.empresa ? 1 : 0, form.observacoes.trim() || null, form.info_extras.trim() || null,
      form.vip ? 1 : 0, form.categoria_compra, form.tem_credito ? 1 : 0, Number(form.valor_cred) || 0, foto
    ]
    if (editandoId) {
      await db.run(
        `UPDATE clientes
         SET codigo=?, nome=?, cpf=?, rg=?, telefone=?, celular=?, email=?, endereco=?, numero=?, bairro=?, cidade=?, uf=?, cep=?,
             pai=?, mae=?, data_nascimento=?, genero=?, fiado_limite=?, fid_total=?, categoria_id=?, empresa=?, observacoes=?,
             info_extras=?, vip=?, categoria_compra=?, tem_credito=?, valor_cred=?, foto=?
         WHERE id=?`,
        [...params, editandoId]
      )
      await salvarEnderecos(db, editandoId)
      setMensagem('Cliente atualizado!')
    } else {
      const r = await db.run(
        `INSERT INTO clientes (codigo, nome, cpf, rg, telefone, celular, email, endereco, numero, bairro, cidade, uf, cep, pai, mae,
           data_nascimento, genero, fiado_limite, fid_total, categoria_id, empresa, observacoes, info_extras, vip, categoria_compra, tem_credito, valor_cred, foto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      )
      await salvarEnderecos(db, Number(r.lastInsertRowid))
      setMensagem('Cliente cadastrado!')
    }
    setFormAberto(false)
    carregar()
  }

  const salvarEnderecos = async (db: ReturnType<typeof getDbApi>, clienteId: number) => {
    const validos = enderecos.filter((e) => e.endereco?.trim() || e.complemento?.trim())
    if (validos.length === 0) {
      await db.run(`DELETE FROM clientes_enderecos WHERE cliente_id = ?`, [clienteId])
      return
    }
    const principal = validos.find((e) => e.principal) ?? validos[0]
    await db.run(`UPDATE clientes SET endereco=?, numero=?, bairro=?, cidade=?, uf=?, cep=? WHERE id=?`, [
      principal.endereco?.trim() || null,
      principal.numero?.trim() || null,
      principal.bairro?.trim() || null,
      principal.cidade?.trim() || null,
      principal.uf?.trim() || null,
      principal.cep?.trim() || null,
      clienteId
    ])
    await db.run(`DELETE FROM clientes_enderecos WHERE cliente_id = ?`, [clienteId])
    for (const e of validos) {
      await db.run(
        `INSERT INTO clientes_enderecos (cliente_id, rotulo, endereco, numero, complemento, bairro, cidade, uf, cep, principal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          clienteId,
          e.rotulo?.trim() || null,
          e.endereco?.trim() || null,
          e.numero?.trim() || null,
          e.complemento?.trim() || null,
          e.bairro?.trim() || null,
          e.cidade?.trim() || null,
          e.uf?.trim() || null,
          e.cep?.trim() || null,
          e === principal ? 1 : 0
        ]
      )
    }
  }

  const registrarPagamento = async (c: Cliente) => {
    const valor = Number(prompt(`Quanto ${c.nome} vai pagar do fiado (débito atual R$ ${c.debito.toFixed(2)})?`) ?? 0)
    if (valor <= 0 || valor > c.debito) { setMensagem('Valor inválido.'); return }
    await getDbApi().run(`UPDATE clientes SET debito = debito - ? WHERE id = ?`, [valor, c.id])
    setMensagem('Pagamento registrado!')
    carregar()
  }

  const adicionarCategoria = async () => {
    if (!novaCat.trim()) return
    await getDbApi().run(`INSERT INTO categorias_clientes (nome) VALUES (?)`, [novaCat.trim()])
    setNovaCat('')
    carregar()
  }

  const removerCategoria = async (id: number) => {
    await getDbApi().run(`UPDATE clientes SET categoria_id = NULL WHERE categoria_id = ?`, [id])
    await getDbApi().run(`DELETE FROM categorias_clientes WHERE id = ?`, [id])
    carregar()
  }

  const fmtData = (dt: string | null) => (dt ? dt.slice(0, 10).split('-').reverse().join('/') : '-')

  const atualizarEndereco = (i: number, campo: keyof ClienteEndereco, valor: string | boolean) => {
    setEnderecos((prev) => prev.map((e, idx) => (idx === i ? { ...e, [campo]: valor } : e)))
  }
  const setPrincipalEndereco = (i: number) => {
    setEnderecos((prev) => prev.map((e, idx) => ({ ...e, principal: idx === i })))
  }
  const adicionarEndereco = () => setEnderecos((prev) => [...prev, enderecoVazio()])
  const removerEndereco = (i: number) => setEnderecos((prev) => prev.filter((_, idx) => idx !== i))

  const fmtEndereco = (e: ClienteEndereco) =>
    [e.endereco, e.numero ? `Nº ${e.numero}` : '', e.complemento, e.bairro, e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ''}` : '', e.cep].filter(Boolean).join(', ')

  const alternarColuna = (chave: string) => {
    const novo = { ...colunasAtivas, [chave]: !colunasAtivas[chave] }
    setColunasAtivas(novo)
    try { localStorage.setItem('clientes_colunas', JSON.stringify(novo)) } catch { /* ignore */ }
  }

  const iniciarRedim = (chave: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setRedim({ chave, startX: e.clientX, startW: (e.currentTarget as HTMLElement).parentElement?.offsetWidth ?? 100 })
  }

  const celula = (c: Cliente, chave: string) => {
    switch (chave) {
      case 'codigo': return c.codigo ?? '-'
      case 'nome': return c.nome
      case 'categoria': return c.categoria_nome ?? '-'
      case 'tipo_compra': return c.categoria_compra === 'atacado1' ? 'Atacado 1' : c.categoria_compra === 'atacado2' ? 'Atacado 2' : 'Varejo'
      case 'vip': return c.vip ? '★ VIP' : '-'
      case 'documento': return (c.empresa ? c.cnpj : c.cpf) ?? '-'
      case 'contato': return c.celular ?? '-'
      case 'telefone': return c.telefone ?? '-'
      case 'email': return c.email ?? '-'
      case 'endereco': return c.endereco ?? '-'
      case 'aniversario': return fmtData(c.data_nascimento ?? c.aniversario)
      case 'genero': return c.genero ?? '-'
      case 'compras': return '—'
      case 'ultima_compra': return '—'
      case 'fiado': return c.debito > 0 ? `R$ ${c.debito.toFixed(2)}` : 'em dia'
      default: return '-'
    }
  }

  const verClienteSelecionado = editandoId && clientes.some((c) => c.id === editandoId) ? clientes.find((c) => c.id === editandoId)! : null

  return (
    <div className="page">
      <div className="page-header">
        <h2>Clientes</h2>
        <div className="page-acoes">
          {onFechar && <button className="btn-secundario" onClick={onFechar}>← Voltar ao PDV</button>}
          <input className="busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar por nome, CPF, código..." />
          <select className="pedido-config-select" value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categorias.map((c) => <option key={c.id} value={String(c.id)}>{c.nome}</option>)}
          </select>
          <button className="btn-secundario" onClick={() => setGerenciarCats(true)}>Categorias</button>
          <button className="btn-primario" onClick={abrirNovo}>+ Novo Cliente</button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {gerenciarCats && (
        <div className="modal-overlay" onClick={() => setGerenciarCats(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Categorias de clientes</h3>
            <div className="form-grid">
              <label style={{ gridColumn: '1 / -1' }}>Nova categoria
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={novaCat} onChange={(e) => setNovaCat(e.target.value)} placeholder="Nome da categoria" />
                  <button className="btn-primario" onClick={adicionarCategoria}>Adicionar</button>
                </div>
              </label>
            </div>
            <div className="config-pdv-lista">
              {categorias.map((c) => (
                <div key={c.id} className="config-pdv-item">
                  <div className="config-pdv-info"><strong>{c.nome}</strong></div>
                  <button className="btn-mini" onClick={() => removerCategoria(c.id)}>Remover</button>
                </div>
              ))}
            </div>
            <div className="modal-acoes"><button className="btn-primario" onClick={() => setGerenciarCats(false)}>Fechar</button></div>
          </div>
        </div>
      )}

      {modalConfig && (
        <div className="modal-overlay" onClick={() => setModalConfig(false)}>
          <div className="modal modal-tela-cheia" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Configuração de código do cliente</h3>
              <button className="modal-fechar" onClick={() => setModalConfig(false)} aria-label="Fechar">✕</button>
            </div>
            <div className="modal-corpo">
              <div className="config-pdv-lista">
                <div className="config-pdv-item">
                  <div className="config-pdv-info">
                    <strong>Dígitos do código do cliente</strong>
                    <span>Os códigos gerados automaticamente terão entre 1 e 30 dígitos. Padrão: 6.</span>
                  </div>
                  <div className="produto-digitos-codigo">
                    <button onClick={() => setDigitosCodigo((v) => Math.min(30, v + 1))}>+</button>
                    <strong>{digitosCodigo} dígitos</strong>
                    <button onClick={() => setDigitosCodigo((v) => Math.max(1, v - 1))}>−</button>
                  </div>
                </div>
                <div className="config-pdv-item">
                  <div className="config-pdv-info">
                    <strong>Gerar código automaticamente</strong>
                    <span>Atribui o próximo código sequencial quando o campo ficar vazio.</span>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={codigoAutomatico} onChange={(e) => setCodigoAutomatico(e.target.checked)} />
                    <span className="slider" />
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-rodape">
              <div className="modal-acoes-direita">
                <button className="btn-secundario" onClick={() => setModalConfig(false)}>Cancelar</button>
                <button className="btn-primario" onClick={() => {
                  localStorage.setItem('clientes_digitos_codigo', String(digitosCodigo))
                  setModalConfig(false)
                  atualizarProximoCodigoCliente()
                  setMensagem('Configuração de código salva.')
                }}>Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rel-cabecalho">
        <div className="dropdown-filtro">
          <button className="btn-secundario dropdown-periodo-btn" onClick={() => setMenuColunas((v) => !v)}>Colunas ⋯</button>
          {menuColunas && (
            <div className="dropdown-colunas-menu">
              <div className="dropdown-colunas-titulo">Colunas da tabela</div>
              {COLUNAS_DISPONIVEIS.map((c) => (
                <label key={c.chave} className="dropdown-colunas-item">
                  <input type="checkbox" checked={colunasAtivas[c.chave] !== false} onChange={() => alternarColuna(c.chave)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="tabela-wrap" ref={wrapClientesRef} onScroll={sincronizarScrollbarClientes}>
        <table className="tabela tabela-clientes">
          <thead>
            <tr>
              <th className="th-acao-fixa">Ações</th>
              {colunasVisiveis.map((col) => (
                <th key={col.chave} className="th-ordena" style={larguras[col.chave] ? { width: larguras[col.chave] } : undefined}>
                  {col.label}
                  <span className="col-resizer" onMouseDown={(e) => iniciarRedim(col.chave, e)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} className="caixa-linha">
                <td className="td-acoes">
                  <button className="btn-mini" onClick={() => abrirVer(c)}>Ver</button>
                  <button className="btn-mini" onClick={() => abrirEdicao(c)}>Editar</button>
                  {c.debito > 0 && <button className="btn-mini" onClick={() => registrarPagamento(c)}>Receber</button>}
                  {onSelecionar && <button className="btn-mini btn-primario" onClick={() => onSelecionar(c)}>Selecionar</button>}
                </td>
                {colunasVisiveis.map((col) => <td key={col.chave}>{celula(c, col.chave)}</td>)}
              </tr>
            ))}
            {clientes.length === 0 && <tr><td colSpan={colunasVisiveis.length + 1} className="sem-resultado">Nenhum cliente cadastrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="tabela-scrollbar-fixo" ref={scrollbarClientesRef} onScroll={onScrollbarClientes}>
        <div className="tabela-scrollbar-fixo-fill" />
      </div>

      {formAberto && (
        <div className="modal-overlay" onClick={() => setFormAberto(false)}>
          <div className="modal modal-cliente" onClick={(e) => e.stopPropagation()}>
            {modo === 'ver' && verClienteSelecionado ? (
              <>
                <div className="cliente-perfil-topo">
                  <div className="cliente-foto-round" onClick={() => fotoInputRef.current?.click()}>
                    {fotoBase64 ? <img src={dataUrlImagem(fotoBase64)} alt="" /> : <span>📷</span>}
                  </div>
                  <div className="cliente-perfil-info">
                    <h3>{verClienteSelecionado.nome}</h3>
                    <div className="cliente-badges">
                      {verClienteSelecionado.vip ? <span className="badge-vip">★ VIP</span> : <span className="badge-normal">Comum</span>}
                      <span className="badge-compra">{verClienteSelecionado.categoria_compra === 'atacado1' ? 'Atacado 1' : verClienteSelecionado.categoria_compra === 'atacado2' ? 'Atacado 2' : 'Varejo'}</span>
                      <span className="badge-cat">{verClienteSelecionado.categoria_nome ?? 'Sem categoria'}</span>
                    </div>
                    <div className="cliente-acoes-topo">
                      <button className="btn-mini" onClick={() => abrirEdicao(verClienteSelecionado)}>Editar</button>
                      <button className="btn-mini" onClick={() => setFormAberto(false)}>Fechar</button>
                    </div>
                  </div>
                </div>
                <div className="cliente-categoria-compra">
                  <span>Categoria de compra:</span>
                  <div className="segmented">
                    <button className={verClienteSelecionado.categoria_compra === 'varejo' ? 'ativo' : ''} onClick={async () => { await getDbApi().run(`UPDATE clientes SET categoria_compra = 'varejo' WHERE id = ?`, [verClienteSelecionado.id]); carregar(); abrirVer(verClienteSelecionado) }}>Varejo</button>
                    <button className={verClienteSelecionado.categoria_compra === 'atacado1' ? 'ativo' : ''} onClick={async () => { await getDbApi().run(`UPDATE clientes SET categoria_compra = 'atacado1' WHERE id = ?`, [verClienteSelecionado.id]); carregar(); abrirVer(verClienteSelecionado) }}>Atacado 1</button>
                    <button className={verClienteSelecionado.categoria_compra === 'atacado2' ? 'ativo' : ''} onClick={async () => { await getDbApi().run(`UPDATE clientes SET categoria_compra = 'atacado2' WHERE id = ?`, [verClienteSelecionado.id]); carregar(); abrirVer(verClienteSelecionado) }}>Atacado 2</button>
                  </div>
                </div>
                <div className="abas-vendas">
                  <button className={`aba ${abaDetalhe === 'fidelidade' ? 'ativa' : ''}`} onClick={() => setAbaDetalhe('fidelidade')}>Fidelidade</button>
                  <button className={`aba ${abaDetalhe === 'transacoes' ? 'ativa' : ''}`} onClick={() => setAbaDetalhe('transacoes')}>Transações</button>
                </div>
                {abaDetalhe === 'fidelidade' && (
                  <div className="modal-resumo">
                    <div className="linha"><span>Última compra</span>
                      {ultimaCompra ? <strong>{fmtData(ultimaCompra.data)} • R$ {ultimaCompra.total.toFixed(2)}</strong> : <span>—</span>}
                    </div>
                    <div className="linha"><span>Última visita</span><span>{fmtData(verClienteSelecionado.ultima_visita)}</span></div>
                    <div className="linha"><span>Pontos de fidelidade</span><strong>{verClienteSelecionado.pontos}</strong></div>
                    <div className="linha"><span>Fidelidade total</span><strong>R$ {verClienteSelecionado.fid_total.toFixed(2)}</strong></div>
                    <div className="linha"><span>Total em compras</span><span>—</span></div>
                    <div className="linha"><span>Débito fiado</span><strong className={verClienteSelecionado.debito > 0 ? 'texto-vermelho' : ''}>R$ {verClienteSelecionado.debito.toFixed(2)}</strong></div>
                    <div className="linha"><span>Limite fiado</span><span>R$ {verClienteSelecionado.fiado_limite.toFixed(2)}</span></div>
                    <div className="linha"><span>Crédito</span>
                      <strong className={verClienteSelecionado.tem_credito ? 'texto-verde' : ''}>
                        {verClienteSelecionado.tem_credito ? `R$ ${verClienteSelecionado.valor_cred.toFixed(2)}` : 'Não possui'}
                      </strong>
                    </div>
                  </div>
                )}
                {abaDetalhe === 'transacoes' && (
                  <div className="tabela-wrap" style={{ maxHeight: 260 }}>
                    <table className="tabela">
                      <thead><tr><th>Venda</th><th>Data</th><th>Total</th></tr></thead>
                      <tbody>
                        {transacoes.map((t, i) => <tr key={i}><td>{t.numero}</td><td>{fmtData(t.data)}</td><td>R$ {t.total.toFixed(2)}</td></tr>)}
                        {transacoes.length === 0 && <tr><td colSpan={3} className="sem-resultado">Sem compras registradas.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="cliente-info-geral">
                  <div className="linha"><span>Código</span><span>{verClienteSelecionado.codigo ?? '-'}</span></div>
                  <div className="linha"><span>Documento</span><span>{verClienteSelecionado.empresa ? verClienteSelecionado.cnpj ?? '-' : verClienteSelecionado.cpf ?? '-'}</span></div>
                  <div className="linha"><span>RG</span><span>{verClienteSelecionado.rg ?? '-'}</span></div>
                  <div className="linha"><span>Celular</span><span>{verClienteSelecionado.celular ?? '-'}</span></div>
                  <div className="linha"><span>Telefone</span><span>{verClienteSelecionado.telefone ?? '-'}</span></div>
                  <div className="linha"><span>Email</span><span>{verClienteSelecionado.email ?? '-'}</span></div>
                  <div className="linha"><span>Endereço</span>
                    <span className="cliente-enderecos-lista">
                      {enderecos.filter((e) => e.endereco?.trim() || e.complemento?.trim()).map((e, i) => (
                        <div key={i}>{e.principal ? '★ ' : ''}{[e.rotulo, fmtEndereco(e)].filter(Boolean).join(' — ') || '—'}</div>
                      ))}
                      {enderecos.length === 0 && <span>—</span>}
                    </span>
                  </div>
                  <div className="linha"><span>Nascimento</span><span>{fmtData(verClienteSelecionado.data_nascimento ?? verClienteSelecionado.aniversario)}</span></div>
                  <div className="linha"><span>Gênero</span><span>{verClienteSelecionado.genero ?? '-'}</span></div>
                  <div className="linha"><span>Pai</span><span>{verClienteSelecionado.pai ?? '-'}</span></div>
                  <div className="linha"><span>Mãe</span><span>{verClienteSelecionado.mae ?? '-'}</span></div>
                  <div className="linha"><span>Tipo</span><span>{verClienteSelecionado.empresa ? 'Empresa' : 'Pessoa física'}</span></div>
                  <div className="linha"><span>Observações</span><span>{verClienteSelecionado.observacoes ?? '-'}</span></div>
                  <div className="linha"><span>Informações extras</span><span>{verClienteSelecionado.info_extras ?? '-'}</span></div>
                </div>
              </>
            ) : (
              <>
                <h3>{modo === 'editar' ? 'Editar Cliente' : 'Novo Cliente'}</h3>
                <div className="cliente-foto-round" onClick={() => fotoInputRef.current?.click()} style={{ margin: '0 auto 12px' }}>
                  {fotoBase64 ? <img src={dataUrlImagem(fotoBase64)} alt="" /> : <span>📷</span>}
                </div>
                <input ref={fotoInputRef} type="file" accept="image/*" hidden onChange={onFotoSelecionada} />
                <div className="form-grid">
                  <label>Código
                    {form.codigo || (codigoAutomatico && modo === 'novo' && proximoCodigo) ? (
                      <input value={form.codigo || (modo === 'novo' ? proximoCodigo : '')} disabled onChange={() => {}} />
                    ) : (
                      <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="Digite ou deixe gerar" />
                    )}
                    {modo === 'novo' && (
                      <small className="nota-config">
                        <label className="opcao-checa">
                          <input type="checkbox" checked={codigoAutomatico} onChange={(e) => setCodigoAutomatico(e.target.checked)} />
                          <span>Gerar automaticamente{proximoCodigo ? ` (próximo: ${proximoCodigo})` : ''}</span>
                        </label>
                      </small>
                    )}
                  </label>
                  <label>Nome<input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus /></label>
                  <label>Data de nascimento<input type="date" value={form.data_nascimento} onChange={(e) => setForm({ ...form, data_nascimento: e.target.value })} /></label>
                  <label>Telefone<input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></label>
                  {!form.empresa && <label>RG<input value={form.rg} onChange={(e) => setForm({ ...form, rg: e.target.value })} /></label>}
                  <label>{form.empresa ? 'CNPJ' : 'CPF'}<input value={form.empresa ? form.cnpj : form.cpf} onChange={(e) => setForm({ ...form, [form.empresa ? 'cnpj' : 'cpf']: e.target.value })} /></label>
                </div>
                <div className="form-secao">
                  <div className="form-secao-titulo">Endereços</div>
                  {enderecos.map((end, i) => (
                    <div key={i} className={`endereco-bloco ${end.principal ? 'endereco-principal' : ''}`}>
                      <div className="endereco-bloco-cabecalho">
                        <label className="opcao-checa" title="Endereço principal">
                          <input type="radio" checked={!!end.principal} onChange={() => setPrincipalEndereco(i)} />
                          <span>Principal</span>
                        </label>
                        {enderecos.length > 1 && <button className="btn-mini" onClick={() => removerEndereco(i)}>Remover</button>}
                      </div>
                      <label>Rótulo<input value={end.rotulo ?? ''} onChange={(e) => atualizarEndereco(i, 'rotulo', e.target.value)} placeholder="Ex.: Residencial, Comercial" /></label>
                      <label>Endereço<input value={end.endereco ?? ''} onChange={(e) => atualizarEndereco(i, 'endereco', e.target.value)} /></label>
                      <div className="form-grid-2">
                        <label>Número<input value={end.numero ?? ''} onChange={(e) => atualizarEndereco(i, 'numero', e.target.value)} /></label>
                        <label>Complemento<input value={end.complemento ?? ''} onChange={(e) => atualizarEndereco(i, 'complemento', e.target.value)} /></label>
                      </div>
                      <label>Bairro<input value={end.bairro ?? ''} onChange={(e) => atualizarEndereco(i, 'bairro', e.target.value)} /></label>
                      <div className="form-grid-2">
                        <label>Cidade<input value={end.cidade ?? ''} onChange={(e) => atualizarEndereco(i, 'cidade', e.target.value)} /></label>
                        <label>UF<input value={end.uf ?? ''} onChange={(e) => atualizarEndereco(i, 'uf', e.target.value)} /></label>
                      </div>
                      <label>CEP<input value={end.cep ?? ''} onChange={(e) => atualizarEndereco(i, 'cep', e.target.value)} /></label>
                    </div>
                  ))}
                  <button className="btn-secundario" onClick={adicionarEndereco}>+ Adicionar endereço</button>
                </div>
                <div className="form-grid">
                  <label>Celular<input value={form.celular} onChange={(e) => setForm({ ...form, celular: e.target.value })} /></label>
                  <label>Gênero
                    <select value={form.genero} onChange={(e) => setForm({ ...form, genero: e.target.value })}>
                      <option value="">Selecione</option>
                      <option value="Masculino">Masculino</option>
                      <option value="Feminino">Feminino</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </label>
                  <label>Email<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
                  <label>Pai<input value={form.pai} onChange={(e) => setForm({ ...form, pai: e.target.value })} /></label>
                  <label>Mãe<input value={form.mae} onChange={(e) => setForm({ ...form, mae: e.target.value })} /></label>
                  <label>É empresa?
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label className="switch"><input type="checkbox" checked={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.checked })} /><span className="slider" /></label>
                      <span>{form.empresa ? 'Sim' : 'Não'}</span>
                    </div>
                  </label>
                  <label>Categoria
                    <select value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
                      <option value="">Sem categoria</option>
                      {categorias.map((c) => <option key={c.id} value={String(c.id)}>{c.nome}</option>)}
                    </select>
                  </label>
                  <label>É VIP?
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label className="switch"><input type="checkbox" checked={form.vip} onChange={(e) => setForm({ ...form, vip: e.target.checked })} /><span className="slider" /></label>
                      <span>{form.vip ? 'Sim' : 'Não'}</span>
                    </div>
                  </label>
                  <label>Limite de fiado (R$)<input type="number" step="0.01" value={form.fiado_limite} onChange={(e) => setForm({ ...form, fiado_limite: e.target.value })} /></label>
                  <label>Pontos de fidelidade<input type="number" value={form.pontos} onChange={(e) => setForm({ ...form, pontos: Number(e.target.value) || 0 })} /></label>
                  <label>Fidelidade total (R$)<input type="number" step="0.01" value={form.fid_total} onChange={(e) => setForm({ ...form, fid_total: Number(e.target.value) || 0 })} /></label>
                  <label>Tem crédito?
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label className="switch"><input type="checkbox" checked={form.tem_credito} onChange={(e) => setForm({ ...form, tem_credito: e.target.checked })} /><span className="slider" /></label>
                      <span>{form.tem_credito ? 'Sim' : 'Não'}</span>
                    </div>
                  </label>
                  {form.tem_credito && <label>Valor de crédito (R$)<input type="number" step="0.01" value={form.valor_cred} onChange={(e) => setForm({ ...form, valor_cred: e.target.value })} /></label>}
                  <label>Observações<input value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></label>
                  <label style={{ gridColumn: '1 / -1' }}>Informações extras<textarea value={form.info_extras} onChange={(e) => setForm({ ...form, info_extras: e.target.value })} rows={2} /></label>
                </div>
                <div className="modal-acoes">
                  <button className="btn-secundario" onClick={() => setFormAberto(false)}>Cancelar</button>
                  <button className="btn-primario" onClick={salvar}>Salvar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
