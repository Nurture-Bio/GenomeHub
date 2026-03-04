import path from 'node:path';
import { defineConfig } from 'vite';
import react    from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const useProdApi = process.env.VITE_USE_PROD_API === 'true';
const apiTarget = useProdApi
  ? 'https://dnryzh3ckbrvh.cloudfront.net'
  : 'http://localhost:3000';

export default defineConfig({
  envDir: '../..',
  plugins: [react(), tailwind()],
  css: {
    transformer: 'lightningcss',
    lightningcss: {
      targets: {
        safari: (13 << 16),
        chrome: (80 << 16),
        firefox: (103 << 16),
      },
    },
  },
  resolve: {
    alias: {
      '@strand/core':      path.resolve(__dirname, '../..', 'vendor/strand/src/index.ts'),
      '@strand/inference': path.resolve(__dirname, '../..', 'packages/strand/src/inference.ts'),
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: useProdApi,
      },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query', '@tanstack/react-virtual'],
          'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-popover', 'class-variance-authority', 'sonner'],
        },
      },
    },
  },
});
