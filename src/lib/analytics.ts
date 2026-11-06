import { INSTRUMENTS } from '../data/catalog';
import type { AssetClass, Holding, MarketSeries, Plan, PricePoint } from './types';

/** Daily observations use 252 trading days per year; rates are fractions, not percentages. */
const TRADING_DAYS = 252;
const MAX_SIMULATIONS = 10_000;
const MAX_YEARS = 60;
const instrumentBySymbol = new Map(
  INSTRUMENTS.map((instrument) => [instrument.symbol, instrument]),
);
const finite = (value: number) => Number.isFinite(value);
const positive = (value: number) => finite(value) && value > 0;

/** Actual/Actual calendar years: costs accrue through weekends, including leap years. */
function elapsedYears(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!finite(start) || !finite(end) || end <= start) return 0;
  let years = 0;
  for (
    let year = new Date(start).getUTCFullYear();
    year <= new Date(end).getUTCFullYear();
    year++
  ) {
    const yearStart = Date.UTC(year, 0, 1);
    const yearEnd = Date.UTC(year + 1, 0, 1);
    const overlap = Math.max(0, Math.min(end, yearEnd) - Math.max(start, yearStart));
    years += overlap / (yearEnd - yearStart);
  }
  return years;
}
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export interface PortfolioPoint {
  date: string;
  value: number;
  /** SPY normalized to the initial portfolio value; NaN when benchmark data is absent. */
  benchmark: number;
  /** Drawdown is zero at a high-water mark, negative below it. */
  drawdown: number;
}

export interface PortfolioPosition extends Holding {
  /** Latest close in the instrument's native currency. */
  price: number;
  currency: string;
  /** All amounts below are EUR, using the supplied current EUR/USD reference rate. */
  value: number;
  cost: number;
  gain: number;
  gainPercent: number;
  weight: number;
  available: boolean;
}

function euroFactor(currency: string, eurUsd: number): number {
  if (currency === 'EUR') return 1;
  if (currency === 'USD' && positive(eurUsd)) return 1 / eurUsd;
  // Unsupported currencies must not silently be interpreted as euros.
  return Number.NaN;
}

function validPrices(series?: MarketSeries): PricePoint[] {
  if (!series || series.status === 'unavailable') return [];
  const deduplicated = new Map<string, PricePoint>();
  for (const price of series.prices) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(price.date) && positive(price.close)) {
      deduplicated.set(price.date, price);
    }
  }
  return [...deduplicated.values()].sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Holdings use actual shares and average costs in each instrument's native currency.
 * No price is invented for missing data. Incomplete totals are NaN, with explicit flags.
 */
export function currentPortfolio(
  holdings: Holding[],
  series: Record<string, MarketSeries>,
  eurUsd: number,
) {
  const positions: PortfolioPosition[] = holdings.map((holding) => {
    const market = series[holding.symbol];
    const currency = market?.currency ?? instrumentBySymbol.get(holding.symbol)?.currency ?? '';
    const factor = euroFactor(currency, eurUsd);
    const prices = validPrices(market);
    const price = prices.at(-1)?.close ?? Number.NaN;
    const available =
      positive(price) && finite(factor) && finite(holding.quantity) && holding.quantity >= 0;
    const value =
      holding.quantity === 0 ? 0 : available ? price * holding.quantity * factor : Number.NaN;
    const cost =
      finite(factor) && finite(holding.averageCost) && holding.averageCost >= 0
        ? holding.averageCost * holding.quantity * factor
        : Number.NaN;
    const gain = value - cost;
    return {
      ...holding,
      price,
      currency,
      value,
      cost,
      gain,
      gainPercent: cost > 0 ? gain / cost : 0,
      weight: 0,
      available,
    };
  });
  const missingSymbols = [
    ...new Set(
      positions
        .filter((position) => position.quantity !== 0 && !position.available)
        .map((position) => position.symbol),
    ),
  ];
  const complete = missingSymbols.length === 0;
  const value = complete ? sum(positions.map((position) => position.value)) : Number.NaN;
  const cost = sum(positions.map((position) => position.cost));
  const gain = value - cost;
  for (const position of positions)
    position.weight = value > 0 ? position.value / value : complete ? 0 : Number.NaN;
  return {
    positions,
    value,
    cost,
    gain,
    gainPercent: cost > 0 ? gain / cost : 0,
    complete,
    missingSymbols,
  };
}

/**
 * Intersect actual dates across every selected asset. No forward fill, backfill,
 * retrospective asset substitution, or silently omitted missing instrument.
 */
