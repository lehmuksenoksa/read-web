// What the page looks like: the phones' looks and fonts, read from Dropbox once per visit and
// kept only in the page's memory. The browser remembers the picked look and its text size.

import type { Dropbox } from "./dropbox";
import { BOOKERLY_FILES, chosenLook, deviceLooks, faceOfFile, fileSafe, hex, isLight, lookKey, pageBackground, type DeviceLooks, type FontFileFace, type Look } from "./looks";
import { backupPath, DEVICES_PATH, FONTS_FOLDER, fontsPath } from "./paths";

const KEY_LOOK = "read.look";
const KEY_SIZE = "read.size.";

function remembered(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function remember(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private window: not remembered.
  }
}

export interface Choice {
  device: string;
  look: Look;
  /** The text size in use: this browser's for the look, else the look's own. */
  size: number;
}

/** Literata, the page's own font: for "Serif", and when a look's font isn't in Dropbox. */
const LITERATA: FontFileFace[] = [
  { file: "literata_400.ttf", family: "Literata", weight: "400", italic: false },
  { file: "literata_400_italic.ttf", family: "Literata", weight: "400", italic: true },
  { file: "literata_700.ttf", family: "Literata", weight: "700", italic: false },
];

export class Appearance {
  private devicesLoad: Promise<DeviceLooks[]> | null = null;
  private readonly fontFiles = new Map<string, Promise<Record<string, string>>>();
  private bookerly: Promise<Map<string, Uint8Array> | null> | null = null;
  private readonly urls: string[] = [];

  constructor(private readonly api: Dropbox) {}

  /** The devices' looks, the S23 first; none when there are no backups. */
  devices(): Promise<DeviceLooks[]> {
    this.devicesLoad ??= (async () => {
      const index = await this.api.readText(DEVICES_PATH).catch(() => null);
      const names = index ? ((JSON.parse(index.text).devices as string[]) ?? []) : [];
      const devices = await Promise.all(names.map(async device => {
        const backup = await this.api.readText(backupPath(device)).catch(() => null);
        if (!backup) return null;
        try {
          return deviceLooks(device, (JSON.parse(backup.text).settings ?? {}) as Record<string, string>);
        } catch {
          return null;
        }
      }));
      return devices.filter((d): d is DeviceLooks => d != null).sort((a, b) => Number(b.device === "S23") - Number(a.device === "S23"));
    })().catch(() => []);
    return this.devicesLoad;
  }

  async choice(): Promise<Choice | null> {
    const chosen = chosenLook(await this.devices(), remembered(KEY_LOOK));
    if (!chosen) return null;
    const size = Number(remembered(KEY_SIZE + lookKey(chosen.device, chosen.look)));
    return { ...chosen, size: size > 0 ? size : chosen.look.fontSize };
  }

  pick(device: string, look: Look) {
    remember(KEY_LOOK, lookKey(device, look));
  }

  setSize(choice: Choice, size: number) {
    const key = KEY_SIZE + lookKey(choice.device, choice.look);
    remember(key, Math.abs(size - choice.look.fontSize) < 1e-9 ? null : String(size));
  }

  /**
   * The look's font for the book's pages: `@font-face` rules pointing at in-memory copies, and
   * the family name to use. Bookerly comes from `/Apps/Read/Fonts/` (or the device's own font of
   * that name), other fonts from the device's backup; anything missing is Literata.
   */
  async font(choice: Choice): Promise<{ family: string; css: string }> {
    const wanted = choice.look.font;
    if (wanted === "Bookerly") {
      const files = await this.bookerlyFiles();
      if (files) return this.declare("Bookerly", BOOKERLY_FILES.map(f => ({ face: f, bytes: files.get(f.file)! })));
    }
    if (wanted !== "Serif") {
      const own = await this.deviceFonts(choice.device);
      const faces = Object.keys(own).map(faceOfFile).filter((f): f is FontFileFace => f != null && f.family === fileSafe(wanted));
      if (faces.length) return this.declare(wanted, faces.map(f => ({ face: f, bytes: base64Bytes(own[f.file]) })));
    }
    const literata = await Promise.all(LITERATA.map(async f => ({
      face: f, bytes: new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}fonts/${f.file}`)).arrayBuffer()),
    })));
    return this.declare("Literata", literata);
  }

  private declare(family: string, files: { face: FontFileFace; bytes: Uint8Array }[]): { family: string; css: string } {
    const css = files.map(({ face, bytes }) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: face.file.toLowerCase().endsWith(".otf") ? "font/otf" : "font/ttf" }));
      this.urls.push(url);
      return `@font-face { font-family: "${family}"; src: url("${url}"); font-weight: ${face.weight}; font-style: ${face.italic ? "italic" : "normal"}; }`;
    }).join("\n");
    return { family, css };
  }

  private bookerlyFiles(): Promise<Map<string, Uint8Array> | null> {
    this.bookerly ??= (async () => {
      const files = await Promise.all(BOOKERLY_FILES.map(f => this.api.download(`${FONTS_FOLDER}/${f.file}`)));
      if (files.some(f => !f)) return null;
      return new Map(BOOKERLY_FILES.map((f, i) => [f.file, files[i]!.bytes]));
    })().catch(() => null);
    return this.bookerly;
  }

  private deviceFonts(device: string): Promise<Record<string, string>> {
    let load = this.fontFiles.get(device);
    if (!load) {
      load = this.api.readText(fontsPath(device))
        .then(r => (r ? ((JSON.parse(r.text).files ?? {}) as Record<string, string>) : {}))
        .catch(() => ({}));
      this.fontFiles.set(device, load);
    }
    return load;
  }

  close() {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.length = 0;
  }
}

function base64Bytes(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** The page around the book follows the look: light for a light look, on the look's own background. */
export function applyTheme(look: Look | null) {
  const root = document.documentElement;
  root.classList.toggle("paper", look != null && isLight(look));
  if (look) root.style.setProperty("--ground", hex(pageBackground(look)));
  else root.style.removeProperty("--ground");
}
