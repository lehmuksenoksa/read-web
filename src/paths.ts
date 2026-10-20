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

/** The phones' serials (read only): the subscriptions, and each serial's chapter list (WEB.md → Home, step 3a). */
export const SUBSCRIPTIONS_PATH = `${SYNC_FOLDER}/subscriptions.json`;
export const CHAPTERS_FOLDER = `${SYNC_FOLDER}/chapters`;

/** A serial's id as the phones make them: "rr-12345", "pt-name", "pt-c12345". */
export const isSerialId = (id: string) => /^(rr|pt)-[A-Za-z0-9_-]+$/.test(id);

/** A serial's chapter list and its sync file, read only. */
export function chapterListPath(id: string): string {
  if (!isSerialId(id)) throw new Error(`Not a serial: ${id}`);
  return `${CHAPTERS_FOLDER}/${id}.json`;
}
export function serialSyncPath(id: string): string {
  if (!isSerialId(id)) throw new Error(`Not a serial: ${id}`);
  return `${SYNC_FOLDER}/${id}.json`;
}

/** A serial's chapter text as the phones put it in Dropbox (step 3b), read only: `chapters/<serial>/<chapter>.xhtml`. */
export function chapterFolderPath(id: string): string {
  if (!isSerialId(id)) throw new Error(`Not a serial: ${id}`);
  return `${CHAPTERS_FOLDER}/${id}`;
}
export function chapterTextPath(id: string, chapterId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(chapterId)) throw new Error(`Not a chapter: ${chapterId}`);
  return `${chapterFolderPath(id)}/${chapterId}.xhtml`;
}

/** Web's own setup (its looks, the look in use, the interface): not in the phones' device list. */
export const WEB_SETUP_PATH = `${SYNC_FOLDER}/devices/Web/setup.json`;

/**
 * The only paths the web version may write: a book's or a serial's own sync file in
 * `/Apps/Read/Sync/` (Web's place; serials since step 3b), Web's own setup file, the shared details
 * file (Edit details, 2026-10-14) and the subscriptions file (a serial's CAUGHT UP mark, step 3b).
 * Never anything in `/Books/` or anywhere else (the app's rule, CLAUDE.md → Never).
 */
export function isWritablePath(path: string): boolean {
  return /^\/Apps\/Read\/Sync\/([0-9a-f]{64}|(rr|pt)-[A-Za-z0-9_-]+)\.json$/.test(path)
    || path === WEB_SETUP_PATH || path === DETAILS_PATH || path === SUBSCRIPTIONS_PATH;
}

/** A font file or a font's list of files, in `/Apps/Read/Fonts/` (fonts downloaded from Google Fonts). */
export const fontPath = (name: string) => `${FONTS_FOLDER}/${name}`;

/**
 * Files the web version may add (never overwrite or remove): a downloaded font's files and its
 * list of files in `/Apps/Read/Fonts/` (Bookerly's .ttf files there are never touched), and since
 * Home's Add books (2026-10-15) an EPUB straight in `/Books/` (CLAUDE.md: only add new ones the user adds),
 * and its sharp cover in `/Apps/Read/Sync/covers/` (2026-10-16).
 */
export function isAddablePath(path: string): boolean {
  return /^\/Apps\/Read\/Fonts\/[A-Za-z0-9-]+\.(woff2|json)$/.test(path) || isNewBookPath(path) || /^\/Apps\/Read\/Sync\/covers\/[0-9a-f]{64}\.jpg$/.test(path);
}

/** A cover chosen from a file (2026-10-20): the image the phones and Read.web upload, one per book or serial. */
export const chosenCoverPath = (id: string) => `${SYNC_FOLDER}/covers/chosen/${id}.jpg`;

/** The one place Read.web overwrites a file of its own besides the sync files: a chosen cover. */
export function isChosenCoverPath(path: string): boolean {
  return /^\/Apps\/Read\/Sync\/covers\/chosen\/([0-9a-f]{64}|(rr|pt)-[A-Za-z0-9_-]+)\.jpg$/.test(path);
}

/** An EPUB straight in /Books/ (not in a folder in it), its name without "..". */
export function isNewBookPath(path: string): boolean {
  return /^\/Books\/[^/]+\.[eE][pP][uU][bB]$/.test(path) && !path.includes("..");
}

/** The phones' setup backups (read only): the device list, each device's settings and fonts. */
export const DEVICES_PATH = `${SYNC_FOLDER}/devices.json`;
export const backupPath = (device: string) => `${SYNC_FOLDER}/devices/${device}/backup.json`;
export const fontsPath = (device: string) => `${SYNC_FOLDER}/devices/${device}/fonts.json`;
