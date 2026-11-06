import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowRight,
  ChartNoAxesCombined,
  CircleHelp,
  FlaskConical,
  Info,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingUp,
} from 'lucide-react';
import type { AssetClass, MarketResponse, MarketSeries, Plan, Workspace } from '../lib/types';
import { backtest, monteCarlo, portfolioHistory, riskMetrics, stressTest } from '../lib/analytics';
import { INSTRUMENTS } from '../data/catalog';
import { parseWorkspace } from '../lib/workspace';
import './analysis.css';

export interface AnalysisPageProps {
  workspace: Workspace;
  market: MarketResponse;
  onChange: (next: Workspace) => void;
}
const euro = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const money = (value: number) => (Number.isFinite(value) ? euro.format(value) : '—');
const percent = (value: number, digits = 1) =>
  Number.isFinite(value)
    ? `${(value * 100).toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`
    : '—';
const date = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
const compact = (value: number) =>
  Math.abs(value) >= 1000000
    ? `${number.format(value / 1000000)} Mio.`
    : Math.abs(value) >= 1000
      ? `${number.format(value / 1000)} Tsd.`
      : number.format(value);
const gridStroke = '#edf1f3';
const tooltipStyle = {
  border: '1px solid #e6ece9',
  borderRadius: 12,
  boxShadow: '0 8px 24px #152b1920',
  fontSize: 12,
};
const assetClasses: { key: AssetClass; label: string; color: string }[] = [
  { key: 'equity', label: 'Aktien & Aktien-ETFs', color: '#0b8c74' },
  { key: 'bond', label: 'Anleihen', color: '#7c9db6' },
  { key: 'gold', label: 'Gold', color: '#d5a546' },
  { key: 'crypto', label: 'Kryptowährungen', color: '#9e8aca' },
  { key: 'realestate', label: 'Immobilien', color: '#dc9d79' },
];
function Heading({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="muted">{text}</p>
      </div>
      {action}
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  positive,
}: {
  label: string;
  value: string;
  note?: string;
  positive?: boolean;
}) {
  return (
    <div className="card metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-value${positive ? ' text-positive' : ''}`}>{value}</div>
      {note && <div className="metric-note">{note}</div>}
    </div>
  );
}
function NoData({ children }: { children?: React.ReactNode }) {
  return (
    <div className="card empty-state">
      <ChartNoAxesCombined size={34} />
      <h3>Noch keine auswertbaren Kursdaten</h3>
      <p>
        {children ||
          'Füge im Portfolio Positionen hinzu und lade ihre Marktdaten. Für eine Analyse müssen gemeinsame Handelstage vorliegen.'}
      </p>
    </div>
  );
}
function ModelNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="note analysis-note">
      <Info size={16} />
      <div>{children}</div>
    </div>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="analysis-input">
        <input
          type="number"
          inputMode="decimal"
          required
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}
const usable = (workspace: Workspace, market: MarketResponse) =>
  workspace.holdings.some((h) => h.quantity > 0) &&
  Number.isFinite(market.fx.eurUsd) &&
  market.fx.eurUsd > 0 &&
  market.fx.status !== 'unavailable' &&
  workspace.holdings
    .filter((h) => h.quantity > 0)
    .every(
      (h) =>
        market.series[h.symbol]?.status !== 'unavailable' &&
        (market.series[h.symbol]?.prices.length || 0) >= 2,
    );

