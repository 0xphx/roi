import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMarketData, parseFxHistory, parseMarketResponse } from '../src/lib/market-client';
import type { FxHistory, MarketResponse } from '../src/lib/types';

const sample = (): MarketResponse => ({
  series: {
    VTI: {
      symbol: 'VTI',
      currency: 'USD',
      prices: [
        { date: '2026-11-05', close: 360 },
        { date: '2026-11-06', close: 362 },
      ],
      source: 'Yahoo Finance · bereinigte Tagesschlusskurse',
      sourceUrl: 'https://finance.yahoo.com/quote/VTI/history/',
      fetchedAt: '2026-11-06T21:26:20.520Z',
      asOf: '2026-11-06',
      status: 'fresh',
    },
  },
  fx: { eurUsd: 1.1165, date: '2026-11-06', source: 'Europäische Zentralbank', status: 'fresh' },
  fetchedAt: '2026-11-06T21:26:20.520Z',
});
const history = (): FxHistory => ({
  base: 'EUR',
  quote: 'USD',
  rates: [
    { date: '2026-11-05', eurUsd: 1.1 },
    { date: '2026-11-06', eurUsd: 1.1165 },
  ],
  source: 'Europäische Zentralbank · historische EUR/USD-Referenzkurse',
  sourceUrl: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
  fetchedAt: '2026-11-06T21:26:20.520Z',
  asOf: '2026-11-06',
  status: 'fresh',
});
afterEach(() => vi.restoreAllMocks());

describe('market client on GitHub Pages', () => {
  it('loads the published JSON beneath the repository base and never requests /api', async () => {
    const data = sample();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(data));
    const result = await loadMarketData({ manual: false, pages: true, baseUrl: '/roi/', fetcher });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      '/roi/market-data.json',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
    expect(String(fetcher.mock.calls[0][0])).not.toContain('/api');
    expect(result.series.VTI.status).toBe('cached');
    expect(result.fx.status).toBe('cached');
    expect(result.fetchedAt).toBe(data.fetchedAt);
    expect(result.series.VTI.fetchedAt).toBe(data.series.VTI.fetchedAt);
    expect(result.series.VTI.asOf).toBe(data.series.VTI.asOf);
    expect(result.fx.date).toBe(data.fx.date);
    expect(result.series.VTI.prices).toEqual(data.series.VTI.prices);
  });
  it('cache-busts an explicit refresh without claiming a new provider fetch', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234567);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(sample()));
    const result = await loadMarketData({ manual: true, pages: true, baseUrl: '/roi', fetcher });
    expect(fetcher.mock.calls[0][0]).toBe('/roi/market-data.json?t=1234567');
    expect(result.series.VTI.fetchedAt).toBe('2026-11-06T21:26:20.520Z');
    expect(result.series.VTI.status).toBe('cached');
  });
  it('supports an account site hosted at the origin root', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(sample()));
    await loadMarketData({ manual: false, pages: true, baseUrl: '/', fetcher });
    expect(fetcher.mock.calls[0][0]).toBe('/market-data.json');
  });
  it('rejects a missing or HTML data response', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Not Found', { status: 404 }));
    await expect(
      loadMarketData({ manual: false, pages: true, baseUrl: '/roi/', fetcher }),
    ).rejects.toThrow('HTTP 404');
    fetcher.mockResolvedValue(new Response('<html>404</html>'));
    await expect(
      loadMarketData({ manual: false, pages: true, baseUrl: '/roi/', fetcher }),
    ).rejects.toThrow('ungültig');
  });
});

