import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
const { parseMarketResponse } = await tsImport('../src/lib/market-client.ts', import.meta.url);
const explicit = process.env.PAGES_DATA_FILE;
let source = explicit || '.pages-data/market-data.json';
try {
  await access(source);
} catch (error) {
  if (explicit) throw error;
  source = 'src/data/market-snapshot.json';
}
const data = parseMarketResponse(JSON.parse(await readFile(source, 'utf8')), true);
if (
  !data.series ||
  !Number.isFinite(data.fx?.eurUsd) ||
  data.fx.eurUsd <= 0 ||
  !Object.values(data.series).every((s) => s.prices?.length && s.asOf && s.fetchedAt)
)
  throw new Error('Keine gültigen Marktdaten für GitHub Pages vorhanden.');
await mkdir('dist/pages', { recursive: true });
await writeFile('dist/pages/market-data.json', JSON.stringify(data));
await writeFile('dist/pages/.nojekyll', '');
console.log(
  `GitHub-Pages-Paket mit ${Object.keys(data.series).length} echten Kursreihen und ${data.fx.history?.rates.length ?? 0} historischen EUR/USD-Referenzkursen erstellt (${source}).`,
);
