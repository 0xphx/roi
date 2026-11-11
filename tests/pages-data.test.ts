import { describe, expect, it } from 'vitest';
import { mergePagesData } from '../scripts/refresh-pages-data';
import { INSTRUMENTS } from '../src/data/catalog';
import type { FxHistory, MarketResponse, MarketSeries } from '../src/lib/types';

// Deliberately synthetic fixtures: refreshing real bundled data must not move unit-test dates.
const snapshot: MarketResponse = {
  series: Object.fromEntries(
    INSTRUMENTS.map((instrument) => [
      instrument.symbol,
      {
        symbol: instrument.symbol,
        currency: instrument.currency,
        prices: [
          { date: '2026-11-05', close: 100 },
          { date: '2026-11-06', close: 110 },
        ],
        source: 'Synthetische Testdaten',
        sourceUrl: 'https://example.com/market-test',
        fetchedAt: '2026-11-06T21:26:20.520Z',
        asOf: '2026-11-06',
        status: 'cached',
      },
    ]),
  ),
  fx: { eurUsd: 1.1165, date: '2026-11-06', source: 'Synthetische Testdaten', status: 'cached' },
  fetchedAt: '2026-11-06T21:26:20.520Z',
};
const history = (date = '2026-11-06'): FxHistory => ({
  base: 'EUR',
  quote: 'USD',
  rates: [
    { date: '2026-11-04', eurUsd: 1.1 },
    { date, eurUsd: 1.2 },
  ],
  source: 'Synthetische EUR/USD-Testdaten',
  sourceUrl: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
  fetchedAt: `${date}T23:00:00.000Z`,
  asOf: date,
  status: 'fresh',
});
function newer(symbol: string, date = '2026-11-09', close = 500): MarketSeries {
  const original = snapshot.series[symbol];
  return {
    ...original,
    prices: [...original.prices, { date, close }],
    asOf: date,
    fetchedAt: `${date}T22:00:00.000Z`,
    status: 'fresh',
  };
}