function alignedPrices(holdings: Holding[], series: Record<string, MarketSeries>, eurUsd: number) {
  const symbols = [...new Set(holdings.map((holding) => holding.symbol))];
  if (symbols.length === 0)
    return { dates: [] as string[], prices: new Map<string, Map<string, number>>() };
  const prices = new Map<string, Map<string, number>>();
  for (const symbol of symbols) {
    const market = series[symbol];
    const factor = euroFactor(market?.currency ?? '', eurUsd);
    if (!finite(factor)) return { dates: [] as string[], prices };
    const points = validPrices(market);
    if (!points.length) return { dates: [] as string[], prices };
    prices.set(symbol, new Map(points.map((point) => [point.date, point.close * factor])));
  }
  const firstDates = [...prices.get(symbols[0])!.keys()];
  const dates = firstDates
    .filter((date) => symbols.every((symbol) => prices.get(symbol)!.has(date)))
    .sort();
  return { dates, prices };
}

/**
 * Revalues today's fixed share quantities over historical common trading dates.
 * This is a model portfolio history, not a reconstruction of actual transactions.
 * Current FX is held constant throughout; historical currency gains are excluded.
 */
export function portfolioHistory(
  holdings: Holding[],
  series: Record<string, MarketSeries>,
  eurUsd: number,
): PortfolioPoint[] {
  const active = holdings.filter((holding) => positive(holding.quantity));
  const { dates, prices } = alignedPrices(active, series, eurUsd);
  if (!dates.length) return [];
  const spy = new Map(validPrices(series.SPY).map((point) => [point.date, point.close]));
  const firstBenchmark = spy.get(dates[0]);
  let peak = 0;
  let initial = 0;
  return dates.map((date, index) => {
    const value = sum(
      active.map((holding) => prices.get(holding.symbol)!.get(date)! * holding.quantity),
    );
    if (index === 0) initial = value;
    peak = Math.max(peak, value);
    const benchmarkPrice = spy.get(date);
    return {
      date,
      value,
      benchmark:
        firstBenchmark && benchmarkPrice ? (initial * benchmarkPrice) / firstBenchmark : Number.NaN,
      drawdown: peak > 0 ? value / peak - 1 : 0,
    };
  });
}

export function quantile(sortedValues: number[], probability: number): number {
  if (!sortedValues.length) return 0;
  const index = Math.max(0, Math.min(1, probability)) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const fraction = index - lower;
  return (
    sortedValues[lower] +
    ((sortedValues[lower + 1] ?? sortedValues[lower]) - sortedValues[lower]) * fraction
  );
}

/** Positive loss magnitudes for VaR, CVaR and maximum drawdown. VaR/CVaR are daily. */
export function riskMetrics(
  history: Pick<PortfolioPoint, 'date' | 'value'>[],
  riskFreeRate: number,
) {
  const values = history.map((point) => point.value);
  const returns = values
    .slice(1)
    .map((value, index) => (values[index] > 0 ? value / values[index] - 1 : Number.NaN))
    .filter(finite);
  const observations = returns.length;
  const totalReturn = values.length > 1 && values[0] > 0 ? values.at(-1)! / values[0] - 1 : 0;
  const mean = observations ? sum(returns) / observations : 0;
  const variance =
    observations > 1 ? sum(returns.map((value) => (value - mean) ** 2)) / (observations - 1) : 0;
  const volatility = Math.sqrt(variance * TRADING_DAYS);
  const annualReturn = observations ? (1 + totalReturn) ** (TRADING_DAYS / observations) - 1 : 0;
  const sharpe = volatility > 0 ? (mean * TRADING_DAYS - riskFreeRate) / volatility : 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of values) {
    if (!finite(value) || value < 0) continue;
    peak = Math.max(peak, value);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, 1 - value / peak);
  }
  const sortedReturns = [...returns].sort((left, right) => left - right);
  const cutoff = quantile(sortedReturns, 0.05);
  // Integrate exactly 5% of the empirical distribution. The boundary observation
  // gets fractional weight, so 31 returns do not silently become a 6.45% tail.
  const tailMass = observations * 0.05;
  let tailSum = 0;
  for (let index = 0; index < Math.ceil(tailMass); index++) {
    tailSum += sortedReturns[index] * Math.min(1, tailMass - index);
  }
  const var95 = observations ? Math.max(0, -cutoff) : 0;
  const cvar95 = tailMass > 0 ? Math.max(0, -tailSum / tailMass) : 0;
  return {
    annualReturn,
    volatility,
    sharpe,
    maxDrawdown,
    var95,
    cvar95,
    observations,
    totalReturn,
  };
}

