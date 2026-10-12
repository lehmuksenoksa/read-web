// Web's own looks (WEB.md, 2026-10-12): kept in Dropbox in Web's setup file, in the app's format
// (settings/Looks.kt) plus the web's column count, and turned into Readium's page settings the way
// the app does (reader/ReaderPreferences.kt). Aa changes what you see; Looks saves and uses looks,
// with the app's rules (SPEC → Display settings).

import { TextAlignment, type IEpubPreferences } from "@readium/navigator";

export type Background = "Oled" | "Eink" | "Custom";

/** A look (the fields the web uses). Colours are ARGB integers. */
export interface Look {
  id: string;
  name: string;
  background: Background;
  backgroundColor: number;
  textColor: number;
  /** "Bookerly", "Literata", or the family name of one of the phones' own fonts. */
  font: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  margins: number;
  letterSpacing: number;
  wordSpacing: number;
  /** Null: the book's own. */
  paragraphSpacing: number | null;
  /** Null: the book's own. */
  paragraphIndent: number | null;
  justify: boolean;
  hyphens: boolean;
  /** Pages side by side (the web's own setting). */
  columns: 1 | 2;
}

const BLACK = 0xff000000 | 0;
const WHITE = 0xffffffff | 0;
const NEAR_WHITE = 0xfff2f2f2 | 0;

/** The app's defaults, for any field a look leaves out. */
const DEFAULT: Omit<Look, "id" | "name"> = {
  background: "Oled", backgroundColor: BLACK, textColor: 0xffe6d8b0 | 0, font: "Bookerly", fontWeight: 400,
  fontSize: 1.0, lineHeight: 1.5, margins: 1.0, letterSpacing: 0, wordSpacing: 0,
  paragraphSpacing: null, paragraphIndent: null, justify: true, hyphens: true, columns: 1,
};

/** Web's looks to start with: quiet, for an office. */
export const WEB_LOOKS: Look[] = [
  { ...DEFAULT, id: "office", name: "Office", background: "Custom", backgroundColor: WHITE, textColor: 0xff1f1f1f | 0 },
  { ...DEFAULT, id: "office-dark", name: "Office dark", background: "Custom", backgroundColor: 0xff121212 | 0, textColor: 0xffc9c9c9 | 0 },
];

export function withDefaults(look: Partial<Look> & { id: string }): Look {
  return { ...DEFAULT, name: look.id, ...look } as Look;
}

/** Web's setup (`/Apps/Read/Sync/devices/Web/setup.json`): its looks, the one in use, what you see, the Library's grouping. */
export interface Setup {
  looks: Look[];
  lookId: string;
  /** What you see when it differs from the look in use (Aa's changes); null: the look itself. */
  page: Look | null;
  /** Series of two or more books are one row in the Library. */
  groupSeries: boolean;
  /** The Library shows as a sidebar beside the reader (false: hidden). */
  sidebar: boolean;
  version: 1;
}

export const DEFAULT_SETUP: Setup = { looks: WEB_LOOKS, lookId: "office", page: null, groupSeries: true, sidebar: true, version: 1 };

/** The setup file's text, read leniently: anything missing or unreadable is the default. */
export function decodeSetup(text: string | null): Setup {
  try {
    const raw = JSON.parse(text ?? "") as Partial<Setup>;
    const looks = (raw.looks ?? []).filter(l => l && typeof l.id === "string").map(withDefaults);
    if (!looks.length) return DEFAULT_SETUP;
    return {
      looks,
      lookId: looks.some(l => l.id === raw.lookId) ? raw.lookId! : looks[0].id,
      page: raw.page && typeof raw.page.id === "string" ? withDefaults(raw.page) : null,
      groupSeries: raw.groupSeries !== false,
      sidebar: raw.sidebar !== false,
      version: 1,
    };
  } catch {
    return DEFAULT_SETUP;
  }
}

export function savedLook(setup: Setup): Look {
  return setup.looks.find(l => l.id === setup.lookId) ?? setup.looks[0];
}

/** What you see: Aa's changes, else the look in use. */
export function shown(setup: Setup): Look {
  return setup.page ?? savedLook(setup);
}

/** What you see differs from the look in use (its name aside): the look shows "changed". */
export function isChanged(setup: Setup): boolean {
  if (!setup.page) return false;
  const saved = savedLook(setup);
  return JSON.stringify({ ...setup.page, id: saved.id, name: saved.name }) !== JSON.stringify(saved);
}

