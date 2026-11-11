import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { compareStrategies } from '../lib/analytics';
import { FxHistoryDetails } from './CurrencyImpact';
import type { BacktestOptions } from '../lib/analytics';
import type { PortfolioLibrary } from '../lib/portfolio-library';
import type { MarketResponse, MarketSeries } from '../lib/types';
import { dateLabel, decimal, euro, pct, shortDate } from '../lib/format';
import './compare.css';

interface ComparePageProps {
  library: PortfolioLibrary;
  market: MarketResponse;
}
interface Settings extends BacktestOptions {
  period: '1' | '3' | '5';
}
interface Submission {
  ids: string[];
  settings: Settings;
}
interface ChartPoint {
  date: string;
  contributions: number;
  benchmark: number | null;
  values: Record<string, number>;
}
const lineStyles = [
  { stroke: '#242424', width: 2, dash: undefined },
  { stroke: '#53534e', width: 1.8, dash: '8 4' },
  { stroke: '#73736c', width: 1.8, dash: '2 3' },
  { stroke: '#93938a', width: 1.8, dash: '10 3 2 3' },
];
const tooltipStyle = {
  border: '1px solid #e5e5e0',
  borderRadius: 3,
  boxShadow: 'none',
  background: '#fff',
  color: '#242424',
  fontSize: 12,
};
const compact = (value: number) =>
  Math.abs(value) >= 1000000
    ? `${decimal(value / 1000000, 1)} Mio.`
    : Math.abs(value) >= 1000
      ? `${decimal(value / 1000, 1)} Tsd.`
      : decimal(value, 0);

