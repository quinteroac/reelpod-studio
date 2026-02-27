import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { createGenerateHandler, GENERATE_ENDPOINT_PATH } from './src/api/generate';

const readBody = async (req: { on: (event: string, cb: (...args: unknown[]) => void) => void }) => {
  return await new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];

    req.on('data', (chunk: unknown) => {
      chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    });

    req.on('end', () => {
      resolve(chunks.join(''));
    });

    req.on('error', (error: unknown) => {
      reject(error);
    });
  });
};

const generateHandler = createGenerateHandler();

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'generate-api-endpoint',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = req.url?.split('?')[0] ?? '';

          if (pathname !== GENERATE_ENDPOINT_PATH) {
            next();
            return;
          }

          const method = req.method ?? 'GET';
          const body = method === 'POST' ? await readBody(req) : undefined;
          const requestInit: RequestInit = {
            method,
            headers: req.headers as HeadersInit
          };

          if (body !== undefined) {
            requestInit.body = body;
          }

          const request = new Request(`http://localhost${req.url ?? GENERATE_ENDPOINT_PATH}`, requestInit);
          const response = await generateHandler(request);

          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          res.end(await response.text());
        });
      }
    }
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  }
});
