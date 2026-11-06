import { describe, expect, it } from 'vitest';
import { mergePagesData } from '../scripts/refresh-pages-data';
import snapshotData from '../src/data/market-snapshot.json';
import type { MarketResponse, MarketSeries } from '../src/lib/types';

const snapshot = snapshotData as MarketResponse;
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
