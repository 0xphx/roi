import { DEFAULT_WORKSPACE, parseWorkspace, STORAGE_KEY } from './workspace';
import type { Workspace } from './types';

export interface LibraryPortfolio {
  id: string;
  workspace: Workspace;
}

export interface PortfolioLibrary {
  kind: 'roi-portfolio-library';
  version: 1;
  activeId: string;
  portfolios: LibraryPortfolio[];
}

export const LIBRARY_STORAGE_KEY = 'roi.portfolio-library.v1';
export const MAX_PORTFOLIOS = 12;
type LibraryStorage = Pick<Storage, 'getItem' | 'setItem'>;
const KIND = 'roi-portfolio-library' as const;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_ID.test(value);
const foldedName = (name: string) => name.trim().toLocaleLowerCase('de-DE');

/** Validates imports and returns independent objects; Workspace version 1 is unchanged. */
export function parsePortfolioLibrary(input: unknown): PortfolioLibrary {
  if (!isObject(input) || input.kind !== KIND)
    throw new Error('Die Datei enthält keine gültige Portfolio-Sammlung.');
  if (input.version !== 1)
    throw new Error('Diese Version der Portfolio-Sammlung wird nicht unterstützt.');
  if (
    !Array.isArray(input.portfolios) ||
    input.portfolios.length < 1 ||
    input.portfolios.length > MAX_PORTFOLIOS
  )
    throw new Error(`Eine Sammlung muss 1–${MAX_PORTFOLIOS} Portfolios enthalten.`);
  if (!validId(input.activeId)) throw new Error('Die aktive Portfolio-ID ist ungültig.');

  const ids = new Set<string>();
  const names = new Set<string>();
  const portfolios = Array.from(input.portfolios, (entry): LibraryPortfolio => {
    if (!isObject(entry) || !validId(entry.id) || ids.has(entry.id))
      throw new Error('Portfolio-IDs müssen gültig und eindeutig sein.');
    if (!isObject(entry.workspace))
      throw new Error('Ein Portfolio enthält keinen gültigen Workspace.');
    const workspace = parseWorkspace(entry.workspace);
    const name = foldedName(workspace.portfolioName);
    if (names.has(name))
      throw new Error(
        'Portfolionamen müssen eindeutig sein; Groß- und Kleinschreibung werden nicht unterschieden.',
      );
    ids.add(entry.id);
    names.add(name);
    return { id: entry.id, workspace };
  });
  if (!ids.has(input.activeId))
    throw new Error('Das aktive Portfolio ist nicht in der Sammlung enthalten.');
  return { kind: KIND, version: 1, activeId: input.activeId, portfolios };
}

/** A complete type guard for reusable library exports, not only a discriminator check. */
export function isPortfolioLibrary(input: unknown): input is PortfolioLibrary {
  try {
    parsePortfolioLibrary(input);
    return true;
  } catch {
    return false;
  }
}

function singlePortfolio(workspace: Workspace): PortfolioLibrary {
  return {
    kind: KIND,
    version: 1,
    activeId: 'portfolio-main',
    portfolios: [{ id: 'portfolio-main', workspace: parseWorkspace(workspace) }],
  };
}

function browserStorage(storage?: LibraryStorage): LibraryStorage {
  const available = storage ?? globalThis.localStorage;
  if (
    !available ||
    typeof available.getItem !== 'function' ||
    typeof available.setItem !== 'function'
  )
    throw new Error('Der Browser-Speicher ist nicht verfügbar.');
  return available;
}

/**
 * Loading never writes. Legacy JSON remains untouched, including malformed data,
 * so StrictMode initialization and failed migrations cannot destroy a backup.
 */
