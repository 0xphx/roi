import { INSTRUMENTS, INSTRUMENT_BY_SYMBOL } from '../src/data/catalog.ts';
import snapshotData from '../src/data/market-snapshot.json' with { type: 'json' };
import type { FxHistory, MarketResponse, MarketSeries, PricePoint } from '../src/lib/types.ts';

const snapshot = snapshotData as MarketResponse;
const TTL = 15 * 60 * 1000;
const TIMEOUT = 9_000;
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const ECB_HISTORY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';
const cache = new Map<string, { value: MarketSeries; expires: number }>();
const inFlight = new Map<string, Promise<MarketSeries>>();
let fxCache: { value: MarketResponse['fx']; expires: number } | undefined;
let fxInFlight: Promise<MarketResponse['fx']> | undefined;
let fxHistoryCache: { value: FxHistory; expires: number } | undefined;
let fxHistoryInFlight: Promise<FxHistory | undefined> | undefined;
let fxHistoryRetryAt = 0;
let refreshAllowedAt = 0;

export function yahooUrl(symbol: string): string {
  if (!Object.hasOwn(INSTRUMENT_BY_SYMBOL, symbol)) throw new Error('Unbekanntes Instrument');
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`;
}

/** Yahoo adjusted close includes the provider's split and distribution adjustments. */
export function parseYahoo(
  payload: unknown,
  symbol: string,
  fetchedAt = new Date().toISOString(),
): MarketSeries {
  const result = (
    payload as {
      chart?: {
        result?: Array<{
          meta?: { currency?: string };
          timestamp?: number[];
          indicators?: {
            adjclose?: Array<{ adjclose?: Array<number | null> }>;
            quote?: Array<{ close?: Array<number | null> }>;
          };
        }>;
      };
    }
  )?.chart?.result?.[0];
  if (!result?.timestamp?.length) throw new Error('Yahoo Finance liefert keine Zeitreihe.');
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose;
  const raw = result.indicators?.quote?.[0]?.close;
  const values = adjusted?.some(
    (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
  )
    ? adjusted
    : raw;
  if (!values) throw new Error('Keine gültigen Schlusskurse.');
  const points = new Map<string, number>();
  result.timestamp.forEach((timestamp, index) => {
    const close = values[index];
    if (
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      typeof close !== 'number' ||
      !Number.isFinite(close) ||
      close <= 0
    )
      return;
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    if (date > fetchedAt.slice(0, 10)) return;
    points.set(date, close);
  });
  const prices = [...points]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, close]) => ({ date, close }));
  if (prices.length < 2) throw new Error('Zu wenige gültige Handelstage.');
  return {
    symbol,
    currency: result.meta?.currency || INSTRUMENT_BY_SYMBOL[symbol]?.currency || 'USD',
    prices,
    source:
      adjusted === values
        ? 'Yahoo Finance · bereinigte Tagesschlusskurse'
        : 'Yahoo Finance · Tagesschlusskurse',
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/`,
    fetchedAt,
    asOf: prices.at(-1)!.date,
    status: 'fresh',
  };
}

export function parseStooq(
  csv: string,
  symbol: string,
  fetchedAt = new Date().toISOString(),
): MarketSeries {
  const rows = csv.trim().split(/\r?\n/);
  if (rows[0]?.replace(/^\uFEFF/, '') !== 'Date,Open,High,Low,Close,Volume')
    throw new Error('Stooq liefert keine Kursdaten.');
  const cutoff = new Date(fetchedAt);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 5);
  const prices: PricePoint[] = [];
  for (const row of rows.slice(1)) {
    const [date, , , , rawClose] = row.split(',');
    const close = Number(rawClose);
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      date >= cutoff.toISOString().slice(0, 10) &&
      date <= fetchedAt.slice(0, 10) &&
      Number.isFinite(close) &&
      close > 0
    )
      prices.push({ date, close });
  }
  prices.sort((a, b) => a.date.localeCompare(b.date));
  if (prices.length < 2) throw new Error('Zu wenige Stooq-Handelstage.');
  return {
    symbol,
    currency: 'USD',
    prices,
    source: 'Stooq · Tagesschlusskurse (Anbieterbasis)',
    sourceUrl: `https://stooq.com/q/d/?s=${encodeURIComponent(symbol.toLowerCase())}.us`,
    fetchedAt,
    asOf: prices.at(-1)!.date,
    status: 'fresh',
  };
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}

export function parseEcb(xml: string): MarketResponse['fx'] {
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const rate = xml.match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/)?.[1];
  const eurUsd = Number(rate);
  if (!date || !validDate(date) || !Number.isFinite(eurUsd) || eurUsd <= 0)
    throw new Error('Kein gültiger EZB-Referenzkurs.');
  return {
    eurUsd,
    date,
    source: 'Europäische Zentralbank · EUR/USD-Referenzkurs',
    status: 'fresh',
  };
}

