// Home: the full Library (WEB.md → Home, agreed 2026-10-15). The parts without the page: what Web's
// setup keeps for it, the sorts, Details' columns, the size steps and the title's red word.

import { libraryItems, searchBooks, type LibraryBook, type LibraryItem, type SortBy } from "./library";

export type BookView = "grid" | "cards" | "details";
export const BOOK_VIEWS: { view: BookView; name: string }[] = [
  { view: "grid", name: "Grid" }, { view: "cards", name: "Cards" }, { view: "details", name: "Details" },
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
export const FIXED: ColumnKey = "title";

export interface HomeSort {
  key: ColumnKey;
  /** The other way from the column's first direction. */
  reversed: boolean;
}

/** What Web's setup keeps for Home (in Dropbox, so every browser shows the same). */
export interface HomeSetup {
  view: BookView;
  /** One sort for all three views. */
  sort: HomeSort;
  /** The size step per view: 0 to 4, 2 the middle. */
  sizes: Record<BookView, number>;
  columns: { order: ColumnKey[]; hidden: ColumnKey[] };
}

export const DEFAULT_COLUMNS: HomeSetup["columns"] = { order: KEYS, hidden: ["cover", "added", "size"] };

export const DEFAULT_HOME: HomeSetup = {
  view: "grid",
  sort: { key: "last", reversed: false },
  sizes: { grid: 2, cards: 2, details: 2 },
  columns: DEFAULT_COLUMNS,
};

/** The setup file's `home`, read leniently: anything missing or unknown is the default. */
export function decodeHome(raw: unknown): HomeSetup {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof HomeSetup, unknown>>;
  const view = BOOK_VIEWS.some(v => v.view === r.view) ? (r.view as BookView) : DEFAULT_HOME.view;
  const sortRaw = (r.sort ?? {}) as Partial<HomeSort>;
  const sort: HomeSort = KEYS.includes(sortRaw.key as ColumnKey) && sortRaw.key !== "cover"
    ? { key: sortRaw.key as ColumnKey, reversed: sortRaw.reversed === true }
    : DEFAULT_HOME.sort;
  const sizesRaw = (r.sizes ?? {}) as Record<string, unknown>;
  const sizes = Object.fromEntries(BOOK_VIEWS.map(({ view: v }) => [v, sizeStep(sizesRaw[v])])) as Record<BookView, number>;
  const colsRaw = (r.columns ?? {}) as { order?: unknown; hidden?: unknown };
  const order = Array.isArray(colsRaw.order) ? colsRaw.order.filter((k): k is ColumnKey => KEYS.includes(k as ColumnKey)) : [];
  // Columns added later join at the end, in their first order.
  const columns = {
    order: [...new Set([...order, ...KEYS])],
    hidden: Array.isArray(colsRaw.hidden) ? colsRaw.hidden.filter((k): k is ColumnKey => KEYS.includes(k as ColumnKey) && k !== FIXED) : DEFAULT_COLUMNS.hidden,
  };
  return { view, sort, sizes, columns };
}

// --- Size ---

/** The five sizes as a share of the middle one: covers and cards, Details' rows. */
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
export function moveColumn(columns: HomeSetup["columns"], key: ColumnKey, before: ColumnKey | null): HomeSetup["columns"] {
  if (key === FIXED || key === before) return columns;
  const order = columns.order.filter(k => k !== key);
  const at = before == null ? order.length : order.indexOf(before);
  order.splice(at < 0 ? order.length : at, 0, key);
  return { ...columns, order };
}

export function toggleColumn(columns: HomeSetup["columns"], key: ColumnKey): HomeSetup["columns"] {
  if (key === FIXED) return columns;
  const hidden = columns.hidden.includes(key) ? columns.hidden.filter(k => k !== key) : [...columns.hidden, key];
  return { ...columns, hidden };
}

export function shownColumns(columns: HomeSetup["columns"]): ColumnKey[] {
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
 * Grid and Cards: the books found and sorted, a series of two or more books as one item when
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
