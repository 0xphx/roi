import { describe, expect, it } from 'vitest';
import {
  backtest,
  currentPortfolio,
  monteCarlo,
  portfolioHistory,
  riskMetrics,
  stressTest,
} from '../src/lib/analytics';
import type { Holding, MarketSeries, Plan } from '../src/lib/types';

const holding = (symbol = 'VTI', overrides: Partial<Holding> = {}): Holding => ({
  id: symbol,
  symbol,
  quantity: 1,
  averageCost: 80,
  targetWeight: 100,
  ...overrides,
});
const series = (symbol: string, rows: [string, number][], currency = 'USD'): MarketSeries => ({
  symbol,
  currency,
  prices: rows.map(([date, close]) => ({ date, close })),
  source: 'test fixture',
  sourceUrl: 'https://example.test',
  fetchedAt: '2026-01-05T12:00:00Z',
  asOf: rows.at(-1)?.[0] ?? '',
  status: 'fresh',
});
const plan: Plan = {
  initialCapital: 10_000,
  monthlyContribution: 100,
  years: 10,
  expectedReturn: 0.07,
  volatility: 0.15,
  inflation: 0.02,
  annualFee: 0.002,
  target: 25_000,
  simulations: 1000,
  seed: 42,
};
const options = { initialCapital: 100, monthlyContribution: 0, rebalance: 'none' as const, fee: 0 };

function dailyRows(count: number, close: (index: number) => number): [string, number][] {
  return Array.from({ length: count }, (_, index) => [
    new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
    close(index),
  ]);
}

describe('portfolio valuations', () => {
  it('converts native share costs and latest prices into EUR', () => {
    const result = currentPortfolio(
      [holding('VTI', { quantity: 2, averageCost: 60 })],
      {
        VTI: series('VTI', [
          ['2026-01-01', 100],
          ['2026-01-02', 120],
        ]),
      },
      1.2,
    );
    expect(result.value).toBeCloseTo(200);
    expect(result.cost).toBeCloseTo(100);
    expect(result.gainPercent).toBeCloseTo(1);
    expect(result.positions[0].price).toBe(120);
    expect(result.positions[0].weight).toBe(1);
    expect(result.complete).toBe(true);
  });

  it('flags unavailable data and refuses to report a partial portfolio as complete', () => {
    const result = currentPortfolio(
      [holding(), holding('BND')],
      { VTI: series('VTI', [['2026-01-01', 100]]) },
      1,
    );
    expect(result.complete).toBe(false);
    expect(result.missingSymbols).toEqual(['BND']);
    expect(Number.isNaN(result.value)).toBe(true);
  });

  it('never silently interprets an unsupported currency as EUR', () => {
    const result = currentPortfolio(
      [holding()],
      { VTI: series('VTI', [['2026-01-01', 100]], 'GBP') },
      1.2,
    );
    expect(result.complete).toBe(false);
    expect(Number.isNaN(result.value)).toBe(true);
  });

  it('uses only exact common dates without backfilling late-inception assets', () => {
    const market = {
      VTI: series('VTI', [
        ['2026-01-01', 100],
        ['2026-01-02', 110],
        ['2026-01-03', 120],
        ['2026-01-04', 130],
      ]),
      BND: series('BND', [
        ['2026-01-02', 50],
        ['2026-01-04', 60],
      ]),
      SPY: series('SPY', [
        ['2026-01-02', 200],
        ['2026-01-04', 220],
      ]),
    };
    const result = portfolioHistory([holding(), holding('BND', { quantity: 2 })], market, 2);
    expect(result.map((point) => point.date)).toEqual(['2026-01-02', '2026-01-04']);
    expect(result[0].value).toBe(105);
    expect(result[1].value).toBe(125);
    expect(result[1].benchmark).toBeCloseTo(115.5);
  });

  it('returns no portfolio history when any held asset has no observations', () => {
    expect(
      portfolioHistory(
        [holding(), holding('BND')],
        { VTI: series('VTI', [['2026-01-01', 100]]) },
        1,
      ),
    ).toEqual([]);
  });

  it('does not invent a benchmark when SPY is absent', () => {
    const result = portfolioHistory([holding()], { VTI: series('VTI', [['2026-01-01', 100]]) }, 1);
    expect(Number.isNaN(result[0].benchmark)).toBe(true);
  });

  it('tracks underwater values from the running high-water mark', () => {
    const result = portfolioHistory(
      [holding()],
      {
        VTI: series('VTI', [
          ['2026-01-01', 100],
          ['2026-01-02', 80],
          ['2026-01-03', 90],
          ['2026-01-04', 110],
        ]),
      },
      1,
    );
    expect(result.map((point) => Math.round(point.drawdown * 100))).toEqual([0, -20, -10, 0]);
  });
});

