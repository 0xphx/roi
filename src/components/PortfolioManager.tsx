import { useState } from 'react';
import type { FormEvent } from 'react';
import type { MarketResponse } from '../lib/types';
import type { PortfolioLibrary } from '../lib/portfolio-library';
import { currentPortfolio } from '../lib/analytics';
import { euro } from '../lib/format';
import './portfolio-tools.css';

interface Props {
  library: PortfolioLibrary;
  market: MarketResponse;
  onSelect: (id: string) => boolean;
  onCreate: (name: string, duplicateId?: string) => boolean;
  onRename: (id: string, name: string) => boolean;
  onDelete: (id: string) => boolean;
  onExport: () => void;
  onImport: () => void;
}
export function PortfolioManager({
  library,
  market,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onExport,
  onImport,
}: Props) {
  const [name, setName] = useState('');
  const [duplicateId, setDuplicateId] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  function create(event: FormEvent) {
    event.preventDefault();
    if (onCreate(name, duplicateId || undefined)) {
      setName('');
      setDuplicateId('');
    }
  }
  return (
    <div className="portfolio-manager">
      <p className="muted portfolio-manager-intro">
        Jedes Portfolio hat eigene Positionen, eine Watchlist und einen Anlageplan. Alle Daten
        bleiben in diesem Browser gespeichert.
      </p>
      <div className="portfolio-list" aria-label="Gespeicherte Portfolios">
        {library.portfolios.map((item) => {
          const valuation = currentPortfolio(
            item.workspace.holdings,
            market.series,
            market.fx.eurUsd,
          );
          return (
            <article
              className={`portfolio-entry ${item.id === library.activeId ? 'portfolio-entry-active' : ''}`}
              key={item.id}
            >
              {renameId === item.id ? (
                <form
                  className="portfolio-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (onRename(item.id, renameName)) setRenameId(null);
                  }}
                >
                  <div className="field">
                    <label htmlFor={`rename-${item.id}`}>Portfolioname</label>
                    <input
                      id={`rename-${item.id}`}
                      maxLength={80}
                      required
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                    />
                  </div>
                  <button className="btn btn-small" type="submit">
                    Namen speichern
                  </button>
                  <button className="text-link" type="button" onClick={() => setRenameId(null)}>
                    Abbrechen
                  </button>
                </form>
              ) : (
                <>
                  <button
                    className="portfolio-entry-select"
                    onClick={() => onSelect(item.id)}
                    aria-label={`${item.workspace.portfolioName} öffnen`}
                  >
                    <span>
                      <strong>{item.workspace.portfolioName}</strong>
                      <small>
                        {item.workspace.holdings.length} Positionen
                        {item.id === library.activeId ? ' · Aktiv' : ''}
                      </small>
                    </span>
                    <span>{euro(valuation.value, 2)}</span>
                  </button>
                  <div className="portfolio-entry-actions">
                    <button
                      className="text-link"
                      onClick={() => {
                        setRenameId(item.id);
                        setRenameName(item.workspace.portfolioName);
                        setDeleteId(null);
                      }}
                    >
                      Umbenennen
                    </button>
                    <button
                      className="text-link"
                      disabled={library.portfolios.length >= 12}
                      onClick={() => {
                        setDuplicateId(item.id);
                        setName(`${item.workspace.portfolioName.slice(0, 70)} Kopie`);
                      }}
                    >
                      Als Vorlage wählen
                    </button>
                    <button
                      className="text-link"
                      disabled={library.portfolios.length === 1}
                      onClick={() => {
                        setDeleteId(deleteId === item.id ? null : item.id);
                        setRenameId(null);
                      }}
                    >
                      Entfernen
                    </button>
                  </div>
                </>
              )}
              {deleteId === item.id && (
                <div className="portfolio-delete-confirm">
                  <p>
                    „{item.workspace.portfolioName}“ samt Positionen, Watchlist und Anlageplan
                    entfernen? Sichere die Daten vorher, wenn du sie behalten möchtest.
                  </p>
                  <button
                    className="btn btn-small btn-danger"
                    onClick={() => {
                      if (onDelete(item.id)) setDeleteId(null);
                    }}
                  >
                    Portfolio entfernen
                  </button>
                  <button className="text-link" onClick={() => setDeleteId(null)}>
                    Abbrechen
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <form className="portfolio-create" onSubmit={create}>
        <h3>Portfolio hinzufügen</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="new-portfolio-name">Name</label>
            <input
              id="new-portfolio-name"
              required
              maxLength={80}
              value={name}
              placeholder="z. B. Langfristige Anlage"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="portfolio-template">Ausgangsbasis</label>
            <select
              id="portfolio-template"
              value={duplicateId}
              onChange={(e) => setDuplicateId(e.target.value)}
            >
              <option value="">Leeres Portfolio</option>
              {library.portfolios.map((item) => (
                <option key={item.id} value={item.id}>
                  Kopie: {item.workspace.portfolioName}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={library.portfolios.length >= 12}
        >
          Portfolio erstellen
        </button>
        <p className="small muted">
          {library.portfolios.length} von 12 Portfolios. Ein leeres Portfolio beginnt ohne
          Positionen. Eine Kopie übernimmt Bestand, Zielgewichte, Watchlist und Plan.
        </p>
      </form>
      <div className="portfolio-backup">
        <h3>Sicherung aller Portfolios</h3>
        <p className="muted">
          Die Sicherung enthält alle Portfolios mit Anlageplänen und Watchlists. Dateien mit einem
          einzelnen Portfolio sowie CSV-Dateien werden dagegen in das gerade geöffnete Portfolio
          importiert.
        </p>
        <div className="portfolio-backup-actions">
          <button className="btn" onClick={onExport}>
            Alle Portfolios exportieren
          </button>
          <button className="btn" onClick={onImport}>
            Sicherung importieren
          </button>
        </div>
      </div>
    </div>
  );
}
