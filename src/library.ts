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
