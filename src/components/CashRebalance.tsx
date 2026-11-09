import { useMemo, useState } from 'react';
import type { MarketResponse, Workspace } from '../lib/types';
import { cashRebalance } from '../lib/analytics';
import { decimal, euro, pct } from '../lib/format';
import { INSTRUMENT_BY_SYMBOL } from '../data/catalog';
import { downloadFile } from '../lib/workspace';
import './portfolio-tools.css';

export function CashRebalance({
  workspace,
  market,
}: {
  workspace: Workspace;
  market: MarketResponse;
}) {
  const [cash, setCash] = useState('1000');
  const [submitted, setSubmitted] = useState(1000);
  const calculation = useMemo(() => {
    try {
      return {
        result: cashRebalance(workspace.holdings, market.series, market.fx.eurUsd, submitted),
        error: '',
      };
    } catch (e) {
      return {
        result: null,
        error: e instanceof Error ? e.message : 'Die Verteilung konnte nicht berechnet werden.',
      };
    }
  }, [workspace.holdings, market, submitted]);
  const [formError, setFormError] = useState('');
  const result = calculation.result;
  const totalTarget = workspace.holdings.reduce((sum, h) => sum + h.targetWeight, 0);
  function exportAllocation() {
    if (!result) return;
    downloadFile(
      'roi-rebalancing.csv',
      'symbol,allocationEUR,additionalQuantity,targetWeightPercent,afterWeightPercent\n' +
        result.positions
          .map((p) =>
            [p.symbol, p.allocation, p.quantity, p.targetWeight * 100, p.afterWeight * 100].join(
              ',',
            ),
          )
          .join('\n'),
      'text/csv;charset=utf-8',
    );
  }
  return (
    <section className="card cash-rebalance">
      <div className="card-header">
        <div>
          <h2>Rebalancing mit neuem Kapital</h2>
          <p className="muted">
            Zusätzliches Kapital auf untergewichtete Positionen verteilen, ohne bestehende
            Positionen zu verkaufen.
          </p>
        </div>
      </div>
      <form
        className="cash-rebalance-form"
        onSubmit={(e) => {
          e.preventDefault();
          const amount = Number(cash);
          if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) {
            setFormError('Bitte einen Betrag zwischen 0 und 1 Milliarde Euro eingeben.');
            return;
          }
          setFormError('');
          setSubmitted(amount);
        }}
      >
        <div className="field">
          <label htmlFor="additional-capital">Zusätzliches Kapital (EUR)</label>
          <input
            id="additional-capital"
            type="number"
            min="0"
            max="1000000000"
            step="any"
            required
            value={cash}
            onChange={(e) => setCash(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit">
          Verteilung berechnen
        </button>
        {result && (
          <button type="button" className="btn" onClick={exportAllocation}>
            CSV exportieren
          </button>
        )}
      </form>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      {calculation.error && (
        <p className="note" role="status">
          {calculation.error}
        </p>
      )}
      {result && (
        <>
          <div className="cash-rebalance-totals">
            <span>
              Aktueller Marktwert<strong>{euro(result.currentValue, 2)}</strong>
            </span>
            <span>
              Neues Kapital<strong>{euro(result.invested, 2)}</strong>
            </span>
            <span>
              Marktwert nach Einzahlung<strong>{euro(result.afterValue, 2)}</strong>
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Aktuell</th>
                  <th>Ziel</th>
                  <th>Zukauf (EUR)</th>
                  <th>Zusätzliche Stückzahl</th>
                  <th>Danach</th>
                </tr>
              </thead>
              <tbody>
                {result.positions.map((p) => (
                  <tr key={p.symbol}>
                    <td>
                      <strong>{p.symbol}</strong>
                      <small className="cell-sub">
                        {INSTRUMENT_BY_SYMBOL[p.symbol]?.shortName}
                      </small>
                    </td>
                    <td>{pct(p.currentWeight)}</td>
                    <td>{pct(p.targetWeight)}</td>
                    <td>{euro(p.allocation, 2)}</td>
                    <td>{decimal(p.quantity, 6)}</td>
                    <td>{pct(p.afterWeight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="card-footnote">
            {Math.abs(totalTarget - 100) > 0.01
              ? `Die Zielgewichte (${decimal(totalTarget)} %) werden auf 100 % normiert. `
              : ''}
            Nur rechnerische Zukäufe mit Bruchstücken; keine Orderausführung. Verteilung
            proportional zu den fehlenden Beträgen der Zielallokation nach Einzahlung. Ohne
            Gebühren, Steuern und Spreads; aktuelle USD-Kurse mit konstantem EUR/USD-Referenzkurs.
            Neue Zielgewichte können durch eine Einzahlung allein unerreichbar bleiben.
          </p>
        </>
      )}
    </section>
  );
}
