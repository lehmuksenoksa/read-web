import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dropbox } from "../src/dropbox";
import { chapterTextPath, DETAILS_PATH, fontPath, isAddablePath, isNewBookPath, isWritablePath, serialSyncPath, SUBSCRIPTIONS_PATH, syncFilePath, WEB_SETUP_PATH } from "../src/paths";

const id = "a".repeat(64);

describe("where the web version may write", () => {
  it("is a book's or a serial's sync file in /Apps/Read/Sync/, Web's own setup, the shared details file and the subscriptions, nothing else", () => {
    expect(isWritablePath(syncFilePath(id))).toBe(true);
    expect(isWritablePath(serialSyncPath("rr-12345"))).toBe(true);
    expect(isWritablePath(SUBSCRIPTIONS_PATH)).toBe(true);
    expect(SUBSCRIPTIONS_PATH).toBe("/Apps/Read/Sync/subscriptions.json");
    expect(isWritablePath(DETAILS_PATH)).toBe(true);
    expect(DETAILS_PATH).toBe("/Apps/Read/Sync/details.json");
    expect(isWritablePath("/Apps/Read/Sync/devices/Web/setup.json")).toBe(true);
    expect(WEB_SETUP_PATH).toBe("/Apps/Read/Sync/devices/Web/setup.json");
    for (const path of [
      "/Books/Emma.epub", `/Books/${id}.json`, "/Apps/Read/Sync/library.json", "/Apps/Read/Sync/details.json.bak", "/Apps/Read/Sync/Details.json",
      "/Apps/Read/Sync/tts-rules.json", "/Apps/Read/Sync/subscriptions.json.bak", `/Apps/Read/Sync/devices/S23/backup.json`, "/Apps/Read/Sync/devices/S23/fonts.json", "/Apps/Read/Sync/devices.json",
      "/Apps/Read/Sync/devices/Web/backup.json", "/Apps/Read/Sync/devices/Web/setup.json.bak",
      "/Apps/Read/Fonts/Bookerly-Regular.ttf", `/Apps/Read/Sync/../../../Books/${id}.json`, `/apps/read/sync/${id}.json`,
      `/Apps/Read/Sync/${id}.json/x`, "/", chapterTextPath("rr-1", "1001"), "/Apps/Read/Sync/chapters/rr-1.json", "/Apps/Read/Sync/rr-../x.json", "/Apps/Read/Sync/xx-1.json",
    ]) expect(isWritablePath(path), path).toBe(false);
    expect(() => syncFilePath("../Books/x")).toThrow();
  });

  it("adds only downloaded font files in /Apps/Read/Fonts/ and new EPUBs straight in /Books/, nothing else", () => {
    expect(isAddablePath(fontPath("Newsreader-r-latin-1.woff2"))).toBe(true);
    expect(isAddablePath(fontPath("Newsreader.json"))).toBe(true);
    expect(isAddablePath(`/Apps/Read/Sync/covers/${"ab".repeat(32)}.jpg`)).toBe(true);
    expect(isAddablePath("/Apps/Read/Sync/covers/../library.json")).toBe(false);
    expect(isAddablePath("/Apps/Read/Sync/covers/x.jpg")).toBe(false);
    expect(isAddablePath("/Books/Piranesi.epub")).toBe(true);
    expect(isAddablePath("/Books/The Hobbit (1937).EPUB")).toBe(true);
    for (const path of [
      "/Apps/Read/Fonts/Bookerly-Regular.ttf", "/Apps/Read/Fonts/../Sync/x.json", "/Apps/Read/Fonts/a/b.woff2",
      "/Books/x.woff2", "/Apps/Read/Sync/devices/Web/setup.json", syncFilePath(id), "/Apps/Read/Fonts/x.txt",
      "/Books/Wildbow/Twig.epub", "/Books/../Apps/x.epub", "/Books/..epub", "/Books/notes.pdf", "/Books/x.epub.json", "/books/x.epub", "/Other/x.epub", "/Books/.epub/",
    ]) expect(isAddablePath(path), path).toBe(false);
    for (const path of ["/Books/Wildbow/Twig.epub", "/Books/x.pdf", fontPath("Newsreader.json")]) expect(isNewBookPath(path), path).toBe(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("is checked before anything is sent", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const api = new Dropbox("token", () => undefined);
    await expect(api.writeText("/Books/Emma.epub", "x", null)).rejects.toThrow();
    await expect(api.writeText("/Apps/Read/Sync/library.json", "{}", "rev")).rejects.toThrow();
    await expect(api.writeText(fontPath("Newsreader.json"), "{}", null)).rejects.toThrow();
    await expect(api.addFile("/Apps/Read/Fonts/Bookerly-Regular.ttf", new Uint8Array())).rejects.toThrow();
    await expect(api.addFile(syncFilePath(id), new Uint8Array())).rejects.toThrow();
    await expect(api.addBook("/Books/Wildbow/Twig.epub", new Uint8Array())).rejects.toThrow();
    await expect(api.addBook(syncFilePath(id), new Uint8Array())).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adds a book with Dropbox's add mode, never over a file: a name taken is null", async () => {
    const sent: { mode: unknown; autorename: unknown }[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const arg = JSON.parse((init.headers as Record<string, string>)["Dropbox-API-Arg"]);
      sent.push({ mode: arg.mode, autorename: arg.autorename });
      return arg.path === "/Books/Taken.epub"
        ? new Response('{"error_summary":"path/conflict/file/"}', { status: 409 })
        : new Response(JSON.stringify({ rev: "1", content_hash: "h".repeat(64) }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const api = new Dropbox("token", () => undefined);
    expect(await api.addBook("/Books/New.epub", new Uint8Array([1]))).toBe("h".repeat(64));
    expect(await api.addBook("/Books/Taken.epub", new Uint8Array([1]))).toBeNull();
    expect(sent).toEqual([{ mode: "add", autorename: false }, { mode: "add", autorename: false }]);
  });

  it("is the only kind of write in the code", () => {
    // Every Dropbox call that changes something goes through writeText, and every writeText is given a sync file path, Web's setup, the details file or the subscriptions.
    const dir = join(__dirname, "../src");
    const code = readdirSync(dir).filter(f => f.endsWith(".ts")).map(f => [f, readFileSync(join(dir, f), "utf8")] as const);
    for (const [file, text] of code) {
      for (const endpoint of ["files/delete", "files/move", "files/copy", "files/create_folder", "files/upload_session", "sharing/"]) {
        expect(text.includes(endpoint), `${file} calls ${endpoint}`).toBe(false);
      }
      if (file !== "dropbox.ts") expect(text.includes("files/upload"), `${file} uploads`).toBe(false);
      for (const call of text.matchAll(/\.writeText\(([^,]+),/g)) expect(call[1].trim(), `${file}: ${call[0]}`).toMatch(/^(syncFilePath\(|syncPath$|WEB_SETUP_PATH$|DETAILS_PATH$|SUBSCRIPTIONS_PATH$)/);
      for (const call of text.matchAll(/\.addFile\(([^,]+),/g)) expect(call[1].trim(), `${file}: ${call[0]}`).toMatch(/^(fontPath|coverPath)\(/);
      for (const call of text.matchAll(/\.addBook\(([^,]+),/g)) expect(call[1].trim(), `${file}: ${call[0]}`).toMatch(/^bookPath\(/);
    }
  });
});
