import { build } from 'esbuild';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
async function collect(dir, prefix = '') {
  let out = {};
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${f.name}`;
    const abs = path.join(dir, f.name);
    if (f.isDirectory()) Object.assign(out, await collect(abs, rel));
    else
      out[rel] = {
        body: (await readFile(abs)).toString('base64'),
        type: types[path.extname(f.name)] || 'application/octet-stream',
      };
  }
  return out;
}
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await writeFile('dist/.openai/hosting.json', await readFile('.openai/hosting.json'));
const assets = await collect('dist/client');
await build({
  stdin: {
    contents: `import {handleMarketRequest} from './server/market'; const assets=${JSON.stringify(assets)}; export default {async fetch(request){const url=new URL(request.url); if(url.pathname.startsWith('/api/')) return handleMarketRequest(request); if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});const asset=assets[url.pathname]||(url.pathname.includes('.')?null:assets['/index.html']);if(!asset)return new Response('Not found',{status:404}); const bytes=Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0));return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':asset.type,'Cache-Control':url.pathname.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"}})}};`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/server/index.js',
  minify: true,
});
console.log('Worker und Frontend wurden gebaut.');
