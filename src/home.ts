// Home: the full Library (WEB.md → Home, agreed 2026-10-15). The parts without the page: what Web's
// setup keeps for it, the sorts, Details' columns, the size steps and the title's red word.

import { libraryItems, searchBooks, type LibraryBook, type LibraryItem, type SortBy } from "./library";
import { SERIAL_COLUMNS, type SerialColumnKey } from "./serials";

export type BookView = "grid" | "details";
/** The view shown: Office shows Details only, books and serials alike (WEB.md → One app, two styles). */
export function viewFor<V extends string>(view: V, home: boolean): V | "details" {
  return home ? view : "details";
}

export const BOOK_VIEWS: { view: BookView; name: string }[] = [
  { view: "grid", name: "Covers" }, { view: "details", name: "Details" },
];

export type ColumnKey = "cover" | "title" | "author" | "series" | "num" | "progress" | "last" | "on" | "added" | "size";

export interface Column {
  key: ColumnKey;
  /** In ☰'s list. */
  name: string;
  /** Over the column ("" for Cover). */
  heading: string;
  /** As the status line names the sort ("Recent" for Last read). */
  sortName: string;
  /** 1: A to Z, small to large, oldest first; -1 the other way. A first click sorts this way. */
  firstDir: 1 | -1;
  /** Right-aligned (numbers). */
  right?: boolean;
}

/** Details' columns in their first order. Title can't be hidden or moved. */
export const COLUMNS: Column[] = [
  { key: "cover", name: "Cover", heading: "", sortName: "Title", firstDir: 1 },
  { key: "title", name: "Title", heading: "Title", sortName: "Title", firstDir: 1 },
  { key: "author", name: "Author", heading: "Author", sortName: "Author", firstDir: 1 },
  { key: "series", name: "Series", heading: "Series", sortName: "Series", firstDir: 1 },
  { key: "num", name: "#", heading: "#", sortName: "Number", firstDir: 1, right: true },
  { key: "progress", name: "Progress", heading: "Progress", sortName: "Progress", firstDir: -1 },
  { key: "last", name: "Last read", heading: "Last read", sortName: "Recent", firstDir: -1 },
  { key: "on", name: "On", heading: "On", sortName: "Device", firstDir: 1 },
  { key: "added", name: "Added", heading: "Added", sortName: "Added", firstDir: -1 },
  { key: "size", name: "Size", heading: "Size", sortName: "Size", firstDir: -1, right: true },
];
const KEYS = COLUMNS.map(c => c.key);
export const column = (key: ColumnKey) => COLUMNS.find(c => c.key === key)!;
/** Title stays: always shown, never moved. */
export const FIXED = "title";

export interface HomeSort {
  key: ColumnKey;
  /** The other way from the column's first direction. */
  reversed: boolean;
}

export type SerialView = "compact" | "expanded" | "details";
export const SERIAL_VIEWS: { view: SerialView; name: string }[] = [
  { view: "compact", name: "Compact" }, { view: "expanded", name: "Expanded" }, { view: "details", name: "Details" },
];

/** The Serials side of Home: its own view, sort, sizes and Details' columns. */
export interface SerialsSetup {
  view: SerialView;
  sort: { key: SerialColumnKey; reversed: boolean };
  sizes: Record<SerialView, number>;
  columns: { order: SerialColumnKey[]; hidden: SerialColumnKey[] };
}

const SERIAL_KEYS = SERIAL_COLUMNS.map(c => c.key);
export const DEFAULT_SERIAL_COLUMNS: SerialsSetup["columns"] = { order: SERIAL_KEYS, hidden: ["latest", "reading", "lastread"] };
export const DEFAULT_SERIALS: SerialsSetup = {
  view: "compact",
  sort: { key: "updated", reversed: false },
  sizes: { compact: 2, expanded: 2, details: 2 },
  columns: DEFAULT_SERIAL_COLUMNS,
};

/** What Web's setup keeps for Home (in Dropbox, so every browser shows the same). */
export interface HomeSetup {
  /** Library or Serials in front. */
  tab: "books" | "serials";
  serials: SerialsSetup;
  view: BookView;
  /** Details' sort (and Covers' when it shows plain matches). */
  sort: HomeSort;
  /** The curated Covers page's All (2026-10-16): its own sort, Title to start with. */
  gridSort: HomeSort;
  /** The size step per view: 0 to 4, 2 the middle. */
  sizes: Record<BookView, number>;
  columns: { order: ColumnKey[]; hidden: ColumnKey[] };
}