/** Aa: what you see changes; the saved look doesn't. */
export function edit(setup: Setup, change: Partial<Look>): Setup {
  const page = { ...shown(setup), ...change };
  return { ...setup, page: JSON.stringify(page) === JSON.stringify(savedLook(setup)) ? null : page };
}

/** Using a look: what you see becomes it. */
export function useLook(setup: Setup, id: string): Setup {
  return setup.looks.some(l => l.id === id) ? { ...setup, lookId: id, page: null } : setup;
}

/** "Office 2", "Office 3"… not taken by another look (the app's saveName). */
export function saveName(base: string, looks: Look[]): string {
  const stem = base.replace(/ \d+$/, "").trim() || "Look";
  for (let n = 2; ; n++) if (!looks.some(l => l.name === `${stem} ${n}`)) return `${stem} ${n}`;
}

/** + Save as new look: what you see, under a new name, in use. */
export function saveAsNew(setup: Setup): Setup {
  let n = 1;
  while (setup.looks.some(l => l.id === `look${n}`)) n++;
  const look = { ...shown(setup), id: `look${n}`, name: saveName(savedLook(setup).name, setup.looks) };
  return { ...setup, looks: [...setup.looks, look], lookId: look.id, page: null };
}

/** Why a look can't be removed, or null: the look in use and the last one stay. */
export function cantRemove(setup: Setup, id: string): string | null {
  if (setup.looks.length <= 1) return "The last look stays.";
  if (id === setup.lookId) return "Use another look first.";
  return null;
}

export function removeLook(setup: Setup, id: string): { setup: Setup; removed: Look; index: number } | null {
  if (cantRemove(setup, id)) return null;
  const index = setup.looks.findIndex(l => l.id === id);
  if (index < 0) return null;
  return { setup: { ...setup, looks: setup.looks.filter(l => l.id !== id) }, removed: setup.looks[index], index };
}

/** Undo: the look back where it was (a look saved meanwhile with its id keeps it; this one gets a new one). */
export function restoreLook(setup: Setup, removed: Look, index: number): Setup {
  let look = removed;
  if (setup.looks.some(l => l.id === look.id)) {
    let n = 1;
    while (setup.looks.some(l => l.id === `look${n}`)) n++;
    look = { ...look, id: `look${n}` };
  }
  const looks = [...setup.looks];
  looks.splice(Math.min(index, looks.length), 0, look);
  return { ...setup, looks };
}

// --- Steps (the app's DisplaySteps) ---

export interface Steps { min: number; max: number; step: number; def: number }

export const STEPS = {
  fontSize: { min: 0.6, max: 2.5, step: 0.1, def: 1.0 },
  margins: { min: 0, max: 3, step: 0.25, def: 1.0 },
  lineHeight: { min: 1, max: 2, step: 0.1, def: 1.5 },
  letterSpacing: { min: 0, max: 0.5, step: 0.05, def: 0 },
  wordSpacing: { min: 0, max: 1, step: 0.1, def: 0 },
  paragraphSpacing: { min: 0, max: 2, step: 0.25, def: 0.5 },
  paragraphIndent: { min: 0, max: 3, step: 0.5, def: 1.0 },
} satisfies Record<string, Steps>;

/** One step up or down, kept on the step grid. */
export function step(steps: Steps, value: number, up: boolean): number {
  const next = value + (up ? steps.step : -steps.step);
  const onGrid = steps.min + Math.round((next - steps.min) / steps.step) * steps.step;
  return Math.round(Math.min(steps.max, Math.max(steps.min, onGrid)) * 1000) / 1000;
}

/**
 * A setting that may be the book's own (null): from the book's own, a step starts at the
 * default; below the minimum it goes back to the book's own.
 */
export function stepOptional(steps: Steps, value: number | null, up: boolean): number | null {
  if (value == null) return up ? steps.def : null;
  if (!up && value <= steps.min + 1e-9) return null;
  return step(steps, value, up);
}

/** The weights a font has, lightest first: the next one up or down, or the same at the end. */
export function stepWeight(weights: number[], value: number, up: boolean): number {
  const sorted = [...new Set(weights)].sort((a, b) => a - b);
  if (!sorted.length) return value;
  const index = sorted.findIndex(w => w >= value);
  const at = index < 0 ? sorted.length - 1 : sorted[index] === value ? index : up ? index - 1 : index;
  return sorted[Math.max(0, Math.min(sorted.length - 1, at + (up ? 1 : -1)))];
}

