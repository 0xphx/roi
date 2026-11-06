import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleMarketRequest } from './server/market.ts';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'roi-market-api',
      configureServer(server) {
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
            res.end(JSON.stringify({ error: 'Marktdaten sind vorübergehend nicht erreichbar.' }));
          }
        });
      },
    },
  ],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist/client', chunkSizeWarningLimit: 650 },
});
