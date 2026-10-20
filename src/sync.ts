// The sync rules of the Read app (SPEC → Sync → Conflicts), ported from its Kotlin code
// (sync/PositionDecision.kt, sync/Positions.kt) so the web decides as the S23 and the Boox do.

/** One reading position, as the app's sync files hold it. The Readium locator is kept as it is. */
export interface Position {
  locator: Record<string, unknown>;
  href: string;
  /** Progress within the chapter, 0..1. */
  progression: number;
  /** Progress within the whole book, 0..1. */
  totalProgression: number;
  /** Epoch milliseconds. */
  timestamp: number;
  deviceName: string;
  /** The first words at the position, for the prompt. */
  snippet: string;
}

/** `/Apps/Read/Sync/<bookId>.json`. Only the fields the web reads; everything else is kept as it is when writing. */
export interface SyncFile {
  bookId: string;
  /** Keyed by device id. A device only ever writes its own entry. */
  positions: Record<string, Position>;
  [other: string]: unknown;
}

/** When the book was started over (Mark as unread on a phone, 2026-10-13); 0 if never. */
export function resetAt(file: object | null): number {
  const at = ((file as { reset?: { at?: unknown } } | null)?.reset)?.at;
  return typeof at === "number" ? at : 0;
}

/** Without the places saved before the book was started over: they don't count on any device. */
export function afterReset<T extends { positions?: Record<string, { timestamp?: number }> }>(file: T | null): T | null {
  const at = resetAt(file);
  if (!file || !at || !file.positions) return file;
  return { ...file, positions: Object.fromEntries(Object.entries(file.positions).filter(([, p]) => (p.timestamp ?? 0) > at)) };
}

/** The web's entry in the sync files: one device, "Web", whichever browser it is. */
export const WEB_DEVICE_ID = "web";
export const WEB_DEVICE_NAME = "Web";

/** Two positions within this much chapter progress count as the same place. */
export const SAME_POSITION_TOLERANCE = 0.005;

/** How much text a position carries for the prompt. */
export const SNIPPET_LENGTH = 80;

/** One chapter file, however its href was escaped ("chapter 2.xhtml" and "chapter%202.xhtml"). */
export function sameHref(a: string, b: string): boolean {
  const plain = (href: string) => { const base = href.split("#")[0]; try { return decodeURIComponent(base); } catch { return base; } };
  return plain(a) === plain(b);
}

/** Pagination differs per device, so compare the chapter and the progress within it. */
export function samePosition(a: Position, b: Position): boolean {
  return sameHref(a.href, b.href) && Math.abs(a.progression - b.progression) <= SAME_POSITION_TOLERANCE + 1e-9;
}

/**
 * How places in a book compare (the app's PlaceOrder): a book by its overall progress; a serial by
 * its chapter in the site's order, then the progress within it (report #81: each device estimates a
 * serial's overall progress from the chapters it has, so the estimates disagree).
 */
export interface PlaceOrder {
  /** Above zero when [a] is further on than [b]. */
  compare(a: Position, b: Position): number;
  same(a: Position, b: Position): boolean;
}

export const BOOK_ORDER: PlaceOrder = {
  compare: (a, b) => a.totalProgression - b.totalProgression,
  same: samePosition,
};

/** A place this far into a chapter counts as its end (the phones' end-of-chapter mark is 1.0). */
export const CHAPTER_END = 0.98;