export function weightName(weight: number): string {
  return ({ 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" } as Record<number, string>)[weight] ?? String(weight);
}

// --- Colours and Readium ---

/** "#rrggbb" of an ARGB integer (alpha dropped: pages are opaque). */
export function hex(argb: number): string {
  return "#" + ((argb >>> 0) & 0xffffff).toString(16).padStart(6, "0");
}

/** An ARGB integer from "#rrggbb". */
export function argb(color: string): number {
  return (0xff000000 | parseInt(color.replace("#", ""), 16)) | 0;
}

function luminance(color: number): number {
  const channel = (shift: number) => {
    const v = ((color >>> shift) & 0xff) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

export function pageBackground(look: Look): number {
  switch (look.background) {
    case "Oled": return BLACK;
    case "Eink": return WHITE;
    default: return look.backgroundColor | BLACK;
  }
}

export function isLight(look: Look): boolean {
  return luminance(pageBackground(look)) > 0.4;
}

/** The text colour as shown: never pure white on a dark page (DESIGN). */
export function pageText(look: Look): number {
  const opaque = look.textColor | BLACK;
  return !isLight(look) && opaque === WHITE ? NEAR_WHITE : opaque;
}

/** Readium's side margin at 1.0, in pixels: the look's margins scale it, as in the app. */
const GUTTER_PX = 20;

/** Readium's page settings for [look], its font declared as [fontFamily]. */
export function preferences(look: Look, fontFamily: string): IEpubPreferences {
  const text = hex(pageText(look));
  return {
    backgroundColor: hex(pageBackground(look)),
    textColor: text,
    linkColor: text,
    visitedColor: text,
    selectionBackgroundColor: isLight(look) ? "#c8c8c8" : "#444444",
    selectionTextColor: text,
    fontFamily,
    fontSize: look.fontSize,
    fontWeight: look.fontWeight,
    lineHeight: look.lineHeight,
    pageGutter: Math.round(look.margins * GUTTER_PX),
    letterSpacing: look.letterSpacing,
    wordSpacing: look.wordSpacing,
    paragraphSpacing: look.paragraphSpacing,
    paragraphIndent: look.paragraphIndent,
    textAlign: look.justify ? TextAlignment.justify : TextAlignment.left,
    hyphens: look.hyphens,
    columnCount: look.columns,
    optimalLineLength: 62,
    maximalLineLength: 70,
  };
}

// --- Fonts ---

/** A family name as the app writes it in font file names ("Open Sans" → "Open-Sans"). */
export function fileSafe(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "Font";
}

export interface FontFileFace {
  file: string;
  family: string;
  /** "400", or a variable font's range "100 900". */
  weight: string;
  italic: boolean;
}

/** A font file's face from the name the app gives it ("Literata-700i.ttf", "Inter-100-900.ttf"). */
export function faceOfFile(file: string): FontFileFace | null {
  const m = /^(.+?)-(\d{3})(?:-(\d{3}))?(i?)\.(ttf|otf)$/i.exec(file);
  if (!m) return null;
  return { file, family: m[1], weight: m[3] ? `${m[2]} ${m[3]}` : m[2], italic: m[4] === "i" };
}

/** The weights a font's files offer (a variable font: every hundred in its range). */
export function weightsOf(faces: FontFileFace[]): number[] {
  return [...new Set(faces.flatMap(f => {
    const [a, b] = f.weight.split(" ").map(Number);
    if (!b) return [a];
    const out: number[] = [];
    for (let w = Math.ceil(a / 100) * 100; w <= b; w += 100) out.push(w);
    return out;
  }))].sort((x, y) => x - y);
}

/** Bookerly's four files in `/Apps/Read/Fonts/` (copied there by the app). */
export const BOOKERLY_FILES: FontFileFace[] = [
  { file: "Bookerly-Regular.ttf", family: "Bookerly", weight: "400", italic: false },
  { file: "Bookerly-Bold.ttf", family: "Bookerly", weight: "700", italic: false },
  { file: "Bookerly-RegularItalic.ttf", family: "Bookerly", weight: "400", italic: true },
  { file: "Bookerly-BoldItalic.ttf", family: "Bookerly", weight: "700", italic: true },
];
