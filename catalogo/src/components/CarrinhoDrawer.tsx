import { useMemo, useState } from 'react'
import { useCarrinho } from '../state/carrinho'
import { formatarMoeda, FORMAS_PAGAMENTO } from '../types'
import type { LojaPublica } from '../types'
import { criarPedidoOnline } from '../api/catalogoApi'

type Modalidade = 'entrega' | 'retirada'

interface FormCheckout {
  nome: string
  whatsapp: string
  endereco: string
  cep: string
  zonaId: string
  modalidade: Modalidade
  formaPagamento: string
}

// Erros do backend que devem ser mostrados ao cliente (e não tratados como
// fallback de comunicação). Os demais erros (rede, indisponibilidade da API)
// permitem o envio pelo WhatsApp como alternativa.
const ERROS_VALIDACAO = new Set([
  'pedidos_pausados',
  'modalidade_indisponivel',
  'nome_obrigatorio',
  'whatsapp_invalido',
  'carrinho_vazio',
  'produto_indisponivel',
  'estoque_insuficiente',
  'cep_invalido',
  'cep_fora_zona',
  'endereco_obrigatorio',
])

function traduzirErro(codigo: string): string {
  switch (codigo) {
    case 'pedidos_pausados': return 'A loja está com pedidos pausados no momento.'
    case 'modalidade_indisponivel': return 'A loja não está aceitando essa modalidade de pedido no momento.'
    case 'nome_obrigatorio': return 'Informe o seu nome.'
    case 'whatsapp_invalido': return 'Informe um WhatsApp válido (com DDD).'
    case 'carrinho_vazio': return 'Seu carrinho está vazio.'
    case 'produto_indisponivel': return 'Um dos itens não está mais disponível.'
    case 'estoque_insuficiente': return 'Um dos itens ficou sem estoque. Ajuste o carrinho e tente de novo.'
    case 'cep_invalido': return 'Informe um CEP válido (8 dígitos).'
    case 'cep_fora_zona': return 'O CEP informado não pertence a nenhuma zona de entrega.'
    case 'endereco_obrigatorio': return 'Informe o endereço de entrega.'
    default: return 'Não foi possível concluir o pedido. Tente novamente.'
  }
}

function somenteDigitos(v: string): string {
  return v.replace(/\D/g, '')
}

// Verifica se um CEP pertence a uma lista de prefixos/CEPs de uma zona.
function cepPertence(cep: string, ceps?: string[]): boolean {
  const cepLimpo = somenteDigitos(cep)
  if (!cepLimpo || cepLimpo.length < 3) return false
  if (!ceps || ceps.length === 0) return false
  return ceps.some((c) => {
    const entrada = somenteDigitos(c ?? '')
    if (!entrada || entrada.length < 3) return false
    const tamanho = Math.min(entrada.length, 8, cepLimpo.length)
    return cepLimpo.slice(0, tamanho) === entrada.slice(0, tamanho)
  })
}

// Identifica a zona pela primeira correspondência de CEP na ordem da lista.
function zonaPorCep(
  cep: string,
  zonas: NonNullable<LojaPublica['zonas']>
): NonNullable<LojaPublica['zonas']>[number] | undefined {
  const cepLimpo = somenteDigitos(cep)
  if (!cepLimpo || cepLimpo.length < 3) return undefined
  return zonas.find((z) => cepPertence(cepLimpo, z.ceps))
}

