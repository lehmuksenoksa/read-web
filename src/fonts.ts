// Fonts from Google Fonts (the app's catalogue, SPEC → Fonts): downloaded once, on Download, and
// kept in Dropbox in `/Apps/Read/Fonts/` beside Bookerly; read from there afterwards, so reading
// never reaches Google. Only Latin letters are kept.

import { fileSafe } from "./looks";

/** The app's catalogue (FontCatalog.kt), Literata aside: the page has it built in. */
export const CATALOGUE = ["Newsreader", "Source Serif 4", "Spectral", "Jost", "Atkinson Hyperlegible Next", "IBM Plex Sans", "Figtree"];

/** Light to Bold, upright and italic: what the app fetches. */
export const WEIGHTS = [300, 400, 500, 600, 700];

/** The subsets kept: Latin letters, with accents (the books are English). */
const SUBSETS = new Set(["latin", "latin-ext"]);

export function googleCssUrl(family: string): string {
  const styles = [0, 1].flatMap(italic => WEIGHTS.map(w => `${italic},${w}`)).join(";");
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:ital,wght@${styles}&display=swap`;
}

export interface GoogleFace {
  url: string;
  weight: number;
  italic: boolean;
  unicodeRange: string;
  subset: string;
}

/** The faces in Google's CSS (one block per weight, style and subset), the kept subsets only. */
export function parseGoogleCss(css: string): GoogleFace[] {
  const faces: GoogleFace[] = [];
  for (const m of css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const [, subset, body] = m;
    if (!SUBSETS.has(subset)) continue;
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1]?.replace(/['"]/g, "");
    const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1]);
    const italic = /font-style:\s*italic/.test(body);
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "";
    if (url && weight && url.startsWith("https://fonts.gstatic.com/")) faces.push({ url, weight, italic, unicodeRange, subset });
  }
  return faces;
}

/** A downloaded font's list of files (`/Apps/Read/Fonts/<Family>.json`). */
export interface FontIndex {
  family: string;
  faces: { file: string; weight: number; italic: boolean; unicodeRange: string }[];
  version: 1;
}

/** The files to keep for [faces]: one per distinct file (a variable font serves several weights from one). */
export function fontIndex(family: string, faces: GoogleFace[]): { index: FontIndex; files: Map<string, string> } {
  const safe = fileSafe(family);
  const files = new Map<string, string>();
  const index: FontIndex = { family, faces: [], version: 1 };
  for (const face of faces) {
    let file = files.get(face.url);
    if (!file) {
      file = `${safe}-${face.italic ? "i" : "r"}-${face.subset}-${files.size + 1}.woff2`;
      files.set(face.url, file);
    }
    index.faces.push({ file, weight: face.weight, italic: face.italic, unicodeRange: face.unicodeRange });
  }
  return { index, files };
}

export const fontIndexName = (family: string) => `${fileSafe(family)}.json`;
