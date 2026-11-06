import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleMarketRequest,
  parseEcb,
  parseStooq,
  parseSymbols,
  parseYahoo,
  yahooUrl,
} from '../server/market';
import { INSTRUMENTS } from '../src/data/catalog';
import snapshotData from '../src/data/market-snapshot.json';
import type { MarketResponse } from '../src/lib/types';

const fetchedAt = '2026-11-06T21:30:00.000Z';
const stamp = (date: string) => new Date(`${date}T15:00:00Z`).getTime() / 1000;
afterEach(() => vi.unstubAllGlobals());

describe('real market-data parsers', () => {
  it('uses adjusted close, discards null/future prices and sorts unique dates', () => {
    const result = parseYahoo(
      {
        chart: {
          result: [
            {
              meta: { currency: 'USD' },
              timestamp: [
                stamp('2026-11-05'),
                stamp('2026-11-04'),
                stamp('2026-11-06'),
                stamp('2026-11-07'),
                stamp('2026-11-05'),
              ],
              indicators: {
                adjclose: [{ adjclose: [101, 99, null, 108, 102] }],
                quote: [{ close: [111, 109, 113, 118, 112] }],
              },
            },
          ],
        },
      },
      'VTI',
      fetchedAt,
    );
    expect(result.prices).toEqual([
      { date: '2026-11-04', close: 99 },
      { date: '2026-11-05', close: 102 },
    ]);
    expect(result.source).toContain('bereinigte');
    expect(result.fetchedAt).toBe(fetchedAt);
    expect(result.asOf).toBe('2026-11-05');
  });

  it('falls back to raw closes only if the adjusted series has no valid observations', () => {
    const result = parseYahoo(
      {
        chart: {
          result: [
            {
              timestamp: [stamp('2026-11-04'), stamp('2026-11-05')],
              indicators: {
                adjclose: [{ adjclose: [null, null] }],
                quote: [{ close: [102, 104] }],
              },
            },
          ],
        },
      },
      'SPY',
      fetchedAt,
    );
    expect(result.prices.map((point) => point.close)).toEqual([102, 104]);
    expect(result.source).toBe('Yahoo Finance · Tagesschlusskurse');
  });

  it('fails rather than manufacturing data for an invalid or empty provider result', () => {
    expect(() =>
      parseYahoo({ chart: { error: { code: 'Not Found' }, result: null } }, 'VTI', fetchedAt),
    ).toThrow();
    expect(() =>
      parseYahoo(
        {
          chart: {
            result: [
              {
                timestamp: [stamp('2026-11-04'), stamp('2026-11-05')],
                indicators: { quote: [{ close: [0, -1] }] },
              },
            ],
          },
        },
        'VTI',
        fetchedAt,
      ),
    ).toThrow();
  });

  it('parses Stooq CSV while excluding invalid closes and prices outside its data horizon', () => {
    const result = parseStooq(
      'Date,Open,High,Low,Close,Volume\n2020-11-06,1,1,1,10,5\n2026-11-04,1,1,1,101.2,5\n2026-11-05,1,1,1,102.3,5\n2026-11-06,1,1,1,NaN,5\n2026-11-07,1,1,1,120,5',
      'SPY',
      fetchedAt,
    );
    expect(result.prices).toEqual([
      { date: '2026-11-04', close: 101.2 },
      { date: '2026-11-05', close: 102.3 },
    ]);
    expect(() => parseStooq('No data', 'SPY', fetchedAt)).toThrow();
  });

  it('reads dated official EUR/USD FX and refuses absent or zero exchange rates', () => {
    expect(parseEcb("<Cube time='2026-11-06'><Cube currency='USD' rate='1.1165'/></Cube>")).toEqual(
      {
        eurUsd: 1.1165,
        date: '2026-11-06',
        source: 'Europäische Zentralbank · EUR/USD-Referenzkurs',
        status: 'fresh',
      },
    );
    expect(() =>
      parseEcb("<Cube time='2026-11-06'><Cube currency='USD' rate='0'/></Cube>"),
    ).toThrow();
    expect(() => parseEcb('<html>service unavailable</html>')).toThrow();
  });
});

describe('bounded market API', () => {
  it('validates and deduplicates catalog symbols before any external request', async () => {
    expect(parseSymbols('vti, SPY,VTI')).toEqual(['VTI', 'SPY']);
    expect(parseSymbols(null)).toHaveLength(INSTRUMENTS.length);
    expect(() => parseSymbols('https://evil.example/a')).toThrow();
    expect(() => parseSymbols('')).toThrow();
    expect(() => parseSymbols('TOSTRING')).toThrow();
    expect(() => yahooUrl('UNKNOWN')).toThrow();
    expect(() => yahooUrl('constructor')).toThrow();
    expect(() => parseSymbols('VTI,'.repeat(100))).toThrow();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await handleMarketRequest(
      new Request('http://localhost/api/market?symbols=SPY,INVALID'),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns explicit cached provenance during provider outages and coalesces concurrent loads', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    const requests = await Promise.all([
      handleMarketRequest(new Request('http://localhost/api/market?symbols=VTI')),
      handleMarketRequest(new Request('http://localhost/api/market?symbols=VTI')),
    ]);
    const results = (await Promise.all(
      requests.map((response) => response.json()),
    )) as MarketResponse[];
    expect(results[0].series.VTI.status).toBe('cached');
    expect(results[0].series.VTI.error).toBe('Network unavailable');
    expect(results[0].series.VTI.prices).toEqual(snapshotData.series.VTI.prices);
    expect(results[0].series.VTI.fetchedAt).toBe(snapshotData.series.VTI.fetchedAt);
    expect(results[0].fx.status).toBe('cached');
    expect(results[0].fx.eurUsd).toBeGreaterThan(0);
    expect(results[0].series).toEqual(results[1].series);
    expect(results[0].fx).toEqual(results[1].fx);
    expect(fetchMock).toHaveBeenCalledTimes(3); // Yahoo + Stooq + ECB, shared by both callers.
  });

  it('keeps health local and rejects mutation methods', async () => {
    const health = await handleMarketRequest(new Request('http://localhost/api/health'));
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe('ok');
    expect(
      (await handleMarketRequest(new Request('http://localhost/api/market', { method: 'POST' })))
        .status,
    ).toBe(405);
  });
});

describe('bundled genuine market snapshot', () => {
  it('contains a sourced, dated, positive five-year history for every listed instrument', () => {
    const snapshot = snapshotData as MarketResponse;
    for (const instrument of INSTRUMENTS) {
      const series = snapshot.series[instrument.symbol];
      expect(series.symbol).toBe(instrument.symbol);
      expect(series.prices.length).toBeGreaterThan(1000);
      expect(series.sourceUrl).toMatch(/^https:\/\/finance\.yahoo\.com\/quote\//);
      expect(series.asOf).toBe(series.prices.at(-1)!.date);
      expect(series.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Set(series.prices.map((point) => point.date)).size).toBe(series.prices.length);
      expect(series.prices.every((point) => Number.isFinite(point.close) && point.close > 0)).toBe(
        true,
      );
    }
    expect(snapshot.fx.eurUsd).toBeGreaterThan(0);
  });
});
