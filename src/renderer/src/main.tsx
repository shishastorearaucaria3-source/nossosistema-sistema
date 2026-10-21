import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import UpdateModal from './features/atualizacao/UpdateModal'
import './css/global.css'
import './css/ui-components.css'
import './css/components.css'
import './css/layout.css'
import './css/login.css'
import './css/home.css'
import './css/pdv.css'
import './css/produtos.css'
import './css/clientes.css'
import './css/vendas.css'
import './css/estoque.css'
import './css/caixa.css'
import './css/financeiro.css'
import './css/relatorios.css'
import './css/server.css'
import './css/misc.css'
import './css/pedidos-online.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <UpdateModal />
  </React.StrictMode>
)