export const DEFAULT_COLUMNS: HomeSetup["columns"] = { order: KEYS, hidden: ["cover", "added", "size"] };

export const DEFAULT_HOME: HomeSetup = {
  tab: "books",
  serials: DEFAULT_SERIALS,
  view: "grid",
  sort: { key: "last", reversed: false },
  gridSort: { key: "title", reversed: false },
  sizes: { grid: 2, details: 2 },
  columns: DEFAULT_COLUMNS,
};

/** The setup file's `home`, read leniently: anything missing or unknown is the default. */
export function decodeHome(raw: unknown): HomeSetup {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof HomeSetup, unknown>>;
  const view = BOOK_VIEWS.some(v => v.view === r.view) ? (r.view as BookView) : DEFAULT_HOME.view;
  const sortOf = (raw: unknown, fallback: HomeSort): HomeSort => {
    const x = (raw ?? {}) as Partial<HomeSort>;
    return KEYS.includes(x.key as ColumnKey) && x.key !== "cover" ? { key: x.key as ColumnKey, reversed: x.reversed === true } : fallback;
  };
  const sort = sortOf(r.sort, DEFAULT_HOME.sort);
  const gridSort = sortOf(r.gridSort, DEFAULT_HOME.gridSort);
  const sizesRaw = (r.sizes ?? {}) as Record<string, unknown>;
  const sizes = Object.fromEntries(BOOK_VIEWS.map(({ view: v }) => [v, sizeStep(sizesRaw[v])])) as Record<BookView, number>;
  const columns = decodeColumns(r.columns, KEYS, DEFAULT_COLUMNS);
  return { tab: r.tab === "serials" ? "serials" : "books", serials: decodeSerials(r.serials), view, sort, gridSort, sizes, columns };
}

function decodeColumns<K extends string>(raw: unknown, keys: K[], fallback: { order: K[]; hidden: K[] }): { order: K[]; hidden: K[] } {
  const colsRaw = (raw ?? {}) as { order?: unknown; hidden?: unknown };
  const order = Array.isArray(colsRaw.order) ? colsRaw.order.filter((k): k is K => keys.includes(k as K)) : [];
  // Columns added later join at the end, in their first order.
  return {
    order: [...new Set([...order, ...keys])],
    hidden: Array.isArray(colsRaw.hidden) ? colsRaw.hidden.filter((k): k is K => keys.includes(k as K) && k !== FIXED) : fallback.hidden,
  };
}

function decodeSerials(raw: unknown): SerialsSetup {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof SerialsSetup, unknown>>;
  const view = SERIAL_VIEWS.some(v => v.view === r.view) ? (r.view as SerialView) : DEFAULT_SERIALS.view;
  const sortRaw = (r.sort ?? {}) as { key?: unknown; reversed?: unknown };
  const sort = SERIAL_KEYS.includes(sortRaw.key as SerialColumnKey)
    ? { key: sortRaw.key as SerialColumnKey, reversed: sortRaw.reversed === true }
    : DEFAULT_SERIALS.sort;
  const sizesRaw = (r.sizes ?? {}) as Record<string, unknown>;
  const sizes = Object.fromEntries(SERIAL_VIEWS.map(({ view: v }) => [v, sizeStep(sizesRaw[v])])) as Record<SerialView, number>;
  return { view, sort, sizes, columns: decodeColumns(r.columns, SERIAL_KEYS, DEFAULT_SERIAL_COLUMNS) };
}

// --- Size ---

/** The five sizes as a share of the middle one: covers, Details' rows. */
export const SIZES = [0.75, 0.875, 1, 1.15, 1.3];

export function sizeStep(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < SIZES.length ? value : 2;
}

/** Text grows with the covers, by less. */
export function textScale(size: number): number {
  return 1 + (size - 1) * 0.7;
}

// --- Columns ---

/** [key] moved to just before [before] (null: to the end). Title doesn't move. */
export function moveColumn<K extends string>(columns: { order: K[]; hidden: K[] }, key: K, before: K | null): { order: K[]; hidden: K[] } {
  if (key === FIXED || key === before) return columns;
  const order = columns.order.filter(k => k !== key);
  const at = before == null ? order.length : order.indexOf(before);
  order.splice(at < 0 ? order.length : at, 0, key);
  return { ...columns, order };
}

