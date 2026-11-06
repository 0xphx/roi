import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
const request = (path, method = 'GET') =>
  worker.fetch(new Request(`http://roi.test${path}`, { method }));
const page = await request('/');
assert.equal(page.status, 200);
const html = await page.text();
assert.match(html, /lang="de"/);
assert.match(html, /ROI/);
assert.ok(page.headers.get('Content-Security-Policy').includes("default-src 'self'"));
const script = html.match(/src="([^"]+\.js)"/)[1];
const asset = await request(script);
assert.equal(asset.status, 200);
assert.match(asset.headers.get('Content-Type'), /javascript/);
assert.ok((await asset.text()).length > 1000);
assert.equal((await request('/favicon.svg')).status, 200);
assert.equal((await request('/fonts.css')).status, 200);
assert.equal((await request('/missing.js')).status, 404);
assert.equal((await request('/', 'POST')).status, 405);
const health = await request('/api/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ok');
const instruments = await request('/api/instruments');
assert.equal((await instruments.json()).instruments.length, 14);
assert.equal((await request('/api/market?symbols=INVALID')).status, 400);
assert.equal((await request('/api/health', 'POST')).status, 405);
assert.equal((await request('/api/not-found')).status, 404);
console.log(
  'Produktionsprüfung erfolgreich: Frontend, Assets, Sicherheitsheader und API-Verträge.',
);
