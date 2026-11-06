import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMarketData, parseMarketResponse } from '../src/lib/market-client';
import type { MarketResponse } from '../src/lib/types';

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
