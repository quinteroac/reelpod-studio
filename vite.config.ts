import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/mcp': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true
      },
      '/api/generate-image': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        proxyTimeout: 300_000 // 5 min — SDXL inference can take 60–120+ seconds
      },
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        proxyTimeout: 300_000
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  }
});