/** ECB quotes USD per EUR. Keep actual dated observations only, without weekend fills. */
export function parseEcbHistory(xml: string, fetchedAt = new Date().toISOString()): FxHistory {
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(fetchedAt) ||
    !validDate(fetchedAt.slice(0, 10)) ||
    !Number.isFinite(Date.parse(fetchedAt)) ||
    xml.length > 10_000_000
  )
    throw new Error('Ungültige Abrufinformationen der EZB-Zeitreihe.');
  const cutoff = new Date(`${fetchedAt.slice(0, 10)}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 5);
  cutoff.setUTCDate(cutoff.getUTCDate() - 10);
  const firstDate = cutoff.toISOString().slice(0, 10);
  const seen = new Set<string>();
  const rates: FxHistory['rates'] = [];
  // Day blocks are non-nested and contain self-closing currency observations in official ECB XML.
  const dayBlocks = xml.matchAll(
    /<(?:[\w-]+:)?Cube\b(?=[^>]*\btime\s*=)([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?Cube\s*>/g,
  );
  for (const [, attributes, children] of dayBlocks) {
    const date = attributes.match(/\btime\s*=\s*(['"])(.*?)\1/)?.[2];
    if (!date || !validDate(date) || date > fetchedAt.slice(0, 10) || seen.has(date))
      throw new Error('Die EZB-Zeitreihe enthält ungültige oder doppelte Kurstage.');
    seen.add(date);
    const usd = [...children.matchAll(/<(?:[\w-]+:)?Cube\b([^>]*)\s*\/\s*>/g)]
      .map(([, entry]) => entry)
      .filter((entry) => /\bcurrency\s*=\s*(['"])USD\1/.test(entry));
    if (usd.length !== 1)
      throw new Error('Die EZB-Zeitreihe enthält keinen eindeutigen USD-Referenzkurs.');
    const rawRate = usd[0].match(/\brate\s*=\s*(['"])(.*?)\1/)?.[2];
    const eurUsd = Number(rawRate);
    if (!rawRate || !/^\d+(?:\.\d+)?$/.test(rawRate) || !Number.isFinite(eurUsd) || eurUsd <= 0)
      throw new Error('Die EZB-Zeitreihe enthält einen ungültigen USD-Referenzkurs.');
    if (date >= firstDate) rates.push({ date, eurUsd });
  }
  rates.sort((a, b) => a.date.localeCompare(b.date));
  if (rates.length < 2) throw new Error('Zu wenige datierte EUR/USD-Referenzkurse.');
  return {
    base: 'EUR',
    quote: 'USD',
    rates,
    source: 'Europäische Zentralbank · historische EUR/USD-Referenzkurse',
    sourceUrl: ECB_HISTORY_URL,
    fetchedAt,
    asOf: rates.at(-1)!.date,
    status: 'fresh',
  };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ROI-Investment-Workspace/1.0',
      Accept: 'application/json,text/csv,application/xml;q=0.9,*/*;q=0.5',
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw new Error(`Datenanbieter antwortet mit HTTP ${response.status}.`);
  return response.text();
}

export async function fetchFreshSeries(symbol: string): Promise<MarketSeries> {
  if (!Object.hasOwn(INSTRUMENT_BY_SYMBOL, symbol)) throw new Error('Unbekanntes Instrument');
  let yahooError: unknown;
  try {
    return parseYahoo(JSON.parse(await fetchText(yahooUrl(symbol))), symbol);
  } catch (error) {
    yahooError = error;
  }
  if (!symbol.includes('-')) {
    try {
      return parseStooq(
        await fetchText(
          `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`,
        ),
        symbol,
      );
    } catch {
      /* Preserve the primary failure when both sources are unavailable. */
    }
  }
  throw yahooError;
}

export async function fetchFreshFx(): Promise<MarketResponse['fx']> {
  return parseEcb(await fetchText(ECB_URL));
}

export async function fetchFreshFxHistory(): Promise<FxHistory> {
  const history = parseEcbHistory(await fetchText(ECB_HISTORY_URL));
  const expectedStart = new Date(`${history.fetchedAt.slice(0, 10)}T00:00:00Z`);
  expectedStart.setUTCFullYear(expectedStart.getUTCFullYear() - 5);
  expectedStart.setUTCDate(expectedStart.getUTCDate() + 10);
  if (
    history.rates.length < 1000 ||
    history.rates[0].date > expectedStart.toISOString().slice(0, 10)
  )
    throw new Error('Die EZB liefert keine ausreichend lange EUR/USD-Zeitreihe.');
  return history;
}

function unavailable(symbol: string, error: string): MarketSeries {
  const saved = snapshot.series[symbol];
  if (saved?.prices.length) return { ...saved, status: 'cached', error };
  return {
    symbol,
    currency: INSTRUMENT_BY_SYMBOL[symbol]?.currency || 'USD',
    prices: [],
    source: 'Keine Marktdaten verfügbar',
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/`,
    fetchedAt: '',
    asOf: '',
    status: 'unavailable',
    error,
  };
}