export function loadPortfolioLibrary(storage?: LibraryStorage): {
  library: PortfolioLibrary;
  storedValue: string | null;
  error?: string;
} {
  let storedValue: string | null = null;
  let selectedStorage: LibraryStorage;
  try {
    selectedStorage = browserStorage(storage);
  } catch {
    return {
      library: singlePortfolio(DEFAULT_WORKSPACE),
      storedValue,
      error:
        'Der Browser-Speicher ist nicht verfügbar. Das Beispielportfolio wurde geöffnet; exportiere eine Sicherung, bevor du den Browser schließt.',
    };
  }

  let libraryUnreadable = false;
  try {
    const raw = selectedStorage.getItem(LIBRARY_STORAGE_KEY);
    storedValue = raw;
    if (raw !== null) {
      try {
        return { library: parsePortfolioLibrary(JSON.parse(raw)), storedValue };
      } catch {
        libraryUnreadable = true;
      }
    }
  } catch {
    libraryUnreadable = true;
  }

  try {
    const legacy = selectedStorage.getItem(STORAGE_KEY);
    if (legacy !== null) {
      const library = singlePortfolio(parseWorkspace(JSON.parse(legacy)));
      return {
        library,
        storedValue,
        ...(libraryUnreadable
          ? {
              error:
                'Die gespeicherte Portfolio-Sammlung konnte nicht gelesen werden und bleibt unverändert. Der bisherige Workspace wurde zur Wiederherstellung geöffnet. Exportiere eine Sicherung, bevor du erneut speicherst.',
            }
          : {}),
      };
    }
  } catch {
    return {
      library: singlePortfolio(DEFAULT_WORKSPACE),
      storedValue,
      error: libraryUnreadable
        ? 'Die Portfolio-Sammlung und der bisherige Workspace konnten nicht gelesen werden. Die Originaldaten bleiben unverändert; geöffnet ist das Beispielportfolio. Exportiere eine Sicherung, bevor du erneut speicherst.'
        : 'Der bisherige Workspace konnte nicht gelesen werden und bleibt unverändert. Geöffnet ist das Beispielportfolio. Exportiere eine Sicherung, bevor du erneut speicherst.',
    };
  }

  return {
    library: singlePortfolio(DEFAULT_WORKSPACE),
    storedValue,
    ...(libraryUnreadable
      ? {
          error:
            'Die gespeicherte Portfolio-Sammlung konnte nicht gelesen werden und bleibt unverändert. Geöffnet ist das Beispielportfolio. Exportiere eine Sicherung, bevor du erneut speicherst.',
        }
      : {}),
  };
}

/** One validated JSON value, one atomic Storage write; legacy data is never changed. */
export function savePortfolioLibrary(
  library: PortfolioLibrary,
  storage?: LibraryStorage,
): PortfolioLibrary {
  const validated = parsePortfolioLibrary(library);
  const json = JSON.stringify(validated);
  try {
    browserStorage(storage).setItem(LIBRARY_STORAGE_KEY, json);
  } catch (cause) {
    throw new Error(
      'Die Portfolio-Sammlung konnte nicht gespeichert werden. Die bisherigen Daten bleiben unverändert. Bitte exportiere eine Sicherung.',
      { cause },
    );
  }
  return validated;
}

/**
 * Refuse a write from a stale tab before replacing the single Storage value.
 * This optimistic check is not a transaction across browser processes: another
 * tab could still write between getItem and setItem. The exact observed string
 * is the baseline, including whitespace and invalid data retained during load.
 */
export function savePortfolioLibraryIfUnchanged(
  next: PortfolioLibrary,
  expectedStoredValue: string | null,
  storage?: LibraryStorage,
): { library: PortfolioLibrary; storedValue: string } {
  const library = parsePortfolioLibrary(next);
  const storedValue = JSON.stringify(library);
  let selectedStorage: LibraryStorage;
  let actual: string | null;
  try {
    selectedStorage = browserStorage(storage);
    actual = selectedStorage.getItem(LIBRARY_STORAGE_KEY);
  } catch (cause) {
    throw new Error(
      'Die gespeicherten Portfolios konnten nicht geprüft werden. Die Änderung wurde nicht gespeichert.',
      { cause },
    );
  }
  if (actual !== expectedStoredValue)
    throw new Error(
      'Die Portfolios wurden in einem anderen Fenster geändert. Lade den aktuellen Datenstand neu, bevor du diese Änderung speicherst.',
    );
  try {
    selectedStorage.setItem(LIBRARY_STORAGE_KEY, storedValue);
  } catch (cause) {
    throw new Error(
      'Die Portfolio-Sammlung konnte nicht gespeichert werden. Die bisherigen Daten bleiben unverändert. Bitte exportiere eine Sicherung.',
      { cause },
    );
  }
  return { library, storedValue };
}

