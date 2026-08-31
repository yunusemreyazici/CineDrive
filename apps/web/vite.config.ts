import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Overridable so an end-to-end run can bring up its own pair of servers
    // beside the ones a developer already has running.
    port: Number(process.env.WEB_PORT) || 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // `vite preview` serves the real build. Without the same proxy it cannot
  // reach the API, so the only way to check production bundle behaviour
  // locally would be a full Docker run.
  preview: {
    port: Number(process.env.WEB_PREVIEW_PORT) || 4173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // hls.js is intentionally loaded as a separate, on-demand player chunk
    // (~574 kB). Keep the budget just above it so unexpected larger chunks
    // still surface during production builds.
    chunkSizeWarningLimit: 600,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
  },
});