describe('historical risk metrics', () => {
  it('calculates geometric annual returns and the correct loss from peak', () => {
    const result = riskMetrics(
      [
        { date: 'a', value: 100 },
        { date: 'b', value: 120 },
        { date: 'c', value: 90 },
        { date: 'd', value: 108 },
      ],
      0,
    );
    expect(result.totalReturn).toBeCloseTo(0.08);
    expect(result.annualReturn).toBeCloseTo(1.08 ** (252 / 3) - 1);
    expect(result.maxDrawdown).toBeCloseTo(0.25);
    expect(result.observations).toBe(3);
  });

  it('uses sample volatility and annual arithmetic excess return for Sharpe', () => {
    const result = riskMetrics(
      [
        { date: 'a', value: 100 },
        { date: 'b', value: 110 },
        { date: 'c', value: 99 },
      ],
      0.02,
    );
    expect(result.volatility).toBeCloseTo(Math.sqrt(0.02 * 252));
    expect(result.sharpe).toBeCloseTo(-0.02 / Math.sqrt(0.02 * 252));
  });

  it('keeps CVaR valid with fewer than twenty returns', () => {
    const result = riskMetrics(
      [
        { date: 'a', value: 100 },
        { date: 'b', value: 90 },
        { date: 'c', value: 99 },
      ],
      0,
    );
    expect(result.var95).toBeCloseTo(0.09);
    expect(result.cvar95).toBeCloseTo(0.1);
    expect(result.cvar95).toBeGreaterThanOrEqual(result.var95);
  });

  it('uses an exact five-percent empirical tail when its observation count is fractional', () => {
    const returns = [-0.4, -0.2, ...Array(28).fill(0.01)];
    let value = 100;
    const history = [{ date: '0', value }];
    for (const [index, dailyReturn] of returns.entries()) {
      value *= 1 + dailyReturn;
      history.push({ date: String(index + 1), value });
    }
    expect(riskMetrics(history, 0).cvar95).toBeCloseTo((0.4 + 0.2 * 0.5) / 1.5);
  });

  it('reports zero tail loss when every observed return is positive', () => {
    const result = riskMetrics(
      [
        { date: 'a', value: 100 },
        { date: 'b', value: 110 },
        { date: 'c', value: 120 },
      ],
      0,
    );
    expect(result.var95).toBe(0);
    expect(result.cvar95).toBe(0);
    expect(result.maxDrawdown).toBe(0);
  });

  it('handles empty and single-point histories without NaN metrics', () => {
    for (const history of [[], [{ date: 'a', value: 100 }]]) {
      const result = riskMetrics(history, 0.02);
      expect(Object.values(result).every(Number.isFinite)).toBe(true);
      expect(result.observations).toBe(0);
      expect(result.volatility).toBe(0);
    }
  });
});

