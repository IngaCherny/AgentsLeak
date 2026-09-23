import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const apiTarget = process.env.VITE_API_TARGET || process.env.AGENTSLEAK_SERVER || 'http://localhost:3827';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Built into the Python package so the backend can serve it without Node.
  build: {
    outDir: '../agentsleak/static/dashboard',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
