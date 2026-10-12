// The phones' looks, from their setup backups in Dropbox (`/Apps/Read/Sync/devices/<device>/`),
// turned into Readium's page settings the way the app does (settings/Looks.kt,
// reader/ReaderPreferences.kt). Only read: nothing here is written anywhere.

import { TextAlignment, type IEpubPreferences } from "@readium/navigator";

export type Background = "Oled" | "Eink" | "Custom";

/** A look as the app stores it (only the fields the web uses). Colours are ARGB integers. */
export interface Look {
  id: string;
  name: string;
  background: Background;
  backgroundColor: number;
  textColor: number;
  /** "Bookerly", "Serif", or the family name of one of the device's own fonts. */
  font: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  margins: number;
  letterSpacing: number;
  wordSpacing: number;
  paragraphSpacing: number | null;
  paragraphIndent: number | null;
  justify: boolean;
  hyphens: boolean;
}

const BLACK = 0xff000000 | 0;
const WHITE = 0xffffffff | 0;
const NEAR_WHITE = 0xfff2f2f2 | 0;
const CREAM_DAY = 0xffe6d8b0 | 0;
const CREAM_NIGHT = 0xffc9b27c | 0;

/** The app's defaults: the backup leaves out every field still at its default. */
const DEFAULT: Omit<Look, "id" | "name"> = {
  background: "Oled", backgroundColor: BLACK, textColor: CREAM_DAY, font: "Bookerly", fontWeight: 400,
  fontSize: 1.0, lineHeight: 1.5, margins: 1.0, letterSpacing: 0, wordSpacing: 0,
  paragraphSpacing: null, paragraphIndent: null, justify: true, hyphens: true,
};

/** The app's own looks, for a device whose backup has none. */
export const DEFAULT_LOOKS: Look[] = [
  { ...DEFAULT, id: "day", name: "Day" },
  { ...DEFAULT, id: "night", name: "Night", textColor: CREAM_NIGHT },
  { ...DEFAULT, id: "eink", name: "E-ink", background: "Eink", textColor: BLACK },
];

/** The backup's "looks" value (a JSON list); the app's defaults when it's missing or unreadable. */
export function decodeLooks(text: string | undefined): Look[] {
  try {
    const list = JSON.parse(text ?? "") as Partial<Look>[];
    const looks = list.filter(l => l && typeof l.id === "string").map(l => ({ ...DEFAULT, name: l.id!, ...l }) as Look);
    if (looks.length) return looks;
  } catch {
    // The defaults, as the app does.
  }
  return DEFAULT_LOOKS;
}

/** One device's looks and the one it uses (its "lookId"). */
export interface DeviceLooks {
  device: string;
  looks: Look[];
  current: string;
}

export function deviceLooks(device: string, settings: Record<string, string>): DeviceLooks {
  const looks = decodeLooks(settings.looks);
  const current = looks.some(l => l.id === settings.lookId) ? settings.lookId : looks[0].id;
  return { device, looks, current };
}

/** A look's name in this browser: its device and id ("S23/night"). */
export function lookKey(device: string, look: Look): string {
  return `${device}/${look.id}`;
}

/** The look to show: the one picked in this browser, else the S23's own, else the first device's. */
export function chosenLook(devices: DeviceLooks[], picked: string | null): { device: string; look: Look } | null {
  for (const d of devices) {
    const look = d.looks.find(l => lookKey(d.device, l) === picked);
    if (look) return { device: d.device, look };
  }
  const first = devices.find(d => d.device === "S23") ?? devices[0];
  if (!first) return null;
  return { device: first.device, look: first.looks.find(l => l.id === first.current) ?? first.looks[0] };
}

/** "#rrggbb" of an ARGB integer (alpha dropped: pages are opaque). */
export function hex(argb: number): string {
  return "#" + ((argb >>> 0) & 0xffffff).toString(16).padStart(6, "0");
}

function luminance(argb: number): number {
  const channel = (shift: number) => {
    const v = ((argb >>> shift) & 0xff) / 255;
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

/** A light page (E-ink, a light colour) gets a light page around it. */
export function isLight(look: Look): boolean {
  return luminance(pageBackground(look)) > 0.4;
}

/** The text colour as shown: never pure white on a dark page (DESIGN). */
export function pageText(look: Look): number {
  const opaque = look.textColor | BLACK;
  return !isLight(look) && opaque === WHITE ? NEAR_WHITE : opaque;
}

/** Text size steps: the app's (60% to 250%, 10% a step). */
export const SIZE = { min: 0.6, max: 2.5, step: 0.1 };

export function stepSize(size: number, up: boolean): number {
  const next = size + (up ? SIZE.step : -SIZE.step);
  const onGrid = SIZE.min + Math.round((next - SIZE.min) / SIZE.step) * SIZE.step;
  return Math.round(Math.min(SIZE.max, Math.max(SIZE.min, onGrid)) * 1000) / 1000;
}

/** Readium's side margin at 1.0 (its default gutter, in pixels): the look's margins scale it, as in the app. */
const GUTTER_PX = 20;

/** Readium's page settings for [look], in the font family [fontFamily] (as declared for the page), at [size]. */
export function preferences(look: Look, fontFamily: string, size: number): IEpubPreferences {
  const text = hex(pageText(look));
  return {
    backgroundColor: hex(pageBackground(look)),
    textColor: text,
    linkColor: text,
    visitedColor: text,
    selectionBackgroundColor: isLight(look) ? "#c8c8c8" : "#5a3420",
    selectionTextColor: text,
    fontFamily,
    fontSize: size,
    fontWeight: look.fontWeight,
    lineHeight: look.lineHeight,
    pageGutter: Math.round(look.margins * GUTTER_PX),
    letterSpacing: look.letterSpacing,
    wordSpacing: look.wordSpacing,
    paragraphSpacing: look.paragraphSpacing,
    paragraphIndent: look.paragraphIndent,
    textAlign: look.justify ? TextAlignment.justify : TextAlignment.left,
    hyphens: look.hyphens,
    columnCount: 1,
    optimalLineLength: 62,
    maximalLineLength: 70,
  };
}

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

/** Bookerly's four files in `/Apps/Read/Fonts/` (copied there by the app). */
export const BOOKERLY_FILES: FontFileFace[] = [
  { file: "Bookerly-Regular.ttf", family: "Bookerly", weight: "400", italic: false },
  { file: "Bookerly-Bold.ttf", family: "Bookerly", weight: "700", italic: false },
  { file: "Bookerly-RegularItalic.ttf", family: "Bookerly", weight: "400", italic: true },
  { file: "Bookerly-BoldItalic.ttf", family: "Bookerly", weight: "700", italic: true },
];
