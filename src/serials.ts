// Serials on Home (WEB.md → Home, step 3a, agreed 2026-10-15). The web can't reach Royal Road or
// Patreon, so it shows the serials from what the phones put in Dropbox: the subscriptions file, each
// serial's chapter list (`chapters/<serial>.json`, written by the phone that checked) and its sync
// file. NEW, UNREAD and CAUGHT UP follow the phones' own rules (StoryRules.kt, LibraryState.kt).

import type { BookDetails } from "./details";
import { afterReset, CHAPTER_END, furthestOf, serialOrder, sinceSubscribed } from "./sync";

// --- The files ---

/** One chapter as a phone wrote it (SharedChapter in ChapterLists.kt). */
export interface SharedChapter {
  id: string;
  title: string;
  url: string;
  /** As the site gave it (ISO time). */
  published?: string | null;
  locked?: boolean;
  empty?: boolean;
  /** When a phone first showed it; 0: the serial came with it (never NEW); missing: not yet (NEW). */
  seenAt?: number | null;
  /** The stored chapter's size in bytes on the phone that wrote the list (step 3b). */
  length?: number | null;
}

/** `/Apps/Read/Sync/chapters/<serial>.json`. */
export interface ChapterList {
  bookId: string;
  /** The phone that wrote it, and when it last checked the site. */
  device: string;
  checkedAt?: number | null;
  chapters: SharedChapter[];
}

/** One serial in `/Apps/Read/Sync/subscriptions.json` (SubscriptionEntry in SubscriptionsSync.kt). */
export interface Subscription {
  bookId: string;
  url: string;
  title: string;
  author?: string | null;
  site?: string | null;
  removed?: boolean;
  /** When each chapter was first seen, on either phone (chapter id → time); the last 30 days only. */
  seen?: Record<string, number>;
  /** The chapter read to its end (CAUGHT UP), and when. */
  endChapterId?: string | null;
  endAt?: number | null;
  /** "Default", "Keep" or "Remove". */
  authorNotes?: string;
  /** When this subscription began (epoch ms; subscribing again moves it): nothing read before it counts (2026-10-23). */
  subscribedAt?: number | null;
}

export function parseSubscriptions(text: string | null): Subscription[] {
  if (!text) return [];
  const stories = (JSON.parse(text) as { stories?: Subscription[] }).stories;
  return Array.isArray(stories) ? stories.filter(s => s && typeof s.bookId === "string" && typeof s.title === "string") : [];
}

export function parseChapterList(text: string | null): ChapterList | null {
  if (!text) return null;
  const file = JSON.parse(text) as ChapterList;
  return file && typeof file.bookId === "string" && Array.isArray(file.chapters) ? file : null;
}

/** "rr" or "pt" from the file; told from the address in files from before 2026-10-04. */
export function siteName(sub: Pick<Subscription, "site" | "url">): string {
  const key = sub.site ?? (sub.url.toLowerCase().includes("patreon.com") ? "pt" : "rr");
  return key === "pt" ? "Patreon" : "Royal Road";
}

// --- The phones' rules ---

/** How long a chapter stays NEW after it was first seen in the Serials list. */
export const NEW_FOR_MS = 24 * 60 * 60_000;

/** "ch/678.xhtml" → "678". */
export function chapterIdOf(href: string): string | null {
  if (!href.includes("ch/")) return null;
  const id = href.split("#")[0].split("/").pop()!.replace(/\.xhtml$/, "");
  return id || null;
}

