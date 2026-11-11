export type AssetClass = 'equity' | 'bond' | 'gold' | 'crypto' | 'realestate';
export interface Instrument {
  symbol: string;
  name: string;
  shortName: string;
  assetClass: AssetClass;
  currency: string;
  color: string;
  region: string;
}
export interface PricePoint {
  date: string;
  close: number;
}
export interface MarketSeries {
  symbol: string;
  currency: string;
  prices: PricePoint[];
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  asOf: string;
  status: 'fresh' | 'cached' | 'unavailable';
  error?: string;
}
export interface FxRatePoint {
  date: string;
  /** US dollars per euro, matching the ECB reference-rate quotation. */
  eurUsd: number;
}
export interface FxHistory {
  base: 'EUR';
  quote: 'USD';
  rates: FxRatePoint[];
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  asOf: string;
  status: 'fresh' | 'cached' | 'unavailable';
  error?: string;
}
export interface MarketResponse {
  series: Record<string, MarketSeries>;
  fx: {
    eurUsd: number;
    date: string;
    source: string;
    status: 'fresh' | 'cached' | 'unavailable';
    history?: FxHistory;
  };
  fetchedAt: string;
}
export interface Holding {
  id: string;
  symbol: string;
  quantity: number;
  averageCost: number;
  targetWeight: number;
}
export interface Plan {
  initialCapital: number;
  monthlyContribution: number;
  years: number;
  expectedReturn: number;
  volatility: number;
  inflation: number;
  annualFee: number;
  target: number;
  simulations: number;
  seed: number;
}
export interface Workspace {
  version: 1;
  portfolioName: string;
  holdings: Holding[];
  watchlist: string[];
  plan: Plan;
  riskFreeRate: number;
}
