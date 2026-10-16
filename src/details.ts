// Edit details on the web (2026-10-14): the same file the phones keep, `/Apps/Read/Sync/details.json`.

/** One book's details as the phones write them (BookDetails in Details.kt). */
export interface BookDetails {
  title: string;
  author?: string | null;
  series?: string | null;
  number?: number | null;
  /** A cover chosen on a phone (Hardcover's address): kept as it is. */
  coverUrl?: string | null;
  /** Epoch milliseconds of the edit; the newer edit wins. */
  updatedAt?: number;
}

export interface DetailsFile {
  books: Record<string, BookDetails>;
  version?: number;
  [other: string]: unknown;
}

export function parseDetails(text: string | null): DetailsFile {
  if (!text) return { books: {}, version: 1 };
  const file = JSON.parse(text) as DetailsFile;
  return { ...file, books: file.books ?? {} };
}

/** What Edit details changes: title, author, series and number; a phone's chosen cover stays. */
export interface DetailsEdit {
  title: string;
  author: string | null;
  series: string | null;
  number: number | null;
}

/** The details file text with [edit] for [bookId] at [now], everything else as it was. */
export function withDetails(remote: string | null, bookId: string, edit: DetailsEdit, now: number): string {
  const file = parseDetails(remote);
  const before = file.books[bookId];
  const books = {
    ...file.books,
    [bookId]: { ...before, title: edit.title, author: edit.author, series: edit.series, number: edit.number, coverUrl: before?.coverUrl ?? null, updatedAt: now },
  };
  return JSON.stringify({ ...file, books, version: file.version ?? 1 });
}

/** "12" → 12, "2.5" → 2.5, "" → null; null for anything else too (the form says so before saving). */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** What a selection's Set details… changes: a series and/or an author for them all; a field left out keeps each book's own. */
export interface ManyEdit {
  series?: string;
  author?: string;
}

/** A book's details as the Library shows them, for an entry the details file doesn't have yet. */
export interface DetailsBase {
  title: string;
  author: string | null;
  series: string | null;
  number: number | null;
}

/**
 * The details file text with [edit] put on every book in [books] at [now], in one write. A book
 * already in the file keeps its other details (its title, number and chosen cover); one not in it
 * yet starts from what the Library shows, so nothing of it is lost on the phones.
 */
export function withDetailsMany(remote: string | null, books: Record<string, DetailsBase>, edit: ManyEdit, now: number): string {
  const file = parseDetails(remote);
  const books2 = { ...file.books };
  for (const [id, base] of Object.entries(books)) {
    const before = file.books[id] ?? { title: base.title, author: base.author, series: base.series, number: base.number, coverUrl: null };
    books2[id] = {
      ...before,
      ...(edit.series !== undefined ? { series: edit.series } : {}),
      ...(edit.author !== undefined ? { author: edit.author } : {}),
      updatedAt: now,
    };
  }
  return JSON.stringify({ ...file, books: books2, version: file.version ?? 1 });
}
