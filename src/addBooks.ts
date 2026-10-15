// Adding books from Home (WEB.md → Home, step 2, agreed 2026-10-15): EPUB files go into Dropbox's
// /Books/ under their own names, added only (never over a file there). What can be known before
// uploading: the file's Dropbox content hash (the book's id), and its title, author and cover.

import { resolveHref } from "./epub";
import { BOOKS_FOLDER } from "./paths";
import { Zip } from "./zip";

/** Dropbox's single-request upload takes up to 150 MB. */
export const MAX_BOOK_BYTES = 150 * 1024 * 1024;

const BLOCK = 4 * 1024 * 1024;

/**
 * Dropbox's content hash (the book id on every device; the app's DropboxContentHash): SHA-256 of
 * each 4 MB block, then SHA-256 of those hashes together, in lowercase hex.
 */
export async function contentHash(bytes: Uint8Array): Promise<string> {
  const blocks: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += BLOCK) {
    blocks.push(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.subarray(at, at + BLOCK) as BufferSource)));
  }
  const all = new Uint8Array(blocks.length * 32);
  blocks.forEach((b, i) => all.set(b, i * 32));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return [...digest].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Where a dropped file goes: straight in /Books/, under its own name. */
export function bookPath(fileName: string): string {
  const name = fileName.replace(/[\\/]/g, "_").trim();
  return `${BOOKS_FOLDER}/${name}`;
}

export const isEpubName = (name: string) => /\.epub$/i.test(name);

/** What an EPUB says about itself: shown until the phones list the book. */
export interface BookInfo {
  title: string | null;
  author: string | null;
  series: string | null;
  seriesIndex: number | null;
  cover: { bytes: Uint8Array; type: string } | null;
}

const decode = (text: string) => text
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag)?.[2] ?? null;

/** The title, author, series and cover from an EPUB's package document; throws when it isn't an EPUB. */
export async function bookInfo(bytes: Uint8Array): Promise<BookInfo> {
  const zip = new Zip(bytes);
  const container = await zip.text("META-INF/container.xml");
  const rootfile = /<(?:\w+:)?rootfile\b[^>]*>/i.exec(container)?.[0];
  const opfPath = rootfile && attr(rootfile, "full-path");
  if (!opfPath || !zip.has(opfPath)) throw new Error("No package document");
  const opf = await zip.text(opfPath);
  const element = (name: string) => {
    const m = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "i").exec(opf);
    const text = m ? decode(m[1].replace(/<[^>]+>/g, "")) : "";
    return text || null;
  };
  const metas = [...opf.matchAll(/<(?:\w+:)?meta\b[^>]*>/gi)].map(m => m[0]);
  const metaContent = (name: string) => {
    const tag = metas.find(t => attr(t, "name") === name);
    return tag ? attr(tag, "content") : null;
  };
  const items = [...opf.matchAll(/<(?:\w+:)?item\b[^>]*>/gi)].map(m => m[0]);
  const coverId = metaContent("cover");
  const coverItem = items.find(t => (attr(t, "properties") ?? "").split(/\s+/).includes("cover-image"))
    ?? (coverId ? items.find(t => attr(t, "id") === coverId) : undefined);
  let cover: BookInfo["cover"] = null;
  const coverHref = coverItem && attr(coverItem, "href");
  if (coverHref) {
    const name = decodeURIComponent(resolveHref(opfPath, coverHref));
    const type = attr(coverItem!, "media-type") ?? "";
    if (zip.has(name) && type.startsWith("image/")) cover = { bytes: await zip.read(name), type };
  }
  const index = Number(metaContent("calibre:series_index"));
  return {
    title: element("title"),
    author: element("creator"),
    series: metaContent("calibre:series"),
    seriesIndex: metaContent("calibre:series") && Number.isFinite(index) && metaContent("calibre:series_index") ? index : null,
    cover,
  };
}

/** How one file went: shown on its line in Add books. */
export type AddOutcome =
  | { kind: "added"; id: string }
  | { kind: "already"; title: string; sameTitle: boolean }
  | { kind: "not-epub" }
  | { kind: "too-big" }
  | { kind: "name-taken"; name: string }
  | { kind: "failed" };

/**
 * Whether a file can go up, before uploading: an EPUB under 150 MB, not already in the library
 * (the same content, whatever its name) and not named as another file in /Books/.
 */
export function beforeUpload(file: { name: string; size: number; id: string | null; title: string | null }, library: { id: string; title: string; path: string }[]): AddOutcome | null {
  if (!isEpubName(file.name) || !file.id) return { kind: "not-epub" };
  if (file.size > MAX_BOOK_BYTES) return { kind: "too-big" };
  const same = library.find(b => b.id === file.id);
  if (same) return { kind: "already", title: same.title, sameTitle: !file.title || same.title.toLocaleLowerCase() === file.title.toLocaleLowerCase() };
  const path = bookPath(file.name).toLocaleLowerCase();
  if (library.some(b => b.path.toLocaleLowerCase() === path)) return { kind: "name-taken", name: file.name };
  return null;
}

/** The line's words for an outcome. */
export function outcomeText(outcome: AddOutcome | null): string {
  if (!outcome) return "Adding…";
  switch (outcome.kind) {
    case "added": return "Added";
    case "already": return outcome.sameTitle ? "Already in the library" : `Already in the library as “${outcome.title}”`;
    case "not-epub": return "Not an EPUB";
    case "too-big": return "Too big to add from the web";
    case "name-taken": return `Another file is called “${outcome.name}”`;
    case "failed": return "Couldn't reach Dropbox";
  }
}

/** "1 added · 2 already there · 2 not added". */
export function addSummary(outcomes: AddOutcome[]): string {
  const added = outcomes.filter(o => o.kind === "added").length;
  const already = outcomes.filter(o => o.kind === "already").length;
  const not = outcomes.length - added - already;
  return [added && `${added} added`, already && `${already} already there`, not && `${not} not added`].filter(Boolean).join(" · ");
}

/** A cover as the phones' index has it: a 120×180 JPEG, base64 (drawn in the page; null if it can't be). */
export async function thumbnail(cover: { bytes: Uint8Array; type: string }): Promise<string | null> {
  try {
    const image = await createImageBitmap(new Blob([cover.bytes as BlobPart], { type: cover.type }));
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 180;
    const scale = Math.max(120 / image.width, 180 / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    canvas.getContext("2d")!.drawImage(image, (120 - w) / 2, (180 - h) / 2, w, h);
    image.close();
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? null;
  } catch {
    return null;
  }
}