/** Instantaneous asset-class shocks. These scenarios are assumptions, not historical replay. */
export function stressTest(
  holdings: Holding[],
  series: Record<string, MarketSeries>,
  eurUsd: number,
  shocks: Record<AssetClass, number>,
) {
  const portfolio = currentPortfolio(holdings, series, eurUsd);
  if (!portfolio.complete)
    return {
      currentValue: Number.NaN,
      stressedValue: Number.NaN,
      loss: Number.NaN,
      lossPercent: Number.NaN,
      positions: [] as { symbol: string; value: number; impact: number; shock: number }[],
    };
  const positions = portfolio.positions.map((position) => {
    const assetClass = instrumentBySymbol.get(position.symbol)?.assetClass;
    const shock = assetClass ? shocks[assetClass] : Number.NaN;
    if (!finite(shock) || shock < -1)
      throw new RangeError(`Ungültiger Stress-Schock für ${position.symbol}.`);
    return {
      symbol: position.symbol,
      value: position.value,
      impact: position.value * shock,
      shock,
    };
  });
  const currentValue = portfolio.value;
  const stressedValue = currentValue + sum(positions.map((position) => position.impact));
  const loss = currentValue - stressedValue;
  return {
    currentValue,
    stressedValue,
    loss,
    lossPercent: currentValue > 0 ? loss / currentValue : 0,
    positions,
  };
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function validatePlan(plan: Plan) {
  for (const [key, value] of Object.entries(plan)) {
    if (!finite(value)) throw new RangeError(`Ungültiger Planungswert: ${key}.`);
  }
  if (
    plan.initialCapital < 0 ||
    plan.monthlyContribution < 0 ||
    plan.target < 0 ||
    plan.volatility < 0 ||
    plan.expectedReturn <= -1 ||
    plan.inflation <= -1 ||
    plan.annualFee < 0 ||
    plan.annualFee >= 1 ||
    plan.years < 0
  ) {
    throw new RangeError(
      'Kapital und Risiken müssen positiv, Rendite/Inflation größer −100 % und Gebühren kleiner 100 % sein.',
    );
  }
}

/**
 * Seeded monthly geometric Brownian motion with monthly deposits at period end.
 * Expected return is an annual arithmetic expectation; volatility is annualized.
 * Annual fees are multiplicative; goal probability refers to the nominal target.
 * Bounds (60 years / 10,000 paths) prevent unbounded browser work from imports.
 */
export function monteCarlo(plan: Plan) {
  validatePlan(plan);
  const years = Math.min(MAX_YEARS, Math.floor(plan.years));
  const simulations = Math.min(MAX_SIMULATIONS, Math.max(100, Math.floor(plan.simulations)));
  const random = seededRandom(plan.seed);
  let spareNormal: number | undefined;
  const normal = () => {
    if (spareNormal !== undefined) {
      const spare = spareNormal;
      spareNormal = undefined;
      return spare;
    }
    const radius = Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, random())));
    const angle = 2 * Math.PI * random();
    spareNormal = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
  const yearlyValues = Array.from({ length: years + 1 }, () => [] as number[]);
  const monthlyDrift = (Math.log1p(plan.expectedReturn) - 0.5 * plan.volatility ** 2) / 12;
  const monthlyVolatility = plan.volatility / Math.sqrt(12);
  const monthlyFeeFactor = (1 - plan.annualFee) ** (1 / 12);
  let goalsMet = 0;
  for (let simulation = 0; simulation < simulations; simulation++) {
    let value = plan.initialCapital;
    yearlyValues[0].push(value);
    for (let month = 1; month <= years * 12; month++) {
      const shock = plan.volatility > 0 ? monthlyVolatility * normal() : 0;
      value = value * Math.exp(monthlyDrift + shock) * monthlyFeeFactor + plan.monthlyContribution;
      if (month % 12 === 0) yearlyValues[month / 12].push(value);
    }
    if (value >= plan.target) goalsMet++;
  }
  const points = yearlyValues.map((values, year) => {
    values.sort((left, right) => left - right);
    return {
      year,
      p10: quantile(values, 0.1),
      p25: quantile(values, 0.25),
      p50: quantile(values, 0.5),
      p75: quantile(values, 0.75),
      p90: quantile(values, 0.9),
      contributions: plan.initialCapital + plan.monthlyContribution * year * 12,
    };
  });
  const median = points.at(-1)!.p50;
  const contributed = plan.initialCapital + plan.monthlyContribution * years * 12;
  return {
    points,
    probabilityOfGoal: goalsMet / simulations,
    median,
    contributed,
    realMedian: median / (1 + plan.inflation) ** years,
  };
}

export interface BacktestOptions {
  initialCapital: number;
  monthlyContribution: number;
  rebalance: 'monthly' | 'yearly' | 'none';
  /** Annual portfolio fee, as a fraction. SPY benchmark is shown before fees. */
  fee: number;
}

export interface BacktestPoint {
  date: string;
  value: number;
  contributions: number;
  benchmark: number;
}

/**
 * Fractional-share backtest using normalized target weights and common actual dates.
 * Rebalancing executes at the observed close; no future return informs allocation.
 * Returns and drawdown are time-weighted so deposits cannot masquerade as gains.
 * Annual fee accrual and CAGR use Actual/Actual calendar years, including weekends.
 */
