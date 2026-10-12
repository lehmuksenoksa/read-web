import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dropbox } from "../src/dropbox";
import { fontPath, isAddablePath, isWritablePath, syncFilePath, WEB_SETUP_PATH } from "../src/paths";

const id = "a".repeat(64);

describe("where the web version may write", () => {
  it("is a book's sync file in /Apps/Read/Sync/ and Web's own setup, nothing else", () => {
    expect(isWritablePath(syncFilePath(id))).toBe(true);
    expect(isWritablePath("/Apps/Read/Sync/devices/Web/setup.json")).toBe(true);
    expect(WEB_SETUP_PATH).toBe("/Apps/Read/Sync/devices/Web/setup.json");
    for (const path of [
      "/Books/Emma.epub", `/Books/${id}.json`, "/Apps/Read/Sync/library.json", "/Apps/Read/Sync/details.json",
      "/Apps/Read/Sync/tts-rules.json", "/Apps/Read/Sync/subscriptions.json", `/Apps/Read/Sync/devices/S23/backup.json`, "/Apps/Read/Sync/devices/S23/fonts.json", "/Apps/Read/Sync/devices.json",
      "/Apps/Read/Sync/devices/Web/backup.json", "/Apps/Read/Sync/devices/Web/setup.json.bak",
      "/Apps/Read/Fonts/Bookerly-Regular.ttf", `/Apps/Read/Sync/../../../Books/${id}.json`, `/apps/read/sync/${id}.json`,
      `/Apps/Read/Sync/${id}.json/x`, "/",
    ]) expect(isWritablePath(path), path).toBe(false);
    expect(() => syncFilePath("../Books/x")).toThrow();
  });

  it("adds only downloaded font files in /Apps/Read/Fonts/, never Bookerly's or anything else", () => {
    expect(isAddablePath(fontPath("Newsreader-r-latin-1.woff2"))).toBe(true);
    expect(isAddablePath(fontPath("Newsreader.json"))).toBe(true);
    for (const path of [
      "/Apps/Read/Fonts/Bookerly-Regular.ttf", "/Apps/Read/Fonts/../Sync/x.json", "/Apps/Read/Fonts/a/b.woff2",
      "/Books/x.woff2", "/Apps/Read/Sync/devices/Web/setup.json", syncFilePath(id), "/Apps/Read/Fonts/x.txt",
    ]) expect(isAddablePath(path), path).toBe(false);
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
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is the only kind of write in the code", () => {
    // Every Dropbox call that changes something goes through writeText, and every writeText is given a sync file path or Web's setup.
    const dir = join(__dirname, "../src");
    const code = readdirSync(dir).filter(f => f.endsWith(".ts")).map(f => [f, readFileSync(join(dir, f), "utf8")] as const);
    for (const [file, text] of code) {
      for (const endpoint of ["files/delete", "files/move", "files/copy", "files/create_folder", "files/upload_session", "sharing/"]) {
        expect(text.includes(endpoint), `${file} calls ${endpoint}`).toBe(false);
      }
      if (file !== "dropbox.ts") expect(text.includes("files/upload"), `${file} uploads`).toBe(false);
      for (const call of text.matchAll(/\.writeText\(([^,]+),/g)) expect(call[1].trim(), `${file}: ${call[0]}`).toMatch(/^(syncFilePath\(|WEB_SETUP_PATH$)/);
      for (const call of text.matchAll(/\.addFile\(([^,]+),/g)) expect(call[1].trim(), `${file}: ${call[0]}`).toMatch(/^fontPath\(/);
    }
  });
});
