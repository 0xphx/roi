import http from 'node:http';
import worker from '../dist/server/index.js';
const port = Number(process.env.PORT || 4173);
http
  .createServer(async (req, res) => {
    try {
      const response = await worker.fetch(
        new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Interner Serverfehler' }));
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`ROI läuft auf http://127.0.0.1:${port}`));