describe('static Pages data refresh', () => {
  it('keeps genuine bundled data and original timestamps when every provider fails', () => {
    const data = mergePagesData({ fallback: snapshot, errors: { VTI: 'HTTP 429' } });
    expect(data.fetchedAt).toBe(snapshot.fetchedAt);
    expect(data.series.VTI.asOf).toBe(snapshot.series.VTI.asOf);
    expect(data.series.VTI.fetchedAt).toBe(snapshot.series.VTI.fetchedAt);
    expect(data.series.VTI.prices).toEqual(snapshot.series.VTI.prices);
    expect(data.series.VTI.error).toBe('HTTP 429');
    expect(Object.values(data.series).every((s) => s.status === 'cached')).toBe(true);
  });

  it('retains the newer previously published asset independently of other assets', () => {
    const vti = newer('VTI');
    const published = {
      ...snapshot,
      series: { ...snapshot.series, VTI: vti },
      fetchedAt: vti.fetchedAt,
    };
    const data = mergePagesData({ fallback: snapshot, published, errors: { VTI: 'Timeout' } });
    expect(data.series.VTI.asOf).toBe('2026-11-09');
    expect(data.series.VTI.prices.at(-1)!.close).toBe(500);
    expect(data.series.VTI.fetchedAt).toBe(vti.fetchedAt);
    expect(data.series.BND.asOf).toBe(snapshot.series.BND.asOf);
  });

  it('updates successful symbols even when another provider request failed', () => {
    const vti = newer('VTI');
    const data = mergePagesData({
      fallback: snapshot,
      updates: { VTI: vti },
      errors: { BND: 'Ausfall' },
    });
    expect(data.series.VTI.asOf).toBe(vti.asOf);
    expect(data.series.VTI.status).toBe('cached');
    expect(data.series.VTI.source).toBe(vti.source);
    expect(data.series.VTI.sourceUrl).toBe(vti.sourceUrl);
    expect(data.series.BND.fetchedAt).toBe(snapshot.series.BND.fetchedAt);
    expect(data.series.BND.error).toBe('Ausfall');
  });

  it('never replaces a newer market date with an older series fetched later', () => {
    const vti = newer('VTI');
    const published = {
      ...snapshot,
      series: { ...snapshot.series, VTI: vti },
      fetchedAt: vti.fetchedAt,
    };
    const older = { ...snapshot.series.VTI, fetchedAt: '2026-11-10T22:00:00.000Z' };
    const data = mergePagesData({ fallback: snapshot, published, updates: { VTI: older } });
    expect(data.series.VTI.asOf).toBe(vti.asOf);
    expect(data.series.VTI.fetchedAt).toBe(vti.fetchedAt);
  });

  it('uses the most recently retrieved provider value when market dates are identical', () => {
    const update = {
      ...snapshot.series.VTI,
      fetchedAt: '2026-11-06T23:00:00.000Z',
      source: 'Yahoo Finance · geprüft',
    };
    const data = mergePagesData({ fallback: snapshot, updates: { VTI: update } });
    expect(data.series.VTI.fetchedAt).toBe(update.fetchedAt);
    expect(data.series.VTI.source).toBe(update.source);
  });

  it('rejects malformed published data without damaging the valid fallback', () => {
    const data = mergePagesData({
      fallback: snapshot,
      published: { ...snapshot, fx: { eurUsd: 0 } },
    });
    expect(data.series.VTI).toEqual(snapshot.series.VTI);
    expect(() => mergePagesData({ fallback: {}, published: {} })).toThrow('Fallback');
  });

  it('rejects invalid fresh quotes and retains the valid saved data', () => {
    const invalid = { ...newer('VTI'), prices: [{ date: '2026-11-09', close: -1 }] };
    const data = mergePagesData({ fallback: snapshot, updates: { VTI: invalid } });
    expect(data.series.VTI).toEqual(snapshot.series.VTI);
  });

  it('does not regress FX dates and preserves source metadata', () => {
    const fx = { ...snapshot.fx, date: '2026-11-09', eurUsd: 1.2, status: 'fresh' as const };
    const published = { ...snapshot, fx };
    const data = mergePagesData({ fallback: snapshot, published, fxUpdate: snapshot.fx });
    expect(data.fx).toEqual({ ...fx, status: 'cached' });
  });

  it('keeps the published FX history when daily FX advances but historical retrieval fails', () => {
    const previousHistory = history('2026-11-09');
    const published = { ...snapshot, fx: { ...snapshot.fx, history: previousHistory } };
    const daily = { ...snapshot.fx, date: '2026-11-10', eurUsd: 1.3, status: 'fresh' as const };
    const data = mergePagesData({ fallback: snapshot, published, fxUpdate: daily });
    expect(data.fx.date).toBe('2026-11-10');
    expect(data.fx.eurUsd).toBe(1.3);
    expect(data.fx.history).toEqual({ ...previousHistory, status: 'cached' });
    expect(data.fx.history?.fetchedAt).toBe('2026-11-09T23:00:00.000Z');
    expect(data.fetchedAt).toBe('2026-11-09T23:00:00.000Z');
  });

  it('advances historical FX even when only its provider request succeeds', () => {
    const nextHistory = history('2026-11-09');
    const data = mergePagesData({ fallback: snapshot, fxHistoryUpdate: nextHistory });
    expect(data.fx.date).toBe(snapshot.fx.date);
    expect(data.fx.history).toEqual({ ...nextHistory, status: 'cached' });
    expect(data.fetchedAt).toBe(nextHistory.fetchedAt);
    expect(nextHistory.status).toBe('fresh');
  });

  it('accepts an embedded historical FX update independently of its older daily quote', () => {
    const latest = history('2026-11-09');
    const published = { ...snapshot, fx: { ...snapshot.fx, date: '2026-11-10', eurUsd: 1.3 } };
    const data = mergePagesData({
      fallback: snapshot,
      published,
      fxUpdate: { ...snapshot.fx, history: latest },
    });
    expect(data.fx.date).toBe('2026-11-10');
    expect(data.fx.history?.asOf).toBe('2026-11-09');
  });

  it('never regresses the historical reference date for a later retrieval of older observations', () => {
    const previousHistory = history('2026-11-09');
    const older = { ...history(), fetchedAt: '2026-11-10T23:00:00.000Z' };
    const data = mergePagesData({
      fallback: snapshot,
      published: { ...snapshot, fx: { ...snapshot.fx, history: previousHistory } },
      fxHistoryUpdate: older,
    });
    expect(data.fx.history?.asOf).toBe(previousHistory.asOf);
    expect(data.fx.history?.fetchedAt).toBe(previousHistory.fetchedAt);
  });

  it('retains wider same-date history instead of replacing it with a shortened response', () => {
    const previousHistory = history('2026-11-09');
    const shorter = {
      ...previousHistory,
      rates: [{ date: '2026-11-05', eurUsd: 1.15 }, previousHistory.rates[1]],
      fetchedAt: '2026-11-10T23:00:00.000Z',
    };
    const data = mergePagesData({
      fallback: snapshot,
      published: { ...snapshot, fx: { ...snapshot.fx, history: previousHistory } },
      fxHistoryUpdate: shorter,
    });
    expect(data.fx.history?.rates).toEqual(previousHistory.rates);
    expect(data.fx.history?.fetchedAt).toBe(previousHistory.fetchedAt);
  });

  it('retains original history metadata and does not splice retrievals into an invented series', () => {
    const previousHistory = history();
    const latest = {
      ...history('2026-11-09'),
      rates: [
        { date: '2026-11-07', eurUsd: 1.15 },
        { date: '2026-11-09', eurUsd: 1.3 },
      ],
    };
    const data = mergePagesData({
      fallback: { ...snapshot, fx: { ...snapshot.fx, history: previousHistory } },
      fxHistoryUpdate: latest,
    });
    expect(data.fx.history?.rates).toEqual(latest.rates);
    expect(data.fx.history?.fetchedAt).toBe(latest.fetchedAt);
    data.fx.history!.rates[0].eurUsd = 2;
    expect(latest.rates[0].eurUsd).toBe(1.15);
  });

  it('isolates malformed historical FX without discarding newer valid published instruments or daily FX', () => {
    const vti = newer('VTI');
    const invalidHistory = {
      ...history('2026-11-09'),
      rates: [{ date: '2026-11-09', eurUsd: -1 }],
    };
    const published = {
      ...snapshot,
      series: { ...snapshot.series, VTI: vti },
      fx: { ...snapshot.fx, date: '2026-11-09', history: invalidHistory },
      fetchedAt: vti.fetchedAt,
    };
    const data = mergePagesData({
      fallback: { ...snapshot, fx: { ...snapshot.fx, history: history() } },
      published,
    });
    expect(data.series.VTI.asOf).toBe(vti.asOf);
    expect(data.fx.date).toBe('2026-11-09');
    expect(data.fx.history?.asOf).toBe('2026-11-06');
  });

  it('ignores malformed/unavailable historical candidates without inventing missing history', () => {
    const unavailable = {
      ...history(),
      rates: [],
      asOf: '',
      fetchedAt: '',
      status: 'unavailable' as const,
    };
    const data = mergePagesData({ fallback: snapshot, fxHistoryUpdate: unavailable });
    expect(data.fx.history).toBeUndefined();
    const malformed = { ...history(), rates: [{ date: '2026-11-06', eurUsd: 0 }] };
    expect(
      mergePagesData({ fallback: snapshot, fxHistoryUpdate: malformed }).fx.history,
    ).toBeUndefined();
  });

  it('does not prefer an unavailable FX record over a usable older reference rate', () => {
    const unavailable = {
      ...snapshot,
      fx: { ...snapshot.fx, date: '2026-11-09', status: 'unavailable' as const },
    };
    const data = mergePagesData({ fallback: unavailable, published: snapshot });
    expect(data.fx).toEqual(snapshot.fx);
  });

  it('does not mutate shared snapshot objects while normalizing statuses', () => {
    const update = newer('VTI');
    const data = mergePagesData({ fallback: snapshot, updates: { VTI: update } });
    data.series.VTI.prices[0].close = 0;
    expect(snapshot.series.VTI.prices[0].close).toBeGreaterThan(0);
    expect(update.status).toBe('fresh');
  });
});
