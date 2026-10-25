import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/existence/', // GitHub Pages serves from /<repo>/
  plugins: [react()],
})