async function loadSeries(symbol: string, refresh = false): Promise<MarketSeries> {
  const saved = cache.get(symbol);
  if (!refresh && saved && saved.expires > Date.now()) return saved.value;
  const pending = inFlight.get(symbol);
  if (pending) return pending;
  const operation = fetchFreshSeries(symbol)
    .then((value) => {
      cache.set(symbol, { value, expires: Date.now() + TTL });
      return value;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Marktdatenabruf fehlgeschlagen.';
      const fallback = saved?.value.prices.length
        ? { ...saved.value, status: 'cached' as const, error: message }
        : unavailable(symbol, message);
      cache.set(symbol, { value: fallback, expires: Date.now() + TTL });
      return fallback;
    })
    .finally(() => inFlight.delete(symbol));
  inFlight.set(symbol, operation);
  return operation;
}

async function loadFx(refresh = false): Promise<MarketResponse['fx']> {
  if (!refresh && fxCache && fxCache.expires > Date.now())
    return { ...fxCache.value, history: await loadFxHistory(refresh) };
  if (fxInFlight) return fxInFlight;
  const historyPromise = loadFxHistory(refresh);
  fxInFlight = fetchFreshFx()
    .then((value) => {
      fxCache = { value, expires: Date.now() + TTL };
      return value;
    })
    .catch(() => {
      const fallback = fxCache?.value.eurUsd ? fxCache.value : snapshot.fx;
      const value = {
        ...fallback,
        status: fallback.eurUsd > 0 ? ('cached' as const) : ('unavailable' as const),
      };
      fxCache = { value, expires: Date.now() + TTL };
      return value;
    })
    .then(async (value) => {
      const history = await historyPromise;
      return { ...value, ...(history ? { history } : {}) };
    })
    .finally(() => {
      fxInFlight = undefined;
    });
  return fxInFlight;
}

/** Historical FX survives an independent daily-rate outage and retains original provenance. */
async function loadFxHistory(refresh = false): Promise<FxHistory | undefined> {
  if (!refresh && fxHistoryCache && fxHistoryCache.expires > Date.now())
    return fxHistoryCache.value;
  if (fxHistoryInFlight) return fxHistoryInFlight;
  if (!refresh && Date.now() < fxHistoryRetryAt) return undefined;
  const previous = fxHistoryCache?.value ?? snapshot.fx.history;
  fxHistoryInFlight = fetchFreshFxHistory()
    .then((fresh) => {
      // An unexpectedly shorter or older response cannot silently shrink the historical data.
      const value =
        previous &&
        previous.status !== 'unavailable' &&
        (fresh.asOf < previous.asOf ||
          fresh.rates[0].date > previous.rates.at(-1)!.date ||
          (fresh.asOf === previous.asOf && fresh.rates.length < previous.rates.length))
          ? { ...previous, status: 'cached' as const }
          : fresh;
      fxHistoryCache = { value, expires: Date.now() + TTL };
      return value;
    })
    .catch((error) => {
      fxHistoryRetryAt = Date.now() + TTL;
      if (!previous || previous.status === 'unavailable' || previous.rates.length < 2)
        return undefined;
      const value: FxHistory = {
        ...previous,
        status: 'cached',
        error:
          error instanceof Error ? error.message : 'Historischer Wechselkursabruf fehlgeschlagen.',
      };
      fxHistoryCache = { value, expires: Date.now() + TTL };
      return value;
    })
    .finally(() => {
      fxHistoryInFlight = undefined;
    });
  return fxHistoryInFlight;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export function parseSymbols(input: string | null): string[] {
  if (input !== null && input.length > 256) throw new Error('Symbolabfrage ist zu lang.');
  const symbols =
    input === null
      ? INSTRUMENTS.map((item) => item.symbol)
      : [
          ...new Set(
            input
              .split(',')
              .map((item) => item.trim().toUpperCase())
              .filter(Boolean),
          ),
        ];
  if (
    !symbols.length ||
    symbols.length > 16 ||
    symbols.some((symbol) => !Object.hasOwn(INSTRUMENT_BY_SYMBOL, symbol))
  )
    throw new Error('Bitte 1 bis 16 unterstützte Symbole angeben.');
  return symbols;
}

export async function handleMarketRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'Nur GET-Anfragen werden unterstützt.' }, 405);
  if (url.pathname === '/api/health')
    return json({
      status: 'ok',
      service: 'roi-market-data',
      snapshotAsOf: snapshot.fetchedAt,
      providers: ['Yahoo Finance', 'Stooq', 'Europäische Zentralbank'],
    });
  if (url.pathname === '/api/instruments') return json({ instruments: INSTRUMENTS });
  if (url.pathname !== '/api/market') return json({ error: 'API-Endpunkt nicht gefunden.' }, 404);
  let symbols: string[];
  try {
    symbols = parseSymbols(url.searchParams.get('symbols'));
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
  // A manual refresh can bypass the 15-minute data cache at most once per minute.
  const refresh = url.searchParams.get('refresh') === '1' && Date.now() >= refreshAllowedAt;
  if (refresh) refreshAllowedAt = Date.now() + 60_000;
  const [all, fx] = await Promise.all([
    Promise.all(symbols.map((symbol) => loadSeries(symbol, refresh))),
    loadFx(refresh),
  ]);
  const body: MarketResponse = {
    series: Object.fromEntries(all.map((value) => [value.symbol, value])),
    fx,
    fetchedAt: new Date().toISOString(),
  };
  return json(body);
}
