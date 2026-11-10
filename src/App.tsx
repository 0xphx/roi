import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  ExternalLink,
  FileUp,
  Globe2,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Trash2,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Holding, Instrument, MarketResponse, Workspace } from './lib/types';
import { currentPortfolio, portfolioHistory, riskMetrics } from './lib/analytics';
import { downloadFile, parseHoldingsCsv, parseWorkspace } from './lib/workspace';
import {
  activePortfolio,
  createPortfolio,
  deletePortfolio,
  loadPortfolioLibrary,
  parsePortfolioLibrary,
  renamePortfolio,
  savePortfolioLibraryIfUnchanged,
  selectPortfolio,
  LIBRARY_STORAGE_KEY,
} from './lib/portfolio-library';
import type { PortfolioLibrary } from './lib/portfolio-library';
import { CLASS_LABEL, dateLabel, decimal, euro, money, pct, shortDate } from './lib/format';
import { INSTRUMENTS, INSTRUMENT_BY_SYMBOL } from './data/catalog';
import snapshot from './data/market-snapshot.json';
import { loadMarketData } from './lib/market-client';
import { PlannerPage, RiskPage, StressPage, BacktestPage } from './components/AnalysisPages';
import { ComparePage } from './components/ComparePage';
import { PortfolioManager } from './components/PortfolioManager';
import { CashRebalance } from './components/CashRebalance';

type Page =
  'overview' | 'portfolio' | 'planner' | 'risk' | 'stress' | 'backtest' | 'compare' | 'markets';
