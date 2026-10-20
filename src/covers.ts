// Sharp covers (WEB.md → Home, 2026-10-16): the phones put each Dropbox book's cover, as they keep
// it (up to 480 × 720), in `/Apps/Read/Sync/covers/<id>.jpg`. The page lists that folder once per
// load, keeps each cover in this browser with its content hash, and fetches only new or changed
// ones, a few at a time in the page's order. Until a book's sharp cover is here, the index's small
// one shows. Every failure is quiet: the small covers stay.
import type { Dropbox, FileEntry } from "./dropbox";
import { forgetFiles, keepValue, keptFile, keptValue } from "./store";

export const COVERS_FOLDER = "/Apps/Read/Sync/covers";
const HASHES = "coverHashes";
const AT_ONCE = 4;

export const coverPath = (id: string) => `${COVERS_FOLDER}/${id}.jpg`;

/** The listing's covers by book id: their content hashes. */
export function coversListed(files: FileEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) if (f.name.endsWith(".jpg") && f.contentHash) out[f.name.slice(0, -4)] = f.contentHash;
  return out;
}

/**
 * The covers to show, in [order] first (the page's order) then the rest: each with whether this
 * browser's copy is out of date (a new or changed cover, fetched again) or can be used as kept.
 */
export function coverPlan(listed: Record<string, string>, kept: Record<string, string>, order: string[]): { id: string; stale: boolean }[] {
  const ids = [...new Set([...order.filter(id => id in listed), ...Object.keys(listed)])];
  return ids.map(id => ({ id, stale: kept[id] !== listed[id] }));
}

/** Book id → the sharp cover's address in this page. */
const sharp = new Map<string, string>();

export function sharpCover(id: string): string | null {
  return sharp.get(id) ?? null;
}

let loading: Promise<void> | null = null;

/** Fetches what's needed once per page load; [shown] is called as each sharp cover becomes available. */
export function loadSharpCovers(api: Dropbox, order: string[], shown: (id: string, url: string) => void): Promise<void> {
  loading ??= (async () => {
    const listed = coversListed(await api.listFolder(COVERS_FOLDER, false).catch(() => []));
    if (!Object.keys(listed).length) return;
    const kept = (await keptValue<Record<string, string>>(HASHES)) ?? {};
    const plan = coverPlan(listed, kept, order);
    // Changed covers are fetched again; those of books gone from the folder are dropped.
    const stale = [...plan.filter(p => p.stale && kept[p.id]).map(p => p.id), ...Object.keys(kept).filter(id => !(id in listed))];
    if (stale.length) await forgetFiles(stale.map(coverPath));
    const hashes: Record<string, string> = Object.fromEntries(Object.entries(kept).filter(([id]) => id in listed));
    let next = 0;
    const worker = async () => {
      while (next < plan.length) {
        const { id } = plan[next++];
        const bytes = await keptFile(coverPath(id), async () => (await api.download(coverPath(id)).catch(() => null))?.bytes ?? null);
        if (!bytes) continue;
        hashes[id] = listed[id];
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
        sharp.set(id, url);
        shown(id, url);
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
    await keepValue(HASHES, hashes);
  })();
  return loading;
}

/** A book added in this browser: its cover as the phones keep theirs, at most 480 × 720 (JPEG); null if it can't be drawn. */
export async function largeCover(cover: { bytes: Uint8Array; type: string }): Promise<Uint8Array | null> {
  try {
    const image = await createImageBitmap(new Blob([cover.bytes as BlobPart], { type: cover.type }));
    const scale = Math.min(480 / image.width, 720 / image.height, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

// --- Covers chosen by hand (2026-10-20): from a file, uploaded to `covers/chosen/<id>.jpg` and named in
// details.json as `dropbox:<path>`; or a link (an https address), shown straight from its site (the
// page's policy allows https images, 2026-10-20). ---

/** Covers chosen from a file (their image here), or picked in this browser: shown before the phones' sharp copy. */
const chosen = new Map<string, string>();
/** Books whose own cover was picked again here: the sharp copy may still be the old choice. */
const ownAgain = new Set<string>();

/** What a book's cover shows: [small] is its own (the index's), null when it has none. */
export function coverSrc(id: string, small: string | null): string | null {
  if (ownAgain.has(id)) return small;
  return chosen.get(id) ?? sharp.get(id) ?? small;
}

/** A cover just chosen here: [src] an image's address, or null for the book's own. */
export function choose(id: string, src: string | null): void {
  if (src == null) {
    chosen.delete(id);
    ownAgain.add(id);
  } else {
    ownAgain.delete(id);
    chosen.set(id, src);
  }
}

/** Whether a book has a cover chosen from a file or here, which the phones' sharp copy doesn't replace. */
export function hasChosen(id: string): boolean {
  return chosen.has(id) || ownAgain.has(id);
}

/**
 * The covers chosen in [details]: a file's fetched from Dropbox once per choice (kept in this browser),
 * a link's shown from its address; [shown] is called as each one is ready.
 */
export async function loadChosenCovers(
  api: Dropbox,
  details: Record<string, { coverUrl?: string | null; updatedAt?: number }>,
  shown: (id: string, url: string) => void,
): Promise<void> {
  await Promise.all(Object.entries(details).map(async ([id, d]) => {
    const url = d.coverUrl;
    if (!url || ownAgain.has(id) || chosen.has(id)) return;
    if (url.startsWith("https://")) {
      chosen.set(id, url);
      shown(id, url);
      return;
    }
    if (!url.startsWith("dropbox:")) return;
    const path = url.slice("dropbox:".length);
    const bytes = await keptFile(`${path}?${d.updatedAt ?? 0}`, async () => (await api.download(path).catch(() => null))?.bytes ?? null).catch(() => null);
    if (!bytes || chosen.has(id) || ownAgain.has(id)) return;
    const src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
    chosen.set(id, src);
    shown(id, src);
  }));
}

/** The longer side of a cover chosen from a file, at most (as on the phones). */
export const CHOSEN_MAX = 1200;

/** A picked image as a chosen cover: any shape, the longer side at most [CHOSEN_MAX], JPEG; null if it can't be drawn. */
export async function chosenCoverBytes(file: Blob): Promise<Uint8Array | null> {
  try {
    const image = await createImageBitmap(file);
    const scale = Math.min(CHOSEN_MAX / Math.max(image.width, image.height), 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
