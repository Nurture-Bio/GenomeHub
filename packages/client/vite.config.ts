import path from 'node:path';
import { defineConfig } from 'vite';
import react    from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  envDir: '../..',
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@strand/core': path.resolve(__dirname, '../../..', 'strand/src/index.ts'),
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
