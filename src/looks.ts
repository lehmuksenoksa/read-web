// Web's own looks (WEB.md, 2026-10-12): kept in Dropbox in Web's setup file, in the app's format
// (settings/Looks.kt) plus the web's column count, and turned into Readium's page settings the way
// the app does (reader/ReaderPreferences.kt). Aa's changes make Custom, as on the phones: Looks
// saves it under a name, puts it in a look's place, or removes it (SPEC → Display settings).

import { decodeHome, DEFAULT_HOME, type HomeSetup } from "./home";
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
  /** Characters per line (per column with two): the text's width, the same with or without the sidebar (2026-10-14). */
  textWidth: number;
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
  /** The chapter scrolls instead of turning pages (the web's own; one column). */
  scroll: boolean;
  /** Where the text sits in the reading pane (the web's own). */
  position: TextPosition;
}

export type TextPosition = "left" | "centre" | "right";

const BLACK = 0xff000000 | 0;
const WHITE = 0xffffffff | 0;
const NEAR_WHITE = 0xfff2f2f2 | 0;

/** The app's defaults, for any field a look leaves out. */
const DEFAULT: Omit<Look, "id" | "name"> = {
  background: "Oled", backgroundColor: BLACK, textColor: 0xffe6d8b0 | 0, font: "Bookerly", fontWeight: 400,
  fontSize: 1.0, lineHeight: 1.5, textWidth: 70, letterSpacing: 0, wordSpacing: 0,
  paragraphSpacing: null, paragraphIndent: null, justify: true, hyphens: true, columns: 1,
  scroll: false, position: "centre",
};

/** Web's looks to start with: quiet, for an office. */
export const WEB_LOOKS: Look[] = [
  { ...DEFAULT, id: "office", name: "Office", background: "Custom", backgroundColor: WHITE, textColor: 0xff1f1f1f | 0 },
  { ...DEFAULT, id: "office-dark", name: "Office dark", background: "Custom", backgroundColor: 0xff121212 | 0, textColor: 0xffc9c9c9 | 0 },
];

export function withDefaults(look: Partial<Look> & { id: string }): Look {
  return { ...DEFAULT, name: look.id, ...look } as Look;
}

/** Custom's id: Aa's changes, kept until saved, replaced or removed (the app's Looks.CUSTOM_ID). */
export const CUSTOM_ID = "custom";
export const CUSTOM_NAME = "Custom";

/** The bar's, the Library's and the panels' colours (not the page's: that's the look). */
export type Chrome = "light" | "dark";

/** A style's look in use and its Custom (WEB.md → One app, two styles: Home and Office each have their own). */
export interface StyleLook {
  lookId: string;
  custom: Look | null;
  customFrom: string | null;
}

/**
 * Web's setup (`/Apps/Read/Sync/devices/Web/setup.json`): its looks, the one in use, Custom, the
 * fonts, the Library's grouping. As the file has it, `lookId`, `custom` and `customFrom` are
 * Office's and `homeLook` Home's; as the page sees it ([forStyle]), they're the style's in use
 * and `homeLook` the other one's.
 */
export interface Setup {
  looks: Look[];
  /** A saved look's id, or [CUSTOM_ID] while Custom is in use. */
  lookId: string;
  /** Aa's changes: one Custom at a time; changing another look makes a new one. */
  custom: Look | null;
  /** The look Custom was made from: where Custom › Remove goes back to. */
  customFrom: string | null;
  /** Downloaded fonts removed from this list (their files stay in Dropbox; Download brings them back). */
  removedFonts: string[];
  /** Series of two or more books are one row in the Library. */
  groupSeries: boolean;
  /** The Library shows as a sidebar beside the reader (false: hidden). */
  sidebar: boolean;
  /** The sidebar's width, dragged by its edge (page pixels). */
  sidebarWidth: number;
  /** Home's Library: the view, the sort, the sizes, Details' columns (WEB.md → Home). */
  home: HomeSetup;
  /** The other style's look in use (in the file: Home's). */
  homeLook: StyleLook;
  /** Light or Dark around the page, each style its own. */
  chrome: { home: Chrome; office: Chrome };
  version: 1;
}