export default function CarrinhoDrawer({ loja }: { loja: LojaPublica }) {
  const { itens, abrir, setAbrir, remover, mudarQuantidade, limpar, total } = useCarrinho()
  const [etapa, setEtapa] = useState<'lista' | 'checkout' | 'enviado'>('lista')
  const [form, setForm] = useState<FormCheckout>({
    nome: '',
    whatsapp: '',
    endereco: '',
    cep: '',
    zonaId: '',
    modalidade: loja.aceita_entrega === false ? 'retirada' : 'entrega',
    formaPagamento: FORMAS_PAGAMENTO[0].id
  })
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [falhaComunicacao, setFalhaComunicacao] = useState(false)
  const [concluidoViaApi, setConcluidoViaApi] = useState(false)
  const [numeroPedido, setNumeroPedido] = useState<number | null>(null)

  const pedidosAtivos = loja.pedidos_ativos !== false
  const aceitaEntrega = loja.aceita_entrega !== false
  const aceitaRetirada = loja.aceita_retirada === true

  const zonas = loja.zonas ?? []
  const zonaIdentificada = zonaPorCep(form.cep, zonas)
  // Zona manual só é usada quando a zona não tem CEPs configurados (fallback).
  const zonaManual = zonas.find((z) => String(z.id) === form.zonaId)
  const zonaUsada = zonaIdentificada ?? zonaManual
  const cepDigitos = somenteDigitos(form.cep)
  const cepCompleto = cepDigitos.length === 8
  const cepForaZona = form.modalidade === 'entrega' && cepCompleto && !zonaIdentificada

  const taxaEntrega = useMemo(() => {
    if (form.modalidade !== 'entrega') return 0
    if (zonaUsada) return zonaUsada.preco
    return typeof loja.taxa_entrega === 'number' ? loja.taxa_entrega : 0
  }, [form.modalidade, zonaUsada, loja.taxa_entrega])

  const totalFinal = total + taxaEntrega
  const whatsLoja = somenteDigitos(loja.whatsapp ?? '')
  const formaRotulo = FORMAS_PAGAMENTO.find((f) => f.id === form.formaPagamento)?.rotulo ?? form.formaPagamento

  if (!abrir) return null

  const fechar = () => {
    setAbrir(false)
    setTimeout(() => {
      setEtapa('lista')
      setErro('')
      setEnviando(false)
      setFalhaComunicacao(false)
      setConcluidoViaApi(false)
      setNumeroPedido(null)
    }, 250)
  }

  const irParaCheckout = () => {
    if (!pedidosAtivos) return
    setErro('')
    setEtapa('checkout')
  }

  const montarMensagem = (): string => {
    const linhas: string[] = []
    linhas.push(`Olá, ${loja.nome || 'loja'}! Gostaria de fazer um pedido:`)
    linhas.push('')
    for (const i of itens) {
      linhas.push(`${i.quantidade}x ${i.nome} — ${formatarMoeda(i.preco * i.quantidade)}`)
    }
    linhas.push('')
    linhas.push(`Subtotal: ${formatarMoeda(total)}`)
    if (form.modalidade === 'entrega') {
      linhas.push(`Zona de entrega: ${zonaUsada?.nome || 'Fora das zonas / taxa fixa'}`)
      linhas.push(`Taxa de entrega: ${taxaEntrega > 0 ? formatarMoeda(taxaEntrega) : 'Grátis'}`)
    }
    linhas.push(`Total: ${formatarMoeda(totalFinal)}`)
    linhas.push(`Pagamento: ${formaRotulo}`)
    linhas.push('')
    linhas.push(`Cliente: ${form.nome.trim()}`)
    linhas.push(`WhatsApp: ${form.whatsapp.trim()}`)
    linhas.push(`Entrega: ${form.modalidade === 'entrega' ? 'Entrega em domicílio' : 'Retirada na loja'}`)
    if (form.modalidade === 'entrega') {
      linhas.push(`Endereço: ${form.endereco.trim()}`)
      if (form.cep.trim()) linhas.push(`CEP: ${form.cep.trim()}`)
    }
    return linhas.join('\n')
  }

  const validar = (): string | null => {
    const modalidadeValida =
      (form.modalidade === 'entrega' && aceitaEntrega) ||
      (form.modalidade === 'retirada' && aceitaRetirada)
    if (!modalidadeValida) return 'A loja não está aceitando essa modalidade de pedido no momento.'
    if (!form.nome.trim()) return 'Informe o seu nome.'
    if (somenteDigitos(form.whatsapp).length < 10) return 'Informe um WhatsApp válido (com DDD).'
    if (form.modalidade === 'entrega' && !form.endereco.trim()) return 'Informe o endereço de entrega.'
    if (form.modalidade === 'entrega' && !cepCompleto) return 'Informe um CEP válido (8 dígitos) para identificarmos a zona de entrega.'
    if (cepForaZona) return 'O CEP informado não pertence a nenhuma zona de entrega. Não é possível entregar nesse endereço. Se preferir, escolha a retirada na loja.'
    if (!pedidosAtivos) return 'A loja está com pedidos pausados no momento.'
    return null
  }

  const concluirPorWhatsApp = () => {
    if (!whatsLoja) return
    const url = `https://wa.me/${whatsLoja}?text=${encodeURIComponent(montarMensagem())}`
    window.open(url, '_blank', 'noopener')
    limpar()
    setConcluidoViaApi(false)
    setEtapa('enviado')
  }

  const finalizar = async (): Promise<void> => {
    if (enviando) return
    const invalido = validar()
    if (invalido) {
      setErro(invalido)
      return
    }
    if (itens.length === 0) {
      setErro('Seu carrinho está vazio.')
      return
    }
    setErro('')
    setFalhaComunicacao(false)
    setEnviando(true)
    const resultado = await criarPedidoOnline({
      cliente: { nome: form.nome.trim(), whatsapp: form.whatsapp.trim() },
      modalidade: form.modalidade,
      endereco: form.modalidade === 'entrega' ? form.endereco.trim() : undefined,
      cep: form.modalidade === 'entrega' ? form.cep : undefined,
      forma_pagamento: form.formaPagamento,
      itens: itens.map((i) => ({ produto_id: i.id, quantidade: i.quantidade })),
    })
    setEnviando(false)

    if (resultado.ok && resultado.pedido) {
      setNumeroPedido(resultado.pedido.numero)
      setConcluidoViaApi(true)
      limpar()
      setEtapa('enviado')
      return
    }

    if (resultado.erro && ERROS_VALIDACAO.has(resultado.erro)) {
      setErro(traduzirErro(resultado.erro))
      return
    }

    // Falha de comunicação/API: oferece envio pelo WhatsApp como alternativa.
    setFalhaComunicacao(true)
    setErro('Não foi possível registrar o pedido automaticamente agora. Você pode enviá-lo pelo WhatsApp:')
  }

  const setCampo = (campo: keyof FormCheckout, valor: string) => {
    setForm((atual) => ({ ...atual, [campo]: valor }))
  }

  return (
    <div className="drawer-overlay" onClick={fechar} role="presentation">
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Carrinho">
        <div className="drawer__topo">
          <h2>{etapa === 'checkout' ? 'Finalizar pedido' : etapa === 'enviado' ? 'Pedido recebido' : 'Carrinho'}</h2>
          <button className="drawer__fechar" onClick={fechar} aria-label="Fechar carrinho">
            ✕
          </button>
        </div>

        {etapa === 'lista' && (
          <>
            {!pedidosAtivos && (
              <p className="drawer__alerta">
                Pedidos pausados neste momento. Você pode revisar o carrinho, mas a finalização está desativada.
              </p>
            )}
            {itens.length === 0 ? (
              <div className="drawer__vazio">
                <p>Seu carrinho está vazio.</p>
              </div>
            ) : (
              <>
                <ul className="drawer__lista">
                  {itens.map((i) => (
                    <li key={i.id} className="drawer__item">
                      <div className="drawer__item-info">
                        <span className="drawer__item-nome">{i.nome}</span>
                        <span className="drawer__item-preco">{formatarMoeda(i.preco)}</span>
                      </div>
                      <div className="drawer__item-acao">
                        <button className="qtd-btn" onClick={() => mudarQuantidade(i.id, i.quantidade - 1)} aria-label="Diminuir quantidade">
                          −
                        </button>
                        <span className="qtd-valor">{i.quantidade}</span>
                        <button className="qtd-btn" onClick={() => mudarQuantidade(i.id, i.quantidade + 1)} aria-label="Aumentar quantidade">
                          +
                        </button>
                        <button className="drawer__remover" onClick={() => remover(i.id)} aria-label="Remover item">
                          Remover
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="drawer__rodape">
                  <div className="drawer__total">
                    <span>Total</span>
                    <strong>{formatarMoeda(total)}</strong>
                  </div>
                  <button className="btn-limpar" onClick={limpar}>
                    Limpar carrinho
                  </button>
                  <button
                    className="btn-finalizar"
                    onClick={irParaCheckout}
                    disabled={!pedidosAtivos || !whatsLoja}
                  >
                    Finalizar pedido
                  </button>
                  {!whatsLoja && (
                    <p className="drawer__aviso">A loja ainda não configurou o WhatsApp para receber pedidos.</p>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {etapa === 'checkout' && (
          <div className="checkout">
            <div className="drawer__lista checkout__itens">
              <ul>
                {itens.map((i) => (
                  <li key={i.id} className="checkout__linha">
                    <span>
                      {i.quantidade}x {i.nome}
                    </span>
                    <strong>{formatarMoeda(i.preco * i.quantidade)}</strong>
                  </li>
                ))}
              </ul>
              <div className="checkout__totais">
                <span>Subtotal</span>
                <strong>{formatarMoeda(total)}</strong>
                {form.modalidade === 'entrega' && (zonaUsada || cepForaZona) && (
                  <>
                    <span>Zona de entrega</span>
                    <strong>{zonaUsada?.nome || '—'}</strong>
                  </>
                )}
                <span>Entrega</span>
                <strong>{form.modalidade === 'retirada' ? 'Retirada na loja' : taxaEntrega > 0 ? formatarMoeda(taxaEntrega) : 'Grátis'}</strong>
                <span className="checkout__total">Total</span>
                <strong className="checkout__total">{formatarMoeda(totalFinal)}</strong>
              </div>
            </div>

            <form
              className="checkout__form"
              onSubmit={(e) => {
                e.preventDefault()
                void finalizar()
              }}
            >
              <label className="checkout__campo">
                <span>Seu nome</span>
                <input
                  type="text"
                  value={form.nome}
                  onChange={(e) => setCampo('nome', e.target.value)}
                  placeholder="Nome completo"
                  autoComplete="name"
                />
              </label>
              <label className="checkout__campo">
                <span>Seu WhatsApp</span>
                <input
                  type="tel"
                  value={form.whatsapp}
                  onChange={(e) => setCampo('whatsapp', e.target.value)}
                  placeholder="(00) 00000-0000"
                  autoComplete="tel"
                />
              </label>

              {(aceitaEntrega || aceitaRetirada) && (
                <div className="checkout__opcoes" role="radiogroup" aria-label="Modalidade de recebimento">
                  {aceitaEntrega && (
                    <label className="checkout__opcao">
                      <input
                        type="radio"
                        name="modalidade"
                        value="entrega"
                        checked={form.modalidade === 'entrega'}
                        onChange={() => setCampo('modalidade', 'entrega')}
                      />
                      <span>Entrega em domicílio</span>
                    </label>
                  )}
                  {aceitaRetirada && (
                    <label className="checkout__opcao">
                      <input
                        type="radio"
                        name="modalidade"
                        value="retirada"
                        checked={form.modalidade === 'retirada'}
                        onChange={() => setCampo('modalidade', 'retirada')}
                      />
                      <span>Retirada na loja</span>
                    </label>
                  )}
                </div>
              )}

              {form.modalidade === 'entrega' && (
                <>
                  <label className="checkout__campo">
                    <span>CEP</span>
                    <input
                      type="text"
                      value={form.cep}
                      onChange={(e) => {
                        setCampo('cep', e.target.value)
                        setErro('')
                      }}
                      onBlur={() => {
                        if (zonaIdentificada) setCampo('zonaId', String(zonaIdentificada.id))
                      }}
                      placeholder="00000-000"
                      inputMode="numeric"
                    />
                  </label>

                  {zonaIdentificada && (
                    <div className="checkout__zona checkout__zona--ok">
                      <strong>Zona: {zonaIdentificada.nome}</strong>
                      <span>Taxa de entrega: {zonaIdentificada.preco > 0 ? formatarMoeda(zonaIdentificada.preco) : 'Grátis'}</span>
                    </div>
                  )}

                  {cepForaZona && (
                    <div className="checkout__zona checkout__zona--erro">
                      <strong>Este CEP não pertence a nenhuma zona de entrega.</strong>
                      <span>Não é possível finalizar como entrega para esse endereço.</span>
                      {aceitaRetirada && (
                        <button
                          type="button"
                          className="btn-mini"
                          onClick={() => {
                            setCampo('modalidade', 'retirada')
                            setErro('')
                          }}
                        >
                          Escolher retirada na loja
                        </button>
                      )}
                    </div>
                  )}

                  {!zonaIdentificada && zonas.length > 0 && zonas.some((z) => !z.ceps || z.ceps.length === 0) && !cepForaZona && (
                    <label className="checkout__campo">
                      <span>Zona de entrega (manual)</span>
                      <select value={form.zonaId} onChange={(e) => setCampo('zonaId', e.target.value)}>
                        <option value="">Selecione a zona</option>
                        {zonas.filter((z) => !z.ceps || z.ceps.length === 0).map((z) => (
                          <option key={z.id} value={String(z.id)}>
                            {z.nome} — {formatarMoeda(z.preco)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="checkout__campo">
                    <span>Endereço de entrega</span>
                    <input
                      type="text"
                      value={form.endereco}
                      onChange={(e) => setCampo('endereco', e.target.value)}
                      placeholder="Rua, número, bairro, cidade"
                    />
                  </label>
                </>
              )}

              <div className="checkout__campo">
                <span>Forma de pagamento</span>
                <div className="checkout__formas" role="radiogroup" aria-label="Forma de pagamento">
                  {FORMAS_PAGAMENTO.map((f) => (
                    <label key={f.id} className="checkout__forma">
                      <input
                        type="radio"
                        name="formaPagamento"
                        value={f.id}
                        checked={form.formaPagamento === f.id}
                        onChange={() => setCampo('formaPagamento', f.id)}
                      />
                      <span>{f.rotulo}</span>
                    </label>
                  ))}
                </div>
                <p className="checkout__nota">
                  {form.modalidade === 'entrega' ? 'Pague na entrega.' : 'Pague na retirada.'}
                </p>
              </div>

              {erro && <p className="checkout__erro">{erro}</p>}

              <div className="checkout__acoes">
                <button type="button" className="btn-voltar" onClick={() => setEtapa('lista')}>
                  Voltar
                </button>
                <button type="submit" className="btn-finalizar" disabled={!pedidosAtivos || enviando}>
                  {enviando ? 'Enviando…' : 'Confirmar pedido'}
                </button>
              </div>

              {falhaComunicacao && whatsLoja && (
                <button type="button" className="btn-mini" onClick={concluirPorWhatsApp}>
                  Enviar pelo WhatsApp
                </button>
              )}
            </form>
          </div>
        )}

        {etapa === 'enviado' && (
          <div className="checkout__enviado">
            <span className="checkout__icone" aria-hidden="true">✅</span>
            <h3>{concluidoViaApi ? 'Pedido confirmado!' : 'Pedido enviado!'}</h3>
            {concluidoViaApi ? (
              <p>
                Recebemos o seu pedido{numeroPedido ? ` (nº ${numeroPedido})` : ''}. A loja vai confirmar o envio
                pelo seu WhatsApp.
              </p>
            ) : (
              <p>
                Abrimos o WhatsApp da loja com o seu pedido preenchido. Confira e envie a mensagem para concluir.
              </p>
            )}
            <button className="btn-finalizar" onClick={fechar}>
              Fechar
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