/** A serial's chapters by id, in the site's order; the end of one chapter and the start of the next are the same place. */
export function serialOrder(chapterIds: string[]): PlaceOrder {
  const index = new Map(chapterIds.map((id, i) => [id, i]));
  const at = (p: Position) => {
    const id = p.href.split("#")[0].split("/").pop()!.replace(/\.xhtml$/, "");
    return p.href.includes("ch/") ? index.get(id) ?? null : null;
  };
  const endThenStart = (end: Position, start: Position) => {
    const ie = at(end);
    return ie != null && at(start) === ie + 1 && end.progression >= CHAPTER_END && start.progression <= SAME_POSITION_TOLERANCE + 1e-9;
  };
  return {
    compare: (a, b) => {
      const ia = at(a);
      const ib = at(b);
      // A chapter not in the list (gone from the site): the overall progress, as for a book.
      if (ia == null || ib == null) return BOOK_ORDER.compare(a, b);
      return ia !== ib ? ia - ib : a.progression - b.progression;
    },
    same: (a, b) => samePosition(a, b) || endThenStart(a, b) || endThenStart(b, a),
  };
}

export type Decision =
  | { kind: "stay" }
  | { kind: "jump"; position: Position }
  | { kind: "ask"; position: Position };

/** Ask when the other place is further on; stay when it's behind; jump when there's no place here yet. */
export function decide(mine: Position | null, other: Position, order: PlaceOrder = BOOK_ORDER): Decision {
  if (mine && order.same(mine, other)) return { kind: "stay" };
  if (!mine) return { kind: "jump", position: other };
  if (order.compare(other, mine) > 0) return { kind: "ask", position: other };
  return { kind: "stay" };
}

/** [decide], only for news: the other place must be newer than this device's last move and than a "Stay". */
export function resolve(mine: Position | null, other: Position, dismissedAt: number | null, order: PlaceOrder = BOOK_ORDER): Decision {
  if (mine && other.timestamp <= mine.timestamp) return { kind: "stay" };
  if (dismissedAt != null && other.timestamp <= dismissedAt) return { kind: "stay" };
  return decide(mine, other, order);
}

const furthestFirst = (order: PlaceOrder) => (a: Position, b: Position): number => order.compare(b, a) || b.timestamp - a.timestamp;

/**
 * Of the other devices' places, the one to compare with [mine]: the furthest of those that are
 * news; with none, the newest (which [resolve] lets be).
 */
export function otherToCompare(others: Position[], mine: Position | null, dismissedAt: number | null, order: PlaceOrder = BOOK_ORDER): Position | null {
  const news = others.filter(p => (!mine || p.timestamp > mine.timestamp) && (dismissedAt == null || p.timestamp > dismissedAt));
  if (news.length) return [...news].sort(furthestFirst(order))[0];
  return [...others].sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
}

// --- Furthest read (2026-10-20, the same rules as the phones' sync/Furthest.kt) ---

/**
 * The furthest any device has read or listened to in a book or serial, kept in its sync file as
 * `furthest`. [set]: set by hand (Set as furthest read), which may be behind what was read before.
 */
export interface Furthest extends Position {
  set?: boolean;
}

/** A place from a sync file as the web compares it, whatever the file left out. */
function asPlace(raw: unknown): Furthest | null {
  const p = raw as Partial<Position> & { set?: unknown; locator?: Record<string, unknown> } | null;
  if (!p || typeof p !== "object") return null;
  // A place the app wrote whole is used as it is.
  if (typeof p.href === "string" && typeof p.progression === "number" && typeof p.totalProgression === "number" && typeof p.timestamp === "number") return p as Furthest;
  const href = typeof p.href === "string" ? p.href : typeof p.locator?.href === "string" ? p.locator.href as string : null;
  if (!href) return null;
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
  return {
    locator: (p.locator ?? { href }) as Record<string, unknown>,
    href,
    progression: num(p.progression),
    totalProgression: num(p.totalProgression),
    timestamp: num(p.timestamp),
    deviceName: typeof p.deviceName === "string" ? p.deviceName : "",
    snippet: typeof p.snippet === "string" ? p.snippet : "",
    set: p.set === true,
  };
}

/**
 * Two furthest places merged: the newer one when it was set by hand; otherwise the further of the
 * two, the older kept when they're the same place (no churn). The phones merge the same way.
 */
