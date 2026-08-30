import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Em desenvolvimento o Vite faz proxy de /api para o servidor local do ERP
// (mesmo origin no navegador: sem CORS, sem alterar o servidor).
// Sobrescreva com: CATALOGO_API_TARGET=http://IP:PORTA npm run dev
const target = process.env.CATALOGO_API_TARGET || 'http://127.0.0.1:3210'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target, changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})