export function PlannerPage({ workspace, market: _market, onChange }: AnalysisPageProps) {
  const [draft, setDraft] = useState<Plan>(workspace.plan);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'nominal' | 'real'>('nominal');
  const projection = useMemo(() => {
    try {
      return monteCarlo(workspace.plan);
    } catch {
      return null;
    }
  }, [workspace.plan]);
  const set = (key: keyof Plan, value: number) => setDraft((p) => ({ ...p, [key]: value }));
  const chartData = useMemo(
    () =>
      projection?.points.map((p) => {
        const discount = tab === 'real' ? (1 + workspace.plan.inflation) ** p.year : 1;
        return {
          year: p.year,
          p10: p.p10 / discount,
          p50: p.p50 / discount,
          p90: p.p90 / discount,
          band: [p.p10 / discount, p.p90 / discount],
          contributions: p.contributions / discount,
        };
      }) || [],
    [projection, tab, workspace.plan.inflation],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(workspace.plan);
  const run = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const validated = parseWorkspace({ ...workspace, plan: { ...draft } });
      monteCarlo(validated.plan);
      onChange(validated);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bitte prüfe die Modellannahmen.');
    }
  };
  return (
    <>
      <Heading
        eyebrow="DEIN WEG NACH VORN"
        title="Aus Zielen wird ein Plan."
        text="Spiele Sparraten, Zeithorizonte und Renditeannahmen durch."
        action={
          <span className="badge neutral">
            <FlaskConical size={14} /> Modellrechnung
          </span>
        }
      />
      <div className="analysis-planner-grid">
        <form className="card analysis-form-card" onSubmit={run}>
          <div className="card-header">
            <div>
              <h3>Deine Stellschrauben</h3>
              <p className="muted">Alle Werte lassen sich anpassen.</p>
            </div>
            <Target size={19} />
          </div>
          <div className="form-grid">
            <NumberField
              label="Startkapital"
              value={draft.initialCapital}
              onChange={(v) => set('initialCapital', v)}
              max={1000000000}
              step="any"
              suffix="€"
            />
            <NumberField
              label="Monatliche Sparrate"
              value={draft.monthlyContribution}
              onChange={(v) => set('monthlyContribution', v)}
              max={10000000}
              step="any"
              suffix="€"
            />
            <NumberField
              label="Anlagehorizont"
              value={draft.years}
              onChange={(v) => set('years', v)}
              min={1}
              max={50}
              suffix="Jahre"
            />
            <NumberField
              label="Vermögensziel"
              value={draft.target}
              onChange={(v) => set('target', v)}
              min={1}
              max={1000000000000}
              step="any"
              suffix="€"
            />
          </div>
          <div className="analysis-divider" />
          <p className="analysis-label">Modellannahmen pro Jahr</p>
          <div className="form-grid">
            <NumberField
              label="Erwartete Rendite"
              value={Number((draft.expectedReturn * 100).toFixed(3))}
              onChange={(v) => set('expectedReturn', v / 100)}
              min={-50}
              max={50}
              step="any"
              suffix="%"
            />
            <NumberField
              label="Volatilität"
              value={Number((draft.volatility * 100).toFixed(3))}
              onChange={(v) => set('volatility', v / 100)}
              max={100}
              step="any"
              suffix="%"
            />
            <NumberField
              label="Inflation"
              value={Number((draft.inflation * 100).toFixed(3))}
              onChange={(v) => set('inflation', v / 100)}
              min={0}
              max={30}
              step="any"
              suffix="%"
            />
            <NumberField
              label="Laufende Kosten"
              value={Number((draft.annualFee * 100).toFixed(3))}
              onChange={(v) => set('annualFee', v / 100)}
              max={10}
              step="any"
              suffix="%"
            />
          </div>
          {error && (
            <p className="negative" role="alert">
              {error}
            </p>
          )}
          {dirty && (
            <p className="analysis-draft-note" role="status">
              Deine Änderungen werden mit „Berechnen“ übernommen. Die Grafik zeigt den gespeicherten
              Plan.
            </p>
          )}
          <button className="btn btn-primary analysis-full-button" type="submit">
            <RefreshCw size={16} />
            {dirty ? 'Änderungen berechnen' : 'Plan berechnen'}
            <ArrowRight size={16} />
          </button>
          <p className="analysis-form-foot">
            {workspace.plan.simulations.toLocaleString('de-DE')} simulierte Pfade · reproduzierbare
            Berechnung
          </p>
        </form>
        <div className="analysis-stack">
          <div className="grid-three analysis-metrics">
            <Metric
              label="Vermögen im Median"
              value={projection ? money(projection.median) : '—'}
              note={`Nach ${workspace.plan.years} Jahren · nominal`}
              positive
            />
            <Metric
              label="Selbst eingezahlt"
              value={projection ? money(projection.contributed) : '—'}
              note="Startkapital + monatliche Sparrate"
            />
            <Metric
              label="Zielwahrscheinlichkeit"
              value={projection ? percent(projection.probabilityOfGoal, 0) : '—'}
              note={`${money(workspace.plan.target)} nominal erreichen`}
            />
          </div>
          <div className="card analysis-chart-card">
            <div className="card-header">
              <div>
                <h3>Deine mögliche Vermögensentwicklung</h3>
                <p className="muted">Der Korridor zeigt das 10. bis 90. Perzentil.</p>
              </div>
              <div className="analysis-segment">
                <button
                  type="button"
                  className={tab === 'nominal' ? 'active' : ''}
                  onClick={() => setTab('nominal')}
                >
                  Nominal
                </button>
                <button
                  type="button"
                  className={tab === 'real' ? 'active' : ''}
                  onClick={() => setTab('real')}
                >
                  Kaufkraft
                </button>
              </div>
            </div>
            <div
              className="analysis-chart"
              role="img"
              aria-label="Prognose mit Median, Einzahlung und Bandbreite zwischen 10. und 90. Perzentil"
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 16, right: 14, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={gridStroke} />
                  <XAxis
                    dataKey="year"
                    tickFormatter={(v) => `${v} J.`}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#89918e' }}
                    minTickGap={25}
                  />
                  <YAxis
                    tickFormatter={compact}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#89918e' }}
                    width={65}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(v) => `Jahr ${v}`}
                    formatter={(value, name) => [
                      Array.isArray(value)
                        ? `${money(Number(value[0]))} – ${money(Number(value[1]))}`
                        : money(Number(value)),
                      name,
                    ]}
                  />
                  <Area
                    dataKey="band"
                    type="monotone"
                    stroke="none"
                    fill="#d9eee5"
                    name="80-%-Korridor"
                  />
                  <Line
                    dataKey="p50"
                    type="monotone"
                    stroke="#0b8c74"
                    strokeWidth={3}
                    dot={false}
                    name="Median"
                  />
                  <Line
                    dataKey="contributions"
                    type="monotone"
                    stroke="#9ba5ae"
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                    dot={false}
                    name="Einzahlungen"
                  />
                  <Legend
                    iconType="circle"
                    iconSize={7}
                    wrapperStyle={{ fontSize: 11, paddingTop: 18 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="analysis-chart-footer">
              <span>
                10. Perzentil{' '}
                <strong>
                  {chartData.length ? money(chartData[chartData.length - 1].p10) : '—'}
                </strong>
              </span>
              <span>
                Median{' '}
                <strong>
                  {chartData.length ? money(chartData[chartData.length - 1].p50) : '—'}
                </strong>
              </span>
              <span>
                90. Perzentil{' '}
                <strong>
                  {chartData.length ? money(chartData[chartData.length - 1].p90) : '—'}
                </strong>
              </span>
            </div>
          </div>
        </div>
      </div>
      <ModelNote>
        Monte-Carlo-Modell mit konstanten, frei gewählten Annahmen für die arithmetische
        Jahresrendite und Volatilität, monatlichen Einzahlungen und laufenden Kosten. Das Modell ist
        keine Prognose aus Marktdaten. Der Korridor enthält 80 % der simulierten Ergebnisse; auch
        Verluste außerhalb dieses Korridors sind möglich. Kaufkraftwerte berücksichtigen die
        angenommene Inflation. Steuern werden nicht berücksichtigt.
      </ModelNote>
    </>
  );
}

