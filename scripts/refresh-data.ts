/** Download a reproducible genuine-data fallback; never synthesize missing prices. */
import { writeFile } from 'node:fs/promises';
import { INSTRUMENTS } from '../src/data/catalog';
import { fetchFreshFx, fetchFreshFxHistory, fetchFreshSeries } from '../server/market';
import type { MarketResponse, MarketSeries } from '../src/lib/types';

const series: Record<string, MarketSeries> = {};
const errors: string[] = [];
// Bound concurrency to avoid overwhelming the free public sources.
for (let index = 0; index < INSTRUMENTS.length; index += 3) {
  await Promise.all(
    INSTRUMENTS.slice(index, index + 3).map(async (instrument) => {
      try {
        series[instrument.symbol] = {
          ...(await fetchFreshSeries(instrument.symbol)),
          status: 'cached',
        };
        console.log(
          `${instrument.symbol}: ${series[instrument.symbol].prices.length} Handelstage bis ${series[instrument.symbol].asOf}`,
        );
      } catch (error) {
        errors.push(`${instrument.symbol}: ${(error as Error).message}`);
      }
    }),
  );
}
if (errors.length)
  throw new Error(`Snapshot bleibt unverändert, da Daten fehlen:\n${errors.join('\n')}`);
const [currentFx, history] = await Promise.all([fetchFreshFx(), fetchFreshFxHistory()]);
const fx = {
  ...currentFx,
  status: 'cached' as const,
  history: { ...history, status: 'cached' as const },
};
const snapshot: MarketResponse = { series, fx, fetchedAt: new Date().toISOString() };
await writeFile(
  new URL('../src/data/market-snapshot.json', import.meta.url),
  JSON.stringify(snapshot),
);
console.log(
  `Echten Marktdaten-Snapshot für ${Object.keys(series).length} Instrumente gespeichert. EUR/USD ${fx.eurUsd} (${fx.date}), ${history.rates.length} historische Referenzkurse bis ${history.asOf}.`,
);