/** Keep identity stable for React consumers; callers update through immutable helpers. */
export function activePortfolio(library: PortfolioLibrary): LibraryPortfolio {
  const selected = library.portfolios.find((portfolio) => portfolio.id === library.activeId);
  if (!selected) throw new Error('Das aktive Portfolio wurde nicht gefunden.');
  return selected;
}

function portfolioIndex(library: PortfolioLibrary, id: string): number {
  const index = library.portfolios.findIndex((portfolio) => portfolio.id === id);
  if (index < 0) throw new Error('Das Portfolio wurde nicht gefunden.');
  return index;
}

function cleanName(name: string): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
    throw new Error('Der Portfolioname muss 1–80 Zeichen lang sein.');
  return name.trim();
}

function uniqueName(library: PortfolioLibrary, proposedName: string): string {
  const base = cleanName(proposedName);
  const names = new Set(
    library.portfolios.map((entry) => foldedName(entry.workspace.portfolioName)),
  );
  if (!names.has(foldedName(base))) return base;
  for (let suffix = 2; suffix <= MAX_PORTFOLIOS + 1; suffix++) {
    const ending = ` (${suffix})`;
    const candidate = `${base.slice(0, 80 - ending.length).trimEnd()}${ending}`;
    if (!names.has(foldedName(candidate))) return candidate;
  }
  throw new Error('Es konnte kein eindeutiger Portfolioname erstellt werden.');
}

function newId(library: PortfolioLibrary): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = globalThis.crypto?.randomUUID?.();
    if (validId(id) && !library.portfolios.some((portfolio) => portfolio.id === id)) return id;
  }
  throw new Error('Es konnte keine eindeutige Portfolio-ID erstellt werden.');
}

/** Empty portfolios inherit planning assumptions only; duplication copies the selected workspace. */
export function createPortfolio(
  library: PortfolioLibrary,
  name: string,
  duplicateId?: string,
): PortfolioLibrary {
  const next = parsePortfolioLibrary(library);
  if (next.portfolios.length >= MAX_PORTFOLIOS)
    throw new Error(`Maximal ${MAX_PORTFOLIOS} Portfolios sind erlaubt.`);
  const portfolioName = uniqueName(next, name);
  const source =
    duplicateId === undefined
      ? { ...DEFAULT_WORKSPACE, holdings: [], watchlist: [] }
      : next.portfolios[portfolioIndex(next, duplicateId)].workspace;
  const workspace = parseWorkspace({ ...source, portfolioName });
  const id = newId(next);
  next.portfolios.push({ id, workspace });
  next.activeId = id;
  return parsePortfolioLibrary(next);
}

export function renamePortfolio(
  library: PortfolioLibrary,
  id: string,
  name: string,
): PortfolioLibrary {
  const next = parsePortfolioLibrary(library);
  const index = portfolioIndex(next, id);
  next.portfolios[index].workspace.portfolioName = cleanName(name);
  return parsePortfolioLibrary(next);
}

export function selectPortfolio(library: PortfolioLibrary, id: string): PortfolioLibrary {
  const next = parsePortfolioLibrary(library);
  portfolioIndex(next, id);
  next.activeId = id;
  return next;
}

export function deletePortfolio(library: PortfolioLibrary, id: string): PortfolioLibrary {
  const next = parsePortfolioLibrary(library);
  const index = portfolioIndex(next, id);
  if (next.portfolios.length === 1)
    throw new Error('Das letzte Portfolio kann nicht gelöscht werden.');
  next.portfolios.splice(index, 1);
  if (next.activeId === id) next.activeId = next.portfolios[0].id;
  return next;
}