export function toggleColumn<K extends string>(columns: { order: K[]; hidden: K[] }, key: K): { order: K[]; hidden: K[] } {
  if (key === FIXED) return columns;
  const hidden = columns.hidden.includes(key) ? columns.hidden.filter(k => k !== key) : [...columns.hidden, key];
  return { ...columns, hidden };
}

/**
 * The columns that fit [available] pixels (2026-10-16): the least important go first, in [dropOrder],
 * until the rest fit by their least widths. The first column (Title) always stays.
 */
export function fitColumns<K extends string>(cols: K[], leastWidth: (key: K) => number, available: number, dropOrder: K[]): K[] {
  const kept = [...cols];
  const width = () => kept.reduce((n, k) => n + leastWidth(k), 0);
  for (const drop of dropOrder) {
    if (width() <= available) break;
    const at = kept.indexOf(drop);
    if (at > 0) kept.splice(at, 1);
  }
  return kept;
}

export function shownColumns<K extends string>(columns: { order: K[]; hidden: K[] }): K[] {
  return columns.order.filter(k => !columns.hidden.includes(k));
}

/** A click on a column's heading: by that column, or the other way when it's sorted by it already. */
export function clickSort(sort: HomeSort, key: ColumnKey): HomeSort {
  const by = key === "cover" ? FIXED : key;
  return sort.key === by ? { key: by, reversed: !sort.reversed } : { key: by, reversed: false };
}

/** The sort menu's Recent, Title and Author as Home's sort; the others aren't the menu's. */
export function menuSort(by: SortBy): HomeSort {
  return { key: by === "recent" ? "last" : by, reversed: false };
}

export function sortMenuChoice(sort: HomeSort): SortBy | null {
  if (sort.reversed) return null;
  return sort.key === "last" ? "recent" : sort.key === "title" || sort.key === "author" ? sort.key : null;
}

// --- Sorting ---

/** What only the books' sync files tell: read when needed and kept. */
export interface Facts {
  progress(id: string): number | null;
  device(id: string): string | null;
}

/** Sorting ignores a leading "The", "A" or "An", as the app does. */
const key = (text: string | null) => (text ?? "").replace(/^(the|a|an)\s+/i, "").toLocaleLowerCase();

/** A book's value in [col]; null sorts last whichever way. */
export function sortValue(book: LibraryBook, col: ColumnKey, facts: Facts): string | number | null {
  switch (col) {
    case "cover":
    case "title": return key(book.title);
    case "author": return book.author ? key(book.author) : null;
    case "series": return book.series ? `${key(book.series)}\u0000${String(book.seriesIndex ?? 0).padStart(8, "0")}` : null;
    case "num": return book.seriesIndex;
    case "progress": return book.read ? 1 : facts.progress(book.id);
    case "last": return book.lastRead;
    case "on": return facts.device(book.id);
    case "added": return book.added ?? null;
    case "size": return book.size ?? null;
  }
}

