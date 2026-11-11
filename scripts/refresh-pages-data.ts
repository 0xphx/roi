/** Build-time retrieval for static GitHub Pages; no provider secrets or browser proxy. */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import snapshotData from '../src/data/market-snapshot.json' with { type: 'json' };
import { INSTRUMENTS } from '../src/data/catalog';
import { parseFxHistory, parseMarketResponse } from '../src/lib/market-client';
import type { FxHistory, MarketResponse, MarketSeries } from '../src/lib/types';
import { fetchFreshFx, fetchFreshFxHistory, fetchFreshSeries } from '../server/market';

export interface PagesDataMerge {
  fallback: unknown;
  published?: unknown;
  updates?: Record<string, MarketSeries>;
  fxUpdate?: MarketResponse['fx'];
  fxHistoryUpdate?: FxHistory;
  errors?: Record<string, string>;
}

function validDataset(input: unknown): MarketResponse | undefined {
  if (input === undefined) return undefined;
  try {
    return parseMarketResponse(input, true);
  } catch {
    // A broken optional FX history must not discard otherwise valid asset observations.
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
    const data = input as Record<string, unknown>;
    if (typeof data.fx !== 'object' || data.fx === null || Array.isArray(data.fx)) return undefined;
    const { history: _ignored, ...fx } = data.fx as Record<string, unknown>;
    try {
      return parseMarketResponse({ ...data, fx }, true);
    } catch {
      return undefined;
    }
  }
}

/** Select one complete provider history; do not splice observations across retrievals. */
function laterFxHistory(left: FxHistory | undefined, right: unknown): FxHistory | undefined {
  let candidate: FxHistory;
  try {
    candidate = parseFxHistory(right, true);
  } catch {
    return left;
  }
  if (candidate.status === 'unavailable') return left;
  if (!left || candidate.asOf > left.asOf) return candidate;
  if (candidate.asOf < left.asOf) return left;
  // Same end date: retain wider coverage before preferring a later genuine retrieval.
  const first = candidate.rates[0].date;
  const selectedFirst = left.rates[0].date;
  if (first !== selectedFirst) return first < selectedFirst ? candidate : left;
  if (candidate.rates.length !== left.rates.length)
    return candidate.rates.length > left.rates.length ? candidate : left;
  return Date.parse(candidate.fetchedAt) >= Date.parse(left.fetchedAt) ? candidate : left;
}

/** Prefer the latest actual market date; retrieval time only breaks same-day ties. */
function laterSeries(left: MarketSeries | undefined, right: MarketSeries | undefined) {
  if (!left?.prices.length || left.status === 'unavailable') return right;
  if (!right?.prices.length || right.status === 'unavailable') return left;
  if (left.asOf !== right.asOf) return left.asOf > right.asOf ? left : right;
  return Date.parse(left.fetchedAt) >= Date.parse(right.fetchedAt) ? left : right;
}

/** Merge independently per instrument so a partial provider outage never resets other assets. */
export function mergePagesData({
  fallback,
  published,
  updates = {},
  fxUpdate,
  fxHistoryUpdate,
  errors = {},
}: PagesDataMerge): MarketResponse {
  const saved = [validDataset(fallback), validDataset(published)].filter(
    (value): value is MarketResponse => value !== undefined,
  );
  if (!saved.length) throw new Error('Kein gültiger echter Marktdaten-Fallback vorhanden.');
  const series: Record<string, MarketSeries> = {};
  for (const { symbol } of INSTRUMENTS) {
    let selected: MarketSeries | undefined;
    for (const data of saved) selected = laterSeries(selected, data.series[symbol]);
    const update = updates[symbol];
    if (update) {
      // Validate a candidate with the same public schema before it can replace saved data.
      const context = saved[0];
      const validated = validDataset({
        ...context,
        series: { [symbol]: update },
        fetchedAt: update.fetchedAt,
      });
      if (validated) selected = laterSeries(selected, validated.series[symbol]);
    }
    if (!selected?.prices.length || selected.status === 'unavailable') {
      throw new Error(
        `Keine verwendbaren echten Kurse für ${symbol}; Veröffentlichung abgebrochen.`,
      );
    }
    series[symbol] = {
      ...structuredClone(selected),
      status: 'cached',
      ...(errors[symbol] ? { error: errors[symbol] } : {}),
    };
  }
  const fxCandidates = saved.map((data) => data.fx).filter((fx) => fx.status !== 'unavailable');
  if (fxUpdate) {
    const { history: _history, ...daily } = fxUpdate;
    const validated = validDataset({ ...saved[0], fx: daily });
    if (validated && validated.fx.status !== 'unavailable') fxCandidates.push(validated.fx);
  }
  const fx = fxCandidates.reduce<MarketResponse['fx'] | undefined>(
    (selected, candidate) => (!selected || candidate.date >= selected.date ? candidate : selected),
    undefined,
  );
  if (!fx) throw new Error('Kein verwendbarer echter EUR/USD-Referenzkurs.');
  let history: FxHistory | undefined;
  for (const data of saved) history = laterFxHistory(history, data.fx.history);
  history = laterFxHistory(history, fxUpdate?.history);
  history = laterFxHistory(history, fxHistoryUpdate);
  // This is the latest original retrieval timestamp, not the publication/build time.
  const fetchedAt = [
    ...saved.map((data) => data.fetchedAt),
    ...Object.values(series).map((s) => s.fetchedAt),
    ...(history ? [history.fetchedAt] : []),
  ]
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1)!;
  const { history: _selectedHistory, ...daily } = fx;
  return parseMarketResponse(
    { series, fx: { ...daily, status: 'cached', ...(history ? { history } : {}) }, fetchedAt },
    true,
  );
}

