import { defineConfig } from 'vite'
import uniPlugin from '@dcloudio/vite-plugin-uni'

const uni = (uniPlugin as any).default || uniPlugin

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [uni()],
  server: {
    port: 5174
  }
})