describe('market client response validation', () => {
  it('accepts legacy datasets without silently inventing a historical exchange rate', () => {
    const parsed = parseMarketResponse(sample(), true);
    expect(parsed.fx.history).toBeUndefined();
  });
  it('preserves genuine FX observations and provenance independently of the daily reference', () => {
    const data = sample();
    data.fx.history = history();
    data.fx.date = '2026-11-09';
    data.fx.eurUsd = 1.2;
    const parsed = parseMarketResponse(data, true);
    expect(parsed.fx.eurUsd).toBe(1.2);
    expect(parsed.fx.date).toBe('2026-11-09');
    expect(parsed.fx.history).toEqual({ ...history(), status: 'cached' });
    parsed.fx.history!.rates[0].eurUsd = 2;
    expect(data.fx.history.rates[0].eurUsd).toBe(1.1);
    expect(data.fx.history.status).toBe('fresh');
  });
  it('does not mark server FX history cached when the provider result is fresh', () => {
    const data = sample();
    data.fx.history = history();
    expect(parseMarketResponse(data).fx.history?.status).toBe('fresh');
  });
  it.each([
    { rates: [{ date: '2026-11-05', eurUsd: 1.1 }] },
    { base: 'USD' },
    { quote: 'EUR' },
    { sourceUrl: 'javascript:alert(1)' },
    { fetchedAt: 'missing' },
    { fetchedAt: '2099-11-07T00:00:00Z' },
    { asOf: '2026-11-05' },
    { status: 'unknown' },
    { error: 123 },
    {
      rates: [
        { date: '2026-11-05', eurUsd: 0 },
        { date: '2026-11-06', eurUsd: 1.1 },
      ],
    },
    {
      rates: [
        { date: '2026-11-05', eurUsd: Number.POSITIVE_INFINITY },
        { date: '2026-11-06', eurUsd: 1.1 },
      ],
    },
    {
      rates: [
        { date: '2026-02-30', eurUsd: 1.1 },
        { date: '2026-11-06', eurUsd: 1.1 },
      ],
    },
    {
      rates: [
        { date: '2026-11-06', eurUsd: 1.1 },
        { date: '2026-11-06', eurUsd: 1.1 },
      ],
    },
    {
      rates: [
        { date: '2026-11-06', eurUsd: 1.1 },
        { date: '2026-11-05', eurUsd: 1.1 },
      ],
    },
    { fetchedAt: '2026-11-05T23:00:00Z' },
    {
      rates: [
        { date: '2099-11-05', eurUsd: 1.1 },
        { date: '2099-11-06', eurUsd: 1.1 },
      ],
      asOf: '2099-11-06',
      fetchedAt: '2099-11-07T00:00:00Z',
    },
  ])('rejects malformed explicit FX history: %o', (override) => {
    const data = sample();
    data.fx.history = { ...history(), ...override } as FxHistory;
    expect(() => parseMarketResponse(data)).toThrow('ungültig');
  });
  it('preserves explicitly unavailable FX history without filling daily fallback observations', () => {
    const missing = {
      ...history(),
      rates: [],
      asOf: '',
      fetchedAt: '',
      status: 'unavailable' as const,
      error: 'Ausfall',
    };
    expect(parseFxHistory(missing, true)).toEqual(missing);
    expect(() => parseFxHistory({ ...missing, rates: history().rates })).toThrow();
  });
  it('retains server API semantics outside Pages', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(sample()));
    const result = await loadMarketData({ manual: true, pages: false, baseUrl: '/', fetcher });
    expect(fetcher.mock.calls[0][0]).toBe('/api/market?refresh=1');
    expect(result.series.VTI.status).toBe('fresh');
    expect(result.fx.status).toBe('fresh');
  });
  it('rejects unknown symbols and mismatched currency instead of valuing them', () => {
    const unknown = sample();
    unknown.series.EVIL = { ...unknown.series.VTI, symbol: 'EVIL' };
    expect(() => parseMarketResponse(unknown, true)).toThrow();
    const currency = sample();
    currency.series.VTI.currency = 'EUR';
    expect(() => parseMarketResponse(currency, true)).toThrow();
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a nonpositive/nonfinite close: %s',
    (close) => {
      const data = sample();
      data.series.VTI.prices[0].close = close;
      expect(() => parseMarketResponse(data, true)).toThrow();
    },
  );
  it('rejects impossible, duplicate, unsorted or provenance-mismatched dates', () => {
    for (const dates of [
      ['2026-02-30', '2026-11-06'],
      ['2026-11-06', '2026-11-06'],
      ['2026-11-06', '2026-11-05'],
      ['2026-11-05', '2026-11-07'],
    ]) {
      const data = sample();
      data.series.VTI.prices = dates.map((date) => ({ date, close: 100 }));
      expect(() => parseMarketResponse(data, true)).toThrow();
    }
    const data = sample();
    data.series.VTI.asOf = '2026-11-05';
    expect(() => parseMarketResponse(data, true)).toThrow();
  });
  it('rejects missing or invalid FX rather than inventing a conversion', () => {
    const data = sample();
    data.fx.eurUsd = 0;
    expect(() => parseMarketResponse(data, true)).toThrow();
    expect(() => parseMarketResponse({ series: sample().series }, true)).toThrow();
  });
  it('preserves explicitly unavailable instruments without replacing them with zero prices', () => {
    const data = sample();
    data.series.VTI = {
      ...data.series.VTI,
      prices: [],
      fetchedAt: '',
      asOf: '',
      status: 'unavailable',
      error: 'Anbieter nicht erreichbar',
    };
    const result = parseMarketResponse(data, true);
    expect(result.series.VTI.status).toBe('unavailable');
    expect(result.series.VTI.prices).toEqual([]);
    expect(result.series.VTI.error).toBe('Anbieter nicht erreichbar');
  });
  it('rejects unsafe source links and does not mutate caller data', () => {
    const data = sample();
    const parsed = parseMarketResponse(data, true);
    expect(data.series.VTI.status).toBe('fresh');
    parsed.series.VTI.prices[0].close = 1;
    expect(data.series.VTI.prices[0].close).toBe(360);
    data.series.VTI.sourceUrl = 'javascript:alert(1)';
    expect(() => parseMarketResponse(data, true)).toThrow();
  });
});