/** The books in [sort]'s order; ties by title. */
export function sortRows(books: LibraryBook[], sort: HomeSort, facts: Facts): LibraryBook[] {
  const dir = column(sort.key).firstDir * (sort.reversed ? -1 : 1);
  const compare = (x: string | number, y: string | number) =>
    (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
  return [...books].sort((a, b) => {
    const x = sortValue(a, sort.key, facts);
    const y = sortValue(b, sort.key, facts);
    // Nothing to sort by goes last whichever way.
    if (x == null || y == null) return x == null && y == null ? key(a.title).localeCompare(key(b.title)) : x == null ? 1 : -1;
    return compare(x, y) || key(a.title).localeCompare(key(b.title));
  });
}

/** Details: every book on its own line, found and sorted. */
export function detailsRows(books: LibraryBook[], sort: HomeSort, query: string, facts: Facts): LibraryBook[] {
  return sortRows(searchBooks(books, query), sort, facts);
}

/**
 * Covers: the books found and sorted, a series of two or more books as one item when
 * [group]. The menu's sorts place a series as the sidebar does; the others where its first book falls.
 */
export function homeItems(books: LibraryBook[], sort: HomeSort, query: string, group: boolean, facts: Facts): LibraryItem[] {
  const menu = sort.key === "last" ? "recent" : sort.key === "title" || sort.key === "author" ? sort.key : null;
  if (menu) {
    const items = libraryItems(books, menu, query, group);
    return sort.reversed ? items.reverse() : items;
  }
  const sorted = sortRows(searchBooks(books, query), sort, facts);
  if (!group) return sorted.map(book => ({ kind: "book", book }));
  const items = libraryItems(sorted, "recent", "", true);
  // The series where its first book falls in [sorted].
  const at = (item: LibraryItem) => Math.min(...(item.kind === "book" ? [item.book] : item.books).map(b => sorted.indexOf(b)));
  return items.sort((a, b) => at(a) - at(b));
}

/** A series' books in order of their number (the panel's list). */
export function inOrder(books: LibraryBook[]): LibraryBook[] {
  return [...books].sort((a, b) => (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity) || key(a.title).localeCompare(key(b.title)));
}

/** The series' book to go on with: the one in progress (the lowest number), else the first not read; null when all are read. */
export function nextInSeries(books: LibraryBook[], progress: (id: string) => number | null): LibraryBook | null {
  const ordered = inOrder(books).filter(b => !b.read);
  return ordered.find(b => (progress(b.id) ?? 0) > 0) ?? ordered[0] ?? null;
}

// --- Words ---

const ARTICLES = new Set(["a", "an", "the"]);

/** A title in three parts, the middle one its first word that isn't "A", "An" or "The" (the app's titleWord). */
export function titleWord(title: string): [string, string, string] {
  const words = [...title.matchAll(/\S+/g)];
  const word = words.find(w => !ARTICLES.has(w[0].toLocaleLowerCase())) ?? words[0];
  if (!word) return [title, "", ""];
  const start = word.index!;
  return [title.slice(0, start), word[0], title.slice(start + word[0].length)];
}

/** "10 min ago", "3 h ago", "yesterday", "4 days ago", "2 weeks ago", "3 months ago", "1/2025". */
export function ago(iso: string | null, now: number): string {
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at)) return "";
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getFullYear()}`;
}

/** "12.10.2026" (Helsinki's way). */
export function shortDate(iso: string | null): string {
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at)) return "";
  const d = new Date(at);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** "0.8 MB". */
export function megabytes(bytes: number | null | undefined): string {
  return bytes == null ? "" : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// --- The curated Covers page (WEB.md → Home; agreed from mockups 2026-10-16) ---

/** Recently added: books added within this many days that haven't been started. */
export const RECENT_DAYS = 60;

export interface CuratedHome {
  /** The book in progress read most recently: Reading now. */
  now: LibraryBook | null;
  /** The next three in progress: Also reading. */
  also: LibraryBook[];
  /** Not started, added in the last [RECENT_DAYS] days, newest first: Recently added. */
  added: LibraryBook[];
}

/**
 * The sections over All. In progress: past 0% and not marked read, most recently read first.
 * [progress] is null while a book's sync file hasn't been read: such a book is in no section yet.
 */
export function curatedHome(books: LibraryBook[], progress: (book: LibraryBook) => number | null, now: number): CuratedHome {
  const shown = books.filter(b => !b.hidden);
  const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);
  const reading = shown.filter(b => !b.read && (progress(b) ?? 0) > 0).sort((a, b) => time(b.lastRead) - time(a.lastRead));
  const since = now - RECENT_DAYS * 86_400_000;
  const added = shown.filter(b => !b.read && progress(b) === 0 && time(b.added) >= since).sort((a, b) => time(b.added) - time(a.added));
  return { now: reading[0] ?? null, also: reading.slice(1, 4), added };
}

/** The series under a featured title, unless the title already says it ("Mage Tank 5" in Mage Tank). */
export function seriesLine(book: LibraryBook): string {
  if (!book.series || book.title.toLowerCase().includes(book.series.toLowerCase())) return "";
  return `${book.series}${book.seriesIndex != null ? ` · ${book.seriesIndex}` : ""}`;
}

/** What sits beside Reading now: the other books in progress, or, with none, the recently added (2026-10-16). */
export function besideReadingNow(c: CuratedHome): { title: string; books: LibraryBook[]; kind: "also" | "added" } | null {
  if (!c.now) return null;
  if (c.also.length) return { title: "Also reading", books: c.also, kind: "also" };
  if (c.added.length) return { title: "Recently added", books: c.added, kind: "added" };
  return null;
}
