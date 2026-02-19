import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'


export default defineConfig({
  plugins: [
    react(), 
    nodePolyfills({
      globals: { Buffer: true, process: true, global: true },
      protocolImports: true,
    }),
  ],
  // Load .env files from the parent directory (repo root)
  envDir: '..',
  define: {
    global: 'globalThis'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: path.resolve(__dirname, './node_modules/buffer/'),
      pino: 'pino/browser.js',
    },
    dedupe: ['@stellar/stellar-sdk']
  },
  optimizeDeps: {
    include: ['@stellar/stellar-sdk', '@stellar/stellar-sdk/contract', '@stellar/stellar-sdk/rpc', 'buffer'],
    exclude: ['@stellar/stellar-sdk', '@aztec/bb.js'],
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    }
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },
  server: {
    port: 3000,
    open: true
  }
})
