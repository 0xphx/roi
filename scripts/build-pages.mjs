import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
const explicit = process.env.PAGES_DATA_FILE;
let source = explicit || '.pages-data/market-data.json';
try {
  await access(source);
} catch (error) {
  if (explicit) throw error;
  source = 'src/data/market-snapshot.json';
}
const data = JSON.parse(await readFile(source, 'utf8'));
if (
  !data.series ||
  !Number.isFinite(data.fx?.eurUsd) ||
  data.fx.eurUsd <= 0 ||
  !Object.values(data.series).every((s) => s.prices?.length && s.asOf && s.fetchedAt)
)
  throw new Error('Keine gültigen Marktdaten für GitHub Pages vorhanden.');
for (const series of Object.values(data.series)) series.status = 'cached';
data.fx.status = 'cached';
await mkdir('dist/pages', { recursive: true });
await writeFile('dist/pages/market-data.json', JSON.stringify(data));
await writeFile('dist/pages/.nojekyll', '');
console.log(
  `GitHub-Pages-Paket mit ${Object.keys(data.series).length} echten Kursreihen erstellt (${source}).`,
);
