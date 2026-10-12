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

/**
 * At most [count] books opened here and [fetched] fetched in the background, and [bytes] of them
 * all. Fetched books go first, so they never push out a book opened here; then the least recently
 * opened.
 */
export const BOOKS_KEPT = { count: 10, fetched: 3, bytes: 200 * 1024 * 1024 };

export interface KeptBook {
  id: string;
  size: number;
  /** When it was opened here; for a fetched book, when any device last read it. */
  usedAt: number;
  /** Fetched in the background (one of the books read last), not opened here yet. */
  fetched?: boolean;
}

/** The books to drop to stay within [limit]; the newest book opened here is always kept. */
export function booksToDrop(books: KeptBook[], limit = BOOKS_KEPT): string[] {
  const newestFirst = (list: KeptBook[]) => [...list].sort((a, b) => b.usedAt - a.usedAt);
  const opened = newestFirst(books.filter(b => !b.fetched));
  const fetched = newestFirst(books.filter(b => b.fetched));
  const keptOpened = opened.slice(0, Math.max(1, limit.count));
  const keptFetched = fetched.slice(0, limit.fetched);
  const drop = [...opened.slice(keptOpened.length), ...fetched.slice(keptFetched.length)].map(b => b.id);
  let bytes = [...keptOpened, ...keptFetched].reduce((sum, b) => sum + b.size, 0);
  // Over the size: fetched books first, the oldest first; then opened ones, never the newest.
  for (const book of [...keptFetched.reverse(), ...keptOpened.slice(1).reverse()]) {
    if (bytes <= limit.bytes) break;
    drop.push(book.id);
    bytes -= book.size;
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

/** The books this browser has. */
export async function keptBooks(): Promise<KeptBook[]> {
  try {
    const d = await db();
    if (!d) return [];
    return await done(d.transaction(BOOK_META).objectStore(BOOK_META).getAll() as IDBRequest<KeptBook[]>);
  } catch {
    return [];
  }
}

/**
 * Keeps a book's file: opened here now, or [fetched] in the background (with when it was last
 * read anywhere); then drops what's beyond [BOOKS_KEPT].
 */
export async function keepBook(id: string, bytes: Uint8Array, fetched?: { lastReadAt: number }): Promise<void> {
  await write(BOOKS, id, bytes);
  await write(BOOK_META, id, (fetched
    ? { id, size: bytes.byteLength, usedAt: fetched.lastReadAt, fetched: true }
    : { id, size: bytes.byteLength, usedAt: Date.now() }) satisfies KeptBook);
  try {
    const d = await db();
    if (!d) return;
    const drop = booksToDrop(await keptBooks());
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
