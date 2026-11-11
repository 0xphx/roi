import { useMemo } from 'react';
import type { MarketResponse, Workspace } from '../lib/types';
import { currencyImpact } from '../lib/analytics';
import { dateLabel, decimal, pct } from '../lib/format';
import './currency.css';

export function FxHistoryDetails({ fx }: { fx: MarketResponse['fx'] }) {
  const history = fx.history;
  if (!history || history.status === 'unavailable' || !history.rates.length)
    return (
      <p className="fx-history-details" role="status">
        Keine verwendbare EUR/USD-Historie. Historische USD-Werte können nicht in EUR ausgewertet
        werden. Der aktuelle Referenzkurs wird nicht als Ersatz verwendet.
      </p>
    );
  return (
    <p className="fx-history-details">
      EUR/USD-Historie: {dateLabel(history.rates[0].date)} – {dateLabel(history.asOf)} ·{' '}
      {decimal(history.rates.length, 0)} EZB-Referenztage · abgerufen{' '}
      {new Date(history.fetchedAt).toLocaleString('de-DE', {
        dateStyle: 'short',
        timeStyle: 'short',
      })}
      {' · '}
      <a href={history.sourceUrl} target="_blank" rel="noreferrer">
        {history.source}
      </a>
      {history.status === 'cached' ? ' · gespeicherter Datenstand' : ''}
      {history.error ? ` · ${history.error}` : ''}
    </p>
  );
}

export function CurrencyImpact({
  workspace,
  market,
}: {
  workspace: Workspace;
  market: MarketResponse;
}) {
  const calculation = useMemo(() => {
    try {
      return { result: currencyImpact(workspace.holdings, market.series, market.fx), error: '' };
    } catch (error) {
      return { result: null, error: (error as Error).message };
    }
  }, [workspace.holdings, market]);
  const active = workspace.holdings.filter((holding) => holding.quantity > 0);
  if (!active.length) return null;
  const needsFx = active.some((holding) => market.series[holding.symbol]?.currency === 'USD');
  const history = market.fx.history;
  const fxDates = new Set(history?.rates.map((rate) => rate.date) ?? []);
  const assetDates = active.map(
    (holding) =>
      new Set(
        market.series[holding.symbol]?.prices
          .filter((point) => Number.isFinite(point.close) && point.close > 0)
          .map((point) => point.date) ?? [],
      ),
  );
  const missing = needsFx
    ? [...assetDates[0]].filter(
        (date) => assetDates.every((dates) => dates.has(date)) && !fxDates.has(date),
      ).length
    : 0;
  const result = calculation.result;
  return (
    <section className="card currency-impact" aria-label="Währungseinfluss">
      <div className="card-header">
        <div>
          <h2>Währungseinfluss</h2>
          <p className="muted">Heutiger Bestand, gesamter verfügbarer Zeitraum.</p>
        </div>
        {result && (
          <span className="currency-period">
            {dateLabel(result.startDate)} – {dateLabel(result.endDate)}
          </span>
        )}
      </div>
      {calculation.error && (
        <p className="note" role="status">
          {calculation.error}
        </p>
      )}
      {result ? (
        <>
          <dl className="currency-values">
            <div>
              <dt>Rendite in EUR</dt>
              <dd>{pct(result.eurReturn, true)}</dd>
            </div>
            <div>
              <dt>Mit festem Start-Wechselkurs</dt>
              <dd>{pct(result.constantFxReturn, true)}</dd>
            </div>
            <div>
              <dt>Differenz durch Umrechnung</dt>
              <dd>
                {result.contributionPp > 0 ? '+' : ''}
                {decimal(result.contributionPp, 2)} Pp.
              </dd>
            </div>
          </dl>
          <p className="card-footnote">
            Die Vergleichsrechnung hält den Wechselkurs des ersten gemeinsamen Tages fest. Die
            Differenz ist ein Renditeunterschied in Prozentpunkten, kein zusätzlicher Gewinn.
            {result.fxReturn !== null &&
              ` Die Veränderung des USD in EUR beträgt im selben Zeitraum ${pct(result.fxReturn, true)}.`}{' '}
            {decimal(result.observations, 0)} gemeinsame Kurstage ausgewertet.
            {needsFx &&
              ` ${decimal(missing, 0)} gemeinsame Kurstage ohne passenden EZB-Kurs ausgelassen.`}
            {!needsFx && ' Das Portfolio benötigt keine USD-Umrechnung.'}
          </p>
        </>
      ) : !calculation.error ? (
        <p className="card-footnote">
          Für den Vergleich fehlen mindestens zwei gemeinsame Kurstage.
        </p>
      ) : null}
      {needsFx && <FxHistoryDetails fx={market.fx} />}
      <p className="card-footnote">
        {needsFx
          ? 'Nur tatsächliche Kurstage mit passendem Referenzkurs; keine Auffüllung von Wochenenden oder Datenlücken. '
          : 'Nur tatsächliche gemeinsame Kurstage, keine Auffüllung von Datenlücken. '}
        Die Rückrechnung bildet keine tatsächlich getätigten Käufe ab.
      </p>
    </section>
  );
}
