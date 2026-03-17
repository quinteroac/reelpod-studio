import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/mcp': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        ws: true, // proxy WebSocket upgrades for /mcp/ws
        proxyTimeout: 600_000, // 10 min for bridge HTTP calls
        timeout: 0, // no read timeout — WS connections stay open
        configure: (proxy) => {
          proxy.on('error', (err: NodeJS.ErrnoException, _req, _res) => {
            // ECONNRESET / socket hang up: client or server closed the connection normally
            if (err.code === 'ECONNRESET' || err.message?.includes('socket hang up')) {
              return;
            }
            console.error('[vite proxy /mcp]', err);
          });
        },
      },
      '/api/generate-image': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        proxyTimeout: 0, // no timeout — image generation can be slow
        timeout: 0
      },
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        proxyTimeout: 0, // no timeout — video generation with Wan I2V can take 10+ minutes
        timeout: 0
      },
      '/yt-upload': {
        target: 'https://www.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yt-upload/, ''),
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  }
});
