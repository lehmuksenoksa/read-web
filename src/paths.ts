// Where the web version reads and writes in Dropbox (WEB.md → Security and privacy).

export const BOOKS_FOLDER = "/Books";
export const SYNC_FOLDER = "/Apps/Read/Sync";
export const FONTS_FOLDER = "/Apps/Read/Fonts";
export const LIBRARY_INDEX_PATH = `${SYNC_FOLDER}/library.json`;

/** A book's sync file. Book ids are Dropbox content hashes (64 hex characters). */
export function syncFilePath(bookId: string): string {
  if (!/^[0-9a-f]{64}$/.test(bookId)) throw new Error(`Not a book id: ${bookId}`);
  return `${SYNC_FOLDER}/${bookId}.json`;
}

/**
 * The only paths the web version may write: a book's own sync file in `/Apps/Read/Sync/`.
 * Never anything in `/Books/` or anywhere else (the app's rule, CLAUDE.md → Never).
 */
export function isWritablePath(path: string): boolean {
  return /^\/Apps\/Read\/Sync\/[0-9a-f]{64}\.json$/.test(path);
}

/** The phones' setup backups (read only): the device list, each device's settings and fonts. */
export const DEVICES_PATH = `${SYNC_FOLDER}/devices.json`;
export const backupPath = (device: string) => `${SYNC_FOLDER}/devices/${device}/backup.json`;
export const fontsPath = (device: string) => `${SYNC_FOLDER}/devices/${device}/fonts.json`;
