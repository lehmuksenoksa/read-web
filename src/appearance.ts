// Web's setup (its own looks, the Library's grouping), kept in Dropbox in Web's setup file, and the
// fonts the page can use: Bookerly and the fonts downloaded from Google Fonts, both in
// `/Apps/Read/Fonts/`, and Literata (the page's own). Fonts are read into the page's memory only.

import { RevConflict, type Dropbox } from "./dropbox";
import { CATALOGUE, fontIndex, fontIndexName, googleCssUrl, parseGoogleCss, type FontIndex } from "./fonts";
import { BOOKERLY_FILES, decodeSetup, DEFAULT_SETUP, hex, pageBackground, pageText, weightsOf, type FontFileFace, type Look, type Setup } from "./looks";
import { FONTS_FOLDER, fontPath, WEB_SETUP_PATH } from "./paths";
import { forgetFiles, keepValue, keptFile, keptValue } from "./store";

/** Setup changes go to Dropbox this long after the last one. */
const SAVE_DELAY_MS = 1500;

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
  private setupLoad: Promise<void> | null = null;
  private current: Setup = DEFAULT_SETUP;
  private rev: string | null = null;
  private saveTimer: number | undefined;
  private readonly listeners = new Set<(setup: Setup) => void>();
  private downloadedLoad: Promise<Map<string, FontIndex>> | null = null;
  private bookerly: Promise<Map<string, Uint8Array> | null> | null = null;
  private readonly pageFonts = new Map<string, Promise<PageFont>>();
  private readonly urls: string[] = [];

  constructor(private readonly api: Dropbox) {}

  /**
   * Web's setup as it is now: as this browser kept it, at once, while Dropbox's is read (and
   * replaces it if it differs); without a kept one, Dropbox's; the defaults when there's none yet.
   */
  async setup(): Promise<Setup> {
    this.setupLoad ??= this.loadSetup();
    await this.setupLoad;
    return this.current;
  }

  private async loadSetup() {
    const fresh = this.api.readText(WEB_SETUP_PATH).then(remote => {
      this.rev = remote?.rev ?? null;
      return decodeSetup(remote?.text ?? null);
    });
    const kept = await keptValue<string>("setup");
    if (kept) {
      this.current = decodeSetup(kept);
      void fresh.then(setup => {
        // A change made here meanwhile is the newer one: it's saved over Dropbox's.
        if (this.saveTimer !== undefined) return;
        void keepValue("setup", JSON.stringify(setup));
        if (JSON.stringify(setup) === JSON.stringify(this.current)) return;
        this.current = setup;
        for (const listener of this.listeners) listener(setup);
      }).catch(() => undefined);
      return;
    }
    this.current = await fresh.catch(() => this.current);
    void keepValue("setup", JSON.stringify(this.current));
  }

  onChange(listener: (setup: Setup) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A change: shown at once, saved to Dropbox a moment after the last one. */
  update(next: Setup) {
    this.current = next;
    void keepValue("setup", JSON.stringify(next));
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

  /**
   * The fonts the page can use: Bookerly (when it's in Dropbox), Literata, those downloaded and not
   * [removed]; and the catalogue's others, to download.
   */
  async fontChoices(removed: string[]): Promise<{ ready: string[]; toDownload: string[] }> {
    const [bookerly, downloaded] = await Promise.all([this.bookerlyFiles(), this.downloaded()]);
    const ready = [...(bookerly ? ["Bookerly"] : []), "Literata", ...[...downloaded.keys()].filter(f => !removed.includes(f))];
    return { ready, toDownload: CATALOGUE.filter(f => !ready.includes(f)) };
  }

  /**
   * Download: [family]'s files from Google Fonts (the only time the page reaches Google), added to
   * `/Apps/Read/Fonts/` with their list last, so a font is there only when it's whole. A font
   * removed from the list is still there: nothing is fetched.
   */
  async download(family: string): Promise<void> {
    if ((await this.downloaded()).has(family)) return;
    const css = await fetch(googleCssUrl(family), { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!css.ok) throw new Error(`Google Fonts: ${css.status}`);
    const faces = parseGoogleCss(await css.text());
    if (!faces.length) throw new Error("Google Fonts listed no files");
    const { index, files } = fontIndex(family, faces);
    await Promise.all([...files].map(async ([url, file]) => {
      const response = await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`Google Fonts: ${response.status}`);
      await this.api.addFile(fontPath(file), new Uint8Array(await response.arrayBuffer()));
    }));
    await this.api.addFile(fontPath(fontIndexName(family)), new TextEncoder().encode(JSON.stringify(index)));
    this.downloadedLoad = null;
  }

  /** Remove: this browser's copies of [family]'s files go (Dropbox's stay). */
  async forget(family: string): Promise<void> {
    this.pageFonts.delete(family);
    const index = (await this.downloaded()).get(family);
    if (index) await forgetFiles(index.faces.map(f => fontPath(f.file)));
  }

  /** The look's font for the book's pages: `@font-face` rules pointing at in-memory copies. */
  font(family: string): Promise<PageFont> {
    let load = this.pageFonts.get(family);
    if (!load) {
      load = this.loadFont(family);
      this.pageFonts.set(family, load);
      // A font that didn't come is tried again next time.
      load.catch(() => this.pageFonts.delete(family));
    }
    return load;
  }

  private async loadFont(family: string): Promise<PageFont> {
    if (family === "Bookerly") {
      const files = await this.bookerlyFiles();
      if (files) return this.declare("Bookerly", BOOKERLY_FILES.map(f => ({ face: f, bytes: files.get(f.file)! })));
    }
    const index = (await this.downloaded()).get(family);
    if (index) {
      const bytes = new Map<string, Uint8Array>();
      await Promise.all([...new Set(index.faces.map(f => f.file))].map(async file => {
        const got = await this.fontFile(fontPath(file));
        if (got) bytes.set(file, got);
      }));
      const faces = index.faces.filter(f => bytes.has(f.file));
      if (faces.length) {
        return this.declare(family, faces.map(f => ({
          face: { file: f.file, family, weight: String(f.weight), italic: f.italic, unicodeRange: f.unicodeRange },
          bytes: bytes.get(f.file)!,
        })));
      }
    }
    const literata = await Promise.all(LITERATA.map(async f => ({
      face: f, bytes: new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}fonts/${f.file}`)).arrayBuffer()),
    })));
    return this.declare("Literata", literata);
  }

  private declare(family: string, files: { face: FontFileFace & { unicodeRange?: string }; bytes: Uint8Array }[]): PageFont {
    const urls = new Map<Uint8Array, string>();
    const css = files.map(({ face, bytes }) => {
      let url = urls.get(bytes);
      if (!url) {
        const type = face.file.endsWith(".woff2") ? "font/woff2" : face.file.toLowerCase().endsWith(".otf") ? "font/otf" : "font/ttf";
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
        urls.set(bytes, url);
        this.urls.push(url);
      }
      const range = face.unicodeRange ? ` unicode-range: ${face.unicodeRange};` : "";
      return `@font-face { font-family: "${family}"; src: url("${url}"); font-weight: ${face.weight}; font-style: ${face.italic ? "italic" : "normal"};${range} }`;
    }).join("\n");
    return { family, css, weights: weightsOf(files.map(f => f.face)) };
  }

  /** The fonts downloaded into `/Apps/Read/Fonts/`, by family, from their lists of files. */
  private downloaded(): Promise<Map<string, FontIndex>> {
    this.downloadedLoad ??= (async () => {
      const files = await this.api.listFolder(FONTS_FOLDER, false);
      const lists = await Promise.all(files.filter(f => f.name.endsWith(".json")).map(f => this.api.readText(f.path).catch(() => null)));
      const fonts = new Map<string, FontIndex>();
      for (const list of lists) {
        try {
          const index = list && (JSON.parse(list.text) as FontIndex);
          if (index && index.family && index.faces?.length) fonts.set(index.family, index);
        } catch {
          // Not one of ours: left alone.
        }
      }
      return fonts;
    })().catch(() => new Map());
    return this.downloadedLoad;
  }

  private bookerlyFiles(): Promise<Map<string, Uint8Array> | null> {
    this.bookerly ??= (async () => {
      const files = await Promise.all(BOOKERLY_FILES.map(f => this.fontFile(`${FONTS_FOLDER}/${f.file}`)));
      if (files.some(f => !f)) return null;
      return new Map(BOOKERLY_FILES.map((f, i) => [f.file, files[i]!]));
    })().catch(() => null);
    return this.bookerly;
  }

  /** A font file from `/Apps/Read/Fonts/`: fetched once, then kept in this browser (fonts there never change). */
  private fontFile(path: string): Promise<Uint8Array | null> {
    return keptFile(path, async () => (await this.api.download(path))?.bytes ?? null);
  }

  close() {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.length = 0;
  }
}

/** The whole page takes the look in use's colours: the greys around the book are made from its text colour. */
export function applyLook(look: Look) {
  const root = document.documentElement.style;
  root.setProperty("--bg", hex(pageBackground(look)));
  root.setProperty("--tx", hex(pageText(look)));
}