function correlations(symbols: string[], series: Record<string, MarketSeries>) {
  const prices = Object.fromEntries(
    symbols.map((symbol) => [
      symbol,
      new Map(
        (series[symbol]?.prices || [])
          .filter((p) => Number.isFinite(p.close) && p.close > 0)
          .map((p) => [p.date, p.close]),
      ),
    ]),
  ) as Record<string, Map<string, number>>;
  return symbols.map((a) =>
    symbols.map((b) => {
      // Match price dates first, so stock/crypto comparisons measure the same interval.
      const dates = [...prices[a].keys()].filter((day) => prices[b].has(day)).sort();
      if (dates.length < 31) return null;
      const pairs = dates
        .slice(1)
        .map((day, i) => [
          prices[a].get(day)! / prices[a].get(dates[i])! - 1,
          prices[b].get(day)! / prices[b].get(dates[i])! - 1,
        ]);
      const avgA = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
      const avgB = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
      let cov = 0,
        varA = 0,
        varB = 0;
      for (const [x, y] of pairs) {
        cov += (x - avgA) * (y - avgB);
        varA += (x - avgA) ** 2;
        varB += (y - avgB) ** 2;
      }
      return varA * varB > 0 ? Math.min(1, Math.max(-1, cov / Math.sqrt(varA * varB))) : null;
    }),
  );
}

