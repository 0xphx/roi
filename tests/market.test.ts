import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleMarketRequest,
  fetchFreshFxHistory,
  ECB_HISTORY_URL,
  parseEcb,
  parseEcbHistory,
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
const fxXml = (entries: Array<[string, string | number]>) =>
  `<Envelope><Cube>${entries.map(([date, rate]) => `<Cube time='${date}'><Cube currency='JPY' rate='160'/><Cube rate='${rate}' currency='USD'/></Cube>`).join('')}</Cube></Envelope>`;
function completeFxXml() {
  const entries: Array<[string, number]> = [];
  for (
    const date = new Date('2021-11-01T00:00:00Z');
    date <= new Date('2026-11-06T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
      entries.push([date.toISOString().slice(0, 10), 1.1]);
  }
  return fxXml(entries.reverse());
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.doUnmock('../src/data/market-snapshot.json');
});

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
    expect(() =>
      parseEcb("<Cube time='2026-02-30'><Cube currency='USD' rate='1.1'/></Cube>"),
    ).toThrow();
  });

  it('reads historical ECB quotation, sorts actual dates and retains provenance without gap filling', () => {
    const history = parseEcbHistory(
      fxXml([
        ['2026-11-06', 1.1165],
        ['2021-10-01', 1.2],
        ['2026-11-04', 1.12],
      ]),
      fetchedAt,
    );
    expect(history.rates).toEqual([
      { date: '2026-11-04', eurUsd: 1.12 },
      { date: '2026-11-06', eurUsd: 1.1165 },
    ]);
    expect(history).toMatchObject({
      base: 'EUR',
      quote: 'USD',
      asOf: '2026-11-06',
      fetchedAt,
      sourceUrl: ECB_HISTORY_URL,
      status: 'fresh',
    });
  });

  it.each([
    fxXml([
      ['2026-02-30', 1.1],
      ['2026-11-06', 1.2],
    ]),
    fxXml([
      ['2026-11-06', 1.1],
      ['2026-11-06', 1.2],
    ]),
    fxXml([
      ['2026-11-05', 0],
      ['2026-11-06', 1.2],
    ]),
    fxXml([
      ['2026-11-05', 'Infinity'],
      ['2026-11-06', 1.2],
    ]),
    fxXml([
      ['2026-11-05', 1.1],
      ['2026-11-07', 1.2],
    ]),
    fxXml([['2026-11-06', 1.2]]),
    "<Cube time='2026-11-05'><Cube currency='JPY' rate='160'/></Cube><Cube time='2026-11-06'><Cube currency='USD' rate='1.2'/></Cube>",
    "<Cube time='2026-11-05'><Cube currency='USD' rate='1.1'/><Cube currency='USD' rate='1.2'/></Cube><Cube time='2026-11-06'><Cube currency='USD' rate='1.2'/></Cube>",
    '<html>not available</html>',
  ])('refuses malformed, future, duplicate or incomplete historical FX input', (xml) => {
    expect(() => parseEcbHistory(xml, fetchedAt)).toThrow();
  });

  it('rejects invalid retrieval timestamps and keeps the ten-day boundary around five years', () => {
    const xml = fxXml([
      ['2021-10-26', 1.1],
      ['2021-10-27', 1.11],
      ['2026-11-06', 1.2],
    ]);
    expect(parseEcbHistory(xml, fetchedAt).rates.map((p) => p.date)).toEqual([
      '2021-10-27',
      '2026-11-06',
    ]);
    expect(() => parseEcbHistory(xml, 'not-a-date')).toThrow();
    expect(() => parseEcbHistory(xml, '2026-02-30T12:00:00Z')).toThrow();
  });

  it('fetches the official full history and rejects a truncated provider response', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(fetchedAt));
    const fetchMock = vi.fn().mockResolvedValue(new Response(completeFxXml()));
    vi.stubGlobal('fetch', fetchMock);
    const history = await fetchFreshFxHistory();
    expect(fetchMock.mock.calls[0][0]).toBe(ECB_HISTORY_URL);
    expect(history.rates.length).toBeGreaterThan(1000);
    expect(history.fetchedAt).toBe(fetchedAt);
    fetchMock.mockResolvedValue(
      new Response(
        fxXml([
          ['2026-11-05', 1.1],
          ['2026-11-06', 1.2],
        ]),
      ),
    );
    await expect(fetchFreshFxHistory()).rejects.toThrow('ausreichend lange');
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
    expect(fetchMock).toHaveBeenCalledTimes(4); // Yahoo + Stooq + ECB daily/history, shared by both callers.
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

