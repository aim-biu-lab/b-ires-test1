import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
    host: true,
    proxy: {
      '/api': {
        // In Docker, use 'backend' service name; outside Docker use localhost
        target: process.env.VITE_PROXY_TARGET || 'http://backend:8000',
        changeOrigin: true,
        configure: (proxy) => {
          // Ensure binary responses are properly handled
          proxy.on('proxyRes', (proxyRes, req, res) => {
            // Remove transfer-encoding if content-length is present to avoid chunking issues
            if (proxyRes.headers['content-length']) {
              delete proxyRes.headers['transfer-encoding']
            }
          })
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})

