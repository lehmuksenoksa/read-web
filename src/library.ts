// The Library: the books in Dropbox's /Books/, shown with what the phones put in library.json.

import type { FileEntry } from "./dropbox";
import { SYNC_FOLDER } from "./paths";
import type { BookDetails } from "./details";
import { afterReset, furthestOf, type Marks } from "./sync";

/** One entry of `/Apps/Read/Sync/library.json`, as the S23 and the Boox write it. */
export interface IndexEntry {
  title: string;
  author?: string;
  series?: string;
  seriesIndex?: number;
  read?: boolean;
  hidden?: boolean;
  /** A small JPEG, base64. */
  cover?: string;
  updatedAt?: number;
}

export interface LibraryBook {
  id: string;
  path: string;
  title: string;
  author: string | null;
  series: string | null;
  seriesIndex: number | null;
  read: boolean;
  /** Hidden from the Library (Hide on any device); shown under Show › Hidden. */
  hidden: boolean;
  /** When a phone last saw this book's index entry change (0: not listed yet). Marks newer than this show over it. */
  indexedAt: number;
  cover: string | null;
  /** When any device last saved a place in it (its sync file), for Recent. */
  lastRead: string | null;
  hasSyncFile: boolean;
  /** When the file came to Dropbox, and its size (Home's Details). Missing in a Library kept before. */
  added?: string | null;
  size?: number | null;
}

export type SortBy = "recent" | "title" | "author";

/** "Mage Tank 5.epub" → "Mage Tank 5": the title of a book the phones haven't listed yet. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.epub$/i, "").replace(/[_]+/g, " ").trim();
}

/**
 * The Library's books: EPUBs in /Books/, with the index's details, the shared details file's edits
 * over them ([details]), and hidden books marked as such.
 */
export function libraryBooks(files: FileEntry[], index: Record<string, IndexEntry>, syncFiles: FileEntry[], details: Record<string, BookDetails> = {}, added: Record<string, IndexEntry> = {}): LibraryBook[] {
  const synced = new Map(syncFiles.map(f => [f.pathLower, f.modified]));
  const seen = new Set<string>();
  const books: LibraryBook[] = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".epub") || !file.contentHash || seen.has(file.contentHash)) continue;
    seen.add(file.contentHash);
    // A book added from Home shows what its EPUB says until a phone lists it.
    const entry = index[file.contentHash] ?? added[file.contentHash];
    const edited = details[file.contentHash];
    const syncPath = `${SYNC_FOLDER}/${file.contentHash}.json`.toLowerCase();
    books.push({
      id: file.contentHash,
      path: file.path,
      title: edited?.title || entry?.title || titleFromFileName(file.name),
      author: edited ? edited.author ?? null : entry?.author ?? null,
      series: edited ? edited.series ?? null : entry?.series ?? null,
      seriesIndex: edited ? edited.number ?? null : entry?.seriesIndex ?? null,
      read: entry?.read ?? false,
      hidden: entry?.hidden ?? false,
      indexedAt: entry?.updatedAt ?? 0,
      cover: entry?.cover ?? null,
      lastRead: synced.get(syncPath) ?? null,
      hasSyncFile: synced.has(syncPath),
      added: file.modified || null,
      size: file.size,
    });
  }
  return books;
}

/**
 * The books with their sync files' times from a new listing of the sync folder (another device read
 * meanwhile); null when nothing changed.
 */
export function withSyncTimes(books: LibraryBook[], syncFiles: FileEntry[]): LibraryBook[] | null {
  const synced = new Map(syncFiles.map(f => [f.pathLower, f.modified]));
  let changed = false;
  const next = books.map(book => {
    const syncPath = `${SYNC_FOLDER}/${book.id}.json`.toLowerCase();
    const lastRead = synced.get(syncPath) ?? null;
    if (lastRead === book.lastRead && synced.has(syncPath) === book.hasSyncFile) return book;
    changed = true;
    return { ...book, lastRead, hasSyncFile: synced.has(syncPath) };
  });
  return changed ? next : null;
}

/** Sorting ignores a leading "The", "A" or "An", as the app does. */
function sortKey(text: string | null): string {
  return (text ?? "").replace(/^(the|a|an)\s+/i, "").toLocaleLowerCase();
}