export function mergeFurthest(a: Furthest | null, b: Furthest | null, order: PlaceOrder = BOOK_ORDER): Furthest | null {
  if (!a) return b;
  if (!b) return a;
  const [older, newer] = a.timestamp <= b.timestamp ? [a, b] : [b, a];
  if (newer.set) return newer;
  if (order.same(newer, older) || order.compare(newer, older) <= 0) return older;
  return newer;
}

/**
 * A sync file's furthest read: its `furthest` (when not from before a reset) merged with every
 * device's place since the reset, so a file from an older build without the field (or a place an
 * older build saved since) still counts. Null when nothing was read.
 */
export function furthestOf(file: object | null, order: PlaceOrder = BOOK_ORDER): Furthest | null {
  if (!file) return null;
  const at = resetAt(file);
  const field = asPlace((file as { furthest?: unknown }).furthest);
  let best = field && field.timestamp > at ? field : null;
  const positions = (file as { positions?: Record<string, unknown> }).positions ?? {};
  for (const raw of Object.values(positions)) {
    const p = asPlace(raw);
    // A device's own place never counts as set by hand.
    if (p && p.timestamp > at) best = mergeFurthest(best, p.set ? { ...p, set: false } : p, order);
  }
  return best;
}

/** What to do on opening a book: where to start, and the question to ask, if any. */
export interface OpeningPlan {
  start: Position | null;
  ask: Position | null;
}

/**
 * Opening a book on the web: at Web's own place; a book never read here opens at the furthest read;
 * when the furthest read is further on and news, it asks, naming the device that read it (2026-10-20).
 */
export function openingPlan(whole: SyncFile | null, dismissedAt: number | null = null, order: PlaceOrder = BOOK_ORDER): OpeningPlan {
  const file = afterReset(whole);
  const mine = file?.positions?.[WEB_DEVICE_ID] ?? null;
  const other = furthestOf(whole, order);
  if (!other) return { start: mine, ask: null };
  const decision = resolve(mine, other, dismissedAt, order);
  switch (decision.kind) {
    case "jump": return { start: decision.position, ask: null };
    case "ask": return { start: mine, ask: decision.position };
    default: return { start: mine, ask: null };
  }
}

/** The sync file with Web's place as this browser kept it, when Dropbox's is older or missing (an upload that didn't get through). */
export function withKeptPlace(file: SyncFile | null, bookId: string, kept: Position): SyncFile {
  const theirs = file?.positions[WEB_DEVICE_ID];
  if (file && theirs && theirs.timestamp >= kept.timestamp) return file;
  const base = file ?? { bookId, positions: {} };
  return { ...base, positions: { ...base.positions, [WEB_DEVICE_ID]: kept } };
}

/**
 * A book opened at the place this browser kept, without waiting for Dropbox (WEB.md → Kept in
 * this browser). When its sync file comes: Web's own place, newer from another browser, moves the
 * page if no page was turned yet; another device further on is asked about, as at any opening.
 */
export function afterKeptOpening(
  whole: SyncFile | null, bookId: string, kept: Position, moved: boolean, dismissedAt: number | null = null, order: PlaceOrder = BOOK_ORDER,
): { moveTo: Position | null; ask: Position | null; restart: boolean } {
  const file = afterReset(whole);
  // Started over on a phone since this browser kept its place: as if it had none.
  if (kept.timestamp <= resetAt(whole)) {
    const plan = openingPlan(file, dismissedAt, order);
    return { moveTo: moved ? null : plan.start, ask: plan.ask, restart: !moved && !plan.start };
  }
  const theirs = file?.positions[WEB_DEVICE_ID] ?? null;
  const moveTo = !moved && theirs && theirs.timestamp > kept.timestamp && !samePosition(theirs, kept) ? theirs : null;
  return { moveTo, ask: openingPlan(withKeptPlace(file, bookId, moveTo ?? kept), dismissedAt, order).ask, restart: false };
}

