import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleMarketRequest } from './server/market.ts';

export default defineConfig(({ mode }) => {
  const pages = mode === 'github-pages';
  const pagesBase = process.env.PAGES_BASE_PATH || '/roi/';
  return {
    base: pages ? `${pagesBase.replace(/\/$/, '')}/` : '/',
    plugins: [
      react(),
      ...(!pages
        ? [
            {
              name: 'roi-market-api',
              configureServer(server: import('vite').ViteDevServer) {
                server.middlewares.use('/api', async (req, res) => {
                  try {
                    const response = await handleMarketRequest(
                      new Request(`http://localhost/api${req.url || '/'}`, { method: req.method }),
                    );
                    res.statusCode = response.status;
                    response.headers.forEach((value, key) => res.setHeader(key, value));
                    res.end(await response.text());
                  } catch {
                    res.statusCode = 500;
                    res.end(
                      JSON.stringify({ error: 'Marktdaten sind vorübergehend nicht erreichbar.' }),
                    );
                  }
                });
              },
            },
          ]
        : []),
    ],
    server: { port: 5173, strictPort: true },
    build: { outDir: pages ? 'dist/pages' : 'dist/client', chunkSizeWarningLimit: 650 },
  };
});
