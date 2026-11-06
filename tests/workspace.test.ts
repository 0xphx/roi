import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE, parseHoldingsCsv, parseWorkspace } from '../src/lib/workspace';

const workspace = () => structuredClone(DEFAULT_WORKSPACE);
describe('workspace import boundary', () => {
  it('round-trips valid exports without retaining object references', () => {
    const original = workspace();
    const parsed = parseWorkspace(JSON.parse(JSON.stringify(original)));
    expect(parsed).toEqual(original);
    parsed.holdings[0].quantity = 1;
    expect(original.holdings[0].quantity).toBe(180);
  });
  it('rejects duplicate symbols and identifiers', () => {
    const w = workspace();
    w.holdings.push({ ...w.holdings[0], id: 'duplicate' });
    expect(() => parseWorkspace(w)).toThrow('doppelte');
    w.holdings.pop();
    w.holdings[1].id = w.holdings[0].id;
    expect(() => parseWorkspace(w)).toThrow('doppelte');
  });
  it('rejects unknown securities rather than inventing quotes', () => {
    const w = workspace();
    w.holdings[0].symbol = 'UNKNOWN';
    expect(() => parseWorkspace(w)).toThrow();
  });
  it.each([NaN, Infinity, -1, 1e11])('rejects invalid quantities: %s', (quantity) => {
    const w = workspace();
    w.holdings[0].quantity = quantity;
    expect(() => parseWorkspace(w)).toThrow();
  });
  it('rejects invalid plans and unknown workspace versions', () => {
    const w = workspace();
    w.plan.years = 200;
    expect(() => parseWorkspace(w)).toThrow('Planungsannahmen');
    expect(() => parseWorkspace({ ...workspace(), version: 2 })).toThrow('Version');
  });
  it('accepts an empty portfolio without silently restoring sample holdings', () => {
    const w = workspace();
    w.holdings = [];
    expect(parseWorkspace(w).holdings).toEqual([]);
  });
  it('parses CSV with decimal points, semicolons and BOM', () => {
    const rows = parseHoldingsCsv(
      '\uFEFFsymbol;quantity;averageCost;targetWeight\r\nBTC-USD;0.125;45000.50;25',
    );
    expect(rows[0]).toMatchObject({
      symbol: 'BTC-USD',
      quantity: 0.125,
      averageCost: 45000.5,
      targetWeight: 25,
    });
  });
  it('rejects malformed or empty CSV fields', () => {
    expect(() => parseHoldingsCsv('symbol,quantity,averageCost,targetWeight\nVTI,,210,20')).toThrow(
      'Zeile',
    );
    expect(() => parseHoldingsCsv('ticker,shares\nVTI,10')).toThrow('CSV-Spalten');
  });
});