export async function refreshPagesData() {
  let published: MarketResponse | undefined;
  if (process.env.PAGES_SITE_URL) {
    try {
      const base = new URL(`${process.env.PAGES_SITE_URL.replace(/\/+$/, '')}/`);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
        throw new Error('Ungültige Pages-Adresse.');
      }
      const previousUrl = new URL('market-data.json', base);
      previousUrl.searchParams.set('previous', String(Date.now()));
      const response = await fetch(previousUrl, {
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      published = validDataset(await response.json());
      if (!published) throw new Error('Ungültige veröffentlichte Marktdaten.');
      console.log('Vorher veröffentlichter echter Datenstand für den Ausfallschutz geladen.');
    } catch (error) {
      console.warn(
        `Vorherige Pages-Daten nicht verfügbar: ${(error as Error).message}. Der mitgelieferte Datenstand bleibt als Fallback erhalten.`,
      );
    }
  }
  const updates: Record<string, MarketSeries> = {};
  const errors: Record<string, string> = {};
  for (let index = 0; index < INSTRUMENTS.length; index += 3) {
    await Promise.all(
      INSTRUMENTS.slice(index, index + 3).map(async ({ symbol }) => {
        try {
          updates[symbol] = await fetchFreshSeries(symbol);
          console.log(`${symbol}: echte Kurse bis ${updates[symbol].asOf} abgerufen.`);
        } catch (error) {
          errors[symbol] = `Aktualisierung fehlgeschlagen: ${(error as Error).message}`;
          console.warn(`${symbol}: ${errors[symbol]}; letzter echter Datenstand bleibt erhalten.`);
        }
      }),
    );
  }
  let fxUpdate: MarketResponse['fx'] | undefined;
  try {
    fxUpdate = await fetchFreshFx();
  } catch (error) {
    console.warn(
      `EZB-Aktualisierung fehlgeschlagen: ${(error as Error).message}; letzter Referenzkurs bleibt erhalten.`,
    );
  }
  let fxHistoryUpdate: FxHistory | undefined;
  try {
    fxHistoryUpdate = await fetchFreshFxHistory();
    console.log(
      `EUR/USD: ${fxHistoryUpdate.rates.length} echte Referenzkurse bis ${fxHistoryUpdate.asOf} abgerufen.`,
    );
  } catch (error) {
    console.warn(
      `EZB-Historie nicht aktualisiert: ${(error as Error).message}; letzter gültiger historischer Datenstand bleibt erhalten.`,
    );
  }
  const data = mergePagesData({
    fallback: snapshotData,
    published,
    updates,
    fxUpdate,
    fxHistoryUpdate,
    errors,
  });
  const output = resolve(process.env.PAGES_DATA_FILE || '.pages-data/market-data.json');
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(data));
  await rename(temporary, output);
  console.log(
    `Statischer Datenstand mit ${Object.keys(data.series).length} Instrumenten geschrieben. Originale Abruf- und Kursdaten bleiben erhalten.`,
  );
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  refreshPagesData().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
