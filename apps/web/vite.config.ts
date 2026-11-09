import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

// Dev: /api so'rovlari backendga proksi qilinadi (bir xil origin: refresh cookie va SSE muammosiz)
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5175,
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:8091', changeOrigin: false },
    },
  },
});