export function backtest(
  holdings: Holding[],
  series: Record<string, MarketSeries>,
  eurUsd: number,
  options: BacktestOptions,
) {
  const empty = {
    points: [] as BacktestPoint[],
    totalReturn: 0,
    annualReturn: 0,
    maxDrawdown: 0,
    finalValue: 0,
    contributed: 0,
    fees: 0,
  };
  if (
    ![options.initialCapital, options.monthlyContribution, options.fee].every(finite) ||
    options.initialCapital < 0 ||
    options.monthlyContribution < 0 ||
    options.fee < 0 ||
    options.fee >= 1
  ) {
    throw new RangeError('Ungültige Backtest-Einstellungen.');
  }
  const active = holdings.filter((holding) => positive(holding.targetWeight));
  const weightSum = sum(active.map((holding) => holding.targetWeight));
  if (weightSum <= 0) return empty;
  // Merge duplicate symbols so an imported portfolio never silently loses a weight.
  const weights = new Map<string, number>();
  for (const holding of active)
    weights.set(
      holding.symbol,
      (weights.get(holding.symbol) ?? 0) + holding.targetWeight / weightSum,
    );
  const { dates, prices } = alignedPrices(active, series, eurUsd);
  if (!dates.length) return empty;
  const spy = new Map(validPrices(series.SPY).map((point) => [point.date, point.close]));
  const firstBenchmark = spy.get(dates[0]);
  let benchmarkShares = firstBenchmark ? options.initialCapital / firstBenchmark : Number.NaN;
  const shares = new Map<string, number>();
  for (const [symbol, weight] of weights)
    shares.set(symbol, (options.initialCapital * weight) / prices.get(symbol)!.get(dates[0])!);
  let contributed = options.initialCapital;
  let fees = 0;
  let previousValue = options.initialCapital;
  let wealthIndex = 1;
  let peakWealth = 1;
  let maxDrawdown = 0;
  const points: BacktestPoint[] = [];
  for (let index = 0; index < dates.length; index++) {
    const date = dates[index];
    let value = sum(
      [...shares].map(([symbol, quantity]) => quantity * prices.get(symbol)!.get(date)!),
    );
    if (index > 0) {
      const previousDate = dates[index - 1];
      const feeFactor = (1 - options.fee) ** elapsedYears(previousDate, date);
      const deductedFee = value * (1 - feeFactor);
      fees += deductedFee;
      for (const [symbol, quantity] of shares) shares.set(symbol, quantity * feeFactor);
      value -= deductedFee;
      if (previousValue > 0) wealthIndex *= value / previousValue;
      peakWealth = Math.max(peakWealth, wealthIndex);
      maxDrawdown = Math.max(maxDrawdown, 1 - wealthIndex / peakWealth);
      const monthDelta =
        (Number(date.slice(0, 4)) - Number(previousDate.slice(0, 4))) * 12 +
        Number(date.slice(5, 7)) -
        Number(previousDate.slice(5, 7));
      const yearChanged = date.slice(0, 4) !== previousDate.slice(0, 4);
      const monthChanged = monthDelta > 0;
      if (monthChanged && options.monthlyContribution > 0) {
        const deposit = options.monthlyContribution * monthDelta;
        contributed += deposit;
        value += deposit;
        for (const [symbol, weight] of weights) {
          shares.set(
            symbol,
            shares.get(symbol)! + (deposit * weight) / prices.get(symbol)!.get(date)!,
          );
        }
        const benchmarkPrice = spy.get(date);
        // A missing required benchmark close invalidates the comparison instead of filling it.
        benchmarkShares = benchmarkPrice ? benchmarkShares + deposit / benchmarkPrice : Number.NaN;
      }
      const rebalanceNow =
        (options.rebalance === 'monthly' && monthChanged) ||
        (options.rebalance === 'yearly' && yearChanged);
      if (rebalanceNow)
        for (const [symbol, weight] of weights)
          shares.set(symbol, (value * weight) / prices.get(symbol)!.get(date)!);
    }
    const benchmarkPrice = spy.get(date);
    points.push({
      date,
      value,
      contributions: contributed,
      benchmark: benchmarkPrice ? benchmarkShares * benchmarkPrice : Number.NaN,
    });
    previousValue = value;
  }
  const totalReturn = wealthIndex - 1;
  const years = elapsedYears(dates[0], dates.at(-1)!);
  const annualReturn = years > 0 ? wealthIndex ** (1 / years) - 1 : 0;
  return {
    points,
    totalReturn,
    annualReturn,
    maxDrawdown,
    finalValue: points.at(-1)!.value,
    contributed,
    fees,
  };
}
