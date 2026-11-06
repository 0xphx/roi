import type { Workspace } from './types';
import { INSTRUMENTS } from '../data/catalog';
export const STORAGE_KEY = 'roi.workspace.v1';
export const DEFAULT_WORKSPACE: Workspace = {
  version: 1,
  portfolioName: 'Mein Beispielportfolio',
  holdings: [
    { id: 'vti', symbol: 'VTI', quantity: 180, averageCost: 210, targetWeight: 40 },
    { id: 'vea', symbol: 'VEA', quantity: 300, averageCost: 42, targetWeight: 15 },
    { id: 'vwo', symbol: 'VWO', quantity: 200, averageCost: 40, targetWeight: 10 },
    { id: 'bnd', symbol: 'BND', quantity: 240, averageCost: 72, targetWeight: 20 },
    { id: 'gld', symbol: 'GLD', quantity: 60, averageCost: 185, targetWeight: 12 },
    { id: 'btc', symbol: 'BTC-USD', quantity: 0.08, averageCost: 45000, targetWeight: 3 },
  ],
  watchlist: ['SPY', 'QQQ', 'NVDA', 'BTC-USD'],
  plan: {
    initialCapital: 100000,
    monthlyContribution: 500,
    years: 20,
    expectedReturn: 0.065,
    volatility: 0.15,
    inflation: 0.02,
    annualFee: 0.002,
    target: 500000,
    simulations: 1000,
    seed: 42,
  },
  riskFreeRate: 0.02,
};
const symbols = new Set(INSTRUMENTS.map((x) => x.symbol));
function numberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
export function parseWorkspace(input: unknown): Workspace {
  if (!input || typeof input !== 'object')
    throw new Error('Die Datei enthält keinen gültigen Workspace.');
  const w = input as Workspace;
  if (w.version !== 1) throw new Error('Diese Workspace-Version wird nicht unterstützt.');
  if (typeof w.portfolioName !== 'string' || !w.portfolioName.trim() || w.portfolioName.length > 80)
    throw new Error('Der Portfolioname muss 1–80 Zeichen lang sein.');
  if (!Array.isArray(w.holdings) || w.holdings.length > 30)
    throw new Error('Maximal 30 Positionen sind erlaubt.');
  const ids = new Set<string>();
  const held = new Set<string>();
  for (const h of w.holdings) {
    if (
      !h ||
      typeof h.id !== 'string' ||
      !h.id ||
      ids.has(h.id) ||
      !symbols.has(h.symbol) ||
      held.has(h.symbol) ||
      !numberIn(h.quantity, 0.00000001, 1e10) ||
      !numberIn(h.averageCost, 0, 1e9) ||
      !numberIn(h.targetWeight, 0, 100)
    )
      throw new Error(
        'Ungültige oder doppelte Position. Prüfe Symbol, Stückzahl, Einstand und Zielgewicht.',
      );
    ids.add(h.id);
    held.add(h.symbol);
  }
  if (
    !Array.isArray(w.watchlist) ||
    w.watchlist.length > 30 ||
    w.watchlist.some((s) => !symbols.has(s)) ||
    new Set(w.watchlist).size !== w.watchlist.length
  )
    throw new Error('Ungültige Watchlist.');
  const p = w.plan;
  if (
    !p ||
    !numberIn(p.initialCapital, 0, 1e9) ||
    !numberIn(p.monthlyContribution, 0, 1e7) ||
    !Number.isInteger(p.years) ||
    !numberIn(p.years, 1, 50) ||
    !numberIn(p.expectedReturn, -0.5, 0.5) ||
    !numberIn(p.volatility, 0, 1) ||
    !numberIn(p.inflation, 0, 0.3) ||
    !numberIn(p.annualFee, 0, 0.1) ||
    !numberIn(p.target, 1, 1e12) ||
    !Number.isInteger(p.simulations) ||
    !numberIn(p.simulations, 100, 5000) ||
    !Number.isInteger(p.seed) ||
    !numberIn(p.seed, 0, 4294967295) ||
    !numberIn(w.riskFreeRate, -0.05, 0.3)
  )
    throw new Error('Ungültige Planungsannahmen. Bitte Wertebereiche prüfen.');
  return {
    version: 1,
    portfolioName: w.portfolioName.trim(),
    holdings: w.holdings.map((h) => ({ ...h })),
    watchlist: [...w.watchlist],
    plan: { ...w.plan },
    riskFreeRate: w.riskFreeRate,
  };
}
export function loadWorkspace(): { workspace: Workspace; error?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return {
      workspace: raw ? parseWorkspace(JSON.parse(raw)) : structuredClone(DEFAULT_WORKSPACE),
    };
  } catch {
    return {
      workspace: structuredClone(DEFAULT_WORKSPACE),
      error:
        'Gespeicherte Daten konnten nicht gelesen werden. Das Beispielportfolio ist geöffnet; die Originaldaten bleiben bis zu deiner nächsten Änderung gespeichert.',
    };
  }
}
export function downloadFile(name: string, body: string, type = 'application/json') {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function parseHoldingsCsv(text: string): Workspace['holdings'] {
  const rows = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .map((row) => row.split(/[;,]/).map((c) => c.trim()));
  if (rows[0]?.join(',').toLowerCase() !== 'symbol,quantity,averagecost,targetweight')
    throw new Error(
      'CSV-Spalten: symbol,quantity,averageCost,targetWeight. Dezimalzahlen mit Punkt.',
    );
  return rows
    .slice(1)
    .filter((r) => r.some(Boolean))
    .map((r, i) => {
      if (r.length !== 4 || r.some((x) => x === ''))
        throw new Error(`Ungültige CSV-Zeile ${i + 2}.`);
      return {
        id: crypto.randomUUID(),
        symbol: r[0].toUpperCase(),
        quantity: Number(r[1]),
        averageCost: Number(r[2]),
        targetWeight: Number(r[3]),
      };
    });
}
