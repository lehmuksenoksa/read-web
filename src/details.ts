// Edit details on the web (2026-10-14): the same file the phones keep, `/Apps/Read/Sync/details.json`.

/** One book's details as the phones write them (BookDetails in Details.kt). */
export interface BookDetails {
  title: string;
  author?: string | null;
  series?: string | null;
  number?: number | null;
  /**
   * A chosen cover: an https address (a Hardcover or Royal Road match, or a link pasted on a phone or
   * here), or `dropbox:<path>` for an image from a file, uploaded to `covers/chosen/<id>.jpg` (2026-10-20).
   * Null: the book's own (or the site's own, for a serial).
   */
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

/** The prefix of a cover chosen from a file: the image is in Dropbox at the path after it. */
export const DROPBOX_COVER = "dropbox:";

/**
 * The Dropbox path of a cover chosen from a file; null for a link or none. The address ends in
 * `#<time>` (as the phones write it), so each new pick of the same book is a new address.
 */
export function dropboxCoverPath(coverUrl: string | null | undefined): string | null {
  return coverUrl?.startsWith(DROPBOX_COVER) ? coverUrl.slice(DROPBOX_COVER.length).split("#")[0] : null;
}

/** A pasted link as a cover address: https (http upgraded); null when it isn't a web address. */
export function coverLink(text: string): string | null {
  const t = text.trim();
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || !url.hostname.includes(".")) return null;
  return url.toString();
}

/**
 * The details file text with [coverUrl] chosen for [bookId] at [now] (null: the book's own). A book
 * without an entry gets one from [shown], its details as the Library shows them, so nothing else changes.
 */
export function withCover(remote: string | null, bookId: string, coverUrl: string | null, shown: DetailsEdit, now: number): string {
  const file = parseDetails(remote);
  const before = file.books[bookId] ?? { title: shown.title, author: shown.author, series: shown.series, number: shown.number };
  const books = { ...file.books, [bookId]: { ...before, coverUrl, updatedAt: now } };
  return JSON.stringify({ ...file, books, version: file.version ?? 1 });
}