export const DEFAULT_SETUP: Setup = {
  looks: WEB_LOOKS, lookId: "office", custom: null, customFrom: null, removedFonts: [], groupSeries: true, sidebar: true, sidebarWidth: 320, home: DEFAULT_HOME,
  homeLook: { lookId: "office", custom: null, customFrom: null }, chrome: { home: "dark", office: "light" }, version: 1,
};

/** The setup as the page sees it in Home (true) or Office: the look in use is that style's. Its own inverse. */
export function forStyle(setup: Setup, home: boolean): Setup {
  if (!home) return setup;
  const { lookId, custom, customFrom } = setup.homeLook;
  return { ...setup, lookId, custom, customFrom, homeLook: { lookId: setup.lookId, custom: setup.custom, customFrom: setup.customFrom } };
}

/** Setup as the file had it before Custom: Aa's changes were `page`. */
type SetupFile = Partial<Setup> & { page?: Partial<Look> & { id: string } };
type LookFile = { lookId?: unknown; custom?: unknown; customFrom?: unknown; page?: Partial<Look> & { id: string } };

/** A style's look in use as the file has it; a look no longer there is the first. */
function decodeStyleLook(raw: LookFile, looks: Look[]): StyleLook {
  const saved = looks.some(l => l.id === raw.lookId) ? raw.lookId as string : looks[0].id;
  let custom = raw.custom && typeof raw.custom === "object" ? asCustom(withDefaults({ ...(raw.custom as Partial<Look>), id: CUSTOM_ID })) : null;
  let customFrom = typeof raw.customFrom === "string" ? raw.customFrom : null;
  let lookId = raw.lookId === CUSTOM_ID && custom ? CUSTOM_ID : saved;
  // An older file's changes to the look in use are Custom now.
  if (!custom && raw.page && typeof raw.page.id === "string") {
    const page = withDefaults(raw.page);
    if (differs(page, looks.find(l => l.id === saved)!)) {
      custom = asCustom(page);
      customFrom = saved;
      lookId = CUSTOM_ID;
    }
  }
  return { lookId, custom, customFrom };
}

const chromeOf = (value: unknown, otherwise: Chrome): Chrome => (value === "light" || value === "dark" ? value : otherwise);

/** The setup file's text, read leniently: anything missing or unreadable is the default. */
export function decodeSetup(text: string | null): Setup {
  try {
    const raw = JSON.parse(text ?? "") as SetupFile;
    const looks = (raw.looks ?? []).filter(l => l && typeof l.id === "string" && l.id !== CUSTOM_ID).map(withDefaults);
    if (!looks.length) return DEFAULT_SETUP;
    const office = decodeStyleLook(raw, looks);
    // Before Home had its own look (2026-10-15), both used Office's: Home starts with it.
    const homeLook = raw.homeLook && typeof raw.homeLook === "object" ? decodeStyleLook(raw.homeLook as LookFile, looks) : office;
    const chrome = (raw.chrome ?? {}) as Partial<Record<"home" | "office", unknown>>;
    const officeLook = (office.lookId === CUSTOM_ID ? office.custom : looks.find(l => l.id === office.lookId)) ?? looks[0];
    return {
      looks,
      ...office,
      removedFonts: Array.isArray(raw.removedFonts) ? raw.removedFonts.filter(f => typeof f === "string") : [],
      groupSeries: raw.groupSeries !== false,
      sidebar: raw.sidebar !== false,
      sidebarWidth: sidebarWidth(raw.sidebarWidth ?? SIDEBAR.normal),
      home: decodeHome(raw.home),
      homeLook,
      // Office's chrome took its look's colours before it had its own: it starts as Light or Dark as that look is.
      chrome: { home: chromeOf(chrome.home, "dark"), office: chromeOf(chrome.office, isLight(officeLook) ? "light" : "dark") },
      version: 1,
    };
  } catch {
    return DEFAULT_SETUP;
  }
}

/** The sidebar's width: 240 to 520 pixels, 320 to start with. */
export const SIDEBAR = { min: 240, max: 520, normal: 320 };

export function sidebarWidth(width: number): number {
  return Number.isFinite(width) ? Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, width))) : SIDEBAR.normal;
}

