// The Library: the books in Dropbox's /Books/, shown with what the phones put in library.json.

import type { FileEntry } from "./dropbox";
import { SYNC_FOLDER } from "./paths";

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
  cover: string | null;
  /** When any device last saved a place in it (its sync file), for Recent. */
  lastRead: string | null;
  hasSyncFile: boolean;
}

export type SortBy = "recent" | "title" | "author";

/** "Mage Tank 5.epub" → "Mage Tank 5": the title of a book the phones haven't listed yet. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.epub$/i, "").replace(/[_]+/g, " ").trim();
}

/** The Library's books: EPUBs in /Books/, with the index's details; hidden books aren't shown. */
export function libraryBooks(files: FileEntry[], index: Record<string, IndexEntry>, syncFiles: FileEntry[]): LibraryBook[] {
  const synced = new Map(syncFiles.map(f => [f.pathLower, f.modified]));
  const seen = new Set<string>();
  const books: LibraryBook[] = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".epub") || !file.contentHash || seen.has(file.contentHash)) continue;
    seen.add(file.contentHash);
    const entry = index[file.contentHash];
    if (entry?.hidden) continue;
    const syncPath = `${SYNC_FOLDER}/${file.contentHash}.json`.toLowerCase();
    books.push({
      id: file.contentHash,
      path: file.path,
      title: entry?.title || titleFromFileName(file.name),
      author: entry?.author ?? null,
      series: entry?.series ?? null,
      seriesIndex: entry?.seriesIndex ?? null,
      read: entry?.read ?? false,
      cover: entry?.cover ?? null,
      lastRead: synced.get(syncPath) ?? null,
      hasSyncFile: synced.has(syncPath),
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

/** The furthest point any device has reached in a book, from its sync file. */
export function furthest(syncFile: { positions?: Record<string, { totalProgression?: number }> } | null): number {
  return Math.max(0, ...Object.values(syncFile?.positions ?? {}).map(p => p.totalProgression ?? 0));
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
  return books.filter(b => b.lastRead).sort((a, b) => b.lastRead!.localeCompare(a.lastRead!))[0] ?? null;
}

/** A book's furthest place as this browser last read it, with its sync file's time then. */
export interface KnownProgress {
  at: string | null;
  p: number;
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