describe('independent daily and historical FX caches', () => {
  async function isolatedApi() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(fetchedAt));
    vi.resetModules();
    vi.doMock('../src/data/market-snapshot.json', () => ({
      default: { ...snapshotData, fx: { ...snapshotData.fx, history: undefined } },
    }));
    return (await import('../server/market')).handleMarketRequest;
  }
  function providerMock() {
    return vi.fn(async (url: string) => {
      if (url.includes('eurofxref-hist.xml')) return new Response(completeFxXml());
      if (url.includes('eurofxref-daily.xml'))
        return new Response("<Cube time='2026-11-06'><Cube currency='USD' rate='1.1165'/></Cube>");
      throw new Error('Asset provider unavailable');
    });
  }
  const request = () => new Request('http://localhost/api/market?symbols=VTI&refresh=1');

  it('keeps historical dates and retrieval timestamps when only the history provider fails', async () => {
    const api = await isolatedApi();
    const fetchMock = providerMock();
    vi.stubGlobal('fetch', fetchMock);
    const first = (await (await api(request())).json()) as MarketResponse;
    expect(first.fx.history?.status).toBe('fresh');
    expect(first.fx.history?.rates.length).toBeGreaterThan(1000);
    vi.setSystemTime(new Date('2026-11-06T21:32:00.000Z'));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('eurofxref-daily.xml'))
        return new Response("<Cube time='2026-11-06'><Cube currency='USD' rate='1.2'/></Cube>");
      throw new Error('History offline');
    });
    const second = (await (await api(request())).json()) as MarketResponse;
    expect(second.fx).toMatchObject({ eurUsd: 1.2, status: 'fresh' });
    expect(second.fx.history).toEqual({
      ...first.fx.history,
      status: 'cached',
      error: 'History offline',
    });
  });

  it('loads a fresh history even when the daily reference rate cannot be refreshed', async () => {
    const api = await isolatedApi();
    const fetchMock = providerMock();
    vi.stubGlobal('fetch', fetchMock);
    const first = (await (await api(request())).json()) as MarketResponse;
    vi.setSystemTime(new Date('2026-11-06T21:32:00.000Z'));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('eurofxref-hist.xml')) return new Response(completeFxXml());
      throw new Error('Daily offline');
    });
    const second = (await (await api(request())).json()) as MarketResponse;
    expect(second.fx.eurUsd).toBe(first.fx.eurUsd);
    expect(second.fx.status).toBe('cached');
    expect(second.fx.history?.status).toBe('fresh');
    expect(second.fx.history?.fetchedAt).toBe('2026-11-06T21:32:00.000Z');
    expect(second.fx.history?.rates).toEqual(first.fx.history?.rates);
  });

  it('retains the five-year history if a later history response is truncated', async () => {
    const api = await isolatedApi();
    const fetchMock = providerMock();
    vi.stubGlobal('fetch', fetchMock);
    const first = (await (await api(request())).json()) as MarketResponse;
    vi.setSystemTime(new Date('2026-11-06T21:32:00.000Z'));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('eurofxref-hist.xml'))
        return new Response(
          fxXml([
            ['2026-11-05', 1.1],
            ['2026-11-06', 1.2],
          ]),
        );
      throw new Error('Provider offline');
    });
    const second = (await (await api(request())).json()) as MarketResponse;
    expect(second.fx.history?.rates).toEqual(first.fx.history?.rates);
    expect(second.fx.history?.fetchedAt).toBe(first.fx.history?.fetchedAt);
    expect(second.fx.history?.asOf).toBe(first.fx.history?.asOf);
    expect(second.fx.history?.status).toBe('cached');
    expect(second.fx.history?.error).toContain('ausreichend lange');
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