/** The space beside the page's arrows: the page's ‹ › take this much on each side. */
export const ARROW_SPACE = 40;

/** Readium's gutter inside the page, in pixels: twice this is the gap between two columns. */
export const GUTTER_PX = 20;

/** The page's text at size 100% (Readium's, the browser's default size). */
export const BASE_FONT_PX = 16;

/**
 * One character's average width in pixels: [sampleWidth] measured for [sample] in the look's font
 * at its size, with the look's letter and word spacing (both in ems, as Readium takes them).
 */
export function charWidth(sampleWidth: number, sample: string, look: Pick<Look, "fontSize" | "letterSpacing" | "wordSpacing">): number {
  const px = BASE_FONT_PX * look.fontSize;
  const spaces = (sample.match(/\s/g) ?? []).length;
  return (sampleWidth + look.letterSpacing * px * sample.length + look.wordSpacing * px * spaces) / sample.length;
}

/**
 * Where the page goes in a reading pane [paneWidth] wide: its width (the look's characters per
 * line in each column, with Readium's gutters) and the space left and right of it, where the ‹ ›
 * are. A pane too narrow for it narrows the text; the arrows always keep their space when there's
 * room. Centre: even; Left or Right: the arrow's space on that side and the rest on the other.
 */
export function pageLayout(paneWidth: number, look: Pick<Look, "textWidth" | "columns" | "scroll" | "position">, charPx: number): { page: number; left: number; right: number } {
  const columns = look.scroll ? 1 : look.columns;
  const wanted = Math.round(columns * (look.textWidth * charPx + 2 * GUTTER_PX));
  const page = Math.max(Math.min(200, paneWidth), Math.min(wanted, paneWidth - 2 * ARROW_SPACE));
  const spare = Math.max(0, paneWidth - page);
  const edge = Math.min(ARROW_SPACE, spare / 2);
  if (look.position === "left") return { page, left: edge, right: spare - edge };
  if (look.position === "right") return { page, left: spare - edge, right: edge };
  return { page, left: spare / 2, right: spare / 2 };
}

const asCustom = (look: Look): Look => ({ ...look, id: CUSTOM_ID, name: CUSTOM_NAME });

/** Two looks differ in more than their names. */
function differs(a: Look, b: Look): boolean {
  return JSON.stringify({ ...a, id: "", name: "" }) !== JSON.stringify({ ...b, id: "", name: "" });
}

export function customInUse(setup: Setup): boolean {
  return setup.lookId === CUSTOM_ID && setup.custom != null;
}

/** What you see: Custom while it's in use, else the look in use. */
export function shown(setup: Setup): Look {
  if (customInUse(setup)) return setup.custom!;
  return setup.looks.find(l => l.id === setup.lookId) ?? setup.looks[0];
}

/** The look a new Custom comes from, or Custom's own: the name Save as… suggests. */
function baseName(setup: Setup): string {
  const from = customInUse(setup) ? setup.customFrom : setup.lookId;
  return setup.looks.find(l => l.id === from)?.name ?? "Look";
}

/**
 * Aa: Custom changes; the saved looks don't. A change to a saved look makes Custom from it (the
 * previous Custom goes); a change that leaves the look as it is makes nothing.
 */
export function edit(setup: Setup, change: Partial<Look>): Setup {
  const next = { ...shown(setup), ...change };
  if (customInUse(setup)) return { ...setup, custom: asCustom(next) };
  if (!differs(next, shown(setup))) return setup;
  return { ...setup, custom: asCustom(next), customFrom: shown(setup).id, lookId: CUSTOM_ID };
}

/** Using a look (or Custom): what you see becomes it. Custom stays among the looks until changed again. */
export function useLook(setup: Setup, id: string): Setup {
  if (id === CUSTOM_ID) return setup.custom ? { ...setup, lookId: CUSTOM_ID } : setup;
  return setup.looks.some(l => l.id === id) ? { ...setup, lookId: id } : setup;
}

/** "Office 2", "Office 3"… not taken by another look (the app's saveName). */
export function saveName(base: string, looks: Look[]): string {
  const stem = base.replace(/ \d+$/, "").trim() || "Look";
  for (let n = 2; ; n++) if (!looks.some(l => sameName(l.name, `${stem} ${n}`))) return `${stem} ${n}`;
}

