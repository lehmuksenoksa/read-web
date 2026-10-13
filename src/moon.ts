// Moon+ Reader's place in a book (SPEC → Sync → Moon+, WEB.md), read from its Dropbox sync file
// `/Books/.Moon+/Cache/<book file name, lowercase>.po`: one line, `1697567716184*33@0#10749:37.4%`
// (an id, the chapter, the part, the character, Moon+'s percentage). Read only ever reads these.
// The counting is the app's (sync/MoonPlus.kt), worked out on six books from four publishers.

import { flatToc, nameBlocks, type Book } from "./epub";
import { BOOKS_FOLDER } from "./paths";
import { positionFromLocator, type Position } from "./sync";

export interface MoonPlace {
  chapter: number;
  part: number;
  offset: number;
  percent: number;
}

export const MOON_FOLDER = `${BOOKS_FOLDER}/.Moon+/Cache`;
export const MOON_DEVICE_ID = "moon+";
export const MOON_DEVICE_NAME = "Moon+";
/** Further from Moon+'s percentage than this, its chapter and character are taken to be counted differently. */
export const MOON_TOLERANCE = 0.05;

const LINE = /^\s*\d+\*(\d+)@(\d+)#(\d+):(\d+(?:\.\d+)?)%\s*$/;

/** The place in a `.po` file's text; null for anything else. */
export function parseMoonPlace(text: string): MoonPlace | null {
  const m = LINE.exec(text.trim());
  if (!m) return null;
  const percent = Number(m[4]);
  if (!(percent >= 0 && percent <= 100)) return null;
  return { chapter: Number(m[1]), part: Number(m[2]), offset: Number(m[3]), percent };
}

export function isMoonPlacePath(path: string): boolean {
  const lower = path.toLowerCase();
  const folder = MOON_FOLDER.toLowerCase() + "/";
  return lower.startsWith(folder) && lower.endsWith(".po") && !lower.slice(folder.length).includes("/");
}

/** The book file name a Moon+ sync file is for, lowercase. */
export function moonBookName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase().replace(/\.po$/, "");
}

export const IMAGE = "￼";
export const PART_SIZE = 100_000;

const BLOCK = /<(p|h[1-6]|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*>/g;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  mdash: "—", ndash: "–", hellip: "…", shy: "­", eacute: "é", copy: "©",
};

function unescape(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return NAMED[code.toLowerCase()] ?? all;
  });
}

/** Paragraphs (and headings, list items…) and lone images, with where each starts in the markup. */
export function blocks(markup: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  for (const m of markup.matchAll(BLOCK)) {
    if (m[0].startsWith("<img")) {
      out.push({ at: m.index!, text: IMAGE });
      continue;
    }
    // Any kind of space (no-break ones too) counts as one, as in the app.
    const text = unescape(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (text) out.push({ at: m.index!, text });
  }
  return out;
}

export function imageOnly(markup: string): boolean {
  const b = blocks(markup);
  return b.length === 1 && b[0].text === IMAGE;
}

/** Moon+'s chapters as lists of reading-order indexes. */
export function chapters(count: number, isImageOnly: (i: number) => boolean, listed: (i: number) => boolean): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; ) {
    if (i + 1 < count && !listed(i + 1) && isImageOnly(i)) {
      out.push([i, i + 1]);
      i += 2;
    } else {
      out.push([i]);
      i += 1;
    }
  }
  return out;
}

/** A file's text in Moon+'s parts: split at the first paragraph after every [size] characters of markup. */
export function parts(markup: string, size = PART_SIZE): string[][] {
  const result: string[][] = [[]];
  let limit = size;
  for (const block of blocks(markup)) {
    if (block.at >= limit && result[result.length - 1].length) {
      result.push([]);
      while (limit <= block.at) limit += size;
    }
    result[result.length - 1].push(block.text);
  }
  return result;
}

export interface MoonTarget {
  /** The words from the top of Moon+'s page to the end of the paragraph (whole words, at most 120 characters). */
  highlight: string;
  before: string;
  /** The whole paragraph, to find it on the page. */
  paragraph: string;
  /** How far into the file. */
  progression: number;
}

const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);