/** The chapter a place's href is in: its index in [ids], or null. */
export function currentChapterIndex(ids: string[], href: string | null | undefined): number | null {
  const id = href ? chapterIdOf(href.replace(/\\\//g, "/")) : null;
  const at = id == null ? -1 : ids.indexOf(id);
  return at >= 0 ? at : null;
}

/**
 * The chapters still NEW at [now]: not yet seen on either phone, or seen less than [NEW_FOR_MS] ago.
 * A chapter counts as seen at the earlier of the list's time and the subscriptions file's.
 */
export function freshIndexes(chapters: SharedChapter[], now: number, seen: Record<string, number> = {}): Set<number> {
  const fresh = new Set<number>();
  chapters.forEach((c, i) => {
    const times = [c.seenAt, seen[c.id]].filter((t): t is number => typeof t === "number");
    const at = times.length ? Math.min(...times) : null;
    if (at == null || now - at < NEW_FOR_MS) fresh.add(i);
  });
  return fresh;
}

/** Where a reader is in a serial's chapters (StoryProgress in StoryRules.kt). */
export interface StoryProgress {
  chapterCount: number;
  currentIndex: number | null;
  /** Readable chapters after the current one; not started: all of them. */
  unreadCount: number;
  /** Unread chapters still NEW: the "N NEW" tag. */
  newCount: number;
  /** Unread chapters that aren't NEW any more: the "N UNREAD" tag beside "N NEW". */
  olderUnreadCount: number;
  isNew(index: number): boolean;
  isRead(index: number): boolean;
}

/** [unreadable]: Patreon's locked and empty posts, never unread or NEW. [fresh]: [freshIndexes]. */
export function storyProgress(chapterCount: number, currentIndex: number | null, unreadable: Set<number> = new Set(), fresh: Set<number> = new Set()): StoryProgress {
  const first = currentIndex == null ? 0 : currentIndex + 1;
  const isNew = (i: number) => fresh.has(i) && i >= first && !unreadable.has(i);
  let unreadCount = 0;
  let newCount = 0;
  for (let i = first; i < chapterCount; i++) {
    if (!unreadable.has(i)) unreadCount++;
    if (isNew(i)) newCount++;
  }
  return {
    chapterCount, currentIndex, unreadCount, newCount, olderUnreadCount: unreadCount - newCount,
    isNew, isRead: i => currentIndex != null && i < currentIndex,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** A day in [timeZone] (the browser's own when not given). */
function dayOf(at: number, timeZone?: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/**
 * When the site posted a chapter, as the phones say it: "45 min ago", "8 h ago", "3 days ago", then
 * "12 Sept" within the year, then "Jan 2025"; [compact]: "8 h", "3 d", "12.9.", "1/2025". Null when
 * there's no date or it can't be read.
 */
export function chapterDateLabel(published: string | null | undefined, now: number, compact = false, timeZone?: string): string | null {
  if (!published || !/^\d{4}-\d\d-\d\dT/.test(published)) return null;
  const at = Date.parse(published);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return compact ? `${minutes} min` : `${minutes} min ago`;
  if (minutes < 24 * 60) return compact ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ago`;
  if (minutes < 7 * 24 * 60) {
    const days = Math.floor(minutes / (24 * 60));
    return compact ? `${days} d` : days === 1 ? "1 day ago" : `${days} days ago`;
  }
  const date = dayOf(at, timeZone);
  if (date.y === dayOf(now, timeZone).y) return compact ? `${date.d}.${date.m}.` : `${date.d} ${MONTHS[date.m - 1]}`;
  return compact ? `${date.m}/${date.y}` : `${MONTHS[date.m - 1]} ${date.y}`;
}

// --- Places ---

type SyncPlace = { href?: string; progression?: number; timestamp?: number; deviceName?: string; locator?: { href?: unknown } };

/**
 * How far a serial has been read (its sync file): the furthest read's chapter index, when, and on
 * which device (2026-10-20: kept in the file, so a device going back doesn't lower it). A furthest
 * read in a chapter no longer listed: the furthest device's place in a listed one.
 */
export function furthestPlace(syncFile: { positions?: Record<string, SyncPlace>; reset?: unknown } | null, ids: string[]): { index: number; at: number; device: string } | null {
  const f = furthestOf(syncFile, serialOrder(ids));
  const fIndex = f ? currentChapterIndex(ids, f.href) : null;
  if (f && fIndex != null) return { index: fIndex, at: f.timestamp, device: f.deviceName };
  let best: { index: number; progression: number; at: number; device: string } | null = null;
  for (const [key, p] of Object.entries(afterReset(syncFile)?.positions ?? {})) {
    const href = p.href ?? (typeof p.locator?.href === "string" ? p.locator.href : null);
    const index = currentChapterIndex(ids, href);
    if (index == null) continue;
    const progression = p.progression ?? 0;
    if (!best || index > best.index || (index === best.index && progression > best.progression)) {
      best = { index, progression, at: p.timestamp ?? 0, device: p.deviceName || key };
    }
  }
  return best && { index: best.index, at: best.at, device: best.device };
}

/** When the serial was last read on any device. */
export function lastReadAt(syncFile: { positions?: Record<string, SyncPlace>; reset?: unknown } | null): number | null {
  const times = Object.values(afterReset(syncFile)?.positions ?? {}).map(p => p.timestamp ?? 0).filter(t => t > 0);
  return times.length ? Math.max(...times) : null;
}

// --- Home's serials ---

/** A serial as Home shows it. */
export interface Serial {
  id: string;
  title: string;
  author: string | null;
  site: string;
  url: string;
  /** The site's chapters in its order; empty until a phone has written the list. */
  chapters: SharedChapter[];
  progress: StoryProgress;
  /** The chapter being read (the furthest place on any device). */
  current: SharedChapter | null;
  caughtUp: boolean;
  /**
   * The chapter Continue opens: the current one, or the next when the current was read to its end
   * (the reader's own rule, nextAfterCaughtUp); the first when not started; null when caught up.
   */
  upNext: SharedChapter | null;
  /** The newest chapter that can be read. */
  latest: SharedChapter | null;
  /** When the newest readable chapter was posted (epoch ms). */
  updated: number | null;
  lastRead: number | null;
  /** The phone that last checked the site, and when. */
  checkedAt: number | null;
  device: string | null;
}

/** What the phones know of a serial's place: from its sync file. */
export interface SerialPlace {
  syncFile: { positions?: Record<string, SyncPlace>; reset?: unknown } | null;
}

const readable = (c: SharedChapter) => !c.locked && !c.empty;

/**
 * A chapter whose text is in Dropbox is yours whatever the site says now (2026-10-19: a Patreon
 * subscription that ended locks every post): it's readable, counted and opened like any other.
 */
export function heldChapters(chapters: SharedChapter[], inDropbox: Set<string> | undefined): SharedChapter[] {
  return inDropbox?.size ? chapters.map(c => (c.locked && inDropbox.has(c.id) ? { ...c, locked: false } : c)) : chapters;
}

/**
 * The subscribed serials (not unsubscribed), with their chapters, places and edited titles.
 * [inDropbox]: each serial's chapters whose text is in Dropbox (a locked post there is readable).
 */
export function homeSerials(subs: Subscription[], lists: Record<string, ChapterList | null>, places: Record<string, SerialPlace["syncFile"]>, details: Record<string, BookDetails>, now: number, inDropbox: Record<string, Set<string>> = {}): Serial[] {
  return subs.filter(s => !s.removed).map(sub => {
    const list = lists[sub.bookId] ?? null;
    const chapters = heldChapters(list?.chapters ?? [], inDropbox[sub.bookId]);
    const ids = chapters.map(c => c.id);
    // Subscribed again: places from the subscription before don't count (2026-10-23).
    const syncFile = sinceSubscribed(places[sub.bookId] ?? null, sub.subscribedAt);
    const place = furthestPlace(syncFile, ids);
    const unreadable = new Set(chapters.flatMap((c, i) => (readable(c) ? [] : [i])));
    const progress = storyProgress(chapters.length, place?.index ?? null, unreadable, freshIndexes(chapters, now, sub.seen));
    const current = place ? chapters[place.index] : null;
    const latest = [...chapters].reverse().find(readable) ?? null;
    const order = chapters.filter(readable);
    const caughtUp = current != null && progress.unreadCount === 0 && sub.endChapterId === current.id;
    const afterEnd = current ? nextAfterCaughtUp(order.map(c => c.id), current.id, sub.endChapterId) : null;
    const upNext = caughtUp ? null : !current ? order[0] ?? null : order.find(c => c.id === afterEnd) ?? current;
    const edited = details[sub.bookId];
    const updated = Date.parse(latest?.published ?? "");
    return {
      id: sub.bookId,
      title: edited?.title || sub.title,
      author: edited ? edited.author ?? null : sub.author ?? null,
      site: siteName(sub),
      url: sub.url,
      chapters,
      progress,
      current,
      // Caught up: the current chapter was read to its end and nothing readable comes after it.
      caughtUp,
      upNext,
      latest,
      updated: Number.isFinite(updated) ? updated : null,
      lastRead: lastReadAt(syncFile),
      checkedAt: list?.checkedAt ?? null,
      device: list?.device ?? null,
    };
  });
}

/** The serials whose title or author has [query]. */
export function searchSerials(serials: Serial[], query: string): Serial[] {
  const q = query.trim().toLocaleLowerCase();
  return q ? serials.filter(s => `${s.title} ${s.author ?? ""}`.toLocaleLowerCase().includes(q)) : serials;
}

/** The latest check of all, for the status line: when and on which phone. */
export function lastCheck(serials: Serial[]): { at: number; device: string } | null {
  const checked = serials.filter(s => s.checkedAt != null && s.device);
  if (!checked.length) return null;
  const last = checked.reduce((a, b) => (b.checkedAt! > a.checkedAt! ? b : a));
  return { at: last.checkedAt!, device: last.device! };
}

/** "4 new chapters", "1 new chapter", "No new chapters". */
export function newChaptersText(serials: Serial[]): string {
  const n = serials.reduce((k, s) => k + s.progress.newCount, 0);
  return n === 0 ? "No new chapters" : n === 1 ? "1 new chapter" : `${n} new chapters`;
}

/** A row of the panel's chapter list: a chapter, "··· 48 more" standing for the ones left out, or "··· 210 earlier" for those before. */
export type PanelRow = { chapter: SharedChapter; index: number } | { more: number } | { earlier: number };

/**
 * The chapters the panel lists, newest first down to the one before the current chapter (empty posts
 * left out). More than [fits] (2026-10-16): the four newest, "N more", then the next three, the current
 * chapter and the one before it, so both what's new and where you pick up show; [expanded] lists them all.
 * The chapters before those stand behind a last "··· N earlier" row (2026-10-20, so a place jumped past
 * by mistake can be found again); [earlierShown] lists them, newest first. Not started: the newest, then the first chapters.
 */
export function panelChapters(serial: Serial, expanded = false, fits = 12, earlierShown = false): PanelRow[] {
  const rows = serial.chapters.map((chapter, index) => ({ chapter, index })).filter(r => !r.chapter.empty).reverse();
  const at = serial.progress.currentIndex ?? -1;
  const upTo = rows.filter(r => r.index >= at - 1);
  if (!upTo.length) return rows.slice(0, fits);
  const before = rows.filter(r => r.index < at - 1);
  const tail: PanelRow[] = !before.length ? [] : earlierShown ? before : [{ earlier: before.length }];
  if (expanded || upTo.length <= fits) return [...upTo, ...tail];
  const bottom = upTo.filter(r => r.index <= at + 3);
  const top = upTo.slice(0, 4).filter(r => !bottom.includes(r));
  const more = upTo.length - top.length - bottom.length;
  return [...(more > 0 ? [...top, { more }, ...bottom] : [...top, ...bottom]), ...tail];
}

/** The reader's way back after a jump: "‹ Back to Chapter 212", or "‹ Back" when the place has no name. */
export function backLabel(where: string | null): string {
  return where ? `‹ Back to ${where}` : "‹ Back";
}

/** A chapter's name in the button: "Chapter 213" out of "Chapter 213: Ink and Stone"; other titles whole. */
export function shortChapter(title: string): string {
  return title.match(/^((?:chapter|ch\.?|book|part|episode|ep\.?)\s*[\d.]+[a-z]?)\b/i)?.[1] ?? title;
}

// --- Details' columns for serials ---

export type SerialColumnKey = "title" | "author" | "site" | "chapters" | "unread" | "updated" | "lastread";

export interface SerialColumn {
  key: SerialColumnKey;
  name: string;
  heading: string;
  /** 1: A to Z, oldest first; -1 the other way. A first click sorts this way. */
  firstDir: 1 | -1;
  /** Right-aligned (numbers). */
  right?: boolean;
}

export const SERIAL_COLUMNS: SerialColumn[] = [
  { key: "title", name: "Serial", heading: "Serial", firstDir: 1 },
  { key: "author", name: "Author", heading: "Author", firstDir: 1 },
  { key: "site", name: "Source", heading: "Source", firstDir: 1 },
  { key: "chapters", name: "Chapters", heading: "Chapters", firstDir: -1, right: true },
  { key: "unread", name: "Unread", heading: "Unread", firstDir: -1, right: true },
  // "Latest" (2026-10-18, the user's note): the date the newest chapter came out.
  { key: "updated", name: "Latest", heading: "Latest", firstDir: -1 },
  { key: "lastread", name: "Last read", heading: "Last read", firstDir: -1 },
];
export const serialColumn = (key: SerialColumnKey) => SERIAL_COLUMNS.find(c => c.key === key)!;
/**
 * Serials' Details, fixed (2026-10-17, evening; the latest and reading chapters went at the user's
 * call): the serial, author, source, the site's chapter count, the unread count, when the newest
 * chapter was published, last read.
 */
export const SERIAL_DETAIL_COLUMNS: SerialColumnKey[] = ["title", "author", "site", "chapters", "unread", "updated", "lastread"];

const sortKey = (text: string | null) => (text ?? "").replace(/^(the|a|an)\s+/i, "").toLocaleLowerCase();

function serialValue(s: Serial, col: SerialColumnKey): string | number | null {
  switch (col) {
    case "title": return sortKey(s.title);
    case "author": return s.author ? sortKey(s.author) : null;
    case "site": return s.site;
    case "chapters": return s.chapters.length || null;
    case "unread": return s.chapters.length ? s.progress.unreadCount : null;
    case "updated": return s.updated;
    case "lastread": return s.lastRead;
  }
}

/** The serials in [sort]'s order; nothing to sort by goes last, ties by title. */
export function sortSerials(serials: Serial[], sort: { key: SerialColumnKey; reversed: boolean }): Serial[] {
  const dir = serialColumn(sort.key).firstDir * (sort.reversed ? -1 : 1);
  return [...serials].sort((a, b) => {
    const x = serialValue(a, sort.key);
    const y = serialValue(b, sort.key);
    const byTitle = sortKey(a.title).localeCompare(sortKey(b.title));
    if (x == null || y == null) return x == null && y == null ? byTitle : x == null ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c * dir || byTitle;
  });
}

// --- Reading a serial on the web (WEB.md → Home, step 3b) ---

/** A chapter's href in the serial as a book, as the phones have it (StoryRules.chapterHref). */
export const chapterHref = (id: string) => `ch/${id}.xhtml`;

/** Until any chapter's size is known, chapters are taken to be about this long (the phones' DEFAULT_CHAPTER_BYTES). */
const DEFAULT_CHAPTER_BYTES = 12_000;

/** The chapters in the serial as a book: the readable ones (empty posts, and locked ones not in Dropbox, left out, as on the phones). */
export function readingOrderOf(chapters: SharedChapter[]): SharedChapter[] {
  return chapters.filter(readable);
}

/** Each chapter's size for Readium's page count: the known ones, the others their average (as the phones estimate). */
export function estimatedLengths(chapters: SharedChapter[]): number[] {
  const known = chapters.map(c => c.length).filter((n): n is number => typeof n === "number" && n > 0);
  const average = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : DEFAULT_CHAPTER_BYTES;
  return chapters.map(c => (typeof c.length === "number" && c.length > 0 ? c.length : average));
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The page for a chapter no phone has put in Dropbox yet: its title and a link to it on the site. */
export function missingChapterPage(title: string, url: string, site: string): string {
  const safe = escapeText(title);
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en"><head><meta charset="UTF-8"/><title>${safe}</title></head><body><h1>${safe}</h1><p>Not in Dropbox yet.</p><p><a href="${escapeText(url)}">Read it on ${escapeText(site)} ↗</a></p></body></html>`;
}

/** The phones' class on authors' notes in a stored chapter (RoyalRoad.kt's AUTHOR_NOTE_CLASS). */
export const AUTHOR_NOTE_CLASS = "read-author-note";

/** Whether a serial's authors' notes show: its own setting, or for Default the phones' setting. */
export function keepsNotes(sub: Pick<Subscription, "authorNotes"> | undefined, phonesKeep: boolean): boolean {
  return sub?.authorNotes === "Keep" ? true : sub?.authorNotes === "Remove" ? false : phonesKeep;
}

/** The phones' "keep author notes" setting, from the newest setup backup; off when none says. */
export function phonesKeepNotes(backups: { savedAt?: number; settings?: Record<string, string> }[]): boolean {
  const newest = [...backups].filter(b => b.settings && "keepAuthorNotes" in b.settings).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0];
  return newest?.settings?.keepAuthorNotes === "true";
}

/**
 * Where a CAUGHT UP serial opens once newer chapters have come (SPEC → Subscriptions, 2026-10-12):
 * the first chapter after the one read to its end, when the place is still in that chapter; null
 * when it opens at its place.
 */
export function nextAfterCaughtUp(order: string[], placeId: string | null, endId: string | null | undefined): string | null {
  if (!placeId || placeId !== endId) return null;
  const at = order.indexOf(endId);
  return at >= 0 && at + 1 < order.length ? order[at + 1] : null;
}

/**
 * The subscriptions file with [bookId] marked read to the end of [chapterId] at [now] (CAUGHT UP):
 * that serial's end mark only, everything else as it was; null when a newer end is there already.
 */
/** [chapterId] null clears the end mark (Set as furthest read before it, 2026-10-20), with its time, so it wins on every device. */
export function withEndMark(text: string, bookId: string, chapterId: string | null, now: number): string | null {
  const file = JSON.parse(text) as { stories?: (Subscription & Record<string, unknown>)[] };
  const stories = file.stories ?? [];
  const entry = stories.find(s => s.bookId === bookId);
  if (!entry || (entry.endAt ?? 0) >= now) return null;
  if ((entry.endChapterId ?? null) === chapterId) return null;
  return JSON.stringify({ ...file, stories: stories.map(s => (s.bookId === bookId ? { ...s, endChapterId: chapterId, endAt: now } : s)) });
}

/** "Ch. 212 of 215", "Up to date · 188" or "Not started · 30" (the phones' StoryProgress.label). */
export function progressLabel(p: StoryProgress): string {
  if (p.currentIndex == null) return `Not started · ${p.chapterCount}`;
  if (p.unreadCount === 0) return `Up to date · ${p.chapterCount}`;
  return `Ch. ${p.currentIndex + 1} of ${p.chapterCount}`;
}

/** The serial read last on any device: Continue on Serials. */
export function lastReadSerial(serials: Serial[]): Serial | null {
  return serials.filter(s => s.lastRead != null && s.chapters.length).sort((a, b) => b.lastRead! - a.lastRead!)[0] ?? null;
}

/**
 * The chapters folder listed with its subfolders: the top-level files (the chapter lists) and, per
 * serial (lower case, as Dropbox's paths), the ids of the chapters whose text is there.
 */
export function chapterTextsListed<F extends { pathLower: string; name: string }>(files: F[], folder: string): { top: F[]; texts: Map<string, Set<string>> } {
  const base = folder.toLowerCase() + "/";
  const top: F[] = [];
  const texts = new Map<string, Set<string>>();
  for (const f of files) {
    if (!f.pathLower.startsWith(base)) continue;
    const parts = f.pathLower.slice(base.length).split("/");
    if (parts.length === 1) top.push(f);
    else if (parts.length === 2 && f.name.endsWith(".xhtml")) {
      if (!texts.has(parts[0])) texts.set(parts[0], new Set());
      texts.get(parts[0])!.add(f.name.slice(0, -".xhtml".length));
    }
  }
  return { top, texts };
}

/** Set as furthest read at [place] in a serial: does it come before the CAUGHT UP end mark [endChapterId]? Then the mark goes. */
export function setBeforeEnd(ids: string[], href: string, progression: number, endChapterId: string | null): boolean {
  if (!endChapterId) return false;
  const end = ids.indexOf(endChapterId);
  const at = currentChapterIndex(ids, href);
  if (end < 0 || at == null) return false;
  return at < end || (at === end && progression < CHAPTER_END);
}