/** Custom › Save as…'s suggestion: the look it came from, numbered. */
export function suggestedName(setup: Setup): string {
  return saveName(baseName(setup), setup.looks);
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The look already called [name] (any case), which Save as… would replace. */
export function lookNamed(setup: Setup, name: string): Look | null {
  return setup.looks.find(l => sameName(l.name, name)) ?? null;
}

function newId(looks: Look[]): string {
  let n = 1;
  while (looks.some(l => l.id === `look${n}`)) n++;
  return `look${n}`;
}

/** Custom › Save as…: Custom becomes a look named [name] (a name taken replaces that look), in use. */
export function saveCustomAs(setup: Setup, name: string): Setup {
  const clean = name.trim();
  if (!setup.custom || !canSaveAs(clean)) return setup;
  const taken = lookNamed(setup, clean);
  if (taken) return replaceWithCustom(setup, taken.id);
  const look = { ...setup.custom, id: newId(setup.looks), name: clean };
  return { ...setup, looks: [...setup.looks, look], lookId: look.id, custom: null, customFrom: null };
}

/** A look's Replace with Custom: the look takes Custom's settings (its name stays) and is used; Custom goes. */
export function replaceWithCustom(setup: Setup, id: string): Setup {
  const custom = setup.custom;
  if (!custom || !setup.looks.some(l => l.id === id)) return setup;
  const looks = setup.looks.map(l => l.id === id ? { ...custom, id: l.id, name: l.name } : l);
  return { ...setup, looks, lookId: id, custom: null, customFrom: null };
}

export interface RemovedCustom { custom: Look; from: string | null; inUse: boolean }

/** Custom › Remove: Custom goes; if it was in use, the look it came from is (or the first). */
export function removeCustom(setup: Setup): { setup: Setup; removed: RemovedCustom } | null {
  if (!setup.custom) return null;
  const inUse = customInUse(setup);
  const back = setup.looks.some(l => l.id === setup.customFrom) ? setup.customFrom! : setup.looks[0].id;
  return {
    setup: { ...setup, custom: null, customFrom: null, lookId: inUse ? back : setup.lookId },
    removed: { custom: setup.custom, from: setup.customFrom, inUse },
  };
}

/** Undo of Custom › Remove (a Custom made meanwhile is the newer one and stays). */
export function restoreCustom(setup: Setup, removed: RemovedCustom): Setup {
  if (setup.custom) return setup;
  return { ...setup, custom: removed.custom, customFrom: removed.from, lookId: removed.inUse ? CUSTOM_ID : setup.lookId };
}

/** A name Save as… can use: not empty, not Custom's (a look's name replaces that look). */
export function canSaveAs(name: string): boolean {
  return name.trim() !== "" && !sameName(name, CUSTOM_NAME);
}

/** A look can take [name]: Save as…'s rule, and no other look has it. */
export function canRename(setup: Setup, id: string, name: string): boolean {
  const taken = lookNamed(setup, name);
  return canSaveAs(name) && (!taken || taken.id === id);
}

export function renameLook(setup: Setup, id: string, name: string): Setup {
  if (!canRename(setup, id, name)) return setup;
  return { ...setup, looks: setup.looks.map(l => l.id === id ? { ...l, name: name.trim() } : l) };
}

/** Why a look can't be removed, or null: the look in use and the last one stay. */
export function cantRemove(setup: Setup, id: string): string | null {
  if (setup.looks.length <= 1) return "The last look stays.";
  if (id === setup.lookId) return "Use another look first.";
  if (id === setup.homeLook.lookId) return "The other style (Home or Office) uses it.";
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
  const look = setup.looks.some(l => l.id === removed.id) ? { ...removed, id: newId(setup.looks) } : removed;
  const looks = [...setup.looks];
  looks.splice(Math.min(index, looks.length), 0, look);
  return { ...setup, looks };
}

// --- Fonts kept in the list ---

/** Bookerly and Literata are always there; the downloaded ones can be removed from the list. */
export const BUILT_IN_FONTS = ["Bookerly", "Literata"];

/** The sans fonts (the catalogue's kinds, FontCatalog.kt); everything else is listed under Serif. */
export const SANS_FONTS = new Set(["Jost", "Atkinson Hyperlegible Next", "IBM Plex Sans", "Figtree"]);

/**
 * Remove: [family] goes from Text's list (its files stay in Dropbox); the looks and Custom that
 * used it use Bookerly. Returns which did, for Undo.
 */
export function removeFont(setup: Setup, family: string): { setup: Setup; switched: string[] } | null {
  if (BUILT_IN_FONTS.includes(family) || setup.removedFonts.includes(family)) return null;
  const switched = [...setup.looks, ...(setup.custom ? [setup.custom] : [])].filter(l => l.font === family).map(l => l.id);
  const swap = (l: Look) => l.font === family ? { ...l, font: "Bookerly" } : l;
  return {
    setup: {
      ...setup, looks: setup.looks.map(swap), custom: setup.custom && swap(setup.custom), removedFonts: [...setup.removedFonts, family],
      homeLook: { ...setup.homeLook, custom: setup.homeLook.custom && swap(setup.homeLook.custom) },
    },
    switched,
  };
}

/** Undo of Remove, or Download of a removed font: back in the list (Undo: and in the looks that had it). */
export function restoreFont(setup: Setup, family: string, switched: string[] = []): Setup {
  const back = (l: Look) => switched.includes(l.id) && l.font === "Bookerly" ? { ...l, font: family } : l;
  return {
    ...setup,
    looks: setup.looks.map(back),
    custom: setup.custom && back(setup.custom),
    homeLook: { ...setup.homeLook, custom: setup.homeLook.custom && back(setup.homeLook.custom) },
    removedFonts: setup.removedFonts.filter(f => f !== family),
  };
}

// --- Steps (the app's DisplaySteps) ---

export interface Steps { min: number; max: number; step: number; def: number }

export const STEPS = {
  fontSize: { min: 0.6, max: 2.5, step: 0.1, def: 1.0 },
  textWidth: { min: 60, max: 100, step: 5, def: 70 },
  lineHeight: { min: 1, max: 2, step: 0.1, def: 1.5 },
  letterSpacing: { min: 0, max: 0.2, step: 0.01, def: 0 },
  wordSpacing: { min: 0, max: 0.5, step: 0.05, def: 0 },
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

/**
 * Read.web's page colours (2026-10-15): the style's Interface, Light or Dark, as its chrome; the
 * looks' own colours stay in the file but aren't used on the web. Never pure white on dark (DESIGN).
 */
export const PAGE_COLOURS: Record<"home" | "office", Record<Chrome, { background: number; text: number }>> = {
  home: { dark: { background: BLACK, text: 0xffc9b27c | 0 }, light: { background: 0xfffbf8f2 | 0, text: 0xff2b2318 | 0 } },
  office: { light: { background: WHITE, text: 0xff1f1f1f | 0 }, dark: { background: 0xff121212 | 0, text: 0xffc9c9c9 | 0 } },
};

/** [look] as the page shows it in Home (true) or Office with [chrome]: its colours the Interface's. */
export function inInterface(look: Look, home: boolean, chrome: Chrome): Look {
  const c = PAGE_COLOURS[home ? "home" : "office"][chrome];
  return { ...look, background: "Custom", backgroundColor: c.background, textColor: c.text };
}

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
    // The page is as wide as the look's text (pageLayout); Readium keeps only a small gutter, the gap between two columns.
    pageGutter: GUTTER_PX,
    letterSpacing: look.letterSpacing,
    wordSpacing: look.wordSpacing,
    paragraphSpacing: look.paragraphSpacing,
    paragraphIndent: look.paragraphIndent,
    textAlign: look.justify ? TextAlignment.justify : TextAlignment.left,
    hyphens: look.hyphens,
    columnCount: look.scroll ? 1 : look.columns,
    scroll: look.scroll,
    // No line-length limit of Readium's: the page's width (Text width) decides it.
    optimalLineLength: 40,
    minimalLineLength: 20,
    maximalLineLength: 2000,
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