function bySeries(a: LibraryBook, b: LibraryBook): number {
  if (a.series && a.series === b.series) return (a.seriesIndex ?? 0) - (b.seriesIndex ?? 0);
  return 0;
}

export function sortBooks(books: LibraryBook[], by: SortBy): LibraryBook[] {
  const title = (a: LibraryBook, b: LibraryBook) => sortKey(a.title).localeCompare(sortKey(b.title));
  const sorted = [...books];
  switch (by) {
    case "recent":
      sorted.sort((a, b) => (b.lastRead ?? "").localeCompare(a.lastRead ?? "") || title(a, b));
      break;
    case "title":
      sorted.sort(title);
      break;
    case "author":
      sorted.sort((a, b) => sortKey(a.author ?? "￿").localeCompare(sortKey(b.author ?? "￿")) || sortKey(a.series).localeCompare(sortKey(b.series)) || bySeries(a, b) || title(a, b));
      break;
  }
  return sorted;
}

export function searchBooks(books: LibraryBook[], query: string): LibraryBook[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return books;
  return books.filter(b => {
    const text = [b.title, b.author, b.series].filter(Boolean).join(" ").toLocaleLowerCase();
    return words.every(w => text.includes(w));
  });
}

/** A book read to here or further counts as read when its status is Automatic (as on the phones). */
export const READ_AT = 0.98;

/**
 * A book with the marks set on the web shown over the phones' index while they're newer than its
 * entry (a phone then lists the book again with them). [progress]: the furthest place, when known.
 */
export function markedBook(book: LibraryBook, marks: Marks | undefined, progress: number | null): LibraryBook {
  if (!marks) return book;
  let { read, hidden } = book;
  if (marks.hidden && marks.hidden.updatedAt > (book.indexedAt ?? 0)) hidden = marks.hidden.hidden;
  if (marks.read && marks.read.updatedAt > (book.indexedAt ?? 0)) {
    const started = marks.reset && marks.reset.at >= marks.read.updatedAt ? 0 : progress ?? 0;
    read = marks.read.read ?? started >= READ_AT;
  }
  return read === book.read && hidden === book.hidden ? book : { ...book, read, hidden };
}

/**
 * How far a book has been read, from its sync file: its furthest read (2026-10-20: kept in the file,
 * so a device going back doesn't lower it; Set as furthest read can). Places from before the book
 * was started over (Mark as unread) don't count.
 */
export function furthest(syncFile: object | null): number {
  return Math.max(0, furthestOf(syncFile)?.totalProgression ?? 0);
}

/** The furthest read as a place for the panels: how far, its chapter, on which device and when. */
export function furthestRead(syncFile: object | null): Place | null {
  const f = furthestOf(syncFile);
  if (!f) return null;
  const title = (f.locator as { title?: unknown } | undefined)?.title;
  return { device: f.deviceName, p: f.totalProgression, chapter: typeof title === "string" && title.trim() ? title.trim() : null, at: f.timestamp };
}

/** One device's place in a book, for Home's panel and Details' On column. */
export interface Place {
  device: string;
  /** 0..1 of the whole book. */
  p: number;
  /** The chapter's title, when the place has one. */
  chapter: string | null;
  /** Epoch milliseconds. */
  at: number;
}

type SyncPlace = { totalProgression?: number; timestamp?: number; deviceName?: string; locator?: { title?: unknown } };

/** Each device's place in a sync file, newest first (places from before a reset left out). */
export function placesOf(syncFile: { positions?: Record<string, SyncPlace>; reset?: unknown } | null): Place[] {
  return Object.entries(afterReset(syncFile)?.positions ?? {})
    .map(([id, p]) => ({
      device: p.deviceName || id,
      p: p.totalProgression ?? 0,
      chapter: typeof p.locator?.title === "string" && p.locator.title.trim() ? p.locator.title.trim() : null,
      at: p.timestamp ?? 0,
    }))
    .sort((a, b) => b.at - a.at);
}

/** A Library row: a book, or a series of two or more books (grouped). */
export type LibraryItem =
  | { kind: "book"; book: LibraryBook }
  | { kind: "series"; name: string; author: string | null; books: LibraryBook[]; read: number; lastRead: string | null };