export function target(markup: string, part: number, offset: number): MoonTarget | null {
  const all = parts(markup);
  if (part < 0 || part >= all.length) return null;
  const paragraphs = all[part];
  const text = paragraphs.join("\n\n");
  if (offset < 0 || offset > text.length) return null;
  let i = offset;
  while (i < text.length && !isWordChar(text[i])) i++;
  while (i > 0 && isWordChar(text[i - 1])) i--;
  let start = 0;
  for (const paragraph of paragraphs) {
    const end = start + paragraph.length;
    if (i <= end) {
      const at = Math.min(Math.max(i - start, 0), paragraph.length);
      const before = paragraph.slice(0, at).slice(-40).replace(/^\s+/, "");
      let highlight = paragraph.slice(at, at + 120);
      if (highlight.length < paragraph.length - at && highlight.includes(" ")) highlight = highlight.slice(0, highlight.lastIndexOf(" "));
      const size = (p: string[]) => p.reduce((sum, t) => sum + t.length + 2, 0);
      const earlier = all.slice(0, part).reduce((sum, p) => sum + size(p), 0);
      const whole = Math.max(1, all.reduce((sum, p) => sum + size(p), 0));
      return { highlight, before, paragraph, progression: (earlier + i) / whole };
    }
    start = end + 2;
  }
  return null;
}

// --- In the browser: Moon+'s place in an open book ---

/**
 * Moon+'s place ([line], saved [modified]) in [book], as a place to go to: the words at the top of
 * Moon+'s page and their paragraph; by Moon+'s percentage when they don't agree with it.
 */
export async function moonPosition(book: Book, line: string, modified: string): Promise<Position | null> {
  const place = parseMoonPlace(line);
  if (!place) return null;
  const order = book.readingOrder;
  const at = Date.parse(modified) || 0;
  const listed = new Set(flatToc(book.toc).map(({ entry }) => entry.href.split("#")[0]));
  const texts = new Map<number, string | null>();
  const read = async (i: number) => {
    if (!texts.has(i)) texts.set(i, await book.text(order[i]));
    return texts.get(i) ?? null;
  };
  const lonely = new Set<number>();
  for (let i = 0; i < order.length - 1; i++) {
    if (!listed.has(order[i + 1]) && imageOnly((await read(i)) ?? "")) lonely.add(i);
  }
  const groups = chapters(order.length, i => lonely.has(i), i => listed.has(order[i]));
  const fraction = place.percent / 100;
  const byPercent = () => {
    const found = [...book.positions].reverse().find(p => (p.locations.totalProgression ?? 0) <= fraction + 1e-9) ?? book.positions[0];
    return found ? positionFromLocator(found.serialize() as Record<string, unknown>, at, MOON_DEVICE_NAME) : null;
  };
  const group = groups[place.chapter];
  if (!group) return byPercent();
  const href = order[group[group.length - 1]];
  const markup = await read(group[group.length - 1]);
  const t = markup ? target(markup, place.part, place.offset) : null;
  if (!markup || !t) return byPercent();
  const inFile = book.positions.map((p, i) => ({ p, i })).filter(({ p }) => p.href === href);
  const start = inFile[0]?.p.locations.totalProgression ?? 0;
  const end = book.positions[(inFile[inFile.length - 1]?.i ?? -2) + 1]?.locations.totalProgression ?? 1;
  const total = start + t.progression * (end - start);
  if (Math.abs(total - fraction) > MOON_TOLERANCE) return byPercent();
  const selector = paragraphSelector(markup, t.paragraph);
  return positionFromLocator({
    href, type: "application/xhtml+xml",
    locations: { progression: t.progression, totalProgression: total, ...(selector ? { cssSelector: selector } : {}) },
    text: { highlight: t.highlight, before: t.before },
  }, at, MOON_DEVICE_NAME);
}

/** The paragraph's name as the page names it (`#read-bN`, or its own id), so the reader finds it. */
function paragraphSelector(markup: string, paragraph: string): string | null {
  let doc = new DOMParser().parseFromString(markup, "application/xhtml+xml");
  if (doc.getElementsByTagName("parsererror").length) doc = new DOMParser().parseFromString(markup, "text/html");
  const body = doc.querySelector("body");
  if (!body) return null;
  nameBlocks(body, new Set(Array.from(doc.querySelectorAll("[id]")).map(el => el.id)));
  for (const el of Array.from(body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre"))) {
    if (el.id && (el.textContent ?? "").replace(/\s+/g, " ").trim() === paragraph) return `#${CSS.escape(el.id)}`;
  }
  return null;
}
