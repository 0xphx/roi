import { describe, expect, it, vi } from 'vitest';
import {
  activePortfolio,
  createPortfolio,
  deletePortfolio,
  isPortfolioLibrary,
  LIBRARY_STORAGE_KEY,
  loadPortfolioLibrary,
  MAX_PORTFOLIOS,
  parsePortfolioLibrary,
  renamePortfolio,
  savePortfolioLibrary,
  savePortfolioLibraryIfUnchanged,
  selectPortfolio,
} from '../src/lib/portfolio-library';
import type { PortfolioLibrary } from '../src/lib/portfolio-library';
import { DEFAULT_WORKSPACE, STORAGE_KEY } from '../src/lib/workspace';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
const fresh = () => loadPortfolioLibrary(memoryStorage()).library;
function twoPortfolios(): PortfolioLibrary {
  return createPortfolio(fresh(), 'Langfristiges Depot');
}

describe('portfolio library loading and migration', () => {
  it('opens an independent default portfolio without writing on first load or StrictMode repetition', () => {
    const storage = memoryStorage();
    const first = loadPortfolioLibrary(storage);
    const second = loadPortfolioLibrary(storage);
    expect(first.error).toBeUndefined();
    expect(first.storedValue).toBeNull();
    expect(first.library).toEqual(second.library);
    expect(first.library.activeId).toBe('portfolio-main');
    expect(activePortfolio(first.library).workspace).toEqual(DEFAULT_WORKSPACE);
    activePortfolio(first.library).workspace.holdings[0].quantity = 1;
    expect(activePortfolio(second.library).workspace.holdings[0].quantity).toBe(180);
    expect(DEFAULT_WORKSPACE.holdings[0].quantity).toBe(180);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('migrates existing Workspace v1 exactly in memory and preserves the original serialized backup', () => {
    const workspace = structuredClone(DEFAULT_WORKSPACE);
    workspace.portfolioName = 'Bisheriges Depot';
    workspace.holdings[0].quantity = 123.456;
    workspace.watchlist = ['QQQ'];
    workspace.plan.monthlyContribution = 777.25;
    const raw = JSON.stringify(workspace, null, 4);
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const { library, error } = loadPortfolioLibrary(storage);
    expect(error).toBeUndefined();
    expect(library.portfolios).toEqual([{ id: 'portfolio-main', workspace }]);
    expect(storage.values.get(STORAGE_KEY)).toBe(raw);
    expect(storage.values.has(LIBRARY_STORAGE_KEY)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('prefers a valid library and never reads or modifies older data', () => {
    const library = twoPortfolios();
    const storage = memoryStorage({
      [LIBRARY_STORAGE_KEY]: JSON.stringify(library),
      [STORAGE_KEY]: 'not-json',
    });
    expect(loadPortfolioLibrary(storage)).toEqual({
      library,
      storedValue: JSON.stringify(library),
    });
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.values.get(STORAGE_KEY)).toBe('not-json');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each(['', '{broken', 'null', JSON.stringify({ ...fresh(), version: 2 })])(
    'preserves corrupt new data and recovers the legacy portfolio: %s',
    (broken) => {
      const storage = memoryStorage({
        [LIBRARY_STORAGE_KEY]: broken,
        [STORAGE_KEY]: JSON.stringify(DEFAULT_WORKSPACE),
      });
      const result = loadPortfolioLibrary(storage);
      expect(result.error).toContain('Portfolio-Sammlung konnte nicht gelesen');
      expect(activePortfolio(result.library).workspace).toEqual(DEFAULT_WORKSPACE);
      expect(result.storedValue).toBe(broken);
      expect(storage.values.get(LIBRARY_STORAGE_KEY)).toBe(broken);
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );
  it('does not overwrite either corrupt format when no valid recovery exists', () => {
    const storage = memoryStorage({ [LIBRARY_STORAGE_KEY]: '{bad-new', [STORAGE_KEY]: '{bad-old' });
    const result = loadPortfolioLibrary(storage);
    expect(result.error).toContain('Originaldaten bleiben unverändert');
    expect(result.library).toEqual(fresh());
    expect([...storage.values]).toEqual([
      [LIBRARY_STORAGE_KEY, '{bad-new'],
      [STORAGE_KEY, '{bad-old'],
    ]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('warns when only the legacy workspace is corrupt or browser access fails', () => {
    const legacy = loadPortfolioLibrary(memoryStorage({ [STORAGE_KEY]: 'invalid' }));
    expect(legacy.error).toContain('bisherige Workspace konnte nicht gelesen');
    const storage = memoryStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadPortfolioLibrary(storage).error).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('portfolio library validation and persistence', () => {
  it('round-trips library exports and preserves only validated independent objects', () => {
    const original = twoPortfolios();
    const raw = JSON.stringify(original);
    const parsed = parsePortfolioLibrary(JSON.parse(raw));
    expect(parsed).toEqual(original);
    expect(isPortfolioLibrary(JSON.parse(raw))).toBe(true);
    parsed.portfolios[0].workspace.plan.monthlyContribution = 1;
    expect(original.portfolios[0].workspace.plan.monthlyContribution).toBe(500);
  });
  it('requires the explicit format, supported version and an existing active ID', () => {
    expect(() => parsePortfolioLibrary(DEFAULT_WORKSPACE)).toThrow('keine gültige');
    expect(() => parsePortfolioLibrary({ ...fresh(), kind: 'workspace' })).toThrow();
    expect(() => parsePortfolioLibrary({ ...fresh(), version: 2 })).toThrow('Version');
    expect(() => parsePortfolioLibrary({ ...fresh(), activeId: 'missing' })).toThrow(
      'aktive Portfolio',
    );
    expect(isPortfolioLibrary({ ...fresh(), version: 2 })).toBe(false);
  });
  it('enforces portfolio bounds and safe unique IDs', () => {
    const library = fresh();
    expect(() => parsePortfolioLibrary({ ...library, portfolios: [] })).toThrow('1–12');
    const repeated = Array.from({ length: 13 }, (_, i) => ({
      id: `portfolio-${i}`,
      workspace: { ...DEFAULT_WORKSPACE, portfolioName: `Depot ${i}` },
    }));
    expect(() => parsePortfolioLibrary({ ...library, portfolios: repeated })).toThrow('1–12');
    for (const id of ['', 'with spaces', 'x'.repeat(81), '../other']) {
      expect(() =>
        parsePortfolioLibrary({
          ...library,
          activeId: id,
          portfolios: [{ ...library.portfolios[0], id }],
        }),
      ).toThrow();
    }
    const both = twoPortfolios();
    both.portfolios[1].id = both.portfolios[0].id;
    expect(() => parsePortfolioLibrary(both)).toThrow('eindeutig');
  });
  it('rejects sparse arrays rather than silently retaining missing portfolios', () => {
    const library = fresh();
    const sparse = new Array(2);
    sparse[0] = library.portfolios[0];
    expect(() => parsePortfolioLibrary({ ...library, portfolios: sparse })).toThrow(
      'Portfolio-IDs',
    );
  });
  it('rejects case-insensitive duplicate names and invalid nested workspaces', () => {
    const library = twoPortfolios();
    library.portfolios[1].workspace.portfolioName = ' MEIN BEISPIELPORTFOLIO ';
    expect(() => parsePortfolioLibrary(library)).toThrow('Portfolionamen müssen eindeutig');
    const invalid = twoPortfolios();
    invalid.portfolios[1].workspace.plan.years = 999;
    expect(() => parsePortfolioLibrary(invalid)).toThrow('Planungsannahmen');
  });
  it('writes the library once atomically and leaves the legacy backup untouched', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: 'legacy-backup' });
    const library = twoPortfolios();
    const result = savePortfolioLibrary(library, storage);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledWith(LIBRARY_STORAGE_KEY, JSON.stringify(library));
    expect(storage.values.get(STORAGE_KEY)).toBe('legacy-backup');
    expect(result).toEqual(library);
    result.portfolios[0].workspace.watchlist = [];
    expect(library.portfolios[0].workspace.watchlist).toEqual(DEFAULT_WORKSPACE.watchlist);
  });
  it('rejects invalid saves before writing and preserves previous state on quota failure', () => {
    const previous = fresh();
    const raw = JSON.stringify(previous);
    const storage = memoryStorage({ [LIBRARY_STORAGE_KEY]: raw });
    expect(() => savePortfolioLibrary({ ...previous, activeId: 'invalid' }, storage)).toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
    const next = twoPortfolios();
    const unchanged = structuredClone(next);
    storage.setItem.mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    expect(() => savePortfolioLibrary(next, storage)).toThrow('konnte nicht gespeichert');
    expect(storage.values.get(LIBRARY_STORAGE_KEY)).toBe(raw);
    expect(next).toEqual(unchanged);
  });
});

describe('immutable local portfolio operations', () => {
  it('creates a blank active portfolio with default assumptions, no fabricated positions or watchlist', () => {
    const original = fresh();
    const before = structuredClone(original);
    const created = createPortfolio(original, '  Neues Depot  ');
    expect(created.portfolios).toHaveLength(2);
    expect(created.activeId).not.toBe(original.activeId);
    expect(activePortfolio(created).workspace).toEqual({
      ...DEFAULT_WORKSPACE,
      portfolioName: 'Neues Depot',
      holdings: [],
      watchlist: [],
    });
    expect(original).toEqual(before);
  });
  it('duplicates the requested portfolio deeply while assigning a new ID and unique name', () => {
    const original = fresh();
    const source = activePortfolio(original);
    const duplicate = createPortfolio(original, source.workspace.portfolioName, source.id);
    expect(activePortfolio(duplicate).workspace).toEqual({
      ...source.workspace,
      portfolioName: 'Mein Beispielportfolio (2)',
    });
    expect(activePortfolio(duplicate).id).not.toBe(source.id);
    activePortfolio(duplicate).workspace.holdings[0].quantity = 5;
    expect(source.workspace.holdings[0].quantity).toBe(180);
    expect(duplicate.portfolios[0].workspace.holdings[0].quantity).toBe(180);
  });
  it('chooses collision-free names within the 80-character limit', () => {
    let library = renamePortfolio(fresh(), 'portfolio-main', 'A'.repeat(80));
    library = createPortfolio(library, 'A'.repeat(80));
    library = createPortfolio(library, 'A'.repeat(80));
    expect(library.portfolios.map((p) => p.workspace.portfolioName)).toEqual([
      'A'.repeat(80),
      'A'.repeat(76) + ' (2)',
      'A'.repeat(76) + ' (3)',
    ]);
    expect(() => renamePortfolio(library, library.activeId, 'a'.repeat(80))).toThrow('eindeutig');
  });
  it('renames and selects without modifying the previous library', () => {
    const original = twoPortfolios();
    const previous = structuredClone(original);
    const renamed = renamePortfolio(original, original.activeId, 'Umbenannt');
    expect(activePortfolio(renamed).workspace.portfolioName).toBe('Umbenannt');
    const selected = selectPortfolio(renamed, 'portfolio-main');
    expect(selected.activeId).toBe('portfolio-main');
    expect(renamed.activeId).toBe(original.activeId);
    expect(original).toEqual(previous);
    expect(activePortfolio(selected)).toBe(selected.portfolios[0]);
  });
  it('deleting an active portfolio chooses the first remaining one; inactive deletion preserves selection', () => {
    const original = twoPortfolios();
    const before = structuredClone(original);
    expect(deletePortfolio(original, original.activeId).activeId).toBe('portfolio-main');
    expect(deletePortfolio(original, 'portfolio-main').activeId).toBe(original.activeId);
    expect(original).toEqual(before);
  });
  it('rejects deleting the final portfolio, unknown IDs and creation beyond the limit', () => {
    expect(() => deletePortfolio(fresh(), 'portfolio-main')).toThrow('letzte Portfolio');
    for (const operation of [
      () => renamePortfolio(fresh(), 'missing', 'Name'),
      () => selectPortfolio(fresh(), 'missing'),
      () => deletePortfolio(fresh(), 'missing'),
      () => createPortfolio(fresh(), 'Kopie', 'missing'),
    ])
      expect(operation).toThrow('nicht gefunden');
    let full = fresh();
    for (let i = 1; i < MAX_PORTFOLIOS; i++) full = createPortfolio(full, `Depot ${i}`);
    expect(() => createPortfolio(full, 'Zu viel')).toThrow('Maximal 12');
    expect(full.portfolios).toHaveLength(12);
  });
});

describe('guarded portfolio persistence', () => {
  it('captures the exact raw library string with its initial read, without a second read race', () => {
    const library = twoPortfolios();
    const raw = JSON.stringify(library, null, 4) + '\n';
    const newer = JSON.stringify(createPortfolio(library, 'Später erstellt'));
    const storage = memoryStorage();
    storage.getItem.mockReturnValueOnce(raw).mockReturnValue(newer);
    const loaded = loadPortfolioLibrary(storage);
    expect(loaded.library).toEqual(library);
    expect(loaded.storedValue).toBe(raw);
    expect(storage.getItem).toHaveBeenCalledOnce();
  });
  it('allows a first save with a null baseline and returns the exact next baseline', () => {
    const storage = memoryStorage();
    const first = loadPortfolioLibrary(storage);
    const next = createPortfolio(first.library, 'Neues Depot');
    const saved = savePortfolioLibraryIfUnchanged(next, first.storedValue, storage);
    expect(saved.library).toEqual(next);
    expect(saved.storedValue).toBe(JSON.stringify(next));
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.values.get(LIBRARY_STORAGE_KEY)).toBe(saved.storedValue);
    const renamed = renamePortfolio(saved.library, saved.library.activeId, 'Umbenannt');
    const resaved = savePortfolioLibraryIfUnchanged(renamed, saved.storedValue, storage);
    expect(resaved.library.portfolios).toHaveLength(2);
    expect(storage.values.get(LIBRARY_STORAGE_KEY)).toBe(resaved.storedValue);
  });
  it('refuses a stale baseline without overwriting portfolios created in another tab', () => {
    const first = fresh();
    const baseline = JSON.stringify(first);
    const newer = createPortfolio(first, 'Anderes Fenster');
    const newerRaw = JSON.stringify(newer);
    const storage = memoryStorage({ [LIBRARY_STORAGE_KEY]: newerRaw });
    const stale = renamePortfolio(first, first.activeId, 'Alter Tab');
    expect(() => savePortfolioLibraryIfUnchanged(stale, baseline, storage)).toThrow(
      'anderen Fenster',
    );
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.values.get(LIBRARY_STORAGE_KEY)).toBe(newerRaw);
    expect(parsePortfolioLibrary(JSON.parse(newerRaw)).portfolios).toHaveLength(2);
  });
  it('detects creation or removal of the persisted entry against a stale null/string baseline', () => {
    const library = fresh();
    const raw = JSON.stringify(library);
    const createdElsewhere = memoryStorage({ [LIBRARY_STORAGE_KEY]: raw });
    expect(() => savePortfolioLibraryIfUnchanged(library, null, createdElsewhere)).toThrow(
      'anderen Fenster',
    );
    expect(createdElsewhere.setItem).not.toHaveBeenCalled();
    const removedElsewhere = memoryStorage();
    expect(() => savePortfolioLibraryIfUnchanged(library, raw, removedElsewhere)).toThrow(
      'anderen Fenster',
    );
    expect(removedElsewhere.setItem).not.toHaveBeenCalled();
  });
  it('preserves a corrupt observed baseline and permits replacement only while it remains unchanged', () => {
    const raw = '{unreadable library';
    const legacy = JSON.stringify(DEFAULT_WORKSPACE);
    const storage = memoryStorage({ [LIBRARY_STORAGE_KEY]: raw, [STORAGE_KEY]: legacy });
    const loaded = loadPortfolioLibrary(storage);
    expect(loaded.storedValue).toBe(raw);
    expect(loaded.error).toBeTruthy();
    const saved = savePortfolioLibraryIfUnchanged(loaded.library, loaded.storedValue, storage);
    expect(saved.storedValue).toBe(JSON.stringify(loaded.library));
    expect(storage.values.get(STORAGE_KEY)).toBe(legacy);
  });
  it('does not write when validation, storage reading or saving fails', () => {
    const library = fresh();
    const storage = memoryStorage();
    expect(() =>
      savePortfolioLibraryIfUnchanged({ ...library, activeId: 'missing' }, null, storage),
    ).toThrow();
    expect(storage.getItem).not.toHaveBeenCalled();
    storage.getItem.mockImplementation(() => {
      throw new Error('Access denied');
    });
    expect(() => savePortfolioLibraryIfUnchanged(library, null, storage)).toThrow('nicht geprüft');
    expect(storage.setItem).not.toHaveBeenCalled();
    storage.getItem.mockReturnValue(null);
    storage.setItem.mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    const unchanged = structuredClone(library);
    expect(() => savePortfolioLibraryIfUnchanged(library, null, storage)).toThrow(
      'nicht gespeichert',
    );
    expect(library).toEqual(unchanged);
    expect(storage.values.has(LIBRARY_STORAGE_KEY)).toBe(false);
  });
});
