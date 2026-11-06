import { INSTRUMENT_BY_SYMBOL, INSTRUMENTS } from '../data/catalog';
import type { MarketResponse, MarketSeries, PricePoint } from './types';

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