const NAV: { id: Page; label: string }[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'planner', label: 'Anlageplan' },
  { id: 'risk', label: 'Risikoanalyse' },
  { id: 'stress', label: 'Stresstest' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'compare', label: 'Strategievergleich' },
  { id: 'markets', label: 'Märkte' },
];
const tooltipStyle = {
  border: '1px solid #deded9',
  borderRadius: 3,
  fontSize: 12,
  background: '#fff',
};
function getPage(): Page {
  const hash = location.hash.slice(1);
  return NAV.some((n) => n.id === hash) ? (hash as Page) : 'overview';
}
function IconBadge({
  instrument,
  size = 'normal',
}: {
  instrument: Instrument;
  size?: 'normal' | 'small';
}) {
  return (
    <span className={`asset-icon ${size === 'small' ? 'asset-icon-small' : ''}`}>
      {instrument.symbol.replace('-USD', '')}
    </span>
  );
}
function Delta({ value }: { value: number }) {
  return (
    <span
      className={`delta ${Number.isFinite(value) ? (value >= 0 ? 'positive' : 'negative') : 'neutral'}`}
    >
      {pct(value, true)}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button,input,select,a[href],[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Schließen" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const PAGES_MODE = import.meta.env.MODE === 'github-pages';

export default function App() {
  const [loaded] = useState(loadPortfolioLibrary);
  const [library, setLibrary] = useState<PortfolioLibrary>(loaded.library);
  const libraryRef = useRef(loaded.library);
  const storedValueRef = useRef(loaded.storedValue);
  const currentEntry = activePortfolio(library);
  const workspace = currentEntry.workspace;
  const [importRevision, setImportRevision] = useState(0);
  const [pendingImport, setPendingImport] = useState<PortfolioLibrary | null>(null);
  const [market, setMarket] = useState<MarketResponse>(snapshot as MarketResponse);
  const [page, setPage] = useState<Page>(getPage);
  const [sidebar, setSidebar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(loaded.error || '');
  const [noticeError, setNoticeError] = useState(!!loaded.error);
  const [dialog, setDialog] = useState<
    'search' | 'sources' | 'help' | 'settings' | 'portfolios' | 'import-library' | null
  >(null);
  const [edit, setEdit] = useState<Holding | 'new' | null>(null);
  const [preselected, setPreselected] = useState('VTI');
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const refreshing = useRef(false);
  function notify(text: string, error = false) {
    setNotice(text);
    setNoticeError(error);
  }
  function commitLibrary(next: PortfolioLibrary) {
    try {
      const saved = savePortfolioLibraryIfUnchanged(next, storedValueRef.current);
      libraryRef.current = saved.library;
      storedValueRef.current = saved.storedValue;
      setLibrary(saved.library);
      return true;
    } catch (e) {
      try {
        const actual = localStorage.getItem(LIBRARY_STORAGE_KEY);
        if (actual !== null && actual !== storedValueRef.current) {
          const latest = parsePortfolioLibrary(JSON.parse(actual));
          libraryRef.current = latest;
          storedValueRef.current = actual;
          setLibrary(latest);
          setDialog(null);
          setEdit(null);
          setSelectedAsset(null);
          setImportRevision((value) => value + 1);
        }
      } catch {
        /* Preserve the opened collection when external storage is unreadable. */
      }
      notify(
        e instanceof DOMException
          ? 'Der Browser konnte die Änderung nicht speichern. Prüfe den verfügbaren Speicher und exportiere eine Sicherung.'
          : (e as Error).message,
        true,
      );
      return false;
    }
  }
  function mutateLibrary(transform: (current: PortfolioLibrary) => PortfolioLibrary) {
    try {
      return commitLibrary(transform(libraryRef.current));
    } catch (error) {
      notify((error as Error).message, true);
      return false;
    }
  }
  function update(next: Workspace) {
    if (libraryRef.current.activeId !== currentEntry.id) {
      notify(
        'Das aktive Portfolio wurde inzwischen gewechselt. Bitte öffne die Eingabe erneut.',
        true,
      );
      return false;
    }
    return mutateLibrary((current) => ({
      ...current,
      portfolios: current.portfolios.map((item) =>
        item.id === current.activeId ? { ...item, workspace: parseWorkspace(next) } : item,
      ),
    }));
  }
  function switchPortfolio(id: string) {
    const saved = mutateLibrary((current) => selectPortfolio(current, id));
    if (saved) {
      setDialog(null);
      setEdit(null);
      setSelectedAsset(null);
      setSidebar(false);
      window.scrollTo({ top: 0 });
    }
    return saved;
  }
  function navigate(next: Page) {
    location.hash = next;
    setPage(next);
    setSidebar(false);
    window.scrollTo({ top: 0 });
  }
  useEffect(() => {
    const handler = () => setPage(getPage());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== LIBRARY_STORAGE_KEY || !event.newValue) return;
      try {
        const next = parsePortfolioLibrary(JSON.parse(event.newValue));
        libraryRef.current = next;
        storedValueRef.current = event.newValue;
        setLibrary(next);
        setDialog(null);
        setEdit(null);
        setSelectedAsset(null);
        setImportRevision((value) => value + 1);
        notify('Portfolios wurden in einem anderen Fenster aktualisiert.');
      } catch {
        notify(
          'Die Änderung aus einem anderen Fenster konnte nicht gelesen werden. Deine geöffneten Daten bleiben erhalten.',
          true,
        );
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timeout);
  }, [notice]);
  async function refresh(manual = false) {
    if (refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    try {
      const data = await loadMarketData({
        manual,
        pages: PAGES_MODE,
        baseUrl: import.meta.env.BASE_URL,
      });
      setMarket(data);
      if (manual) {
        const cached = Object.values(data.series).some((s) => s.status !== 'fresh');
        notify(
          PAGES_MODE
            ? 'Veröffentlichter Datenstand neu geladen. Das jeweilige Kursdatum findest du unter „Daten & Quellen“.'
            : cached
              ? 'Daten geprüft. Einige Anbieter sind nicht erreichbar; der gekennzeichnete letzte Datenstand bleibt erhalten.'
              : 'Marktdaten erfolgreich aktualisiert.',
        );
      }
    } catch {
      if (manual)
        notify(
          PAGES_MODE
            ? 'Der veröffentlichte Datenstand ist gerade nicht erreichbar. Die zuletzt geladenen Kurse bleiben sichtbar.'
            : 'Der Datenanbieter ist nicht erreichbar. Der zuletzt abgerufene Datenstand bleibt sichtbar.',
          true,
        );
    } finally {
      setLoading(false);
      refreshing.current = false;
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const portfolio = useMemo(
    () => currentPortfolio(workspace.holdings, market.series, market.fx.eurUsd),
    [workspace.holdings, market],
  );
  const history = useMemo(
    () => portfolioHistory(workspace.holdings, market.series, market.fx.eurUsd),
    [workspace.holdings, market],
  );
  const risk = useMemo(
    () => riskMetrics(history, workspace.riskFreeRate),
    [history, workspace.riskFreeRate],
  );
  function addAsset(symbol?: string) {
    const existing = symbol ? workspace.holdings.find((h) => h.symbol === symbol) : undefined;
    const next =
      symbol ||
      INSTRUMENTS.find((i) => !workspace.holdings.some((h) => h.symbol === i.symbol))?.symbol;
    if (!next) {
      notify(
        'Alle verfügbaren Instrumente sind bereits enthalten. Bearbeite eine vorhandene Position.',
      );
      return;
    }
    setPreselected(next);
    setEdit(existing || 'new');
  }

  function watch(symbol: string) {
    update({
      ...workspace,
      watchlist: workspace.watchlist.includes(symbol)
        ? workspace.watchlist.filter((s) => s !== symbol)
        : [...workspace.watchlist, symbol],
    });
  }
  async function importFile(file: File) {
    const targetId = libraryRef.current.activeId;
    const startingValue = storedValueRef.current;
    try {
      if (file.size > 1024 * 1024) throw new Error('Bitte eine Datei unter 1 MB wählen.');
      const text = await file.text();
      if (targetId !== libraryRef.current.activeId || startingValue !== storedValueRef.current) {
        throw new Error(
          'Die Portfolios wurden während des Dateilesens geändert. Bitte wähle die Importdatei erneut.',
        );
      }
      const next = file.name.toLowerCase().endsWith('.csv')
        ? { ...workspace, holdings: parseHoldingsCsv(text) }
        : JSON.parse(text);
      if (next?.kind === 'roi-portfolio-library') {
        setPendingImport(parsePortfolioLibrary(next));
        setDialog('import-library');
        return;
      }
      if (update(parseWorkspace(next))) {
        setImportRevision((value) => value + 1);
        notify(`${file.name} wurde in das aktive Portfolio importiert.`);
      }
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  function exportJson() {
    downloadFile(
      `roi-workspace-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(workspace, null, 2),
    );
    notify('Das aktive Portfolio wurde exportiert.');
  }
  function exportLibrary() {
    downloadFile(
      `roi-portfolios-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(library, null, 2),
    );
    notify('Alle Portfolios wurden exportiert.');
  }
  const dates = Object.values(market.series)
    .map((s) => s.asOf)
    .filter(Boolean)
    .sort();
  const lastDate = dates[0];
  const cached =
    Object.values(market.series).some((s) => s.status !== 'fresh') || market.fx.status !== 'fresh';
  const active = NAV.find((n) => n.id === page)!;
  const common = { workspace, market, onChange: update };
  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Menü schließen"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside id="main-navigation" className={`sidebar ${sidebar ? 'sidebar-open' : ''}`}>
        <button className="brand" onClick={() => navigate('overview')} aria-label="ROI Übersicht">
          ROI
        </button>
        <p className="sidebar-caption">Portfolio & Analyse</p>
        <div className="sidebar-portfolio">
          <label htmlFor="active-portfolio">Aktives Portfolio</label>
          <select
            id="active-portfolio"
            value={library.activeId}
            onChange={(event) => switchPortfolio(event.target.value)}
          >
            {library.portfolios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.workspace.portfolioName}
              </option>
            ))}
          </select>
          <button
            className="text-link"
            onClick={() => {
              setDialog('portfolios');
              setSidebar(false);
            }}
          >
            Portfolios verwalten
          </button>
        </div>
        <nav aria-label="Hauptnavigation">
          {NAV.map((nav) => (
            <div
              key={nav.id}
              className={nav.id === 'risk' || nav.id === 'markets' ? 'nav-group-start' : undefined}
            >
              <button
                className={`nav-link ${page === nav.id ? 'active' : ''}`}
                onClick={() => navigate(nav.id)}
                aria-current={page === nav.id ? 'page' : undefined}
              >
                <span>{nav.label}</span>
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-link" onClick={() => setDialog('help')}>
            Hilfe & Methodik
          </button>
          <div className="storage-indicator">Daten lokal gespeichert</div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              onClick={() => setSidebar(!sidebar)}
              aria-label="Menü öffnen"
              aria-expanded={sidebar}
              aria-controls="main-navigation"
            >
              <Menu size={21} />
            </button>
            <strong>{active.label}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="global-search"
              aria-label="Wertpapier suchen"
              onClick={() => setDialog('search')}
            >
              <Search size={16} />
              <span>Suchen</span>
            </button>
            <button
              className="topbar-link"
              onClick={() => setDialog('sources')}
              aria-label="Datenstatus anzeigen"
            >
              Datenstand
            </button>
            <button
              className="topbar-link settings-link"
              onClick={() => setDialog('settings')}
              aria-label="Einstellungen"
            >
              <Settings2 size={16} />
              <span>Einstellungen</span>
            </button>
          </div>
        </header>
        <main className="main-content" key={`${currentEntry.id}:${importRevision}`}>
          {page === 'overview' && (
            <>
              <div className="page-heading">
                <div>
                  <h1>Übersicht</h1>
                  <p className="muted">Bestand, Entwicklung und Risiko.</p>
                </div>
                <div className="heading-actions">
                  <button className="btn" onClick={exportJson}>
                    <Download size={16} />
                    Portfolio sichern
                  </button>
                  <button className="btn btn-primary" onClick={() => addAsset()}>
                    <Plus size={17} />
                    Position hinzufügen
                  </button>
                </div>
              </div>
              <div className="overview-context">
                <button className="portfolio-name" onClick={() => setDialog('portfolios')}>
                  {workspace.portfolioName}
                  <ChevronDown size={13} />
                </button>
                <button className="data-state" onClick={() => setDialog('sources')}>
                  {PAGES_MODE
                    ? 'Veröffentlichte Marktdaten'
                    : cached
                      ? 'Gespeicherte Marktdaten'
                      : 'Marktdaten aktualisiert'}
                  <span className="data-date">Stand {dateLabel(lastDate)}</span>
                </button>
              </div>
              <div className="grid-four kpi-grid">
                <Metric
                  label="Portfoliowert"
                  value={euro(portfolio.value, 2)}
                  note={
                    <>
                      <Delta value={portfolio.gainPercent} />
                      <span>seit Einstand</span>
                    </>
                  }
                />
                <Metric
                  label="Historische Wertentwicklung"
                  value={pct(history.length > 1 ? risk.totalReturn : NaN, true)}
                  note={<span>Heutiger Bestand rückgerechnet</span>}
                />
                <Metric
                  label="Jährliche Schwankung"
                  value={pct(history.length >= 31 ? risk.volatility : NaN)}
                  note={<span>Aus Tagesrenditen hochgerechnet</span>}
                />
                <Metric
                  label="Monatlicher Sparplan"
                  value={euro(workspace.plan.monthlyContribution)}
                  note={
                    <button className="inline-link" onClick={() => navigate('planner')}>
                      Anlageplan bearbeiten
                    </button>
                  }
                />
              </div>
              <div className="overview-charts">
                <PortfolioChart history={history} />
                <AllocationCard
                  positions={portfolio.positions}
                  value={portfolio.value}
                  onDetails={() => navigate('portfolio')}
                />
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    Positionen <span className="count-badge">{workspace.holdings.length}</span>
                  </h2>
                </div>
                <button className="text-link" onClick={() => navigate('portfolio')}>
                  Verwalten
                </button>
              </div>
              <div className="card holdings-card">
                <HoldingsTable
                  workspace={workspace}
                  market={market}
                  onEdit={(h) => setEdit(h)}
                  onDetails={setSelectedAsset}
                />
              </div>
            </>
          )}
          {page === 'portfolio' && (
            <>
              <div className="page-heading">
                <div>
                  <h1>Portfolio</h1>
                  <p className="muted">Positionen, Einstandspreise und Zielgewichte.</p>
                </div>
                <div className="heading-actions">
                  <button className="btn" onClick={() => importRef.current?.click()}>
                    <FileUp size={16} />
                    Importieren
                  </button>
                  <button className="btn btn-primary" onClick={() => addAsset()}>
                    <Plus size={16} />
                    Position hinzufügen
                  </button>
                </div>
              </div>
              <div className="grid-three">
                <Metric
                  label="Portfoliowert"
                  value={euro(portfolio.value, 2)}
                  note={<span>{workspace.holdings.length} Positionen · Basiswährung EUR</span>}
                />
                <Metric
                  label="Investiertes Kapital"
                  value={euro(portfolio.cost, 2)}
                  note={<span>Einstand mit aktuellem Wechselkurs</span>}
                />
                <Metric
                  label="Buchgewinn / -verlust"
                  value={euro(portfolio.gain, 2)}
                  note={<Delta value={portfolio.gainPercent} />}
                />
              </div>
              <div className="card portfolio-management">
                <div className="card-header">
                  <h2>{workspace.portfolioName}</h2>
                  <button
                    className="btn btn-small"
                    onClick={() => {
                      downloadFile(
                        'roi-positionen.csv',
                        'symbol,quantity,averageCost,targetWeight\n' +
                          workspace.holdings
                            .map((h) =>
                              [h.symbol, h.quantity, h.averageCost, h.targetWeight].join(','),
                            )
                            .join('\n'),
                        'text/csv;charset=utf-8',
                      );
                      notify('Positionen als CSV exportiert.');
                    }}
                  >
                    <Download size={14} />
                    CSV exportieren
                  </button>
                </div>
                <HoldingsTable
                  workspace={workspace}
                  market={market}
                  onEdit={(h) => setEdit(h)}
                  onDetails={setSelectedAsset}
                  editable
                />
                <div className="table-footer">
                  <span>
                    <ShieldCheck size={14} /> Positionen werden in diesem Browser gespeichert.
                  </span>
                  <button className="inline-link" onClick={exportJson}>
                    Portfolio sichern <Download size={13} />
                  </button>
                </div>
              </div>
              <RebalanceCard workspace={workspace} market={market} onChange={update} />
              <CashRebalance workspace={workspace} market={market} />
              <div className="note">
                <BookOpen size={17} />
                <span>
                  <strong>CSV importieren:</strong> Spalten{' '}
                  <code>symbol,quantity,averageCost,targetWeight</code>, Dezimalpunkt verwenden.
                  Einstandspreise in der Handelswährung, Zielgewichte in Prozent. Ein Import ersetzt
                  die Positionen im aktiven Portfolio. Lade vorher eine Sicherung herunter.
                </span>
              </div>
            </>
          )}
          {page === 'planner' && <PlannerPage {...common} />}
          {page === 'risk' && <RiskPage {...common} />}
          {page === 'stress' && <StressPage {...common} />}
          {page === 'backtest' && <BacktestPage {...common} />}
          {page === 'compare' && <ComparePage library={library} market={market} />}
          {page === 'markets' && (
            <MarketsPage
              workspace={workspace}
              market={market}
              onWatch={watch}
              onDetails={setSelectedAsset}
              onAdd={addAsset}
              onRefresh={() => refresh(true)}
              loading={loading}
            />
          )}
          <footer className="page-footer">
            <span>ROI · Portfolioanalyse</span>
            <div>
              <button onClick={() => setDialog('sources')}>Daten & Quellen</button>
              <span>·</span>
              <button onClick={() => setDialog('help')}>Methodik</button>
              <span>·</span>
              <span>Planung, keine Anlageberatung</span>
            </div>
          </footer>
        </main>
      </div>
      <input
        ref={importRef}
        type="file"
        accept=".json,.csv"
        className="visually-hidden"
        aria-label="Portfolio importieren"
        onChange={(e) => {
          if (e.target.files?.[0]) void importFile(e.target.files[0]);
          e.target.value = '';
        }}
      />
      {notice && (
        <div
          className={`toast ${noticeError ? 'toast-error' : ''}`}
          role={noticeError ? 'alert' : 'status'}
        >
          {noticeError ? <CircleHelp size={18} /> : <CheckCheck size={18} />}
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Meldung schließen">
            <X size={15} />
          </button>
        </div>
      )}
      {edit && (
        <PositionModal
          holding={edit === 'new' ? undefined : edit}
          initialSymbol={preselected}
          market={market}
          holdings={workspace.holdings}
          onClose={() => setEdit(null)}
          onSave={(holding) => {
            const existing = workspace.holdings.some((h) => h.id === holding.id);
            const saved = update({
              ...workspace,
              holdings: existing
                ? workspace.holdings.map((h) => (h.id === holding.id ? holding : h))
                : [...workspace.holdings, holding],
            });
            if (saved) {
              setEdit(null);
              notify(existing ? 'Position aktualisiert.' : 'Position hinzugefügt.');
            }
          }}
          onDelete={(id) => {
            if (update({ ...workspace, holdings: workspace.holdings.filter((h) => h.id !== id) })) {
              setEdit(null);
              notify('Position entfernt.');
            }
          }}
        />
      )}
      {selectedAsset && (
        <AssetModal
          symbol={selectedAsset}
          market={market}
          watched={workspace.watchlist.includes(selectedAsset)}
          onClose={() => setSelectedAsset(null)}
          onWatch={() => watch(selectedAsset)}
          onAdd={() => {
            addAsset(selectedAsset);
            setSelectedAsset(null);
          }}
        />
      )}
      {dialog === 'search' && (
        <SearchModal
          market={market}
          onClose={() => setDialog(null)}
          onSelect={(symbol) => {
            setDialog(null);
            setSelectedAsset(symbol);
          }}
        />
      )}
      {dialog === 'sources' && (
        <Modal title="Datenstand & Quellen" onClose={() => setDialog(null)} wide>
          <div className="source-intro">
            <p className="muted">
              Echte Tageskurse von Yahoo Finance, bei Ausfällen Stooq. Keine Echtzeitkurse. Ein
              laufender Handelstag kann noch vorläufig sein.
              {PAGES_MODE &&
                ' Die Online-Version erhält neue Daten durch einen täglichen Aktualisierungslauf. „Daten neu laden“ lädt den zuletzt erfolgreich veröffentlichten Stand. Bei Anbieterfehlern bleibt der letzte gültige Kurs erhalten.'}
            </p>
            <button className="btn btn-primary" disabled={loading} onClick={() => refresh(true)}>
              <RefreshCw size={15} className={loading ? 'spinning' : ''} />
              {loading ? 'Wird geprüft …' : PAGES_MODE ? 'Daten neu laden' : 'Jetzt aktualisieren'}
            </button>
          </div>
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
                {Object.values(market.series).map((s) => (
                  <tr key={s.symbol}>
                    <td>
                      <strong>{s.symbol}</strong>
                    </td>
                    <td>{dateLabel(s.asOf)}</td>
                    <td>
                      {s.fetchedAt
                        ? new Date(s.fetchedAt).toLocaleString('de-DE', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </td>
                    <td>
                      <span className={`badge ${s.status === 'fresh' ? 'positive' : 'neutral'}`}>
                        {s.status === 'fresh'
                          ? 'Aktualisiert'
                          : s.status === 'cached'
                            ? PAGES_MODE
                              ? 'Veröffentlicht'
                              : 'Gespeichert'
                            : 'Nicht verfügbar'}
                      </span>
                    </td>
                    <td>
                      <a
                        className="inline-link"
                        href={s.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.source.startsWith('Stooq') ? 'Stooq' : 'Yahoo Finance'}{' '}
                        <ExternalLink size={11} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="note">
            <Globe2 size={17} />
            <span>
              EZB-Referenzkurs vom {dateLabel(market.fx.date)}: 1 EUR ={' '}
              {decimal(market.fx.eurUsd, 4)} USD (
              {market.fx.status === 'fresh' ? 'aktualisiert' : 'gespeichert'}). Historische
              EUR-Werte verwenden diesen konstanten Kurs; historische Währungseffekte werden nicht
              abgebildet.{' '}
              <a
                href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html"
                target="_blank"
                rel="noreferrer"
              >
                Zur EZB
              </a>
            </span>
          </div>
          <p className="small muted">
            Kursreihen sind nach Möglichkeit um Ausschüttungen und Splits bereinigt. Das eingebaute
            Offline-Abbild enthält echte abgerufene Marktdaten. Ein Cache-Fallback behält Abruf- und
            Kursdatum unverändert bei.
          </p>
        </Modal>
      )}
      {dialog === 'help' && (
        <Modal title="Berechnungen und Daten" onClose={() => setDialog(null)} wide>
          <div className="help-grid">
            {[
              {
                icon: Wallet,
                title: 'Beispielbestand',
                text: 'Das Startportfolio enthält frei gewählte Beispielbestände und Einstandspreise. Ersetze sie durch deine Positionen. Es werden keine Depotdaten automatisch eingelesen.',
              },
              {
                icon: Activity,
                title: 'Historische Analyse',
                text: 'Die Übersicht rechnet den heutigen Bestand rückwirkend mit bereinigten Tageskursen. Sie zeigt eine Modellrechnung, keine tatsächliche Depotperformance. Nur gemeinsame Handelstage aller Positionen werden verwendet.',
              },
              {
                icon: ShieldCheck,
                title: 'Risikokennzahlen',
                text: 'Volatilität basiert auf täglichen Renditen, annualisiert mit 252 Handelstagen. VaR und Expected Shortfall beschreiben historische Tagesverluste auf 95%-Niveau. Sie begrenzen zukünftige Verluste nicht.',
              },
              {
                icon: Zap,
                title: 'Szenarien & Simulationen',
                text: 'Stresstests sind frei veränderbare, hypothetische Schocks. Monte Carlo nutzt ein geometrisches Renditemodell mit konstanten Annahmen und festem Zufallsstartwert. Krisen und Extremverluste können unterschätzt werden.',
              },
              {
                icon: ChartNoAxesCombined,
                title: 'Backtesting',
                text: 'Zielgewichte, Sparraten und laufende Gebühren werden auf tatsächliche gemeinsame Kurstage angewendet. Der S&P-500-ETF SPY dient als Vergleich. Steuern, Spreads, Handelsgebühren und historische Wechselkurse fehlen.',
              },
              {
                icon: ShieldCheck,
                title: 'Lokale Speicherung',
                text:
                  'Positionen und Pläne werden lokal im Browser gespeichert. Es gibt keine Cloud-Synchronisierung, Bankanbindung oder Orderausführung. Exportiere regelmäßig eine JSON-Sicherung. ' +
                  (PAGES_MODE
                    ? 'Die Online-Version lädt ausschließlich öffentliche Kursdaten; deine Bestände werden dabei nicht übertragen.'
                    : 'Die Kurs-API erhält nur Wertpapiersymbole.'),
              },
            ].map((x) => (
              <article key={x.title}>
                <x.icon size={21} />
                <h3>{x.title}</h3>
                <p>{x.text}</p>
              </article>
            ))}
          </div>
          <div className="note">
            Historische Renditen und Simulationen sind keine Prognose. Die Anwendung unterstützt
            deine eigene Analyse; sie gibt keine persönlichen Kauf- oder Verkaufsempfehlungen.
          </div>
        </Modal>
      )}
      {dialog === 'settings' && (
        <SettingsModal
          workspace={workspace}
          onClose={() => setDialog(null)}
          onChange={update}
          onExport={exportJson}
          onImport={() => {
            setDialog(null);
            importRef.current?.click();
          }}
          onExportAll={exportLibrary}
          onManage={() => setDialog('portfolios')}
        />
      )}
      {dialog === 'portfolios' && (
        <Modal title="Portfolios verwalten" wide onClose={() => setDialog(null)}>
          <PortfolioManager
            library={library}
            market={market}
            onSelect={switchPortfolio}
            onCreate={(name, duplicateId) => {
              const saved = mutateLibrary((current) => createPortfolio(current, name, duplicateId));
              if (saved) {
                setDialog(null);
                notify('Portfolio erstellt und geöffnet.');
              }
              return saved;
            }}
            onRename={(id, name) => mutateLibrary((current) => renamePortfolio(current, id, name))}
            onDelete={(id) => mutateLibrary((current) => deletePortfolio(current, id))}
            onExport={exportLibrary}
            onImport={() => {
              setDialog(null);
              importRef.current?.click();
            }}
          />
        </Modal>
      )}
      {dialog === 'import-library' && pendingImport && (
        <Modal
          title="Gesamtsicherung importieren"
          onClose={() => {
            setDialog(null);
            setPendingImport(null);
          }}
        >
          <p className="muted">
            Diese Datei enthält mehrere Portfolios. Beim Import werden die aktuell in diesem Browser
            gespeicherten Portfolios vollständig ersetzt.
          </p>
          <div className="library-import-summary">
            <p>Aktuell: {library.portfolios.length} Portfolios</p>
            <p>Aus der Sicherung: {pendingImport.portfolios.length} Portfolios</p>
            <p>Danach aktiv: {activePortfolio(pendingImport).workspace.portfolioName}</p>
          </div>
          <button className="text-link" onClick={exportLibrary}>
            Vorher aktuelle Gesamtsicherung herunterladen
          </button>
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                setDialog(null);
                setPendingImport(null);
              }}
            >
              Abbrechen
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (commitLibrary(pendingImport)) {
                  setPendingImport(null);
                  setDialog(null);
                  setImportRevision((value) => value + 1);
                  notify('Gesamtsicherung importiert.');
                }
              }}
            >
              Alle Portfolios ersetzen
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Metric({ label, value, note }: { label: string; value: string; note: ReactNode }) {
  return (
    <div className="card metric">
      <div className="metric-top">
        <span className="metric-label">{label}</span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}
function PortfolioChart({ history }: { history: ReturnType<typeof portfolioHistory> }) {
  const [period, setPeriod] = useState('5J');
  const [benchmark, setBenchmark] = useState(true);
  const data = useMemo(() => {
    if (period === '5J') return history;
    const end = history.at(-1)?.date;
    if (!end) return [];
    const d = new Date(end);
    d.setMonth(d.getMonth() - ({ '1M': 1, '6M': 6, '1J': 12, '3J': 36 }[period] || 60));
    return history.filter((h) => h.date >= d.toISOString().slice(0, 10));
  }, [history, period]);
  const gain = data.length > 1 ? data.at(-1)!.value / data[0].value - 1 : NaN;
  return (
    <section className="card performance-card">
      <div className="card-header">
        <div>
          <h2>
            Historische Entwicklung{' '}
            <span
              className={`chart-gain ${!Number.isFinite(gain) ? 'neutral' : gain >= 0 ? 'positive' : 'negative'}`}
            >
              {pct(gain, true)}
            </span>
          </h2>
          <p className="muted">Heutiger Bestand rückgerechnet · Wechselkurs konstant</p>
        </div>
        <div className="period-tabs" aria-label="Zeitraum">
          {['1M', '6M', '1J', '3J', '5J'].map((p) => (
            <button
              className={period === p ? 'selected' : ''}
              aria-pressed={period === p}
              key={p}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {data.length > 1 ? (
        <div className="performance-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 15, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#e9e9e5" />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                minTickGap={70}
                tick={{ fontSize: 11, fill: '#6f6f66' }}
                axisLine={false}
                tickLine={false}
                dy={10}
              />
              <YAxis
                tickFormatter={(v) => `${Math.round(v / 1000)} Tsd.`}
                width={63}
                tick={{ fontSize: 11, fill: '#6f6f66' }}
                axisLine={false}
                tickLine={false}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(v) => dateLabel(String(v))}
                formatter={(v, name) => [euro(Number(v)), name]}
              />
              {benchmark && (
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  name="S&P 500 · normiert"
                  stroke="#b5b5ae"
                  strokeWidth={1.5}
                  strokeDasharray="5 5"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="value"
                name="Portfolio"
                stroke="#33332e"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="empty-state">
          <h3>Noch keine Kursentwicklung</h3>
          <p>Füge Positionen hinzu, um ihre Entwicklung zu sehen.</p>
        </div>
      )}
      <div className="chart-legend">
        <span>
          <i style={{ background: '#33332e' }} />
          Portfolio
        </span>
        <button
          onClick={() => setBenchmark(!benchmark)}
          aria-pressed={benchmark}
          className={!benchmark ? 'legend-disabled' : ''}
        >
          <i style={{ background: '#b5b5ae' }} />
          S&P 500 <span className="legend-note">Vergleich</span>
        </button>
        <span className="legend-period">
          {data[0] ? dateLabel(data[0].date) : '—'} –{' '}
          {data.at(-1) ? dateLabel(data.at(-1)!.date) : '—'}
        </span>
      </div>
    </section>
  );
}
function AllocationCard({
  positions,
  value,
  onDetails,
}: {
  positions: ReturnType<typeof currentPortfolio>['positions'];
  value: number;
  onDetails: () => void;
}) {
  const grouped = Object.entries(CLASS_LABEL)
    .map(([key, name]) => ({
      name,
      value: positions
        .filter((p) => INSTRUMENT_BY_SYMBOL[p.symbol].assetClass === key)
        .reduce((sum, p) => sum + p.value, 0),
    }))
    .filter((item) => item.value > 0);
  return (
    <section className="card allocation-card">
      <div className="card-header">
        <h2>Aufteilung</h2>
        <button className="text-link" onClick={onDetails}>
          Bearbeiten
        </button>
      </div>
      {Number.isFinite(value) && value > 0 ? (
        <div className="allocation-list">
          {grouped.map((item) => (
            <div className="allocation-row" key={item.name}>
              <div>
                <span>{item.name}</span>
                <strong>{pct(item.value / value)}</strong>
              </div>
              <div className="allocation-meter">
                <span style={{ width: `${(item.value / value) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>Keine bewerteten Positionen.</p>
        </div>
      )}
      <p className="allocation-footnote">Anteil am aktuellen Marktwert.</p>
    </section>
  );
}
function HoldingsTable({
  workspace,
  market,
  onEdit,
  onDetails,
  editable = false,
}: {
  workspace: Workspace;
  market: MarketResponse;
  onEdit: (h: Holding) => void;
  onDetails: (s: string) => void;
  editable?: boolean;
}) {
  const portfolio = currentPortfolio(workspace.holdings, market.series, market.fx.eurUsd);
  return (
    <div className="table-wrap">
      <table className="holdings-table">
        <thead>
          <tr>
            <th>Wertpapier</th>
            <th>
              Kurs <span>USD</span>
            </th>
            {editable && <th>Stück / Einstand</th>}
            <th>
              Marktwert <span>EUR</span>
            </th>
            <th>Gewinn / Verlust</th>
            <th>Gewicht</th>
            <th aria-label="Aktionen" />
          </tr>
        </thead>
        <tbody>
          {portfolio.positions.map((p) => {
            const instrument = INSTRUMENT_BY_SYMBOL[p.symbol];
            return (
              <tr key={p.id}>
                <td>
                  <button className="asset-cell" onClick={() => onDetails(p.symbol)}>
                    <span>
                      <strong>{instrument.shortName}</strong>
                      <small>
                        {p.symbol}
                        <span className="asset-tag">{CLASS_LABEL[instrument.assetClass]}</span>
                      </small>
                    </span>
                  </button>
                </td>
                <td className="numeric">
                  {money(p.price)}
                  <small className="cell-sub">{dateLabel(market.series[p.symbol]?.asOf)}</small>
                </td>
                {editable && (
                  <td className="numeric">
                    {decimal(p.quantity, 6)}
                    <small className="cell-sub">{money(p.averageCost)}</small>
                  </td>
                )}
                <td className="numeric strong">{euro(p.value, 2)}</td>
                <td className="numeric">
                  <span className={p.gain >= 0 ? 'positive' : 'negative'}>{euro(p.gain, 2)}</span>
                  <small className={`cell-sub ${p.gain >= 0 ? 'positive' : 'negative'}`}>
                    {pct(p.gainPercent, true)}
                  </small>
                </td>
                <td>
                  <div className="weight-cell">
                    <span>{pct(p.weight)}</span>
                    <div>
                      <i
                        style={{
                          width: `${Math.min(100, p.weight * 100)}%`,
                          background: '#777770',
                        }}
                      />
                    </div>
                  </div>
                </td>
                <td>
                  <button
                    className="icon-btn"
                    aria-label={`${instrument.shortName} bearbeiten`}
                    onClick={() => onEdit(p)}
                  >
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
          {!workspace.holdings.length && (
            <tr>
              <td colSpan={7}>
                <div className="empty-state">
                  <Wallet />
                  <h3>Keine Positionen</h3>
                  <p>Füge deine erste Position hinzu oder importiere eine Sicherung.</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function MarketTile({
  symbol,
  market,
  onClick,
}: {
  symbol: string;
  market: MarketResponse;
  onClick: () => void;
}) {
  const instrument = INSTRUMENT_BY_SYMBOL[symbol],
    prices = market.series[symbol]?.prices || [],
    last = prices.at(-1)?.close || NaN,
    prev = prices.at(-2)?.close || NaN;
  const change = last / prev - 1;
  return (
    <button className="card market-tile" onClick={onClick}>
      <div className="market-tile-top">
        <IconBadge instrument={instrument} size="small" />
        <strong>{instrument.shortName}</strong>
        <ArrowUpRight size={14} />
      </div>
      <div className="market-tile-bottom">
        <div>
          <strong>{money(last)}</strong>
          <Delta value={change} />
        </div>
        <div className="sparkline">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={prices.slice(-30)}>
              <Line
                dataKey="close"
                stroke="#81817a"
                strokeWidth={1.7}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </button>
  );
}
function PositionModal({
  holding,
  initialSymbol,
  market,
  holdings,
  onClose,
  onSave,
  onDelete,
}: {
  holding?: Holding;
  initialSymbol: string;
  market: MarketResponse;
  holdings: Holding[];
  onClose: () => void;
  onSave: (h: Holding) => void;
  onDelete: (id: string) => void;
}) {
  const [symbol, setSymbol] = useState(holding?.symbol || initialSymbol);
  const [quantity, setQuantity] = useState(String(holding?.quantity || ''));
  const [cost, setCost] = useState(
    String(holding?.averageCost ?? market.series[symbol]?.prices.at(-1)?.close.toFixed(2) ?? ''),
  );
  const [weight, setWeight] = useState(String(holding?.targetWeight || 0));
  const [error, setError] = useState('');
  const [remove, setRemove] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    const q = Number(quantity),
      c = Number(cost),
      w = Number(weight);
    if (
      !quantity ||
      !Number.isFinite(q) ||
      q <= 0 ||
      q > 1e10 ||
      cost === '' ||
      !Number.isFinite(c) ||
      c < 0 ||
      c > 1e9 ||
      weight === '' ||
      !Number.isFinite(w) ||
      w < 0 ||
      w > 100
    ) {
      setError(
        'Bitte eine positive Stückzahl, einen gültigen Einstand und ein Zielgewicht von 0–100 % eingeben.',
      );
      return;
    }
    if (holdings.some((h) => h.symbol === symbol && h.id !== holding?.id)) {
      setError('Dieses Instrument ist bereits enthalten. Bearbeite die vorhandene Position.');
      return;
    }
    onSave({
      id: holding?.id || crypto.randomUUID(),
      symbol,
      quantity: q,
      averageCost: c,
      targetWeight: w,
    });
  }
  return (
    <Modal title={holding ? 'Position bearbeiten' : 'Position hinzufügen'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="position-symbol">Wertpapier</label>
          <select
            id="position-symbol"
            value={symbol}
            disabled={!!holding}
            onChange={(e) => {
              setSymbol(e.target.value);
              setCost(String(market.series[e.target.value]?.prices.at(-1)?.close.toFixed(2) || ''));
            }}
          >
            {INSTRUMENTS.map((i) => (
              <option key={i.symbol} value={i.symbol}>
                {i.symbol} · {i.shortName}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="quantity">Stückzahl</label>
            <input
              id="quantity"
              type="number"
              min="0.00000001"
              max="10000000000"
              step="any"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="z. B. 100"
            />
          </div>
          <div className="field">
            <label htmlFor="average-cost">Durchschn. Einstand (USD)</label>
            <input
              id="average-cost"
              type="number"
              min="0"
              max="1000000000"
              step="any"
              required
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="target-weight">Zielgewicht (%)</label>
          <input
            id="target-weight"
            type="number"
            min="0"
            max="100"
            step="any"
            required
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
          <small>
            Für Rebalancing und Backtesting. Alle Zielgewichte sollten zusammen 100 % ergeben.
          </small>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="note small">
          Kurs: {money(market.series[symbol]?.prices.at(-1)?.close ?? NaN)} · Stand{' '}
          {dateLabel(market.series[symbol]?.asOf)}. Der Einstand ist deine Annahme, kein automatisch
          ermittelter Kaufpreis.
        </div>
        <div className="modal-actions">
          {holding && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (remove) onDelete(holding.id);
                else setRemove(true);
              }}
            >
              <Trash2 size={15} />
              {remove ? 'Entfernen bestätigen' : 'Entfernen'}
            </button>
          )}
          <span className="flex-spacer" />
          <button className="btn" type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" type="submit">
            <Check size={16} />
            Speichern
          </button>
        </div>
      </form>
    </Modal>
  );
}
function RebalanceCard({
  workspace,
  market,
  onChange,
}: {
  workspace: Workspace;
  market: MarketResponse;
  onChange: (w: Workspace) => void;
}) {
  const portfolio = currentPortfolio(workspace.holdings, market.series, market.fx.eurUsd);
  const sum = workspace.holdings.reduce((a, h) => a + h.targetWeight, 0);
  return (
    <section className="card rebalance-card">
      <div className="card-header">
        <div>
          <h2>Zielallokation</h2>
          <p className="muted">Aktuelle und geplante Verteilung des Portfolios.</p>
        </div>
        <button
          className="btn btn-small"
          disabled={!workspace.holdings.length}
          onClick={() =>
            onChange({
              ...workspace,
              holdings: workspace.holdings.map((h) => ({
                ...h,
                targetWeight: 100 / workspace.holdings.length,
              })),
            })
          }
        >
          <SlidersHorizontal size={14} />
          Gleich gewichten
        </button>
      </div>
      {Math.abs(sum - 100) > 0.01 && (
        <div className="note">
          Die Zielgewichte ergeben {decimal(sum)} %. Für die Anpassungsbeträge müssen sie zusammen
          100 % ergeben.
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Wertpapier</th>
              <th>Aktuell</th>
              <th>Ziel</th>
              <th>Abweichung</th>
              <th>Rechnerische Anpassung</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.positions.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{INSTRUMENT_BY_SYMBOL[p.symbol].shortName}</strong>
                </td>
                <td>{pct(p.weight)}</td>
                <td>{decimal(p.targetWeight)} %</td>
                <td className={p.weight - p.targetWeight / 100 > 0 ? 'negative' : 'positive'}>
                  {decimal((p.weight - p.targetWeight / 100) * 100)} Pp.
                </td>
                <td>
                  {Math.abs(sum - 100) < 0.01
                    ? euro((portfolio.value * p.targetWeight) / 100 - p.value, 2)
                    : 'Zielgewichte prüfen'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-footnote">
        Positive Anpassung = Zukauf, negative = Verkauf. Ohne Transaktionskosten und Steuern; keine
        Orderausführung.
      </p>
    </section>
  );
}
function MarketsPage({
  workspace,
  market,
  onWatch,
  onDetails,
  onAdd,
  onRefresh,
  loading,
}: {
  workspace: Workspace;
  market: MarketResponse;
  onWatch: (s: string) => void;
  onDetails: (s: string) => void;
  onAdd: (s: string) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const rows = INSTRUMENTS.filter(
    (i) =>
      (filter === 'all' ||
        (filter === 'watchlist' && workspace.watchlist.includes(i.symbol)) ||
        filter === i.assetClass) &&
      `${i.symbol} ${i.name} ${i.shortName}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Märkte</h1>
          <p className="muted">Kurse, Zeitreihen und Watchlist für 14 Instrumente.</p>
        </div>
        <button className="btn" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          {loading ? 'Wird aktualisiert …' : PAGES_MODE ? 'Daten neu laden' : 'Kurse aktualisieren'}
        </button>
      </div>
      <div className="market-strip">
        {['SPY', 'QQQ', 'GLD', 'BTC-USD'].map((s) => (
          <MarketTile key={s} symbol={s} market={market} onClick={() => onDetails(s)} />
        ))}
      </div>
      <div className="card markets-card">
        <div className="market-filters">
          <div className="filter-tabs">
            {[
              ['all', 'Alle Märkte'],
              ['watchlist', `Watchlist (${workspace.watchlist.length})`],
              ['equity', 'Aktien'],
              ['bond', 'Anleihen'],
              ['crypto', 'Krypto'],
            ].map(([key, label]) => (
              <button
                key={key}
                className={filter === key ? 'selected' : ''}
                onClick={() => setFilter(key)}
              >
                {key === 'watchlist' && <Star size={13} />} {label}
              </button>
            ))}
          </div>
          <div className="input-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Märkte filtern"
              placeholder="Symbol oder Name …"
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-label="Watchlist" />
                <th>Instrument</th>
                <th>Kurs (USD)</th>
                <th>Letzter Kurstag</th>
                <th>30 Handelstage</th>
                <th>Datenstand</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const prices = market.series[i.symbol]?.prices || [],
                  last = prices.at(-1)?.close ?? NaN,
                  prev = prices.at(-2)?.close ?? NaN,
                  change = last / prev - 1;
                return (
                  <tr key={i.symbol}>
                    <td>
                      <button
                        className={`icon-btn star-btn ${workspace.watchlist.includes(i.symbol) ? 'star-active' : ''}`}
                        aria-label={`${i.shortName} ${workspace.watchlist.includes(i.symbol) ? 'aus Watchlist entfernen' : 'zur Watchlist hinzufügen'}`}
                        onClick={() => onWatch(i.symbol)}
                      >
                        <Star
                          size={17}
                          fill={workspace.watchlist.includes(i.symbol) ? 'currentColor' : 'none'}
                        />
                      </button>
                    </td>
                    <td>
                      <button className="asset-cell" onClick={() => onDetails(i.symbol)}>
                        <span>
                          <strong>{i.shortName}</strong>
                          <small>
                            {i.symbol} · {CLASS_LABEL[i.assetClass]}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td className="numeric strong">{money(last)}</td>
                    <td>
                      <Delta value={change} />
                    </td>
                    <td>
                      <div className="table-sparkline">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={prices.slice(-30)}>
                            <Line
                              dataKey="close"
                              stroke="#81817a"
                              dot={false}
                              strokeWidth={1.5}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </td>
                    <td>
                      {dateLabel(market.series[i.symbol]?.asOf)}
                      <small className="cell-sub">
                        {market.series[i.symbol]?.status === 'fresh'
                          ? 'Aktualisiert'
                          : 'Gespeichert'}
                      </small>
                    </td>
                    <td>
                      <button className="btn btn-small" onClick={() => onAdd(i.symbol)}>
                        <Plus size={14} />
                        Portfolio
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <Search />
                      <h3>Keine Treffer</h3>
                      <p>Ändere deinen Suchbegriff oder füge Instrumente zur Watchlist hinzu.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="note">
        <Globe2 size={17} />
        <span>
          US-notierte ETFs dienen als liquide Marktproxies. Ihre Handelbarkeit in deinem Land kann
          eingeschränkt sein. Tageskurse sind keine handelbaren Echtzeitangebote. Alle Instrumente
          werden in USD gehandelt.
        </span>
      </div>
    </>
  );
}
function AssetModal({
  symbol,
  market,
  watched,
  onClose,
  onWatch,
  onAdd,
}: {
  symbol: string;
  market: MarketResponse;
  watched: boolean;
  onClose: () => void;
  onWatch: () => void;
  onAdd: () => void;
}) {
  const i = INSTRUMENT_BY_SYMBOL[symbol],
    s = market.series[symbol],
    last = s?.prices.at(-1)?.close ?? NaN,
    prev = s?.prices.at(-2)?.close ?? NaN;
  return (
    <Modal title={i.name} onClose={onClose} wide>
      <div className="asset-detail-summary">
        <IconBadge instrument={i} />
        <div>
          <span className="muted">
            {symbol} · {CLASS_LABEL[i.assetClass]} · {i.region}
          </span>
          <h2>
            {money(last)} <Delta value={last / prev - 1} />
          </h2>
        </div>
        <span className="badge neutral">
          {s?.status === 'fresh' ? 'Aktualisiert' : 'Gespeicherte Kurse'}
        </span>
      </div>
      <div className="asset-detail-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={s?.prices || []}>
            <CartesianGrid vertical={false} stroke="#edf0f3" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              minTickGap={60}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 11 }}
              width={65}
              tickFormatter={(v) => decimal(v, 0)}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => dateLabel(String(v))}
              formatter={(v) => [money(Number(v)), 'Kurs']}
            />
            <Area
              dataKey="close"
              stroke="#33332e"
              fill="#f1f1ee"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="small muted">
        {s?.source} · Stand {dateLabel(s?.asOf)} · Ausschüttungs- und splitbereinigt, soweit vom
        Anbieter geliefert. 5 Jahre.
      </p>
      <div className="modal-actions">
        <a className="btn" href={s?.sourceUrl} target="_blank" rel="noreferrer">
          Quelle <ExternalLink size={14} />
        </a>
        <span className="flex-spacer" />
        <button className="btn" onClick={onWatch}>
          <Star size={15} fill={watched ? 'currentColor' : 'none'} />
          {watched ? 'Auf der Watchlist' : 'Zur Watchlist'}
        </button>
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus size={16} />
          Zum Portfolio
        </button>
      </div>
    </Modal>
  );
}
function SearchModal({
  market,
  onClose,
  onSelect,
}: {
  market: MarketResponse;
  onClose: () => void;
  onSelect: (s: string) => void;
}) {
  const [query, setQuery] = useState('');
  const results = INSTRUMENTS.filter((i) =>
    `${i.symbol} ${i.name} ${i.shortName}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Modal title="Wertpapier suchen" onClose={onClose}>
      <div className="input-search search-large">
        <Search size={19} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name oder Symbol"
          aria-label="Wertpapier suchen"
        />
      </div>
      <div className="search-results">
        {results.map((i) => (
          <button key={i.symbol} onClick={() => onSelect(i.symbol)}>
            <span>
              <strong>{i.shortName}</strong>
              <small>
                {i.symbol} · {CLASS_LABEL[i.assetClass]}
              </small>
            </span>
            <span className="search-result-price">
              {money(market.series[i.symbol]?.prices.at(-1)?.close ?? NaN)}
              <ChevronRight size={15} />
            </span>
          </button>
        ))}
        {!results.length && (
          <div className="empty-state">
            <Search />
            <p>Kein Instrument im aktuellen Universum gefunden.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
function SettingsModal({
  workspace,
  onClose,
  onChange,
  onExport,
  onImport,
  onExportAll,
  onManage,
}: {
  workspace: Workspace;
  onClose: () => void;
  onChange: (w: Workspace) => boolean;
  onExport: () => void;
  onImport: () => void;
  onExportAll: () => void;
  onManage: () => void;
}) {
  const [name, setName] = useState(workspace.portfolioName);
  const [rate, setRate] = useState(String(workspace.riskFreeRate * 100));
  return (
    <Modal title="Einstellungen" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (onChange({ ...workspace, portfolioName: name, riskFreeRate: Number(rate) / 100 }))
            onClose();
        }}
      >
        <div className="field">
          <label htmlFor="portfolio-name">Portfolioname</label>
          <input
            id="portfolio-name"
            value={name}
            maxLength={80}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="risk-free">Risikofreier Zins (% p. a.)</label>
          <input
            id="risk-free"
            value={rate}
            type="number"
            min="-5"
            max="30"
            step="0.1"
            required
            onChange={(e) => setRate(e.target.value)}
          />
          <small>
            Frei gewählte Annahme für die Sharpe Ratio, kein automatisch bezogener Marktzins.
          </small>
        </div>
        <div className="settings-backup">
          <h3>Datensicherung</h3>
          <p className="muted">
            Das aktive Portfolio oder alle Portfolios mit Positionen, Watchlists und Anlageplänen
            als JSON sichern.
          </p>
          <button className="btn" type="button" onClick={onExport}>
            <Download size={15} />
            Aktives Portfolio exportieren
          </button>
          <button className="btn" type="button" onClick={onExportAll}>
            Alle Portfolios exportieren
          </button>
          <button className="btn" type="button" onClick={onImport}>
            <FileUp size={15} />
            Importieren
          </button>
          <p className="muted">
            <button className="text-link" type="button" onClick={onManage}>
              Portfolios verwalten
            </button>
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Schließen
          </button>
          <button className="btn btn-primary" type="submit">
            Einstellungen speichern
          </button>
        </div>
      </form>
    </Modal>
  );
}
