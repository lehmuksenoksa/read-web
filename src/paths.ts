// Where the web version reads and writes in Dropbox (WEB.md → Security and privacy).

export const BOOKS_FOLDER = "/Books";
export const SYNC_FOLDER = "/Apps/Read/Sync";
export const FONTS_FOLDER = "/Apps/Read/Fonts";
export const LIBRARY_INDEX_PATH = `${SYNC_FOLDER}/library.json`;
/** Edit details, shared with the phones: book id → title, author, series, number (the newer edit wins per book). */
export const DETAILS_PATH = `${SYNC_FOLDER}/details.json`;

/** A book's sync file. Book ids are Dropbox content hashes (64 hex characters). */
export function syncFilePath(bookId: string): string {
  if (!/^[0-9a-f]{64}$/.test(bookId)) throw new Error(`Not a book id: ${bookId}`);
  return `${SYNC_FOLDER}/${bookId}.json`;
}

/** Web's own setup (its looks, the look in use, the interface): not in the phones' device list. */
export const WEB_SETUP_PATH = `${SYNC_FOLDER}/devices/Web/setup.json`;

/**
 * The only paths the web version may write: a book's own sync file in `/Apps/Read/Sync/`, Web's own
 * setup file, and the shared details file (Edit details, 2026-10-14). Never anything in `/Books/` or
 * anywhere else (the app's rule, CLAUDE.md → Never).
 */
export function isWritablePath(path: string): boolean {
  return /^\/Apps\/Read\/Sync\/[0-9a-f]{64}\.json$/.test(path) || path === WEB_SETUP_PATH || path === DETAILS_PATH;
}

/** A font file or a font's list of files, in `/Apps/Read/Fonts/` (fonts downloaded from Google Fonts). */
export const fontPath = (name: string) => `${FONTS_FOLDER}/${name}`;

/**
 * Files the web version may add (never overwrite or remove): a downloaded font's files and its
 * list of files in `/Apps/Read/Fonts/`. Bookerly's .ttf files there are never touched.
 */
export function isAddablePath(path: string): boolean {
  return /^\/Apps\/Read\/Fonts\/[A-Za-z0-9-]+\.(woff2|json)$/.test(path);
}

/** The phones' setup backups (read only): the device list, each device's settings and fonts. */
export const DEVICES_PATH = `${SYNC_FOLDER}/devices.json`;
export const backupPath = (device: string) => `${SYNC_FOLDER}/devices/${device}/backup.json`;
export const fontsPath = (device: string) => `${SYNC_FOLDER}/devices/${device}/fonts.json`;
