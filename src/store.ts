// What this browser keeps between visits (WEB.md → Kept in this browser, 2026-10-12): the books
// opened, the font files, the Library as last seen and Web's setup, so a visit doesn't fetch them
// all again. IndexedDB, this browser only; Sign out empties it. Every call fails quietly: without
// storage the page fetches everything, as it did before.

const DB_NAME = "read-web";
const DB_VERSION = 1;
/** Book files by id (the Dropbox content hash, so a stored copy is never out of date). */
const BOOKS = "books";
/** Each stored book's size and when it was last opened, for dropping the oldest. */
const BOOK_META = "bookMeta";
/** Font files by their path in `/Apps/Read/Fonts/` (added there once, never changed). */
const FILES = "files";
/** Small values: the Library as last seen, Web's setup. */
const VALUES = "values";

/** At most this many books, and this many bytes of them; the least recently opened go first. */
export const BOOKS_KEPT = { count: 10, bytes: 200 * 1024 * 1024 };

export interface KeptBook {
  id: string;
  size: number;
  usedAt: number;
}

/** The books to drop to stay within [limit]: the newest are kept, and always the newest one. */
export function booksToDrop(books: KeptBook[], limit = BOOKS_KEPT): string[] {
  const newestFirst = [...books].sort((a, b) => b.usedAt - a.usedAt);
  const drop: string[] = [];
  let count = 0;
  let bytes = 0;
  for (const book of newestFirst) {
    if (count > 0 && (count >= limit.count || bytes + book.size > limit.bytes)) {
      drop.push(book.id);
      continue;
    }
    count++;
    bytes += book.size;
  }
  return drop;
}

let opened: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  opened ??= new Promise<IDBDatabase | null>(resolve => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const d = request.result;
        for (const name of [BOOKS, BOOK_META, FILES, VALUES]) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read<T>(store: string, key: string): Promise<T | undefined> {
  try {
    const d = await db();
    if (!d) return undefined;
    return await done(d.transaction(store).objectStore(store).get(key) as IDBRequest<T | undefined>);
  } catch {
    return undefined;
  }
}

async function write(store: string, key: string, value: unknown): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    await done(d.transaction(store, "readwrite").objectStore(store).put(value, key));
  } catch {
    // Full or unavailable: it's fetched again next time.
  }
}

/** A book's file, if this browser has it (and it counts as opened now). */
export async function keptBook(id: string): Promise<Uint8Array | null> {
  const bytes = await read<Uint8Array>(BOOKS, id);
  if (!bytes) return null;
  await write(BOOK_META, id, { id, size: bytes.byteLength, usedAt: Date.now() } satisfies KeptBook);
  return bytes;
}

/** Keeps a book's file, dropping the least recently opened beyond [BOOKS_KEPT]. */
export async function keepBook(id: string, bytes: Uint8Array): Promise<void> {
  await write(BOOKS, id, bytes);
  await write(BOOK_META, id, { id, size: bytes.byteLength, usedAt: Date.now() } satisfies KeptBook);
  try {
    const d = await db();
    if (!d) return;
    const all = await done(d.transaction(BOOK_META).objectStore(BOOK_META).getAll() as IDBRequest<KeptBook[]>);
    const drop = booksToDrop(all);
    if (!drop.length) return;
    const tx = d.transaction([BOOKS, BOOK_META], "readwrite");
    for (const old of drop) {
      tx.objectStore(BOOKS).delete(old);
      tx.objectStore(BOOK_META).delete(old);
    }
  } catch {
    // Dropped next time.
  }
}

/** A file this browser has for [path], or [fetch]'s, kept for next time; null when there's none. */
export async function keptFile(path: string, fetch: () => Promise<Uint8Array | null>): Promise<Uint8Array | null> {
  const kept = await read<Uint8Array>(FILES, path.toLowerCase());
  if (kept) return kept;
  const bytes = await fetch();
  if (bytes) await write(FILES, path.toLowerCase(), bytes);
  return bytes;
}

export function keptValue<T>(key: string): Promise<T | undefined> {
  return read<T>(VALUES, key);
}

export function keepValue(key: string, value: unknown): Promise<void> {
  return write(VALUES, key, value);
}

/** Sign out: everything this browser kept goes. */
export async function forgetAll(): Promise<void> {
  const d = await opened?.catch(() => null);
  d?.close();
  opened = null;
  await new Promise<void>(resolve => {
    try {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
