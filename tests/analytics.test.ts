import { describe, expect, it } from 'vitest';
import {
  backtest,
  cashRebalance,
  compareStrategies,
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

describe('fair strategy comparisons', () => {
  const strategies = [
    { id: 'stocks', name: 'Aktien', holdings: [holding('VTI')] },
    { id: 'bonds', name: 'Anleihen', holdings: [holding('BND')] },
  ];

  it('uses the intersection across every strategy rather than a separate start or filled dates', () => {
    const market = {
      VTI: series('VTI', [
        ['2026-01-01', 90],
        ['2026-01-02', 100],
        ['2026-01-03', 110],
        ['2026-01-04', 120],
        ['2026-01-05', 130],
      ]),
      BND: series('BND', [
        ['2026-01-02', 50],
        ['2026-01-03', 55],
        ['2026-01-05', 60],
      ]),
    };
    const result = compareStrategies(strategies, market, 1, options);
    expect(result.startDate).toBe('2026-01-02');
    expect(result.endDate).toBe('2026-01-05');
    expect(result.observations).toBe(3);
    expect(result.points.map((point) => point.date)).toEqual([
      '2026-01-02',
      '2026-01-03',
      '2026-01-05',
    ]);
    for (const strategy of result.strategies) {
      expect(strategy.result.points.map((point) => point.date)).toEqual(
        result.points.map((point) => point.date),
      );
      expect(strategy.result.points[0].value).toBe(100);
    }
    expect(result.points.at(-1)!.values.stocks).toBeCloseTo(130);
    expect(result.points.at(-1)!.values.bonds).toBeCloseTo(120);
  });

  it('also matches available benchmark trading dates instead of inventing weekend SPY prices', () => {
    const dates: [string, number][] = [
      ['2026-01-02', 100],
      ['2026-01-03', 100],
      ['2026-01-04', 100],
      ['2026-01-05', 110],
    ];
    const result = compareStrategies(
      [{ id: 'crypto', name: 'Krypto', holdings: [holding('BTC-USD')] }],
      {
        'BTC-USD': series('BTC-USD', dates),
        SPY: series('SPY', [
          ['2026-01-02', 200],
          ['2026-01-05', 220],
        ]),
      },
      1,
      options,
    );
    expect(result.points.map((point) => point.date)).toEqual(['2026-01-02', '2026-01-05']);
    expect(result.points[1].benchmark).toBeCloseTo(110);
  });

  it('keeps a missing or unavailable benchmark explicit without discarding valid portfolio dates', () => {
    const market = {
      VTI: series('VTI', [
        ['2026-01-02', 100],
        ['2026-01-03', 110],
      ]),
    };
    const result = compareStrategies([strategies[0]], market, 1, options);
    expect(result.points).toHaveLength(2);
    expect(result.points.every((point) => Number.isNaN(point.benchmark))).toBe(true);
    const unavailable = {
      ...market,
      SPY: {
        ...series('SPY', [
          ['2026-01-02', 100],
          ['2026-01-05', 200],
        ]),
        status: 'unavailable' as const,
      },
    };
    expect(compareStrategies([strategies[0]], unavailable, 1, options).points).toEqual(
      result.points,
    );
  });

  it('invests the same cashflows on the same dates and excludes them from returns', () => {
    const result = compareStrategies(
      strategies,
      {
        VTI: series('VTI', [
          ['2026-01-20', 100],
          ['2026-01-30', 100],
          ['2026-02-02', 100],
          ['2026-03-02', 100],
        ]),
        BND: series('BND', [
          ['2026-01-30', 50],
          ['2026-02-02', 50],
          ['2026-03-02', 50],
        ]),
        SPY: series('SPY', [
          ['2026-01-30', 100],
          ['2026-02-02', 100],
          ['2026-03-02', 100],
        ]),
      },
      1,
      { ...options, monthlyContribution: 50 },
    );
    expect(result.points.map((point) => point.contributions)).toEqual([100, 150, 200]);
    for (const strategy of result.strategies) {
      expect(strategy.result.finalValue).toBe(200);
      expect(strategy.result.contributed).toBe(200);
      expect(strategy.result.totalReturn).toBe(0);
      expect(strategy.result.maxDrawdown).toBe(0);
    }
    expect(result.points.at(-1)!.benchmark).toBe(200);
  });

  it('applies the same elapsed-calendar fee convention to every strategy', () => {
    const result = compareStrategies(
      strategies,
      {
        VTI: series('VTI', [
          ['2024-01-01', 100],
          ['2025-01-01', 100],
        ]),
        BND: series('BND', [
          ['2024-01-01', 50],
          ['2025-01-01', 50],
        ]),
      },
      1,
      { ...options, fee: 0.01 },
    );
    for (const strategy of result.strategies) {
      expect(strategy.result.finalValue).toBeCloseTo(99);
      expect(strategy.result.fees).toBeCloseTo(1);
      expect(strategy.result.annualReturn).toBeCloseTo(-0.01);
    }
  });

  it('ignores zero-target instruments but never drops an active instrument with missing quotes', () => {
    const market = {
      VTI: series('VTI', [
        ['2026-01-01', 100],
        ['2026-01-02', 110],
      ]),
    };
    const ignored = [
      { ...strategies[0], holdings: [holding(), holding('BND', { targetWeight: 0 })] },
    ];
    expect(compareStrategies(ignored, market, 1, options).points).toHaveLength(2);
    expect(() => compareStrategies(strategies, market, 1, options)).toThrow(/BND/);
    expect(() => compareStrategies([strategies[0]], market, Number.NaN, options)).toThrow(
      /EUR\/USD/,
    );
    expect(() =>
      compareStrategies([strategies[0]], { VTI: { ...market.VTI, currency: 'GBP' } }, 1, options),
    ).toThrow(/Kurswährung/);
  });

  it('requires at least two genuine common observations', () => {
    expect(() =>
      compareStrategies(
        strategies,
        {
          VTI: series('VTI', [
            ['2026-01-01', 100],
            ['2026-01-02', 110],
          ]),
          BND: series('BND', [
            ['2026-01-02', 100],
            ['2026-01-03', 110],
          ]),
        },
        1,
        options,
      ),
    ).toThrow(/gemeinsame Kurstage/);
  });

  it('rejects ambiguous strategy IDs and invalid or absent target allocations', () => {
    const market = {
      VTI: series('VTI', [
        ['2026-01-01', 100],
        ['2026-01-02', 110],
      ]),
    };
    expect(() => compareStrategies([], market, 1, options)).toThrow(/einer und vier/);
    expect(() => compareStrategies(Array(5).fill(strategies[0]), market, 1, options)).toThrow(
      /einer und vier/,
    );
    expect(() => compareStrategies([strategies[0], strategies[0]], market, 1, options)).toThrow(
      /eindeutige/,
    );
    expect(() => compareStrategies([{ ...strategies[0], id: ' ' }], market, 1, options)).toThrow(
      /Kennung/,
    );
    expect(() =>
      compareStrategies(
        [{ ...strategies[0], holdings: [holding('VTI', { targetWeight: 0 })] }],
        market,
        1,
        options,
      ),
    ).toThrow(/positives Zielgewicht/);
    expect(() =>
      compareStrategies(
        [{ ...strategies[0], holdings: [holding('VTI', { targetWeight: -1 })] }],
        market,
        1,
        options,
      ),
    ).toThrow(/Zielgewichte/);
  });

  it('validates shared budgets while allowing a zero initial capital contribution strategy', () => {
    const market = {
      VTI: series('VTI', [
        ['2026-01-30', 100],
        ['2026-02-02', 100],
      ]),
    };
    expect(() =>
      compareStrategies([strategies[0]], market, 1, { ...options, initialCapital: Number.NaN }),
    ).toThrow(/Startkapital/);
    expect(() =>
      compareStrategies([strategies[0]], market, 1, { ...options, monthlyContribution: -1 }),
    ).toThrow(/Sparrate/);
    expect(() => compareStrategies([strategies[0]], market, 1, { ...options, fee: 1 })).toThrow(
      /Zusatzkosten/,
    );
    const result = compareStrategies([strategies[0]], market, 1, {
      ...options,
      initialCapital: 0,
      monthlyContribution: 50,
    });
    expect(result.strategies[0].result.finalValue).toBe(50);
    expect(result.strategies[0].result.totalReturn).toBe(0);
  });

  it('preserves inputs and handles strategy identifiers as own data keys', () => {
    const market = {
      VTI: series('VTI', [
        ['2026-01-02', 110],
        ['2026-01-01', 100],
      ]),
    };
    const selected = [{ ...strategies[0], id: '__proto__' }];
    const before = structuredClone({ selected, market, options });
    const result = compareStrategies(selected, market, 1, options);
    expect(result.points[0].values.__proto__).toBe(100);
    expect({ selected, market, options }).toEqual(before);
  });
});

describe('cash-only rebalancing', () => {
  const market = {
    VTI: series('VTI', [['2026-01-01', 100]]),
    BND: series('BND', [['2026-01-01', 100]]),
    GLD: series('GLD', [['2026-01-01', 200]]),
  };

  it('uses new capital for underweights without selling an overweight position', () => {
    const result = cashRebalance(
      [
        holding('VTI', { quantity: 8, targetWeight: 60 }),
        holding('BND', { quantity: 2, targetWeight: 40 }),
      ],
      market,
      1,
      100,
    );
    expect(result.currentValue).toBe(1000);
    expect(result.afterValue).toBe(1100);
    expect(result.invested).toBe(100);
    expect(result.positions[0].allocation).toBe(0);
    expect(result.positions[0].quantity).toBe(0);
    expect(result.positions[1].allocation).toBe(100);
    expect(result.positions[1].quantity).toBe(1);
    expect(result.positions[0].afterWeight).toBeCloseTo(800 / 1100);
    expect(result.positions[1].afterWeight).toBeCloseTo(300 / 1100);
    expect(result.positions.every((position) => position.allocation >= 0)).toBe(true);
  });

  it('distributes all cash proportionally across multiple post-deposit deficits', () => {
    const result = cashRebalance(
      [
        holding('VTI', { quantity: 8, targetWeight: 50 }),
        holding('BND', { quantity: 1, targetWeight: 30 }),
        holding('GLD', { quantity: 0.5, targetWeight: 20 }),
      ],
      market,
      1,
      200,
    );
    // EUR1,000 existing; post-deposit targets600/360/240, positive deficits0/260/140.
    expect(result.positions.map((position) => position.allocation)).toEqual([0, 130, 70]);
    expect(result.invested).toBe(200);
    expect(result.positions[1].quantity).toBeCloseTo(1.3);
    expect(result.positions[2].quantity).toBeCloseTo(0.35);
    expect(result.positions.reduce((sum, position) => sum + position.afterWeight, 0)).toBeCloseTo(
      1,
    );
  });

  it('normalizes target weights and converts extra share quantities from EUR to USD prices', () => {
    const result = cashRebalance(
      [
        holding('VTI', { quantity: 0, targetWeight: 2 }),
        holding('BND', { quantity: 0, targetWeight: 1 }),
      ],
      market,
      2,
      150,
    );
    expect(result.positions[0].targetWeight).toBeCloseTo(2 / 3);
    expect(result.positions[0].allocation).toBeCloseTo(100);
    expect(result.positions[0].quantity).toBeCloseTo(2);
    expect(result.positions[1].allocation).toBeCloseTo(50);
    expect(result.positions[1].quantity).toBeCloseTo(1);
    expect(result.positions[0].afterWeight).toBeCloseTo(2 / 3);
    expect(result.currentValue).toBe(0);
  });

  it('does not rebalance through trades when no cash is added', () => {
    const result = cashRebalance(
      [
        holding('VTI', { quantity: 8, targetWeight: 50 }),
        holding('BND', { quantity: 2, targetWeight: 50 }),
      ],
      market,
      1,
      0,
    );
    expect(result.invested).toBe(0);
    expect(result.afterValue).toBe(1000);
    for (const position of result.positions) {
      expect(position.allocation).toBe(0);
      expect(position.quantity).toBe(0);
      expect(position.afterWeight).toBe(position.currentWeight);
    }
  });

  it('does not buy a zero-target holding and can reach the target when cash is sufficient', () => {
    const result = cashRebalance(
      [
        holding('VTI', { quantity: 1, targetWeight: 0 }),
        holding('BND', { quantity: 0, targetWeight: 100 }),
      ],
      market,
      1,
      100,
    );
    expect(result.positions[0].allocation).toBe(0);
    expect(result.positions[1].allocation).toBe(100);
    expect(result.positions[1].afterWeight).toBe(0.5);
    const enough = cashRebalance(
      [
        holding('VTI', { quantity: 8, targetWeight: 50 }),
        holding('BND', { quantity: 2, targetWeight: 50 }),
      ],
      market,
      1,
      1000,
    );
    expect(enough.positions.map((position) => position.allocation)).toEqual([200, 800]);
    expect(enough.positions.map((position) => position.afterWeight)).toEqual([0.5, 0.5]);
  });

  it('conserves the budget with fractional target weights and shares', () => {
    const result = cashRebalance(
      [
        holding('VTI', { quantity: 0.11, targetWeight: 33 }),
        holding('BND', { quantity: 0.13, targetWeight: 33 }),
        holding('GLD', { quantity: 0.17, targetWeight: 34 }),
      ],
      market,
      1.087,
      123.45,
    );
    expect(result.positions.reduce((sum, position) => sum + position.allocation, 0)).toBeCloseTo(
      123.45,
      10,
    );
    expect(result.invested).toBeCloseTo(123.45, 10);
    expect(result.afterValue - result.currentValue).toBeCloseTo(123.45, 10);
    for (const position of result.positions) expect(position.allocation).toBeGreaterThanOrEqual(0);
  });

  it('does not omit missing quotes, invalid currencies, or invalid current quantities', () => {
    expect(() => cashRebalance([holding('VWO')], market, 1, 100)).toThrow(/VWO/);
    expect(() =>
      cashRebalance([holding('VTI')], { ...market, VTI: { ...market.VTI, symbol: 'BND' } }, 1, 100),
    ).toThrow(/anderen Instrument/);
    expect(() =>
      cashRebalance(
        [holding('VTI')],
        { ...market, VTI: { ...market.VTI, status: 'unavailable' } },
        1,
        100,
      ),
    ).toThrow(/VTI/);
    expect(() => cashRebalance([holding('VTI')], market, 0, 100)).toThrow(/EUR\/USD/);
    expect(() =>
      cashRebalance(
        [holding('VTI')],
        { ...market, VTI: { ...market.VTI, currency: 'GBP' } },
        1,
        100,
      ),
    ).toThrow(/Kurswährung/);
    expect(() => cashRebalance([holding('VTI', { quantity: -1 })], market, 1, 100)).toThrow(
      /Stückzahlen/,
    );
  });

  it('rejects invalid cash budgets and absent or invalid targets explicitly', () => {
    for (const cash of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => cashRebalance([holding()], market, 1, cash)).toThrow(/Kapital/);
    expect(() => cashRebalance([], market, 1, 100)).toThrow(/positives Zielgewicht/);
    expect(() => cashRebalance([holding('VTI', { targetWeight: 0 })], market, 1, 100)).toThrow(
      /positives Zielgewicht/,
    );
    expect(() =>
      cashRebalance([holding('VTI', { targetWeight: Number.NaN })], market, 1, 100),
    ).toThrow(/Zielgewichte/);
  });

  it('preserves a tiny positive cash budget even when target deficits are lost to rounding', () => {
    const tinyMarket = Object.fromEntries(
      ['VTI', 'BND', 'GLD'].map((symbol) => [symbol, series(symbol, [['2026-01-01', 1.1]])]),
    );
    const result = cashRebalance(
      ['VTI', 'BND', 'GLD'].map((symbol) => holding(symbol, { quantity: 7, targetWeight: 1 })),
      tinyMarket,
      1,
      1e-16,
    );
    expect(result.invested).toBe(1e-16);
    expect(result.positions.reduce((sum, position) => sum + position.allocation, 0)).toBe(1e-16);
    expect(
      result.positions.every(
        (position) => Number.isFinite(position.quantity) && position.quantity >= 0,
      ),
    ).toBe(true);
  });

  it('merges duplicate symbols and leaves all input objects unchanged', () => {
    const holdings = [
      holding('VTI', { quantity: 1, targetWeight: 25 }),
      holding('VTI', { id: 'duplicate', quantity: 1, targetWeight: 25 }),
      holding('BND', { quantity: 1, targetWeight: 50 }),
    ];
    const before = structuredClone({ holdings, market });
    const result = cashRebalance(holdings, market, 1, 100);
    expect(result.positions.map((position) => position.symbol)).toEqual(['VTI', 'BND']);
    expect(result.positions[0].currentValue).toBe(200);
    expect(result.positions[0].targetWeight).toBe(0.5);
    expect(result.positions[1].allocation).toBe(100);
    expect({ holdings, market }).toEqual(before);
  });
});