function initialSelection(library: PortfolioLibrary) {
  const activeIndex = library.portfolios.findIndex((p) => p.id === library.activeId);
  const next =
    library.portfolios[activeIndex + 1] ||
    library.portfolios.find((p) => p.id !== library.activeId);
  const selected = new Set([library.activeId, ...(next ? [next.id] : [])]);
  return library.portfolios.filter((p) => selected.has(p.id)).map((p) => p.id);
}
function initialSettings(library: PortfolioLibrary): Settings {
  const plan = (library.portfolios.find((p) => p.id === library.activeId) || library.portfolios[0])
    ?.workspace.plan;
  return {
    initialCapital: plan?.initialCapital ?? 10000,
    monthlyContribution: plan?.monthlyContribution ?? 0,
    fee: plan?.annualFee ?? 0,
    rebalance: 'yearly',
    period: '5',
  };
}
function NumberField({
  label,
  value,
  onChange,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max: number;
  suffix: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="compare-input">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={max}
          step="any"
          required
          value={value}
          onChange={(event) => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
        />
        <span>{suffix}</span>
      </div>
    </label>
  );
}

/** Apply the same requested window to every strategy before intersecting actual dates. */
function seriesForPeriod(
  library: PortfolioLibrary,
  market: MarketResponse,
  submission: Submission,
) {
  const selected = library.portfolios.filter((p) => submission.ids.includes(p.id));
  if (selected.length !== submission.ids.length || selected.length === 0) {
    throw new Error('Wähle mindestens ein vorhandenes Portfolio für den Vergleich.');
  }
  const symbols = [
    ...new Set(
      selected.flatMap((p) =>
        p.workspace.holdings.filter((h) => h.targetWeight > 0).map((h) => h.symbol),
      ),
    ),
  ];
  if (!symbols.length)
    throw new Error('Die ausgewählten Portfolios benötigen positive Zielgewichte.');
  const latestDates = symbols.map((symbol) => {
    const series = market.series[symbol];
    const dates =
      series?.status !== 'unavailable'
        ? series?.prices
            .filter((p) => Number.isFinite(p.close) && p.close > 0)
            .map((p) => p.date)
            .sort()
        : [];
    const latest = dates?.at(-1);
    if (!latest) throw new Error(`Für ${symbol} fehlen auswertbare Kursdaten.`);
    return latest;
  });
  const cutoff = new Date(`${latestDates.sort()[0]}T12:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number(submission.settings.period));
  const start = cutoff.toISOString().slice(0, 10);
  return Object.fromEntries(
    Object.entries(market.series).map(([symbol, series]) => [
      symbol,
      {
        ...series,
        prices: series.prices.filter((point) => point.date >= start),
      },
    ]),
  ) as Record<string, MarketSeries>;
}

export function ComparePage({ library, market }: ComparePageProps) {
  const [selectedIds, setSelectedIds] = useState(() => initialSelection(library));
  const [settings, setSettings] = useState<Settings>(() => initialSettings(library));
  const [submitted, setSubmitted] = useState<Submission>(() => ({
    ids: initialSelection(library),
    settings: initialSettings(library),
  }));
  const [formError, setFormError] = useState('');
  const selection = library.portfolios.filter((p) => selectedIds.includes(p.id)).map((p) => p.id);
  const dirty = JSON.stringify({ ids: selection, settings }) !== JSON.stringify(submitted);
  const comparison = useMemo(() => {
    try {
      const series = seriesForPeriod(library, market, submitted);
      const strategies = submitted.ids.map((id) => {
        const portfolio = library.portfolios.find((p) => p.id === id)!;
        return {
          id,
          name: portfolio.workspace.portfolioName,
          holdings: portfolio.workspace.holdings,
        };
      });
      return {
        data: compareStrategies(strategies, series, market.fx, submitted.settings),
        error: '',
      };
    } catch (error) {
      return {
        data: null,
        error:
          error instanceof Error
            ? error.message
            : 'Der Strategievergleich konnte nicht berechnet werden.',
      };
    }
  }, [library, market, submitted]);
  const result = comparison.data;
  const chartData: ChartPoint[] =
    result?.points.map((point) => ({
      ...point,
      benchmark: Number.isFinite(point.benchmark) ? point.benchmark : null,
    })) || [];
  const hasBenchmark = chartData.some((point) => point.benchmark !== null);
  const symbols = [
    ...new Set(
      submitted.ids.flatMap(
        (id) =>
          library.portfolios
            .find((p) => p.id === id)
            ?.workspace.holdings.filter((h) => h.targetWeight > 0)
            .map((h) => h.symbol) || [],
      ),
    ),
  ];
  if (hasBenchmark && !symbols.includes('SPY')) symbols.push('SPY');
  const sources = symbols
    .map((symbol) => market.series[symbol])
    .filter((series): series is MarketSeries => !!series);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((previous) => ({ ...previous, [key]: value }));
  const toggle = (id: string) => {
    setSelectedIds((previous) => {
      const existing = previous.filter((selected) =>
        library.portfolios.some((p) => p.id === selected),
      );
      return existing.includes(id)
        ? existing.filter((selected) => selected !== id)
        : existing.length < 4
          ? [...existing, id]
          : existing;
    });
    setFormError('');
  };

  const run = (event: FormEvent) => {
    event.preventDefault();
    if (selection.length < 1 || selection.length > 4) {
      setFormError('Wähle ein bis vier Portfolios.');
      return;
    }
    if (
      ![settings.initialCapital, settings.monthlyContribution, settings.fee].every(
        Number.isFinite,
      ) ||
      settings.initialCapital < 0 ||
      settings.initialCapital > 1e9 ||
      settings.monthlyContribution < 0 ||
      settings.monthlyContribution > 1e7 ||
      settings.fee < 0 ||
      settings.fee > 0.1
    ) {
      setFormError(
        'Prüfe Startkapital, Sparrate und Zusatzkosten. Die Werte dürfen nicht negativ sein.',
      );
      return;
    }
    setFormError('');
    setSubmitted({ ids: selection, settings: { ...settings } });
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Strategievergleich</h1>
          <p className="muted">
            Portfolios mit denselben Einzahlungen und Kosten historisch vergleichen.
          </p>
        </div>
      </div>
      <form className="compare-form" onSubmit={run}>
        <fieldset className="compare-selection">
          <legend>Portfolios auswählen</legend>
          <p className="compare-help">
            Wähle bis zu vier Portfolios. Es gelten die gespeicherten Zielgewichte, nicht die
            aktuellen Stückzahlen.
          </p>
          <div className="compare-options">
            {library.portfolios.map((portfolio) => {
              const checked = selection.includes(portfolio.id);
              const disabled = !checked && selection.length >= 4;
              return (
                <label
                  key={portfolio.id}
                  className={`compare-option${disabled ? ' compare-option-disabled' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(portfolio.id)}
                  />
                  <span>
                    <strong>{portfolio.workspace.portfolioName}</strong>
                    <small>
                      {portfolio.workspace.holdings.length} Positionen
                      {portfolio.id === library.activeId ? ' · aktives Portfolio' : ''}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          {library.portfolios.length < 2 && (
            <p className="compare-help compare-single-hint">
              Mit einem Portfolio kannst du bereits einen Backtest berechnen. Für den Vergleich
              brauchst du ein zweites.
            </p>
          )}
          {selection.length === 0 && (
            <p className="compare-help" role="status">
              Wähle mindestens ein Portfolio.
            </p>
          )}
        </fieldset>
        <div className="compare-settings card">
          <div className="card-header">
            <h2>Gemeinsame Annahmen</h2>
          </div>
          <div className="compare-fields">
            <NumberField
              label="Startkapital"
              value={settings.initialCapital}
              onChange={(value) => set('initialCapital', value)}
              max={1e9}
              suffix="€"
            />
            <NumberField
              label="Monatliche Sparrate"
              value={settings.monthlyContribution}
              onChange={(value) => set('monthlyContribution', value)}
              max={1e7}
              suffix="€"
            />
            <label className="field">
              <span>Zeitraum</span>
              <select
                value={settings.period}
                onChange={(event) => set('period', event.target.value as Settings['period'])}
              >
                <option value="1">Letztes Jahr</option>
                <option value="3">Letzte 3 Jahre</option>
                <option value="5">Letzte 5 Jahre</option>
              </select>
            </label>
            <label className="field">
              <span>Rebalancing</span>
              <select
                value={settings.rebalance}
                onChange={(event) => set('rebalance', event.target.value as Settings['rebalance'])}
              >
                <option value="none">Keines</option>
                <option value="yearly">Jährlich</option>
                <option value="monthly">Monatlich</option>
              </select>
            </label>
            <NumberField
              label="Zusatzkosten p. a."
              value={Number((settings.fee * 100).toFixed(3))}
              onChange={(value) => set('fee', value / 100)}
              max={10}
              suffix="%"
            />
            <button
              className="btn btn-primary compare-submit"
              type="submit"
              disabled={selection.length === 0}
            >
              Vergleich berechnen
            </button>
          </div>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          {dirty && (
            <p className="compare-draft-note" role="status">
              Die Ergebnisse zeigen noch die vorherige Berechnung. Mit „Vergleich berechnen“
              übernimmst du die Änderungen.
            </p>
          )}
        </div>
      </form>
      {!result ? (
        <section className="card compare-empty" role="status">
          <h2>Vergleich nicht verfügbar</h2>
          <p>{comparison.error}</p>
        </section>
      ) : (
        <>
          <section className="card compare-chart-card">
            <div className="card-header">
              <div>
                <h2>Wertentwicklung</h2>
                <p className="muted">
                  {dateLabel(result.startDate)} – {dateLabel(result.endDate)} ·{' '}
                  {result.observations.toLocaleString('de-DE')} gemeinsame Kurstage
                </p>
              </div>
              <span className="compare-meta">
                {result.strategies.length}{' '}
                {result.strategies.length === 1 ? 'Strategie' : 'Strategien'}
              </span>
            </div>
            <div
              className="compare-chart"
              role="img"
              aria-label="Historische Wertentwicklung der ausgewählten Portfolios unter gleichen Einzahlungs- und Kostenannahmen"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 12, right: 14, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e8e8e3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    minTickGap={65}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#73736e' }}
                  />
                  <YAxis
                    tickFormatter={compact}
                    width={65}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#73736e' }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(value) => dateLabel(String(value))}
                    formatter={(value, name) => [euro(Number(value)), name]}
                  />
                  {result.strategies.map((strategy, index) => (
                    <Line
                      key={strategy.id}
                      dataKey={(point: ChartPoint) => point.values[strategy.id]}
                      name={strategy.name}
                      stroke={lineStyles[index].stroke}
                      strokeWidth={lineStyles[index].width}
                      strokeDasharray={lineStyles[index].dash}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                  {hasBenchmark && (
                    <Line
                      dataKey="benchmark"
                      name="S&P 500 · SPY"
                      stroke="#a3a39b"
                      strokeWidth={1.2}
                      strokeDasharray="5 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  <Line
                    dataKey="contributions"
                    name="Einzahlungen"
                    stroke="#bcbcb4"
                    strokeWidth={1.2}
                    strokeDasharray="1 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Legend
                    iconType="plainline"
                    iconSize={18}
                    wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card compare-results">
            <div className="card-header">
              <div>
                <h2>Ergebnisse</h2>
                <p className="muted">
                  Gleiche Zeiträume, Einzahlungen, Zusatzkosten und Rebalancing-Regeln.
                </p>
              </div>
              <span className="compare-meta">
                Je Strategie {euro(result.points.at(-1)?.contributions ?? Number.NaN)} eingezahlt
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Portfolio</th>
                    <th className="numeric">Endvermögen</th>
                    <th className="numeric">Rendite gesamt¹</th>
                    <th className="numeric">Rendite p. a.¹</th>
                    <th className="numeric">Größter Rückgang¹</th>
                    <th className="numeric">Zusatzkosten</th>
                  </tr>
                </thead>
                <tbody>
                  {result.strategies.map((strategy, index) => (
                    <tr key={strategy.id}>
                      <td>
                        <span className="compare-strategy-name">
                          <span
                            className="compare-line-sample"
                            style={{
                              borderTopColor: lineStyles[index].stroke,
                              borderTopStyle:
                                index === 0 ? 'solid' : index === 2 ? 'dotted' : 'dashed',
                            }}
                          />
                          {strategy.name}
                        </span>
                      </td>
                      <td className="numeric">{euro(strategy.result.finalValue)}</td>
                      <td className="numeric">{pct(strategy.result.totalReturn)}</td>
                      <td className="numeric">{pct(strategy.result.annualReturn)}</td>
                      <td className="numeric">
                        {pct(strategy.result.maxDrawdown > 0 ? -strategy.result.maxDrawdown : 0)}
                      </td>
                      <td className="numeric">{euro(strategy.result.fees)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="compare-help compare-table-note">
              ¹ Zeitgewichtet bzw. einzahlungsbereinigt: Zusätzliche Einzahlungen werden nicht als
              Rendite gezählt. Die Kostenbeträge können trotz gleicher Kostenquote unterschiedlich
              ausfallen, weil sich die Portfoliowerte anders entwickeln.
            </p>
          </section>
          <details className="compare-sources">
            <summary>Datenquellen und Datenstand</summary>
            <FxHistoryDetails fx={market.fx} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Kursdatum</th>
                    <th>Abruf</th>
                    <th>Status</th>
                    <th>Quelle</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((series) => (
                    <tr key={series.symbol}>
                      <td>{series.symbol}</td>
                      <td>{dateLabel(series.asOf)}</td>
                      <td>
                        {series.fetchedAt
                          ? new Date(series.fetchedAt).toLocaleString('de-DE', {
                              timeZone: 'Europe/Berlin',
                            })
                          : '—'}
                      </td>
                      <td>
                        {series.status === 'fresh'
                          ? 'Aktualisiert'
                          : series.status === 'cached'
                            ? 'Gespeichert'
                            : 'Nicht verfügbar'}
                      </td>
                      <td>
                        {/^https?:\/\//.test(series.sourceUrl) ? (
                          <a href={series.sourceUrl} target="_blank" rel="noreferrer">
                            {series.source}
                          </a>
                        ) : (
                          series.source
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <aside className="compare-method">
        <h2>Methodik</h2>
        <p>
          Die Zielgewichte jedes Portfolios werden auf 100 % normiert. Alle Strategien starten mit
          demselben Kapital und erhalten dieselben monatlichen Einzahlungen. Verwendet werden
          ausschließlich gemeinsame tatsächliche Kurstage aller benötigten Instrumente
          {hasBenchmark ? ' und des SPY-Benchmarks' : ''} sowie der benötigten EZB-Referenzkurse;
          fehlende Kurse werden nicht aufgefüllt. Der angefragte Zeitraum kann sich deshalb
          verkürzen.
        </p>
        <p>
          Einzahlungen und Rebalancing erfolgen am ersten gemeinsamen Kurstag des jeweiligen Monats
          bzw. Jahres. Zusatzkosten werden auf das jeweilige Vermögen angewandt; in ETF-Kursen
          enthaltene Fondskosten sind bereits berücksichtigt. Keine Steuern, Spreads oder
          Ordergebühren.{' '}
          {hasBenchmark
            ? 'SPY bildet als ETF den S&P 500 ab. Im Vergleich gelten dieselben Einzahlungen, aber keine zusätzlich angesetzten Kosten.'
            : 'Ohne passende SPY-Kurse wird kein Benchmark angezeigt.'}
        </p>
        <p>
          USD-Werte werden mit dem historischen EZB-Referenzkurs desselben Tages in EUR bewertet. Es
          gibt keine Übernahme des letzten Kurses auf Wochenenden oder Datenlücken.
          EZB-Referenzkurse sind keine Ausführungskurse und werden zu einer anderen Tageszeit als
          US-Schlusskurse festgestellt. Kursanpassungen hängen von der Datenquelle ab. Die heutige
          Portfolioauswahl kann Auswahl- und Überlebensverzerrungen enthalten. Die Rückrechnung ist
          keine Prognose; vergangene Ergebnisse erlauben keine Aussage über künftige Renditen.
        </p>
      </aside>
    </>
  );
}