/**
 * The rows to show: the books found, sorted, with a series of two or more books as one row
 * ([group]) placed where its most recently read book would be (Recent), by its name (Title) or
 * its author (Author). Inside a series the newest book comes first.
 */
export function libraryItems(books: LibraryBook[], by: SortBy, query: string, group: boolean): LibraryItem[] {
  const found = searchBooks(books, query);
  if (!group) return sortBooks(found, by).map(book => ({ kind: "book", book }));
  const bySeries = new Map<string, LibraryBook[]>();
  for (const book of found) {
    if (!book.series) continue;
    const key = book.series.toLocaleLowerCase();
    bySeries.set(key, [...(bySeries.get(key) ?? []), book]);
  }
  const items: LibraryItem[] = [];
  const grouped = new Set<string>();
  for (const book of found) {
    const members = book.series ? bySeries.get(book.series.toLocaleLowerCase())! : [];
    if (members.length < 2) {
      items.push({ kind: "book", book });
      continue;
    }
    const key = book.series!.toLocaleLowerCase();
    if (grouped.has(key)) continue;
    grouped.add(key);
    const ordered = [...members].sort((a, b) => (b.seriesIndex ?? 0) - (a.seriesIndex ?? 0));
    items.push({
      kind: "series",
      name: book.series!,
      author: members.find(m => m.author)?.author ?? null,
      books: ordered,
      read: members.filter(m => m.read).length,
      lastRead: members.map(m => m.lastRead ?? "").sort().pop() || null,
    });
  }
  const title = (i: LibraryItem) => sortKey(i.kind === "book" ? i.book.title : i.name);
  const author = (i: LibraryItem) => sortKey((i.kind === "book" ? i.book.author : i.author) ?? "￿");
  const recent = (i: LibraryItem) => (i.kind === "book" ? i.book.lastRead : i.lastRead) ?? "";
  return items.sort((a, b) => {
    switch (by) {
      case "recent": return recent(b).localeCompare(recent(a)) || title(a).localeCompare(title(b));
      case "title": return title(a).localeCompare(title(b));
      case "author": return author(a).localeCompare(author(b)) || title(a).localeCompare(title(b));
    }
  });
}

/** The book read last on any device (its sync file changed last), to open at the start; null before any reading. */
export function lastReadBook(books: LibraryBook[]): LibraryBook | null {
  // A book marked read has nothing to continue (2026-10-16).
  return books.filter(b => b.lastRead && !b.read).sort((a, b) => b.lastRead!.localeCompare(a.lastRead!))[0] ?? null;
}

/**
 * When a book was last read, for Continue, Recent and Last read: its newest place, which only a device
 * reading moves. Its sync file's time also moves with Mark as read, unread, Hide and Unhide (2026-10-16),
 * so that time stands in only until the file's places are known; a changed file is read again anyway.
 */
export function readAt(book: LibraryBook, known: KnownProgress | undefined): string | null {
  if (!known?.places || known.at !== book.lastRead) return book.lastRead;
  const newest = known.places.reduce((t, p) => Math.max(t, p.at), 0);
  return newest > 0 ? new Date(newest).toISOString() : known.places.length ? book.lastRead : null;
}

/** A book's furthest place as this browser last read it, with its sync file's time then. */
export interface KnownProgress {
  at: string | null;
  p: number;
  /** The furthest read as a place (2026-10-20; missing in older kept ones: then the furthest device). */
  far?: Place | null;
  /** Each device's place, newest first (kept since Home; missing in older kept ones). */
  places?: Place[];
}

/** The kept progress while the book's sync file is unchanged since; null: read it again. */
export function stillKnown(was: KnownProgress | undefined, book: LibraryBook): number | null {
  return was && was.at === book.lastRead ? was.p : null;
}

/** Books to fetch in the background: of the [count] read last on any device, those this browser doesn't have. */
export function booksToFetch(books: LibraryBook[], kept: Set<string>, openNow: string | null, count = 3): LibraryBook[] {
  return books.filter(b => b.lastRead).sort((a, b) => b.lastRead!.localeCompare(a.lastRead!)).slice(0, count)
    .filter(b => !kept.has(b.id) && b.id !== openNow);
}
