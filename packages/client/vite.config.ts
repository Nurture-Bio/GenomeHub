import { defineConfig } from 'vite';
import react    from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  envDir: '../..',
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  // Prevent esbuild pre-bundling from rewriting import.meta.url inside
  // concertina/core — the DataWorker is resolved via:
  //   new Worker(new URL('./data-worker.js', import.meta.url))
  // That URL must stay relative to dist/core/index.js on disk.
  optimizeDeps: {
    exclude: ['concertina'],
  },
});