describe('stress scenarios', () => {
  it('applies each asset class shock to its current EUR exposure', () => {
    const result = stressTest(
      [holding('VTI', { quantity: 2 }), holding('BND')],
      {
        VTI: series('VTI', [['2026-01-01', 100]]),
        BND: series('BND', [['2026-01-01', 100]]),
      },
      2,
      { equity: -0.4, bond: 0.1, gold: 0, crypto: -0.7, realestate: -0.3 },
    );
    expect(result.currentValue).toBe(150);
    expect(result.stressedValue).toBe(115);
    expect(result.loss).toBe(35);
    expect(result.lossPercent).toBeCloseTo(35 / 150);
    expect(result.positions.map((position) => position.impact)).toEqual([-40, 5]);
  });

  it('does not present incomplete scenario exposures as a full portfolio', () => {
    const result = stressTest([holding()], {}, 1, {
      equity: -0.4,
      bond: 0,
      gold: 0,
      crypto: 0,
      realestate: 0,
    });
    expect(Number.isNaN(result.loss)).toBe(true);
    expect(result.positions).toEqual([]);
  });

  it('rejects scenarios that could produce negative asset values', () => {
    expect(() =>
      stressTest([holding()], { VTI: series('VTI', [['2026-01-01', 100]]) }, 1, {
        equity: -1.1,
        bond: 0,
        gold: 0,
        crypto: 0,
        realestate: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe('Monte Carlo planning', () => {
  it('is reproducible from a seed and produces ordered percentile bands', () => {
    const first = monteCarlo(plan);
    expect(first).toEqual(monteCarlo(plan));
    for (const point of first.points) {
      expect(point.p10).toBeLessThanOrEqual(point.p25);
      expect(point.p25).toBeLessThanOrEqual(point.p50);
      expect(point.p50).toBeLessThanOrEqual(point.p75);
      expect(point.p75).toBeLessThanOrEqual(point.p90);
    }
    expect(first.probabilityOfGoal).toBeGreaterThanOrEqual(0);
    expect(first.probabilityOfGoal).toBeLessThanOrEqual(1);
  });

  it('matches a deterministic monthly annuity with no volatility', () => {
    const input = { ...plan, volatility: 0, annualFee: 0, years: 5 };
    const result = monteCarlo(input);
    const growth = 1.07 ** (1 / 12);
    const expected =
      input.initialCapital * growth ** 60 +
      (input.monthlyContribution * (growth ** 60 - 1)) / (growth - 1);
    expect(result.median).toBeCloseTo(expected, 6);
    expect(result.points.at(-1)!.p10).toBe(result.points.at(-1)!.p90);
    expect(result.contributed).toBe(16_000);
    expect(result.realMedian).toBeCloseTo(result.median / 1.02 ** 5);
  });

  it('handles zero returns and zero volatility without dividing by zero', () => {
    const result = monteCarlo({
      ...plan,
      expectedReturn: 0,
      volatility: 0,
      annualFee: 0,
      years: 1,
    });
    expect(result.median).toBe(11_200);
    expect(result.contributed).toBe(11_200);
  });

  it('deducts annual fees multiplicatively instead of treating them as deposits', () => {
    const result = monteCarlo({
      ...plan,
      expectedReturn: 0,
      volatility: 0,
      annualFee: 0.01,
      monthlyContribution: 0,
      years: 2,
    });
    expect(result.median).toBeCloseTo(10_000 * 0.99 ** 2);
  });

  it('handles a zero-year plan and validates impossible model inputs', () => {
    const result = monteCarlo({ ...plan, years: 0, target: 10_000 });
    expect(result.points).toHaveLength(1);
    expect(result.median).toBe(10_000);
    expect(result.probabilityOfGoal).toBe(1);
    expect(() => monteCarlo({ ...plan, expectedReturn: -1 })).toThrow(RangeError);
    expect(() => monteCarlo({ ...plan, monthlyContribution: Number.NaN })).toThrow(RangeError);
  });
});

describe('cashflow-aware backtesting', () => {
  it('keeps deposits out of reported performance and drawdown', () => {
    const market = {
      VTI: series('VTI', [
        ['2026-01-30', 100],
        ['2026-02-02', 100],
        ['2026-03-02', 100],
      ]),
    };
    const result = backtest([holding()], market, 1, { ...options, monthlyContribution: 50 });
    expect(result.finalValue).toBe(200);
    expect(result.contributed).toBe(200);
    expect(result.totalReturn).toBe(0);
    expect(result.annualReturn).toBe(0);
    expect(result.maxDrawdown).toBe(0);
  });

  it('measures a loss even when a cash deposit makes the nominal portfolio rise', () => {
    const result = backtest(
      [holding()],
      {
        VTI: series('VTI', [
          ['2026-01-30', 100],
          ['2026-02-02', 50],
        ]),
      },
      1,
      { ...options, monthlyContribution: 100 },
    );
    expect(result.finalValue).toBe(150);
    expect(result.contributed).toBe(200);
    expect(result.totalReturn).toBe(-0.5);
    expect(result.maxDrawdown).toBe(0.5);
  });

  it('normalizes target weights and merges duplicate symbols', () => {
    const result = backtest(
      [
        holding('VTI', { targetWeight: 30 }),
        holding('VTI', { id: 'duplicate', targetWeight: 30 }),
        holding('BND', { targetWeight: 40 }),
      ],
      {
        VTI: series('VTI', [
          ['2026-01-01', 100],
          ['2026-01-02', 200],
        ]),
        BND: series('BND', [
          ['2026-01-01', 100],
          ['2026-01-02', 100],
        ]),
      },
      1,
      options,
    );
    expect(result.finalValue).toBe(160);
    expect(result.totalReturn).toBeCloseTo(0.6);
  });

  it('rebalances at the current close without knowledge of the next return', () => {
    const holdings = [holding('VTI', { targetWeight: 50 }), holding('BND', { targetWeight: 50 })];
    const market = {
      VTI: series('VTI', [
        ['2026-01-30', 100],
        ['2026-02-02', 200],
        ['2026-03-02', 200],
      ]),
      BND: series('BND', [
        ['2026-01-30', 100],
        ['2026-02-02', 100],
        ['2026-03-02', 200],
      ]),
    };
    expect(backtest(holdings, market, 1, options).finalValue).toBe(200);
    expect(backtest(holdings, market, 1, { ...options, rebalance: 'monthly' }).finalValue).toBe(
      225,
    );
  });

  it('deducts exactly one annual fee across a full leap year of daily crypto observations', () => {
    const result = backtest(
      [holding()],
      {
        VTI: series(
          'VTI',
          dailyRows(367, () => 100),
        ),
      },
      1,
      { ...options, fee: 0.01 },
    );
    expect(result.finalValue).toBeCloseTo(99, 8);
    expect(result.fees).toBeCloseTo(1, 8);
    expect(result.totalReturn).toBeCloseTo(-0.01, 8);
    expect(result.annualReturn).toBeCloseTo(-0.01, 8);
  });

  it('accrues annual costs across nontrading days and gaps instead of counting observations', () => {
    const result = backtest(
      [holding()],
      {
        VTI: series('VTI', [
          ['2024-01-01', 100],
          ['2025-01-01', 100],
        ]),
      },
      1,
      { ...options, fee: 0.01 },
    );
    expect(result.finalValue).toBeCloseTo(99, 8);
    expect(result.annualReturn).toBeCloseTo(-0.01, 8);
    expect(result.fees).toBeCloseTo(1, 8);
  });

  it('annualizes returns by elapsed calendar time for both daily and sparse series', () => {
    const result = backtest(
      [holding()],
      {
        VTI: series('VTI', [
          ['2024-01-01', 100],
          ['2025-01-01', 110],
        ]),
      },
      1,
      options,
    );
    expect(result.totalReturn).toBeCloseTo(0.1);
    expect(result.annualReturn).toBeCloseTo(0.1);
  });

  it('invests the same cashflows in the SPY comparison without fees', () => {
    const result = backtest(
      [holding()],
      {
        VTI: series('VTI', [
          ['2026-01-30', 100],
          ['2026-02-02', 100],
          ['2026-03-02', 100],
        ]),
        SPY: series('SPY', [
          ['2026-01-30', 100],
          ['2026-02-02', 200],
          ['2026-03-02', 100],
        ]),
      },
      1,
      { ...options, monthlyContribution: 50 },
    );
    expect(result.points[1].benchmark).toBe(250);
    expect(result.points[2].benchmark).toBe(175);
    expect(result.points[2].contributions).toBe(200);
  });

  it('can start from zero initial capital without manufacturing a return', () => {
    const result = backtest(
      [holding()],
      {
        VTI: series('VTI', [
          ['2026-01-30', 100],
          ['2026-02-02', 200],
          ['2026-03-02', 200],
        ]),
      },
      1,
      { ...options, initialCapital: 0, monthlyContribution: 50 },
    );
    expect(result.finalValue).toBe(100);
    expect(result.totalReturn).toBe(0);
  });

  it('returns no backtest for missing required historical data', () => {
    expect(
      backtest(
        [holding(), holding('BND')],
        { VTI: series('VTI', [['2026-01-01', 100]]) },
        1,
        options,
      ).points,
    ).toEqual([]);
  });
});
