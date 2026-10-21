import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getDbApi, getZonasApi } from '../../shared/db'

interface Zona {
  id: number
  nome: string
  preco: number
  poligono: string
  ativo: number
  ceps: string
}

// Converte a entrada textual de CEPs em lista limpa de prefixos.
function parseCeps(texto: string): string[] {
  const lista: string[] = []
  const partes = (texto || '').split(/[\s,;]+/)
  for (const parte of partes) {
    const digitos = parte.replace(/\D/g, '')
    if (digitos.length >= 3 && digitos.length <= 8 && !lista.includes(digitos)) {
      lista.push(digitos)
    }
  }
  return lista
}

interface PontoDesenhado {
  latlng: L.LatLng
  marker: L.Marker
}

interface ZonaPoligono {
  zona: Zona
  layer: L.Polygon
}

export default function Zonas() {
  const mapaRef = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const [zonas, setZonas] = useState<Zona[]>([])
  const [modoDesenho, setModoDesenho] = useState(false)
  const modoDesenhoRef = useRef(false)
  const pontosRef = useRef<PontoDesenhado[]>([])
  const poligonoRef = useRef<L.Polygon | null>(null)
  const poligonosZonasRef = useRef<ZonaPoligono[]>([])
  const [numPontos, setNumPontos] = useState(0)
  const [nome, setNome] = useState('')
  const [preco, setPreco] = useState('')
  const [ceps, setCeps] = useState('')
  const [mensagem, setMensagem] = useState('')
  const definindoLojaRef = useRef(false)
  const lojaMarkerRef = useRef<L.Marker | null>(null)
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const editandoIdRef = useRef<number | null>(null)
  const [buscaLocal, setBuscaLocal] = useState('')
  const bairroLayerRef = useRef<L.LayerGroup | null>(null)
  const [temContorno, setTemContorno] = useState(false)

  const CORES = ['#22c55e', '#eab308', '#ef4444']

  const corZona = (i: number) => CORES[i % CORES.length]

  useEffect(() => {
    modoDesenhoRef.current = modoDesenho
  }, [modoDesenho])

  useEffect(() => {
    editandoIdRef.current = editandoId
  }, [editandoId])

  const carregarZonas = async () => {
    const m = mapa.current
    if (!m) return
    poligonosZonasRef.current.forEach((p) => p.layer.remove())
    poligonosZonasRef.current = []
    const rows = (await getDbApi().all(
      `SELECT id, nome, preco, poligono, ativo, ceps FROM zonas_entrega ORDER BY nome`
    )) as unknown as Zona[]
    setZonas(rows)
    rows.forEach((z, i) => {
      const poly = JSON.parse(z.poligono) as { lat: number; lng: number }[]
      const pol = L.polygon(poly.map((p) => [p.lat, p.lng]), {
        color: corZona(i),
        fillColor: corZona(i),
        fillOpacity: 0.25
      }).addTo(m).bindTooltip(`${z.nome} — R$ ${z.preco.toFixed(2)}`)
      pol.on('click', (ev: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(ev)
        editarZona(z)
      })
      poligonosZonasRef.current.push({ zona: z, layer: pol })
    })
    return rows
  }

  useEffect(() => {
    if (!mapaRef.current) return

    const mapaInstancia = L.map(mapaRef.current, {
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomControl: true
    }).setView([-23.5505, -46.6333], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(mapaInstancia)
    mapa.current = mapaInstancia

    mapaInstancia.on('click', aoClicarNoMapa)
    mapaInstancia.on('dblclick', aoDuploCliqueNoMapa)

    const inicializar = async () => {
      const zonasCarregadas = await carregarZonas()

      const cfg = (await getDbApi().get(
        `SELECT valor FROM config WHERE chave = 'loja_lat'`
      )) as { valor: string }
      const cfgLng = (await getDbApi().get(
        `SELECT valor FROM config WHERE chave = 'loja_lng'`
      )) as { valor: string }
      const lat = Number(cfg?.valor)
      const lng = Number(cfgLng?.valor)
      const temLoja = Boolean(lat && lng)

      if (zonasCarregadas && zonasCarregadas.length > 0) {
        const bounds = L.latLngBounds(
          zonasCarregadas.flatMap((z) => {
            const pts = JSON.parse(z.poligono) as { lat: number; lng: number }[]
            return pts.map((p) => [p.lat, p.lng] as [number, number])
          })
        )
        mapaInstancia.fitBounds(bounds, { padding: [40, 40] })
      } else if (temLoja) {
        mapaInstancia.setView([lat, lng], 13)
      }

      if (temLoja) {
        lojaMarkerRef.current = L.marker([lat, lng]).addTo(mapaInstancia).bindTooltip('Loja')
      }
    }
    inicializar()

    return () => {
      mapaInstancia.off('click', aoClicarNoMapa)
      mapaInstancia.off('dblclick', aoDuploCliqueNoMapa)
      mapaInstancia.remove()
      mapa.current = null
      poligonosZonasRef.current = []
    }
  }, [])

  const redesenharPoligono = () => {
    const m = mapa.current
    if (!m) return
    if (poligonoRef.current) {
      poligonoRef.current.remove()
      poligonoRef.current = null
    }
    const pts = pontosRef.current.map((p) => p.latlng)
    if (pts.length >= 3) {
      const cor = corZona(zonas.length)
      poligonoRef.current = L.polygon(pts, {
        color: cor,
        fillColor: cor,
        fillOpacity: 0.25
      }).addTo(m)
    }
    setNumPontos(pts.length)
  }

  const removerPonto = (marker: L.Marker) => {
    const idx = pontosRef.current.findIndex((p) => p.marker === marker)
    if (idx === -1) return
    marker.remove()
    pontosRef.current = pontosRef.current.filter((_, i) => i !== idx)
    redesenharPoligono()
  }

  const aoClicarNoMapa = (e: L.LeafletMouseEvent) => {
    if (!mapa.current) return

    if (definindoLojaRef.current) {
      if (lojaMarkerRef.current) lojaMarkerRef.current.remove()
      lojaMarkerRef.current = L.marker(e.latlng).addTo(mapa.current).bindTooltip('Loja')
      getDbApi().run(`UPDATE config SET valor = ? WHERE chave = 'loja_lat'`, [String(e.latlng.lat)])
      getDbApi().run(`UPDATE config SET valor = ? WHERE chave = 'loja_lng'`, [String(e.latlng.lng)])
      definindoLojaRef.current = false
      setMensagem('Local da loja salvo.')
      return
    }

    if (modoDesenhoRef.current) {
      adicionarPonto(e.latlng)
    }
  }

  const aoDuploCliqueNoMapa = (e: L.LeafletMouseEvent) => {
    if (!modoDesenhoRef.current) return
    if (definindoLojaRef.current) return
    adicionarPonto(e.latlng)
  }

  const adicionarPonto = (latlng: L.LatLng) => {
    if (!mapa.current) return
    const marker = L.marker(latlng, {
      draggable: true,
      icon: L.divIcon({
        className: '',
        html: '<div style="width:18px;height:18px;border:3px solid #ef4444;border-radius:50%;background:#22c55e;cursor:grab"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      })
    }).addTo(mapa.current)
    marker.on('click', (ev: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(ev)
      removerPonto(marker)
    })
    marker.on('dragend', (ev: L.LeafletEvent) => {
      const m = ev.target as L.Marker
      const idx = pontosRef.current.findIndex((p) => p.marker === m)
      if (idx !== -1) {
        pontosRef.current[idx].latlng = m.getLatLng()
        redesenharPoligono()
      }
    })
    pontosRef.current.push({ latlng, marker })
    redesenharPoligono()
  }

  const editarZona = (z: Zona) => {
    if (modoDesenho) limparDesenho()
    setEditandoId(z.id)
    setNome(z.nome)
    setPreco(String(z.preco))
    setCeps(String(z.ceps ?? ''))
    setModoDesenho(true)
    definindoLojaRef.current = false
    const pts = JSON.parse(z.poligono) as { lat: number; lng: number }[]
    pts.forEach((p) => adicionarPonto(L.latLng(p.lat, p.lng)))
    setMensagem(`Editando "${z.nome}". Ajuste os pontos e clique em Salvar.`)
  }

  const ativarDesenho = () => {
    if (!modoDesenho) {
      setEditandoId(null)
      setNome('')
      setPreco('')
      setCeps('')
    }
    const ativo = !modoDesenho
    setModoDesenho(ativo)
    definindoLojaRef.current = false
    if (ativo) limparDesenho()
    setMensagem(
      ativo
        ? 'Clique ou dê duplo clique no mapa para adicionar pontos. Arraste o mapa para navegar. Clique num ponto para removê-lo.'
        : ''
    )
  }

  const ativarLoja = () => {
    definindoLojaRef.current = !definindoLojaRef.current
    setModoDesenho(false)
    setEditandoId(null)
    limparDesenho()
    setMensagem(definindoLojaRef.current ? 'Clique no mapa para marcar a loja.' : '')
  }

  const limparDesenho = () => {
    pontosRef.current.forEach((p) => p.marker.remove())
    pontosRef.current = []
    if (poligonoRef.current) {
      poligonoRef.current.remove()
      poligonoRef.current = null
    }
    setNumPontos(0)
  }

  const cancelarEdicao = () => {
    setEditandoId(null)
    setNome('')
    setPreco('')
    setCeps('')
    limparDesenho()
    setModoDesenho(false)
    setMensagem('')
  }

  const salvarZona = async () => {
    if (pontosRef.current.length < 3) {
      setMensagem('Clique no mapa ao menos 3 pontos para fechar a zona.')
      return
    }
    if (!nome.trim() || !Number(preco)) {
      setMensagem('Informe nome e preço da zona.')
      return
    }
    const poligono = JSON.stringify(pontosRef.current.map((p) => ({ lat: p.latlng.lat, lng: p.latlng.lng })))
    const cepsJson = JSON.stringify(parseCeps(ceps))
    if (editandoIdRef.current) {
      await getDbApi().run(
        `UPDATE zonas_entrega SET nome = ?, preco = ?, poligono = ?, ceps = ? WHERE id = ?`,
        [nome.trim(), Number(preco), poligono, cepsJson, editandoIdRef.current]
      )
      setMensagem(`Zona "${nome.trim()}" atualizada!`)
    } else {
      await getDbApi().run(
        `INSERT INTO zonas_entrega (nome, preco, poligono, ceps) VALUES (?, ?, ?, ?)`,
        [nome.trim(), Number(preco), poligono, cepsJson]
      )
      setMensagem('Zona criada! Pode continuar — clique em "+ Desenhar zona" para criar outra.')
    }
    setEditandoId(null)
    setNome('')
    setPreco('')
    setCeps('')
    limparDesenho()
    setModoDesenho(false)
    await carregarZonas()
  }

  const excluirZona = async (z: Zona) => {
    if (!confirm(`Excluir a zona "${z.nome}"?`)) return
    await getDbApi().run(`DELETE FROM zonas_entrega WHERE id = ?`, [z.id])
    setMensagem(`Zona "${z.nome}" excluída.`)
    await carregarZonas()
  }

  const alternarAtivo = async (z: Zona) => {
    await getDbApi().run(`UPDATE zonas_entrega SET ativo = ? WHERE id = ?`, [z.ativo ? 0 : 1, z.id])
    setMensagem(`Zona "${z.nome}" ${z.ativo ? 'desativada' : 'ativada'}.`)
    await carregarZonas()
  }

  const exportarZonas = async () => {
    const res = await getZonasApi().exportar()
    setMensagem(res.ok ? `Zonas exportadas para ${res.arquivo}` : res.erro ?? 'Falha ao exportar.')
  }

  const importarZonas = async () => {
    if (!confirm('Importar zonas? As zonas do arquivo serão adicionadas às existentes.')) return
    const res = await getZonasApi().importar()
    if (res.ok) {
      setMensagem(`${res.qtd} zona(s) importada(s).`)
      await carregarZonas()
    } else {
      setMensagem(res.erro ?? 'Falha ao importar.')
    }
  }

  const limparContornoBairro = () => {
    if (bairroLayerRef.current) {
      bairroLayerRef.current.remove()
      bairroLayerRef.current = null
    }
    setTemContorno(false)
  }

  const buscarLocal = async () => {
    const q = buscaLocal.trim()
    if (q.length < 3) {
      setMensagem('Digite ao menos 3 letras para buscar.')
      return
    }
    setMensagem('Buscando local...')
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&polygon_geojson=1&q=${encodeURIComponent(q)}`
      )
      const dados = await r.json()
      if (!dados.length) {
        setMensagem('Local não encontrado. Tente outro nome.')
        return
      }
      const d = dados[0]
      const lat = Number(d.lat)
      const lng = Number(d.lon)
      limparContornoBairro()
      if (d.geojson && d.geojson.type) {
        const layer = L.geoJSON(d.geojson, {
          style: {
            color: '#ef4444',
            weight: 2,
            dashArray: '6 4',
            fillColor: '#ef4444',
            fillOpacity: 0.06
          }
        })
        bairroLayerRef.current = L.layerGroup([layer]).addTo(mapa.current!)
        setTemContorno(true)
        const bounds = layer.getBounds()
        if (bounds.isValid()) {
          mapa.current?.fitBounds(bounds, { padding: [30, 30] })
        } else {
          mapa.current?.setView([lat, lng], 15)
        }
      } else {
        mapa.current?.setView([lat, lng], 15)
      }
      setMensagem(`Localizado: ${d.display_name}`)
    } catch {
      setMensagem('Falha ao buscar o local.')
    }
  }

  return (
    <div className="page page-zonas">
      <div className="page-header">
        <h2>Zonas de entrega</h2>
        <div className="page-acoes">
          <button className="btn-secundario" onClick={exportarZonas}>Exportar</button>
          <button className="btn-secundario" onClick={importarZonas}>Importar</button>
          <button className="btn-secundario" onClick={ativarLoja}>
            Definir local da loja
          </button>
          <button className="btn-primario" onClick={ativarDesenho}>
            {modoDesenho ? 'Cancelar desenho' : '+ Desenhar zona'}
          </button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      <div className="zonas-layout">
        <div className="zonas-mapa-col">
          <div className="zonas-busca">
            <input
              value={buscaLocal}
              onChange={(e) => setBuscaLocal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') buscarLocal() }}
              placeholder="Buscar local (ex: bairro, rua, cidade)..."
            />
            <button className="btn-secundario" onClick={buscarLocal}>Buscar</button>
            {temContorno && (
              <button className="btn-secundario" onClick={limparContornoBairro}>Limpar contorno</button>
            )}
          </div>
          <div ref={mapaRef} className="mapa-zonas" />
        </div>
        <aside className="zonas-lista">
          {modoDesenho && (
            <div className="painel-desenho">
              <h3>{editandoId ? `Editando zona (${numPontos} pontos)` : `Nova zona (${numPontos} pontos)`}</h3>
              <p className="nota-config">
                <strong>Clique ou duplo clique</strong> no mapa: adiciona ponto.
                <br /><strong>Arraste o mapa</strong>: move a visualização (roda do mouse dá zoom).
                <br /><strong>Arraste um ponto</strong>: move de lugar.
                <br /><strong>Clique num ponto</strong>: remove.
                <br />3+ pontos forma o polígono.
              </p>
              <input placeholder="Nome (ex: Centro)" value={nome} onChange={(e) => setNome(e.target.value)} />
              <input type="number" step="0.01" placeholder="Taxa R$ (ex: 5.00)" value={preco} onChange={(e) => setPreco(e.target.value)} />
              <input
                placeholder="CEPs (ex: 01310, 01320 ou 01310100) separados por espaço/vírgula"
                value={ceps}
                onChange={(e) => setCeps(e.target.value)}
              />
              <p className="nota-config">
                CEPs desta zona para o catálogo online: prefixos (3 a 8 dígitos) ou CEPs completos.
                O cliente informa o CEP e a zona é identificada automaticamente.
              </p>
              <div className="modal-acoes">
                <button className="btn-secundario" onClick={cancelarEdicao}>Cancelar</button>
                <button className="btn-secundario" onClick={limparDesenho}>Limpar pontos</button>
                <button className="btn-primario" onClick={salvarZona}>Salvar zona</button>
              </div>
            </div>
          )}

          <h3>Zonas cadastradas</h3>
          {zonas.length === 0 && <p className="sem-resultado">Nenhuma zona ainda.</p>}
          {zonas.map((z) => (
            <div key={z.id} className="zona-item">
              <div>
                <strong>{z.nome}</strong>
                <span>R$ {z.preco.toFixed(2)} • {z.ativo ? 'ativa' : 'inativa'}</span>
                {Array.isArray(z.ceps) && z.ceps.length > 0 && (
                  <span> • CEPs: {(z.ceps as string[]).join(', ')}</span>
                )}
              </div>
              <div className="td-acoes">
                <button className="btn-mini" onClick={() => editarZona(z)}>Editar</button>
                <button className="btn-mini" onClick={() => alternarAtivo(z)}>{z.ativo ? 'Desativar' : 'Ativar'}</button>
                <button className="btn-mini" onClick={() => excluirZona(z)}>Excluir</button>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}