/** The first words, cut at a word boundary. */
export function snippet(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= SNIPPET_LENGTH) return clean;
  const cut = clean.slice(0, SNIPPET_LENGTH);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut) + "…";
}

/** A position for the sync file from a Readium locator's JSON. Null if the JSON is unusable. */
export function positionFromLocator(locator: Record<string, unknown>, timestamp: number, deviceName = WEB_DEVICE_NAME): Position | null {
  const href = typeof locator.href === "string" ? locator.href : null;
  if (!href) return null;
  const locations = (locator.locations ?? {}) as Record<string, unknown>;
  const text = (locator.text ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    locator,
    href,
    progression: num(locations.progression),
    totalProgression: num(locations.totalProgression),
    timestamp,
    deviceName,
    snippet: snippet(str(text.highlight) ?? str(text.after) ?? ""),
  };
}

/**
 * The sync file text with Web's own place put in, everything else as it was (other devices'
 * places, listening history, marks, fields the web doesn't know). [remote]: the file's text, or
 * null when there's none yet.
 */
export function withWebPlace(remote: string | null, bookId: string, place: Position, order: PlaceOrder = BOOK_ORDER): string {
  const file: Record<string, unknown> = remote ? JSON.parse(remote) : { bookId, positions: {}, history: [], version: 1 };
  const positions = { ...((file.positions as Record<string, Position> | undefined) ?? {}) };
  positions[WEB_DEVICE_ID] = place;
  // Reading on raises the furthest read; it never lowers it.
  const furthest = mergeFurthest(furthestOf(file, order), { ...place, set: false }, order);
  return JSON.stringify({ ...file, positions, ...(furthest ? { furthest } : {}) });
}

/** Set as furthest read: Web's place and the furthest read are [place], on every device (2026-10-20). */
export function withFurthestSet(remote: string | null, bookId: string, place: Position): string {
  const file: Record<string, unknown> = remote ? JSON.parse(remote) : { bookId, positions: {}, history: [], version: 1 };
  const positions = { ...((file.positions as Record<string, Position> | undefined) ?? {}) };
  positions[WEB_DEVICE_ID] = place;
  return JSON.stringify({ ...file, positions, furthest: { ...place, set: true } });
}

/** A book's marks as the phones keep them (SyncFile.kt): the newer of each wins between devices. */
export interface ReadMark { read: boolean | null; updatedAt: number }
export interface HiddenMark { hidden: boolean; updatedAt: number }
export interface Marks { read?: ReadMark; hidden?: HiddenMark; reset?: { at: number } }

/**
 * The sync file text with the book's menu choices put in (Mark as read / unread / Automatic, Hide /
 * Unhide), everything else as it was. Mark as unread is a reset mark and Automatic, as on the phones.
 */
export function withMarks(remote: string | null, bookId: string, marks: Marks): string {
  const file: Record<string, unknown> = remote ? JSON.parse(remote) : { bookId, positions: {}, history: [], version: 1 };
  return JSON.stringify({ ...file, ...marks });
}

/** The marks in a sync file, as far as they're there. */
export function marksOf(file: object | null): Marks {
  const f = (file ?? {}) as Record<string, unknown>;
  const read = f.read as ReadMark | null | undefined;
  const hidden = f.hidden as HiddenMark | null | undefined;
  return {
    ...(read && typeof read.updatedAt === "number" ? { read } : {}),
    ...(hidden && typeof hidden.updatedAt === "number" ? { hidden } : {}),
    ...(resetAt(file) ? { reset: { at: resetAt(file) } } : {}),
  };
}

/** "Chapter 3, 9%" style place for the prompt: the chapter's title when known, and the book's percentage. */
export function placeLabel(position: Position, chapterTitle: string | null): string {
  const percent = `${Math.round(position.totalProgression * 100)}%`;
  return chapterTitle ? `${chapterTitle}, ${percent}` : percent;
}
