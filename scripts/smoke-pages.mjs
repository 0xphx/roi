import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
const { parseMarketResponse } = await tsImport('../src/lib/market-client.ts', import.meta.url);
const root = new URL('../dist/pages/', import.meta.url);
const base = `${(process.env.PAGES_BASE_PATH || '/roi/').replace(/\/$/, '')}/`;
const html = await readFile(new URL('index.html', root), 'utf8');
assert.match(html, /lang="de"/);
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
assert.ok(assets.some((a) => a.endsWith('.js')));
assert.ok(assets.some((a) => a.endsWith('.css')));
assert.ok(assets.some((a) => a.endsWith('favicon.svg')));
for (const asset of assets) {
  assert.ok(asset.startsWith(base), `Asset muss unter ${base} liegen: ${asset}`);
  const file = new URL(asset.slice(base.length), root);
  assert.ok((await stat(file)).isFile(), `Fehlendes Asset: ${asset}`);
  if (asset.endsWith('.css'))
    assert.doesNotMatch(
      await readFile(file, 'utf8'),
      /url\(['"]?\/fonts\.css/,
      'Kein Asset darf ungewollt außerhalb des Projektpfads laden.',
    );
}
const data = parseMarketResponse(
  JSON.parse(await readFile(new URL('market-data.json', root), 'utf8')),
);
assert.equal(Object.keys(data.series).length, 14);
assert.ok(data.fx.eurUsd > 0 && /^\d{4}-\d{2}-\d{2}$/.test(data.fx.date));
assert.equal(data.fx.status, 'cached');
if (data.fx.history) {
  assert.equal(data.fx.history.status, 'cached');
  assert.ok(data.fx.history.rates.length > 1);
  assert.equal(data.fx.history.asOf, data.fx.history.rates.at(-1).date);
}
for (const [symbol, series] of Object.entries(data.series)) {
  assert.equal(series.symbol, symbol);
  assert.equal(series.status, 'cached');
  assert.ok(series.prices.length > 1);
  assert.ok(series.source && series.sourceUrl && series.fetchedAt);
  assert.equal(series.asOf, series.prices.at(-1).date);
  assert.ok(series.prices.every((p) => Number.isFinite(p.close) && p.close > 0));
}
assert.equal((await stat(new URL('.nojekyll', root))).size, 0);
console.log(
  `GitHub-Pages-Prüfung erfolgreich: Projektpfad ${base}, alle Assets, 14 datierte echte Kursreihen und ${data.fx.history?.rates.length ?? 0} geprüfte historische EUR/USD-Referenzkurse.`,
);
