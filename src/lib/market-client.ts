import { INSTRUMENT_BY_SYMBOL, INSTRUMENTS } from '../data/catalog';
import type { FxHistory, FxRatePoint, MarketResponse, MarketSeries, PricePoint } from './types';

export interface LoadMarketDataOptions {
  manual: boolean;
  pages: boolean;
  /** Vite's BASE_URL, such as '/' locally or '/roi/' on a project Pages site. */
  baseUrl: string;
  fetcher?: typeof fetch;
}

type RecordValue = Record<string, unknown>;
const statuses = new Set(['fresh', 'cached', 'unavailable']);
const invalid = () => new Error('Die Marktdatenantwort ist ungültig oder unvollständig.');
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
function validTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    validDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}
function validSourceUrl(value: unknown): value is string {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Historical conversion only uses genuine observations with their original provenance. */
export function parseFxHistory(value: unknown, staticFile = false): FxHistory {
  if (
    !isRecord(value) ||
    value.base !== 'EUR' ||
    value.quote !== 'USD' ||
    !text(value.source) ||
    !validSourceUrl(value.sourceUrl) ||
    typeof value.status !== 'string' ||
    !statuses.has(value.status) ||
    !Array.isArray(value.rates) ||
    value.rates.length > 25000 ||
    (value.error !== undefined && typeof value.error !== 'string')
  )
    throw invalid();
  const unavailable = value.status === 'unavailable';
  if (unavailable) {
    if (value.rates.length !== 0 || value.asOf !== '' || value.fetchedAt !== '') throw invalid();
  } else if (
    value.rates.length < 2 ||
    !validDate(value.asOf) ||
    !validTimestamp(value.fetchedAt) ||
    Date.parse(value.fetchedAt) > Date.now() + 5 * 60 * 1000 ||
    value.asOf > value.fetchedAt.slice(0, 10) ||
    value.asOf > new Date().toISOString().slice(0, 10)
  )
    throw invalid();
  const rates: FxRatePoint[] = [];
  let previous = '';
  for (const rate of value.rates) {
    if (
      !isRecord(rate) ||
      !validDate(rate.date) ||
      !positive(rate.eurUsd) ||
      rate.date <= previous ||
      rate.date > (value.asOf as string)
    )
      throw invalid();
    rates.push({ date: rate.date, eurUsd: rate.eurUsd });
    previous = rate.date;
  }
  if (!unavailable && rates.at(-1)?.date !== value.asOf) throw invalid();
  return {
    base: 'EUR',
    quote: 'USD',
    rates,
    source: value.source,
    sourceUrl: value.sourceUrl,
    fetchedAt: value.fetchedAt as string,
    asOf: value.asOf as string,
    status: unavailable
      ? 'unavailable'
      : staticFile
        ? 'cached'
        : (value.status as FxHistory['status']),
    ...(value.error === undefined ? {} : { error: value.error }),
  };
}

/** Validate provenance and observations without filling gaps or inventing values. */
export function parseMarketResponse(value: unknown, staticFile = false): MarketResponse {
  if (
    !isRecord(value) ||
    !isRecord(value.series) ||
    !isRecord(value.fx) ||
    !validTimestamp(value.fetchedAt)
  )
    throw invalid();
  const entries = Object.entries(value.series);
  if (!entries.length || entries.length > INSTRUMENTS.length) throw invalid();
  const series: Record<string, MarketSeries> = {};
  for (const [symbol, item] of entries) {
    if (
      !Object.hasOwn(INSTRUMENT_BY_SYMBOL, symbol) ||
      !isRecord(item) ||
      item.symbol !== symbol ||
      item.currency !== INSTRUMENT_BY_SYMBOL[symbol].currency ||
      !text(item.source) ||
      !validSourceUrl(item.sourceUrl) ||
      typeof item.status !== 'string' ||
      !statuses.has(item.status) ||
      !Array.isArray(item.prices) ||
      item.prices.length > 25000 ||
      (item.error !== undefined && typeof item.error !== 'string')
    )
      throw invalid();
    const unavailable = item.status === 'unavailable';
    if (unavailable ? item.prices.length !== 0 : item.prices.length < 2) throw invalid();
    if (unavailable) {
      if (item.asOf !== '' || item.fetchedAt !== '') throw invalid();
    } else if (
      !validDate(item.asOf) ||
      !validTimestamp(item.fetchedAt) ||
      item.asOf > item.fetchedAt.slice(0, 10)
    )
      throw invalid();
    const prices: PricePoint[] = [];
    let previous = '';
    for (const point of item.prices) {
      if (
        !isRecord(point) ||
        !validDate(point.date) ||
        !positive(point.close) ||
        point.date <= previous ||
        point.date > (item.asOf as string)
      )
        throw invalid();
      previous = point.date;
      prices.push({ date: point.date, close: point.close });
    }
    if (!unavailable && prices.at(-1)?.date !== item.asOf) throw invalid();
    series[symbol] = {
      symbol,
      currency: item.currency as string,
      prices,
      source: item.source,
      sourceUrl: item.sourceUrl,
      fetchedAt: item.fetchedAt as string,
      asOf: item.asOf as string,
      status: unavailable
        ? 'unavailable'
        : staticFile
          ? 'cached'
          : (item.status as MarketSeries['status']),
      ...(item.error === undefined ? {} : { error: item.error }),
    };
  }
  const fx = value.fx;
  if (
    !positive(fx.eurUsd) ||
    !validDate(fx.date) ||
    !text(fx.source) ||
    typeof fx.status !== 'string' ||
    !statuses.has(fx.status)
  )
    throw invalid();
  return {
    series,
    fx: {
      eurUsd: fx.eurUsd,
      date: fx.date,
      source: fx.source,
      status:
        fx.status === 'unavailable'
          ? 'unavailable'
          : staticFile
            ? 'cached'
            : (fx.status as MarketResponse['fx']['status']),
      ...(fx.history === undefined ? {} : { history: parseFxHistory(fx.history, staticFile) }),
    },
    fetchedAt: value.fetchedAt,
  };
}

/** Pages serves a published, dated JSON file; server builds keep their market API. */
export async function loadMarketData({
  manual,
  pages,
  baseUrl,
  fetcher = fetch,
}: LoadMarketDataOptions): Promise<MarketResponse> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const path = pages
    ? `${base}market-data.json${manual ? `?t=${Date.now()}` : ''}`
    : `${base}api/market${manual ? '?refresh=1' : ''}`;
  const response = await fetcher(path, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok)
    throw new Error(`Marktdaten konnten nicht geladen werden (HTTP ${response.status}).`);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw invalid();
  }
  return parseMarketResponse(data, pages);
}
