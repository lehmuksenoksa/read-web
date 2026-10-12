// Web's setup (its own looks and interface theme), kept in Dropbox in Web's setup file, and the
// fonts the page can use: Bookerly from `/Apps/Read/Fonts/`, Literata (the page's own), and the
// phones' own fonts from their setup backups. Fonts are read into the page's memory only.

import { RevConflict, type Dropbox } from "./dropbox";
import { BOOKERLY_FILES, decodeSetup, DEFAULT_SETUP, faceOfFile, fileSafe, weightsOf, type FontFileFace, type InterfaceTheme, type Setup } from "./looks";
import { backupPath, DEVICES_PATH, FONTS_FOLDER, fontsPath, WEB_SETUP_PATH } from "./paths";

/** Setup changes go to Dropbox this long after the last one. */
const SAVE_DELAY_MS = 1500;

export interface FontChoice {
  family: string;
  /** The phone it comes from ("S23"); null for Bookerly and Literata. */
  from: string | null;
}

export interface PageFont {
  /** The family name declared for the page (Literata when the look's font isn't available). */
  family: string;
  css: string;
  weights: number[];
}

const LITERATA: FontFileFace[] = [
  { file: "literata_400.ttf", family: "Literata", weight: "400", italic: false },
  { file: "literata_400_italic.ttf", family: "Literata", weight: "400", italic: true },
  { file: "literata_700.ttf", family: "Literata", weight: "700", italic: false },
];

export class Appearance {
  private setupLoad: Promise<Setup> | null = null;
  private current: Setup = DEFAULT_SETUP;
  private rev: string | null = null;
  private saveTimer: number | undefined;
  private readonly listeners = new Set<(setup: Setup) => void>();
  private devicesLoad: Promise<{ device: string; fonts: string[] }[]> | null = null;
  private bookerly: Promise<Map<string, Uint8Array> | null> | null = null;
  private readonly deviceFontFiles = new Map<string, Promise<Record<string, string>>>();
  private readonly pageFonts = new Map<string, Promise<PageFont>>();
  private readonly urls: string[] = [];

  constructor(private readonly api: Dropbox) {}

  /** Web's setup: read from Dropbox once; the defaults when there's none yet. */
  setup(): Promise<Setup> {
    this.setupLoad ??= this.api.readText(WEB_SETUP_PATH)
      .then(remote => {
        this.rev = remote?.rev ?? null;
        this.current = decodeSetup(remote?.text ?? null);
        return this.current;
      })
      .catch(() => this.current);
    return this.setupLoad;
  }

  onChange(listener: (setup: Setup) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A change: shown at once, saved to Dropbox a moment after the last one. */
  update(next: Setup) {
    this.current = next;
    for (const listener of this.listeners) listener(next);
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), SAVE_DELAY_MS);
  }

  /** Writes the setup now if a change is waiting (leaving the page, signing out). */
  async flush() {
    if (this.saveTimer === undefined) return;
    window.clearTimeout(this.saveTimer);
    await this.save();
  }

  private async save() {
    this.saveTimer = undefined;
    const text = JSON.stringify(this.current);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        this.rev = await this.api.writeText(WEB_SETUP_PATH, text, this.rev);
        return;
      } catch (e) {
        if (!(e instanceof RevConflict)) return;
        // Another tab saved meanwhile: this one's setup is the newer.
        this.rev = (await this.api.readText(WEB_SETUP_PATH).catch(() => null))?.rev ?? null;
      }
    }
  }

  /** The fonts the page can use: Bookerly (when it's in Dropbox), Literata, then the phones' own. */
  async fontChoices(): Promise<FontChoice[]> {
    const [bookerly, devices] = await Promise.all([this.bookerlyFiles(), this.devices()]);
    const choices: FontChoice[] = [...(bookerly ? [{ family: "Bookerly", from: null }] : []), { family: "Literata", from: null }];
    for (const d of devices) {
      for (const family of d.fonts) {
        if (!choices.some(c => c.family === family)) choices.push({ family, from: d.device });
      }
    }
    return choices;
  }

  /** The look's font for the book's pages: `@font-face` rules pointing at in-memory copies. */
  font(family: string): Promise<PageFont> {
    let load = this.pageFonts.get(family);
    if (!load) {
      load = this.loadFont(family);
      this.pageFonts.set(family, load);
    }
    return load;
  }

  private async loadFont(family: string): Promise<PageFont> {
    if (family === "Bookerly") {
      const files = await this.bookerlyFiles();
      if (files) return this.declare("Bookerly", BOOKERLY_FILES.map(f => ({ face: f, bytes: files.get(f.file)! })));
    }
    if (family !== "Literata") {
      for (const d of await this.devices()) {
        if (!d.fonts.includes(family)) continue;
        const own = await this.fontFiles(d.device);
        const faces = Object.keys(own).map(faceOfFile).filter((f): f is FontFileFace => f != null && f.family === fileSafe(family));
        if (faces.length) return this.declare(family, faces.map(f => ({ face: f, bytes: base64Bytes(own[f.file]) })));
      }
    }
    const literata = await Promise.all(LITERATA.map(async f => ({
      face: f, bytes: new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}fonts/${f.file}`)).arrayBuffer()),
    })));
    return this.declare("Literata", literata);
  }

  private declare(family: string, files: { face: FontFileFace; bytes: Uint8Array }[]): PageFont {
    const css = files.map(({ face, bytes }) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: face.file.toLowerCase().endsWith(".otf") ? "font/otf" : "font/ttf" }));
      this.urls.push(url);
      return `@font-face { font-family: "${family}"; src: url("${url}"); font-weight: ${face.weight}; font-style: ${face.italic ? "italic" : "normal"}; }`;
    }).join("\n");
    return { family, css, weights: weightsOf(files.map(f => f.face)) };
  }

  /** The phones and the font families in their setup backups (the backup lists them by name). */
  private devices(): Promise<{ device: string; fonts: string[] }[]> {
    this.devicesLoad ??= (async () => {
      const index = await this.api.readText(DEVICES_PATH).catch(() => null);
      const names = index ? ((JSON.parse(index.text).devices as string[]) ?? []) : [];
      const devices = await Promise.all(names.map(async device => {
        const backup = await this.api.readText(backupPath(device)).catch(() => null);
        try {
          return { device, fonts: backup ? ((JSON.parse(backup.text).fonts as string[]) ?? []) : [] };
        } catch {
          return { device, fonts: [] };
        }
      }));
      return devices.sort((a, b) => Number(b.device === "S23") - Number(a.device === "S23"));
    })().catch(() => []);
    return this.devicesLoad;
  }

  private bookerlyFiles(): Promise<Map<string, Uint8Array> | null> {
    this.bookerly ??= (async () => {
      const files = await Promise.all(BOOKERLY_FILES.map(f => this.api.download(`${FONTS_FOLDER}/${f.file}`)));
      if (files.some(f => !f)) return null;
      return new Map(BOOKERLY_FILES.map((f, i) => [f.file, files[i]!.bytes]));
    })().catch(() => null);
    return this.bookerly;
  }

  private fontFiles(device: string): Promise<Record<string, string>> {
    let load = this.deviceFontFiles.get(device);
    if (!load) {
      load = this.api.readText(fontsPath(device))
        .then(r => (r ? ((JSON.parse(r.text).files ?? {}) as Record<string, string>) : {}))
        .catch(() => ({}));
      this.deviceFontFiles.set(device, load);
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

/** The interface (Library, bars, panels): light or dark, whatever the page's look. */
export function applyTheme(theme: InterfaceTheme) {
  document.documentElement.classList.toggle("dark", theme === "Dark");
}
