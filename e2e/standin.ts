// A stand-in Dropbox for the smoke test: two books (the fixture EPUB), one serial with its chapters
// in Dropbox, Web's setup file. Reads answer from memory; writes are kept for the test to look at.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const EPUB = readFileSync(new URL("./fixtures/test.epub", import.meta.url));
/** Emma's sharp cover, as a phone puts it in the covers folder. */
const COVER = readFileSync(new URL("./fixtures/cover.jpg", import.meta.url));
const H = 3_600_000;
const D = 24 * H;

export const hashOf = (i: number) => i.toString(16).padStart(2, "0").repeat(32);
/** The two books: Katabasis (0) and Emma (1), one series. */
export const KATABASIS = hashOf(0);
export const EMMA = hashOf(1);
export const SERIAL = "rr-101";
/** A caught-up serial (2026-10-17): its three chapters all seen, the newest read to its end. */
export const DONE = "rr-202";

export interface StandIn {
  /** Every file written, in order. */
  uploads: { path: string; text: string }[];
  /** Console errors and page errors, with the 409s of files not found left out. */
  errors: string[];
  /** Every file read, in order. */
  downloads: string[];
}

export async function standIn(page: Page, home: boolean): Promise<StandIn> {
  const now = Date.now();
  const titles: [string, string][] = [["Katabasis", "R. F. Kuang"], ["Emma", "Jane Austen"]];
  const index = Object.fromEntries(titles.map(([title, author], i) => [hashOf(i), { title, author, series: "Test Series", seriesIndex: i + 1, updatedAt: 1 }]));
  const chapterId = (n: number) => `0${String(n).padStart(4, "0")}`;
  const chapters = Array.from({ length: 215 }, (_, i) => ({
    id: chapterId(i + 1), title: `Chapter ${i + 1}: ${["Ink and Stone", "Contour Lines", "Scale", "North by Lantern"][i % 4]}`,
    url: `https://www.royalroad.com/fiction/101/x/chapter/${chapterId(i + 1)}/c`,
    published: new Date(now - 8 * H - (214 - i) * 3 * D).toISOString(), length: 9000,
    ...(i >= 214 ? {} : { seenAt: 0 }),
    // Locked on the site since (a subscription ended), but their text is in Dropbox: still read and counted (2026-10-19).
    ...(i >= 213 ? { locked: true } : {}),
  }));
  const doneChapters = Array.from({ length: 3 }, (_, i) => ({
    id: chapterId(i + 1), title: `Chapter ${i + 1}: ${["Ashes", "Embers", "Smoke"][i]}`,
    url: `https://www.royalroad.com/fiction/202/x/chapter/${chapterId(i + 1)}/c`,
    published: new Date(now - 30 * D - (2 - i) * 7 * D).toISOString(), length: 9000, seenAt: 0,
  }));
  const para = (n: number) => `<p>Paragraph ${n}. The ink had dried in the night, and with it the last of the coastline he had trusted. Maren rolled the sheet flat with both palms and looked at what the survey had become.</p>`;
  const chapterPage = (title: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${Array.from({ length: 14 }, (_, i) => para(i + 1)).join("")}</body></html>`;
  const files: Record<string, string> = {
    "/Apps/Read/Sync/library.json": JSON.stringify({ books: index, version: 1 }),
    "/Apps/Read/Sync/subscriptions.json": JSON.stringify({ stories: [
      { bookId: SERIAL, url: "https://www.royalroad.com/fiction/101", title: "Dungeon Cartographer", author: "Sample Author", site: "rr", updatedAt: 1, removed: false, seen: {}, endChapterId: null },
      { bookId: DONE, url: "https://www.royalroad.com/fiction/202", title: "The Lantern Road", author: "Ivy Marrow", site: "rr", updatedAt: 1, removed: false, seen: {}, endChapterId: chapterId(3) },
    ], version: 1 }),
    "/Apps/Read/Sync/devices/Web/setup.json": JSON.stringify({ looks: [{ id: "office", name: "Office", background: "Custom", backgroundColor: -1, textColor: -14737633 }], lookId: "office", version: 1 }),
    "/Apps/Read/Sync/devices.json": JSON.stringify({ devices: ["S23"], version: 1 }),
    "/Apps/Read/Sync/devices/S23/backup.json": JSON.stringify({ device: "S23", savedAt: 5, settings: { keepAuthorNotes: "false" }, fonts: [], version: 1 }),
    [`/Apps/Read/Sync/chapters/${SERIAL}.json`]: JSON.stringify({ bookId: SERIAL, device: "S23", checkedAt: now - 2 * H, version: 1, chapters }),
    [`/Apps/Read/Sync/chapters/${DONE}.json`]: JSON.stringify({ bookId: DONE, device: "S23", checkedAt: now - 2 * H, version: 1, chapters: doneChapters }),
    [`/Apps/Read/Sync/${DONE}.json`]: JSON.stringify({ bookId: DONE, positions: { s23: { href: `ch/${chapterId(3)}.xhtml`, progression: 1, totalProgression: 1, timestamp: now - 3 * D, deviceName: "S23", locator: { href: `ch/${chapterId(3)}.xhtml`, type: "application/xhtml+xml", title: "x", locations: { progression: 1, totalProgression: 1 } }, snippet: "" } }, version: 1 }),
    [`/Apps/Read/Sync/${SERIAL}.json`]: JSON.stringify({ bookId: SERIAL, positions: { s23: { href: `ch/${chapterId(212)}.xhtml`, progression: 0.4, totalProgression: 0.9, timestamp: now - 5 * H, deviceName: "S23", locator: { href: `ch/${chapterId(212)}.xhtml`, type: "application/xhtml+xml", title: "x", locations: { progression: 0.4, totalProgression: 0.9 } }, snippet: "" } }, version: 1 }),
    [`/Apps/Read/Sync/${EMMA}.json`]: JSON.stringify({ bookId: EMMA, positions: { s23: { href: "OEBPS/Text/chapter 2.xhtml", progression: 0.3, totalProgression: 0.43, timestamp: now - 2 * H, deviceName: "S23", locator: { href: "OEBPS/Text/chapter 2.xhtml", type: "application/xhtml+xml", title: "Chapter 2", locations: { progression: 0.3, totalProgression: 0.43 } } } }, version: 1 }),
  };
  for (const c of chapters) files[`/Apps/Read/Sync/chapters/${SERIAL}/${c.id}.xhtml`] = chapterPage(c.title);

  const result: StandIn = { uploads: [], errors: [], downloads: [] };
  page.on("console", m => { if (m.type() === "error" && !m.text().includes("409")) result.errors.push(m.text()); });
  page.on("pageerror", e => result.errors.push(`pageerror: ${e.message}`));
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-expose-headers": "Dropbox-API-Result" };
  // The content hash follows the text, so a file written since reads as changed (serials kept in the browser).
  const textHash = (text: string | undefined) => { let h = 7; for (const c of text ?? "") h = (h * 31 + c.charCodeAt(0)) | 0; return `h${h >>> 0}`; };
  const entry = (path: string) => ({ ".tag": "file", name: path.split("/").pop(), path_display: path, path_lower: path.toLowerCase(), size: 1, content_hash: textHash(files[path]), server_modified: new Date(now - H).toISOString() });
  await page.route(/dropboxapi\.com/, async route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    const url = req.url();
    const arg = JSON.parse(req.headers()["dropbox-api-arg"] || "null");
    const body = (() => { try { return JSON.parse(req.postData() ?? ""); } catch { return null; } })();
    const ok = (data: string | Buffer, rev = "r") => route.fulfill({ status: 200, headers: { ...cors, "dropbox-api-result": JSON.stringify({ rev }) }, body: data });
    if (url.endsWith("/files/list_folder")) {
      const folder = body.path as string;
      const entries = folder === "/Books"
        ? titles.map(([t], i) => ({ ...entry(`/Books/${t}.epub`), content_hash: hashOf(i), size: 300_000 }))
        : folder === "/Apps/Read/Sync/covers" ? [{ ...entry(`${folder}/${EMMA}.jpg`), content_hash: "c1" }, { ...entry(`${folder}/${SERIAL}.jpg`), content_hash: "c2" }]
        : Object.keys(files).filter(p => p.startsWith(folder + "/") && (body.recursive || !p.slice(folder.length + 1).includes("/"))).map(entry);
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ entries, cursor: "c", has_more: false }) });
    }
    if (url.endsWith("/files/download")) {
      result.downloads.push(arg.path);
      if (files[arg.path]) return ok(files[arg.path], "X");
      if (arg.path === `/Apps/Read/Sync/covers/${EMMA}.jpg` || arg.path === `/Apps/Read/Sync/covers/${SERIAL}.jpg`) return ok(COVER, "C");
      if (String(arg.path).startsWith("/Books/")) return ok(EPUB);
      return route.fulfill({ status: 409, headers: cors, body: '{"error_summary":"path/not_found/"}' });
    }
    if (url.endsWith("/files/upload")) {
      const text = req.postDataBuffer()?.toString() ?? "";
      result.uploads.push({ path: arg.path, text });
      files[arg.path] = text;
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ rev: "U" }) });
    }
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: "null" });
  });
  await page.addInitScript(h => {
    sessionStorage.setItem("read.token", JSON.stringify({ token: "T", expiresAt: Date.now() + 3_600_000 }));
    if (h) localStorage.setItem("read.home", "1");
    localStorage.setItem("read.contents", "0");
  }, home);
  return result;
}

/** The text of the chapter on screen (Readium's visible frame), or "" while none is. */
export async function pageText(page: Page): Promise<string> {
  for (const frame of page.frames()) {
    try {
      const text = await frame.evaluate(() => {
        const el = window.frameElement;
        if (!el || getComputedStyle(el).visibility === "hidden" || !document.body) return null;
        return document.body.innerText;
      });
      if (text !== null) return text;
    } catch {
      // A frame that went away meanwhile.
    }
  }
  return "";
}