export function RiskPage({ workspace, market, onChange }: AnalysisPageProps) {
  const history = useMemo(
    () =>
      usable(workspace, market)
        ? portfolioHistory(workspace.holdings, market.series, market.fx.eurUsd)
        : [],
    [workspace.holdings, market],
  );
  const risk = useMemo(
    () => riskMetrics(history, workspace.riskFreeRate),
    [history, workspace.riskFreeRate],
  );
  const symbols = [
    ...new Set(workspace.holdings.filter((h) => h.quantity > 0).map((h) => h.symbol)),
  ].slice(0, 10);
  const matrix = useMemo(
    () => correlations(symbols, market.series),
    [symbols.join(','), market.series],
  );
  const sufficient = history.length >= 31;
  const drawdowns = history.map((p) => ({ date: p.date, drawdown: p.drawdown * 100 }));
  const latestValue = history.at(-1)?.value || 0;
  return (
    <>
      <Heading
        eyebrow="VERSTEHEN, WAS DU HÄLTST"
        title="Risiko sichtbar machen."
        text="Kennzahlen, Verlustphasen und Zusammenhänge auf Basis historischer Kurse."
        action={
          <span className="badge neutral">
            <ShieldCheck size={14} /> Historische Analyse
          </span>
        }
      />
      {!sufficient ? (
        <NoData>
          Für stabile Kennzahlen werden mindestens 31 gemeinsame Kurstage aller Positionen benötigt.
          Lade die Marktdaten oder passe dein Portfolio an.
        </NoData>
      ) : (
        <>
          <div className="grid-four analysis-metrics">
            <Metric
              label="Volatilität p. a."
              value={percent(risk.volatility)}
              note="Annualisierte tägliche Schwankung"
            />
            <Metric
              label="Maximaler Drawdown"
              value={`−${percent(risk.maxDrawdown)}`}
              note="Größter historischer Rückgang"
            />
            <Metric
              label="Sharpe Ratio"
              value={Number.isFinite(risk.sharpe) ? number.format(risk.sharpe) : '—'}
              note="Überschussrendite je Risikoeinheit"
            />
            <Metric
              label="Value at Risk · 95 %"
              value={percent(risk.var95)}
              note={`${money(latestValue * risk.var95)} · historisch pro Tag`}
            />
          </div>
          <div className="card analysis-chart-card">
            <div className="card-header">
              <div>
                <h3>Jede Hochphase hat ihre Rücksetzer.</h3>
                <p className="muted">Rückgang vom jeweils zuvor erreichten Höchststand.</p>
              </div>
              <span className="badge neutral">
                {date(history[0].date)} – {date(history[history.length - 1].date)}
              </span>
            </div>
            <div
              className="analysis-chart analysis-chart-short"
              role="img"
              aria-label="Historischer Drawdown des Portfolios in Prozent"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={drawdowns} margin={{ top: 12, right: 16, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#d87967" stopOpacity={0.1} />
                      <stop offset="100%" stopColor="#d87967" stopOpacity={0.4} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={gridStroke} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString('de-DE', { year: '2-digit', month: 'short' })
                    }
                    minTickGap={70}
                    tick={{ fontSize: 11, fill: '#89918e' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `${v} %`}
                    tick={{ fontSize: 11, fill: '#89918e' }}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(v) => date(String(v))}
                    formatter={(v) => [`${Number(v).toFixed(2)} %`, 'Drawdown']}
                  />
                  <ReferenceLine y={0} stroke="#e0e5e2" />
                  <Area
                    dataKey="drawdown"
                    type="monotone"
                    fill="url(#drawdownGradient)"
                    stroke="#c67566"
                    strokeWidth={1.6}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="grid-two">
            <div className="card analysis-form-card">
              <div className="card-header">
                <div>
                  <h3>Wie bewegen sich deine Anlagen?</h3>
                  <p className="muted">Korrelation der täglichen Renditen.</p>
                </div>
                <CircleHelp size={17} />
              </div>
              <div className="table-wrap">
                <table className="correlation-table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      {symbols.map((s) => (
                        <th key={s}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {symbols.map((s, i) => (
                      <tr key={s}>
                        <th>{s}</th>
                        {symbols.map((other, j) => (
                          <td key={other}>
                            <span
                              title={`${s} / ${other}: ${matrix[i][j] === null ? 'Zu wenige Daten' : number.format(matrix[i][j]!)}`}
                              style={{
                                background:
                                  matrix[i][j] === null
                                    ? '#f3f5f4'
                                    : matrix[i][j]! >= 0
                                      ? `rgba(11,140,116,${0.06 + matrix[i][j]! * 0.65})`
                                      : `rgba(220,157,121,${0.1 + Math.abs(matrix[i][j]!) * 0.5})`,
                                color:
                                  matrix[i][j] !== null && matrix[i][j]! > 0.65
                                    ? 'white'
                                    : '#42544c',
                              }}
                            >
                              {matrix[i][j] === null ? '—' : matrix[i][j]!.toFixed(2)}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="analysis-help">
                +1: gleiche Richtung · 0: kein linearer Zusammenhang · −1: Gegenbewegung. Je Paar
                mindestens 30 gemeinsame Renditetage.
              </p>
            </div>
            <div className="card analysis-form-card">
              <div className="card-header">
                <div>
                  <h3>Die Zahlen einordnen</h3>
                  <p className="muted">Risiko hat mehr als eine Dimension.</p>
                </div>
                <Info size={17} />
              </div>
              <div className="analysis-detail-row">
                <div>
                  <strong>Expected Shortfall · 95 %</strong>
                  <small>Mittlerer Verlust in den schlechtesten 5 % der Tage</small>
                </div>
                <b>{percent(risk.cvar95)}</b>
              </div>
              <div className="analysis-detail-row">
                <div>
                  <strong>Historische Rendite p. a.</strong>
                  <small>Aktuelle Stückzahlen über den gesamten Zeitraum</small>
                </div>
                <b>{percent(risk.annualReturn)}</b>
              </div>
              <div className="analysis-detail-row">
                <div>
                  <strong>Gemeinsame Renditetage</strong>
                  <small>Nur Tage mit Kursen für alle Positionen</small>
                </div>
                <b>{risk.observations.toLocaleString('de-DE')}</b>
              </div>
              <label className="field analysis-rate-field">
                <span>Risikofreier Zins für die Sharpe Ratio</span>
                <div className="analysis-input">
                  <input
                    aria-label="Risikofreier Zins in Prozent"
                    type="number"
                    min={-5}
                    max={30}
                    step="any"
                    value={Number((workspace.riskFreeRate * 100).toFixed(2))}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isFinite(value) && value >= -5 && value <= 30)
                        onChange({ ...workspace, riskFreeRate: value / 100 });
                    }}
                  />
                  <span>% p. a.</span>
                </div>
              </label>
            </div>
          </div>
        </>
      )}
      <ModelNote>
        Die Analyse bewertet heutige Stückzahlen rückwirkend und bildet keinen tatsächlichen
        Depotverlauf ab. Renditen zwischen gemeinsamen Kurstagen werden mit 252 Beobachtungen pro
        Jahr annualisiert; für reine Krypto-Portfolios kann dies von Kalendertagen abweichen. VaR
        und Expected Shortfall sind empirische Verlustmaße für einen Tag, keine Verlustobergrenzen.
        EUR-Werte verwenden den aktuellen EUR/USD-Referenzkurs; historische Währungseffekte fehlen.
        Korrelationen sind keine Garantie für Diversifikation in Krisen.
      </ModelNote>
    </>
  );
}

const presets: {
  id: string;
  name: string;
  subtitle: string;
  shocks: Record<AssetClass, number>;
}[] = [
  {
    id: 'financial',
    name: 'Finanzkrise',
    subtitle: 'Breiter Risikoabbau',
    shocks: { equity: -0.45, bond: 0.05, gold: 0.08, crypto: -0.65, realestate: -0.45 },
  },
  {
    id: 'pandemic',
    name: 'Pandemie',
    subtitle: 'Plötzlicher Liquiditätsschock',
    shocks: { equity: -0.32, bond: -0.04, gold: -0.08, crypto: -0.5, realestate: -0.35 },
  },
  {
    id: 'rates',
    name: 'Zinsschock',
    subtitle: 'Aktien und Anleihen unter Druck',
    shocks: { equity: -0.22, bond: -0.18, gold: -0.08, crypto: -0.5, realestate: -0.3 },
  },
  {
    id: 'custom',
    name: 'Eigenes Szenario',
    subtitle: 'Deine Annahmen, dein Test',
    shocks: { equity: -0.2, bond: -0.05, gold: 0.05, crypto: -0.35, realestate: -0.15 },
  },
];
export function StressPage({ workspace, market }: AnalysisPageProps) {
  const [selected, setSelected] = useState(presets[0].id);
  const [shocks, setShocks] = useState<Record<AssetClass, number>>(presets[0].shocks);
  const result = useMemo(
    () =>
      usable(workspace, market)
        ? stressTest(workspace.holdings, market.series, market.fx.eurUsd, shocks)
        : null,
    [workspace.holdings, market, shocks],
  );
  const select = (id: string) => {
    setSelected(id);
    setShocks({ ...presets.find((p) => p.id === id)!.shocks });
  };
  const changed = (key: AssetClass, value: number) => {
    setSelected('custom');
    setShocks((s) => ({ ...s, [key]: value }));
  };
  return (
    <>
      <Heading
        eyebrow="VORBEREITET AUF DAS UNERWARTETE"
        title="Was hält dein Portfolio aus?"
        text="Teste, wie sich heftige Marktbewegungen auf dein Vermögen auswirken."
        action={
          <span className="badge neutral">
            <FlaskConical size={14} /> Hypothetische Schocks
          </span>
        }
      />
      <div className="analysis-scenarios">
        {presets.map((p, i) => (
          <button
            type="button"
            key={p.id}
            className={`card analysis-scenario${selected === p.id ? ' selected' : ''}`}
            onClick={() => select(p.id)}
          >
            <span className="analysis-scenario-index">0{i + 1}</span>
            <strong>{p.name}</strong>
            <small>{p.subtitle}</small>
            <span className="analysis-radio" />
          </button>
        ))}
      </div>
      <div className="analysis-stress-grid">
        <div className="card analysis-form-card">
          <div className="card-header">
            <div>
              <h3>Ein Schock. Mehrere Anlageklassen.</h3>
              <p className="muted">Annahmen frei anpassen.</p>
            </div>
            <FlaskConical size={19} />
          </div>
          <div className="analysis-shocks">
            {assetClasses.map((c) => (
              <label key={c.key} className="range-field analysis-shock">
                <span>
                  <i style={{ background: c.color }} />
                  {c.label}
                  <strong className={shocks[c.key] < 0 ? 'text-negative' : 'text-positive'}>
                    {shocks[c.key] > 0 ? '+' : ''}
                    {percent(shocks[c.key], 0)}
                  </strong>
                </span>
                <input
                  aria-label={`Schock für ${c.label} in Prozent`}
                  type="range"
                  min={-95}
                  max={50}
                  step={1}
                  value={Math.round(shocks[c.key] * 100)}
                  onChange={(e) => changed(c.key, Number(e.target.value) / 100)}
                />
                <div className="analysis-range-labels">
                  <small>−95 %</small>
                  <small>+50 %</small>
                </div>
              </label>
            ))}
          </div>
          <button
            className="btn btn-ghost analysis-full-button"
            type="button"
            onClick={() => select(presets[0].id)}
          >
            <RefreshCw size={14} /> Annahmen zurücksetzen
          </button>
        </div>
        <div className="analysis-stack">
          {result ? (
            <>
              <div className="card analysis-stress-summary">
                <div>
                  <span className="eyebrow">AUSWIRKUNG AUF DEIN PORTFOLIO</span>
                  <div
                    className={
                      result.loss > 0
                        ? 'analysis-loss text-negative'
                        : 'analysis-loss text-positive'
                    }
                  >
                    {result.loss > 0 ? '−' : '+'}
                    {money(Math.abs(result.loss))}
                    <span>
                      {result.loss > 0 ? '−' : '+'}
                      {percent(Math.abs(result.lossPercent))}
                    </span>
                  </div>
                  <p className="muted">Simulierte Wertänderung durch die gewählten Schocks</p>
                </div>
                <div className="analysis-stress-values">
                  <span>
                    Aktueller Wert<strong>{money(result.currentValue)}</strong>
                  </span>
                  <ArrowRight size={21} />
                  <span>
                    Wert nach dem Schock<strong>{money(result.stressedValue)}</strong>
                  </span>
                </div>
              </div>
              <div className="card analysis-chart-card">
                <div className="card-header">
                  <div>
                    <h3>Wo entsteht der größte Effekt?</h3>
                    <p className="muted">Wertänderung je Position in Euro.</p>
                  </div>
                </div>
                <div
                  className="analysis-chart analysis-chart-short"
                  role="img"
                  aria-label="Wertänderung der Positionen durch das Szenario"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={result.positions.map((p) => ({ symbol: p.symbol, impact: p.impact }))}
                      layout="vertical"
                      margin={{ top: 5, right: 24, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid horizontal={false} stroke={gridStroke} />
                      <XAxis
                        type="number"
                        tickFormatter={compact}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#89918e' }}
                      />
                      <YAxis
                        dataKey="symbol"
                        type="category"
                        width={70}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#5b6760' }}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value) => [money(Number(value)), 'Wertänderung']}
                      />
                      <ReferenceLine x={0} stroke="#aebbb3" />
                      <Bar dataKey="impact" radius={[4, 4, 4, 4]} maxBarSize={24}>
                        {result.positions.map((p) => (
                          <Cell key={p.symbol} fill={p.impact < 0 ? '#c97e70' : '#0b8c74'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : (
            <NoData />
          )}
        </div>
      </div>
      {result && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Der Schock im Detail</h3>
              <p className="muted">Ohne Verkäufe, Rebalancing oder Transaktionskosten.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Anlageklasse</th>
                  <th>Aktueller Wert</th>
                  <th>Modellschock</th>
                  <th>Wertänderung</th>
                  <th>Nach dem Schock</th>
                </tr>
              </thead>
              <tbody>
                {result.positions.map((p) => {
                  const instrument = INSTRUMENTS.find((i) => i.symbol === p.symbol);
                  return (
                    <tr key={p.symbol}>
                      <td>
                        <strong>{p.symbol}</strong>
                        <small className="analysis-table-sub">
                          {instrument?.shortName || p.symbol}
                        </small>
                      </td>
                      <td>
                        {assetClasses.find((c) => c.key === instrument?.assetClass)?.label || '—'}
                      </td>
                      <td>{money(p.value)}</td>
                      <td className={p.shock < 0 ? 'text-negative' : 'text-positive'}>
                        {percent(p.shock)}
                      </td>
                      <td className={p.impact < 0 ? 'text-negative' : 'text-positive'}>
                        {money(p.impact)}
                      </td>
                      <td>{money(p.value + p.impact)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ModelNote>
        Die Szenarionamen stehen für frei definierte Modellschocks. Sie sind keine exakte
        Nachrechnung der jeweiligen historischen Krise; der Kryptoschock im Finanzkrisen-Szenario
        ist rein hypothetisch. Innerhalb einer Anlageklasse wird derselbe unmittelbare Kursschock
        auf jede Position angewandt. Währung, Korrelation, Liquidität, Derivate und zeitliche
        Erholung werden nicht modelliert.
      </ModelNote>
    </>
  );
}

export function BacktestPage({ workspace, market }: AnalysisPageProps) {
  const [initialCapital, setInitialCapital] = useState(workspace.plan.initialCapital);
  const [monthlyContribution, setMonthlyContribution] = useState(
    workspace.plan.monthlyContribution,
  );
  const [fee, setFee] = useState(workspace.plan.annualFee);
  const [rebalance, setRebalance] = useState<'monthly' | 'yearly' | 'none'>('yearly');
  const [period, setPeriod] = useState('5');
  const [submitted, setSubmitted] = useState({
    initialCapital,
    monthlyContribution,
    fee,
    rebalance,
    period,
  });
  const [error, setError] = useState('');
  const result = useMemo(() => {
    const active = workspace.holdings.filter((h) => h.targetWeight > 0);
    if (
      !active.length ||
      market.fx.eurUsd <= 0 ||
      market.fx.status === 'unavailable' ||
      !active.every((h) => (market.series[h.symbol]?.prices.length || 0) >= 2)
    )
      return null;
    try {
      const latest = Math.min(
        ...active.map((h) => Date.parse(market.series[h.symbol]?.prices.at(-1)?.date || '')),
      );
      const cutoffDate = new Date(latest);
      cutoffDate.setUTCFullYear(cutoffDate.getUTCFullYear() - Number(submitted.period));
      const cutoff = cutoffDate.toISOString().slice(0, 10);
      const filtered = Object.fromEntries(
        Object.entries(market.series).map(([symbol, data]) => [
          symbol,
          { ...data, prices: data.prices.filter((p) => p.date >= cutoff) },
        ]),
      );
      return backtest(workspace.holdings, filtered, market.fx.eurUsd, submitted);
    } catch {
      return null;
    }
  }, [workspace.holdings, market, submitted]);
  const chartData =
    result?.points.map((p) => ({
      ...p,
      benchmark: Number.isFinite(p.benchmark) ? p.benchmark : null,
    })) || [];
  const hasBenchmark = chartData.some((p) => p.benchmark !== null);
  const good = !!result && result.points.length > 1;
  const run = (e: React.FormEvent) => {
    e.preventDefault();
    if (initialCapital <= 0 || monthlyContribution < 0 || fee < 0 || fee > 0.1) {
      setError('Startkapital muss positiv sein. Sparrate und Kosten dürfen nicht negativ sein.');
      return;
    }
    setError('');
    setSubmitted({ initialCapital, monthlyContribution, fee, rebalance, period });
  };
  return (
    <>
      <Heading
        eyebrow="STRATEGIE TRIFFT WIRKLICHKEIT"
        title="Ein Blick zurück. Mit deinem Plan."
        text="Teste deine Zielgewichtung an tatsächlichen historischen Kursen."
        action={
          <span className="badge neutral">
            <TrendingUp size={14} /> Historisches Backtesting
          </span>
        }
      />
      <form className="card analysis-backtest-form" onSubmit={run}>
        <div className="analysis-backtest-fields">
          <NumberField
            label="Startkapital"
            value={initialCapital}
            onChange={setInitialCapital}
            min={1}
            max={1000000000}
            step="any"
            suffix="€"
          />
          <NumberField
            label="Sparrate pro Monat"
            value={monthlyContribution}
            onChange={setMonthlyContribution}
            max={10000000}
            step="any"
            suffix="€"
          />
          <label className="field">
            <span>Zeitraum</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="1">Letztes Jahr</option>
              <option value="3">Letzte 3 Jahre</option>
              <option value="5">Letzte 5 Jahre</option>
            </select>
          </label>
          <label className="field">
            <span>Rebalancing</span>
            <select
              value={rebalance}
              onChange={(e) => setRebalance(e.target.value as typeof rebalance)}
            >
              <option value="none">Keines</option>
              <option value="yearly">Jährlich</option>
              <option value="monthly">Monatlich</option>
            </select>
          </label>
          <NumberField
            label="Zusatzkosten p. a."
            value={Number((fee * 100).toFixed(3))}
            onChange={(v) => setFee(v / 100)}
            max={10}
            step="any"
            suffix="%"
          />
          <button className="btn btn-primary" type="submit">
            <RefreshCw size={15} /> Strategie testen
          </button>
        </div>
        {error && (
          <p className="negative" role="alert">
            {error}
          </p>
        )}
      </form>
      {!good ? (
        <NoData>
          Für das Backtesting werden gemeinsame Kurstage und Zielgewichte im Portfolio benötigt. Der
          gewählte Zeitraum kann höchstens so lang sein wie die verfügbare gemeinsame Historie.
        </NoData>
      ) : (
        <>
          <div className="grid-four analysis-metrics">
            <Metric
              label="Portfolio am Ende"
              value={money(result.finalValue)}
              note={`${money(result.contributed)} insgesamt eingezahlt`}
              positive
            />
            <Metric
              label="Zeitgewichtete Rendite"
              value={percent(result.totalReturn)}
              note={`${percent(result.annualReturn)} annualisiert`}
            />
            <Metric
              label="Maximaler Drawdown"
              value={`−${percent(result.maxDrawdown)}`}
              note="Einzahlungsbereinigter Rückgang"
            />
            <Metric
              label="Modellierte Kosten"
              value={money(result.fees)}
              note={`${percent(submitted.fee, 2)} Zusatzkosten p. a.`}
            />
          </div>
          <div className="card analysis-chart-card">
            <div className="card-header">
              <div>
                <h3>So hätte sich die Strategie entwickelt.</h3>
                <p className="muted">
                  {date(result.points[0].date)} –{' '}
                  {date(result.points[result.points.length - 1].date)} · auf gemeinsamen
                  Handelstagen
                </p>
              </div>
              <span className="badge neutral">
                {result.points.length.toLocaleString('de-DE')} Kurstage
              </span>
            </div>
            <div
              className="analysis-chart"
              role="img"
              aria-label="Historischer Portfoliowert und Einzahlungen mit S&P-500-Vergleich sofern verfügbar"
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 15, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="backtestGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0b8c74" stopOpacity={0.13} />
                      <stop offset="100%" stopColor="#0b8c74" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={gridStroke} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })
                    }
                    minTickGap={70}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#89918e' }}
                  />
                  <YAxis
                    tickFormatter={compact}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#89918e' }}
                    width={65}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(v) => date(String(v))}
                    formatter={(value, name) => [money(Number(value)), name]}
                  />
                  <Area
                    dataKey="value"
                    type="monotone"
                    fill="url(#backtestGradient)"
                    stroke="#0b8c74"
                    strokeWidth={2.5}
                    name="Deine Strategie"
                  />
                  {hasBenchmark && (
                    <Line
                      dataKey="benchmark"
                      type="monotone"
                      stroke="#7b8dbb"
                      strokeWidth={1.5}
                      dot={false}
                      name="S&P 500 · SPY"
                    />
                  )}
                  <Line
                    dataKey="contributions"
                    type="stepAfter"
                    stroke="#adb4b0"
                    strokeDasharray="4 4"
                    dot={false}
                    name="Einzahlungen"
                  />
                  <Legend
                    iconType="circle"
                    iconSize={7}
                    wrapperStyle={{ fontSize: 11, paddingTop: 18 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="grid-two">
            <div className="card analysis-form-card">
              <div className="card-header">
                <h3>Getestete Zielallokation</h3>
              </div>
              {workspace.holdings
                .filter((h) => h.targetWeight > 0)
                .map((h) => {
                  const sum = workspace.holdings
                    .filter((item) => item.targetWeight > 0)
                    .reduce((s, item) => s + item.targetWeight, 0);
                  const weight = sum > 0 ? h.targetWeight / sum : 0;
                  const instrument = INSTRUMENTS.find((i) => i.symbol === h.symbol);
                  return (
                    <div className="analysis-allocation-row" key={h.id}>
                      <span>
                        <i style={{ background: instrument?.color || '#0b8c74' }} />
                        <strong>{h.symbol}</strong>
                      </span>
                      <div>
                        <span
                          style={{
                            width: `${weight * 100}%`,
                            background: instrument?.color || '#0b8c74',
                          }}
                        />
                      </div>
                      <b>{percent(weight, 0)}</b>
                    </div>
                  );
                })}
              <p className="analysis-help">
                Zielgewichte werden auf 100 % normiert. Die Strategie startet mit diesen Gewichten;
                Sparraten fließen gemäß Zielgewichtung zu.
              </p>
            </div>
            <div className="card analysis-form-card">
              <div className="card-header">
                <h3>Was dieser Test aussagt</h3>
                <CircleHelp size={17} />
              </div>
              <div className="analysis-insight">
                <ArrowDownRight size={19} />
                <p>
                  Einzahlungen erhöhen das Vermögen, aber nicht die ausgewiesene zeitgewichtete
                  Rendite.
                </p>
              </div>
              <div className="analysis-insight">
                <TrendingUp size={19} />
                <p>
                  {hasBenchmark
                    ? 'SPY steht als ETF-Proxy für den S&P 500. Gleiche Einzahlungen, ohne die modellierten Portfoliokosten.'
                    : 'Für SPY sind in diesem Zeitraum keine passenden Kurse vorhanden. Ein Benchmarkvergleich wird deshalb nicht angezeigt.'}
                </p>
              </div>
              <div className="analysis-insight">
                <ShieldCheck size={19} />
                <p>
                  Die aktuelle Auswahl kennt die Gewinner der Vergangenheit. Das Ergebnis kann durch
                  Auswahl- und Überlebensverzerrungen beeinflusst sein.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
      <ModelNote>
        Rückrechnung mit historischen verfügbaren Kursen und heutigen Zielgewichten. Einzahlungen
        und Rebalancing erfolgen am ersten verfügbaren Handelstag des jeweiligen Monats bzw. Jahres.
        Keine Steuern, Spreads oder Ordergebühren; Zusatzkosten werden separat abgezogen; in
        ETF-Kursen enthaltene Fondskosten sind bereits berücksichtigt. EUR-Bewertung mit aktuellem
        Referenzkurs, ohne historische Währungseffekte. Kursanpassungen hängen von der Datenquelle
        ab. Vergangene Ergebnisse erlauben keine Aussage über künftige Renditen.
      </ModelNote>
    </>
  );
}
