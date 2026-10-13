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

/** Pagination differs per device, so compare the chapter and the progress within it. */
export function samePosition(a: Position, b: Position): boolean {
  return a.href === b.href && Math.abs(a.progression - b.progression) <= SAME_POSITION_TOLERANCE + 1e-9;
}

export type Decision =
  | { kind: "stay" }
  | { kind: "jump"; position: Position }
  | { kind: "ask"; position: Position };

/** Ask when the other place is further on; stay when it's behind; jump when there's no place here yet. */
export function decide(mine: Position | null, other: Position): Decision {
  if (mine && samePosition(mine, other)) return { kind: "stay" };
  if (!mine) return { kind: "jump", position: other };
  if (other.totalProgression > mine.totalProgression) return { kind: "ask", position: other };
  return { kind: "stay" };
}

/** [decide], only for news: the other place must be newer than this device's last move and than a "Stay". */
export function resolve(mine: Position | null, other: Position, dismissedAt: number | null): Decision {
  if (mine && other.timestamp <= mine.timestamp) return { kind: "stay" };
  if (dismissedAt != null && other.timestamp <= dismissedAt) return { kind: "stay" };
  return decide(mine, other);
}

function furthestFirst(a: Position, b: Position): number {
  return b.totalProgression - a.totalProgression || b.timestamp - a.timestamp;
}

/**
 * Of the other devices' places, the one to compare with [mine]: the furthest of those that are
 * news; with none, the newest (which [resolve] lets be).
 */
export function otherToCompare(others: Position[], mine: Position | null, dismissedAt: number | null): Position | null {
  const news = others.filter(p => (!mine || p.timestamp > mine.timestamp) && (dismissedAt == null || p.timestamp > dismissedAt));
  if (news.length) return [...news].sort(furthestFirst)[0];
  return [...others].sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
}

/** What to do on opening a book: where to start, and the question to ask, if any. */
export interface OpeningPlan {
  start: Position | null;
  ask: Position | null;
}

/**
 * Opening a book on the web: at Web's own place; a book never read here opens at the furthest
 * place another device reached; when another device is further on, it asks.
 */
export function openingPlan(whole: SyncFile | null, dismissedAt: number | null = null): OpeningPlan {
  const file = afterReset(whole);
  const positions = file?.positions ?? {};
  const mine = positions[WEB_DEVICE_ID] ?? null;
  const others = Object.entries(positions).filter(([id]) => id !== WEB_DEVICE_ID).map(([, p]) => p);
  const other = otherToCompare(others, mine, dismissedAt);
  if (!other) return { start: mine, ask: null };
  const decision = resolve(mine, other, dismissedAt);
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
  whole: SyncFile | null, bookId: string, kept: Position, moved: boolean, dismissedAt: number | null = null,
): { moveTo: Position | null; ask: Position | null; restart: boolean } {
  const file = afterReset(whole);
  // Started over on a phone since this browser kept its place: as if it had none.
  if (kept.timestamp <= resetAt(whole)) {
    const plan = openingPlan(file, dismissedAt);
    return { moveTo: moved ? null : plan.start, ask: plan.ask, restart: !moved && !plan.start };
  }
  const theirs = file?.positions[WEB_DEVICE_ID] ?? null;
  const moveTo = !moved && theirs && theirs.timestamp > kept.timestamp && !samePosition(theirs, kept) ? theirs : null;
  return { moveTo, ask: openingPlan(withKeptPlace(file, bookId, moveTo ?? kept), dismissedAt).ask, restart: false };
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
export function withWebPlace(remote: string | null, bookId: string, place: Position): string {
  const file: Record<string, unknown> = remote ? JSON.parse(remote) : { bookId, positions: {}, history: [], version: 1 };
  const positions = { ...((file.positions as Record<string, Position> | undefined) ?? {}) };
  positions[WEB_DEVICE_ID] = place;
  return JSON.stringify({ ...file, positions });
}

/** "Chapter 3, 9%" style place for the prompt: the chapter's title when known, and the book's percentage. */
export function placeLabel(position: Position, chapterTitle: string | null): string {
  const percent = `${Math.round(position.totalProgression * 100)}%`;
  return chapterTitle ? `${chapterTitle}, ${percent}` : percent;
}
