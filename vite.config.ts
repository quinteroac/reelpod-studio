import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/mcp': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        proxyTimeout: 600_000, // 10 min for audio generation
        timeout: 0, // no read timeout — SSE connections stay open with no data until generation runs
        configure: (proxy) => {
          proxy.on('error', (err: NodeJS.ErrnoException, _req, res) => {
            // ECONNRESET / socket hang up: client or backend closed the connection (e.g. EventSource closed, page nav, or MCP server not running)
            if (err.code === 'ECONNRESET' || err.message?.includes('socket hang up')) {
              return; // suppress noisy log; connection already closed
            }
            console.error('[vite proxy /mcp]', err);
          });
        },
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
