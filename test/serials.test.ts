import { describe, expect, it } from "vitest";
import { decodeHome, DEFAULT_SERIALS } from "../src/home";
import { chapterListPath, isSerialId, isWritablePath, serialSyncPath } from "../src/paths";
import {
  chapterDateLabel, chapterHref, currentChapterIndex, estimatedLengths, freshIndexes, furthestPlace, homeSerials, keepsNotes, lastCheck, lastReadSerial,
  missingChapterPage, NEW_FOR_MS, newChaptersText, nextAfterCaughtUp, panelChapters, parseChapterList, shortChapter, parseSubscriptions, phonesKeepNotes,
  progressLabel, readingOrderOf, searchSerials, sortSerials, storyProgress, withEndMark,
  type ChapterList, type SharedChapter, type Subscription,
} from "../src/serials";

// The cases are StoryRulesTest.kt's and LibraryStateTest.kt's, so the web counts as the phones do.

describe("NEW and UNREAD, as on the phones", () => {
  it("counts the readable chapters after the current one; not started is all of them", () => {
    const p = storyProgress(215, 211);
    expect(p.unreadCount).toBe(3);
    expect(p.isRead(210)).toBe(true);
    expect(p.isRead(211)).toBe(false);
    expect(storyProgress(188, 187).unreadCount).toBe(0);
    expect(storyProgress(30, null).unreadCount).toBe(30);
  });

  it("NEW means come since it was seen, not just unread", () => {
    const p = storyProgress(215, 211, new Set(), new Set([213, 214]));
    expect(p.unreadCount).toBe(3);
    expect(p.newCount).toBe(2);
    expect(p.isNew(212)).toBe(false);
    expect(p.isNew(213)).toBe(true);
    expect(storyProgress(215, 213, new Set(), new Set([213, 214])).newCount).toBe(1);
    expect(storyProgress(30, null).newCount).toBe(0);
    // Locked posts are never new.
    expect(storyProgress(215, 211, new Set([214]), new Set([213, 214])).newCount).toBe(1);
  });

  it("is NEW until a day after it was seen, and UNREAD and NEW never count a chapter twice", () => {
    const now = 10 * NEW_FOR_MS;
    const c = (i: number, seenAt: number | null): SharedChapter => ({ id: `c${i}`, title: `Chapter ${i}`, url: "u", seenAt });
    const list = [
      c(0, 0), // came with the subscription
      c(1, now - NEW_FOR_MS - 1), // seen more than a day ago
      c(2, now - NEW_FOR_MS + 1), // seen less than a day ago
      c(3, null), // not seen yet, however long ago it came
    ];
    expect([...freshIndexes(list, now)]).toEqual([2, 3]);
    const p = storyProgress(60, 2, new Set(), new Set([57, 58, 59]));
    expect(p.newCount).toBe(3);
    expect(p.olderUnreadCount).toBe(54);
  });

  it("counts a chapter seen at the earlier of the list's time and the other phone's", () => {
    const now = 10 * NEW_FOR_MS;
    const list: SharedChapter[] = [{ id: "c1", title: "1", url: "u", seenAt: null }, { id: "c2", title: "2", url: "u", seenAt: now - 1000 }];
    expect([...freshIndexes(list, now, { c1: now - NEW_FOR_MS - 5 })]).toEqual([1]);
    expect([...freshIndexes(list, now, { c2: now - NEW_FOR_MS - 5 })]).toEqual([0]);
  });

  it("finds the place in Android's escaped JSON hrefs", () => {
    const ids = ["1001", "1002", "1003"];
    expect(currentChapterIndex(ids, "ch\\/1002.xhtml")).toBe(1);
    expect(currentChapterIndex(ids, "ch/1003.xhtml#x")).toBe(2);
    expect(currentChapterIndex(ids, null)).toBeNull();
    expect(currentChapterIndex(ids, "OEBPS/text.xhtml")).toBeNull();
  });
});

describe("Chapter dates, as the lists say them", () => {
  const now = Date.parse("2026-10-09T09:00:00Z");
  const at = (iso: string, compact = false) => chapterDateLabel(iso, now, compact, "Europe/Helsinki");

  it("reads like the phones'", () => {
    expect(at("2026-10-09T08:59:40Z")).toBe("just now");
    expect(at("2026-10-09T08:15:00Z")).toBe("45 min ago");
    expect(at("2026-10-09T01:00:00Z")).toBe("8 h ago");
    expect(at("2026-10-06T09:00:00Z")).toBe("3 days ago");
    expect(at("2026-10-08T09:00:00Z")).toBe("1 day ago");
    expect(at("2026-09-12T10:00:00Z")).toBe("12 Sept");
    expect(at("2025-01-20T10:00:00Z")).toBe("Jan 2025");
    expect(at("2026-10-09T08:15:00Z", true)).toBe("45 min");
    expect(at("2026-10-09T01:00:00Z", true)).toBe("8 h");
    expect(at("2026-10-06T09:00:00Z", true)).toBe("3 d");
    expect(at("2026-09-12T10:00:00Z", true)).toBe("12.9.");
    expect(at("2025-01-20T10:00:00Z", true)).toBe("1/2025");
    // Helsinki's day, not UTC's: 23:30 UTC on the 12th is the 13th there.
    expect(at("2026-09-12T23:30:00Z")).toBe("13 Sept");
    expect(chapterDateLabel(null, now)).toBeNull();
    expect(chapterDateLabel("yesterday", now)).toBeNull();
  });
});

const NOW = Date.parse("2026-10-15T12:00:00Z");
const chapters = (n: number, extra: (i: number) => Partial<SharedChapter> = () => ({})): SharedChapter[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${1001 + i}`, title: `Chapter ${i + 1}`, url: `https://www.royalroad.com/fiction/1/s/chapter/${1001 + i}`, published: new Date(NOW - (n - i) * 86_400_000).toISOString(), seenAt: 0, ...extra(i) }));
const list = (id: string, cs: SharedChapter[], device = "S23", checkedAt = NOW - 2 * 3_600_000): ChapterList => ({ bookId: id, device, checkedAt, chapters: cs });
const place = (href: string, progression: number, timestamp: number, deviceName: string) => ({ href, progression, totalProgression: 0, timestamp, deviceName, locator: {} });
const sub = (id: string, title: string, more: Partial<Subscription> = {}): Subscription => ({ bookId: id, url: `https://www.royalroad.com/fiction/${id}`, title, site: "rr", ...more });

describe("Serials on Home", () => {
  it("reads the furthest place on any device, after a start over", () => {
    const ids = ["a", "b", "c"];
    const file = { positions: { boox: place("ch/b.xhtml", 0.9, 10, "Boox"), s23: place("ch/c.xhtml", 0.1, 5, "S23"), web: place("ch/a.xhtml", 1, 20, "Web") } };
    expect(furthestPlace(file, ids)).toEqual({ index: 2, at: 5, device: "S23" });
    expect(furthestPlace({ ...file, reset: { at: 6 } }, ids)).toEqual({ index: 1, at: 10, device: "Boox" });
    expect(furthestPlace(null, ids)).toBeNull();
  });

  it("is CAUGHT UP only when the newest chapter was read to its end", () => {
    const cs = chapters(3);
    const sync = { positions: { s23: place("ch/1003.xhtml", 1, NOW, "S23") } };
    const item = (end: string | null, href = "ch/1003.xhtml") =>
      homeSerials([sub("rr-1", "Harbour", { endChapterId: end })], { "rr-1": list("rr-1", cs) }, { "rr-1": { positions: { s23: { ...sync.positions.s23, href } } } }, {}, NOW)[0];
    expect(item("1003").caughtUp).toBe(true);
    expect(item(null).caughtUp).toBe(false);
    expect(item("1002", "ch/1002.xhtml").caughtUp).toBe(false);
  });

  it("builds each serial from its list, its sync file and an edited title; unsubscribed ones are left out", () => {
    const cs = chapters(215, i => (i >= 213 ? { seenAt: i === 214 ? null : NOW - 3_600_000 } : {}));
    const serials = homeSerials(
      [sub("rr-1", "Dungeon Cartographer", { author: "Sample Author" }), sub("pt-x", "Gone", { removed: true }), sub("rr-2", "No list yet", { site: null, url: "https://www.patreon.com/x" })],
      { "rr-1": list("rr-1", cs) },
      { "rr-1": { positions: { s23: place("ch/1212.xhtml", 0.5, NOW - 7_200_000, "S23") } } },
      { "rr-1": { title: "Dungeon Cartographer (edited)", author: null } },
      NOW,
    );
    expect(serials.map(s => s.id)).toEqual(["rr-1", "rr-2"]);
    const [dc, none] = serials;
    expect(dc.title).toBe("Dungeon Cartographer (edited)");
    expect(dc.author).toBeNull();
    expect(dc.site).toBe("Royal Road");
    expect(dc.current?.title).toBe("Chapter 212");
    expect(dc.progress.newCount).toBe(2);
    expect(dc.progress.olderUnreadCount).toBe(1);
    expect(dc.latest?.title).toBe("Chapter 215");
    expect(dc.lastRead).toBe(NOW - 7_200_000);
    expect(none.site).toBe("Patreon");
    expect(none.chapters).toEqual([]);
    expect(none.progress.unreadCount).toBe(0);
    expect(newChaptersText(serials)).toBe("2 new chapters");
    expect(lastCheck(serials)).toEqual({ at: NOW - 2 * 3_600_000, device: "S23" });
  });

  it("skips locked and empty posts: never unread, never the latest", () => {
    const cs = chapters(4, i => ({ locked: i === 3, empty: i === 2, seenAt: null }));
    const [s] = homeSerials([sub("pt-c1", "Lanterns", { site: "pt" })], { "pt-c1": list("pt-c1", cs) }, {}, {}, NOW);
    expect(s.progress.unreadCount).toBe(2);
    expect(s.progress.newCount).toBe(2);
    expect(s.latest?.title).toBe("Chapter 2");
    // The panel lists newest first, empty posts left out.
    expect(panelChapters(s).map(r => r.chapter.title)).toEqual(["Chapter 4", "Chapter 2", "Chapter 1"]);
  });

  it("the panel lists down to the chapter before the one being read, at most twelve", () => {
    const cs = chapters(30);
    const [s] = homeSerials([sub("rr-1", "X")], { "rr-1": list("rr-1", cs) }, { "rr-1": { positions: { a: place("ch/1027.xhtml", 0, 1, "S23") } } }, {}, NOW);
    expect(panelChapters(s).map(r => r.index)).toEqual([29, 28, 27, 26, 25]);
    const [fresh] = homeSerials([sub("rr-1", "X")], { "rr-1": list("rr-1", cs) }, {}, {}, NOW);
    // Not started with more than twelve: the newest four, the rest left out, then the first three.
    expect(panelChapters(fresh).map(r => ("more" in r ? `+${r.more}` : r.index))).toEqual([29, 28, 27, 26, "+23", 2, 1, 0]);
  });

  it("a long backlog: the newest four, N more, then the next three, the current and the one before; expanded, all", () => {
    const cs = chapters(215);
    const places = { "rr-1": { positions: { a: place("ch/1160.xhtml", 0.5, 1, "S23") } } };
    const [s] = homeSerials([sub("rr-1", "X")], { "rr-1": list("rr-1", cs) }, places, {}, NOW);
    expect(s.progress.currentIndex).toBe(159);
    expect(panelChapters(s).map(r => ("more" in r ? `+${r.more}` : r.index))).toEqual([214, 213, 212, 211, "+48", 162, 161, 160, 159, 158]);
    expect(panelChapters(s, true)).toHaveLength(57);
    expect(panelChapters(s, true).every(r => !("more" in r))).toBe(true);
  });

  it("Continue names the chapter it opens: the current, the next after one read to its end, the first, none when caught up", () => {
    const cs = chapters(30);
    const at = (file: string) => ({ "rr-1": { positions: { a: place(file, 0.5, 1, "S23") } } });
    const [mid] = homeSerials([sub("rr-1", "X")], { "rr-1": list("rr-1", cs) }, at("ch/1027.xhtml"), {}, NOW);
    expect(mid.upNext?.id).toBe(mid.current?.id);
    const [ended] = homeSerials([sub("rr-1", "X", { endChapterId: mid.current!.id })], { "rr-1": list("rr-1", cs) }, at("ch/1027.xhtml"), {}, NOW);
    expect(ended.upNext?.id).toBe(cs[mid.progress.currentIndex! + 1].id);
    const [fresh] = homeSerials([sub("rr-1", "X")], { "rr-1": list("rr-1", cs) }, {}, {}, NOW);
    expect(fresh.upNext?.id).toBe(cs[0].id);
    const last = cs[29].id;
    const [caught] = homeSerials([sub("rr-1", "X", { endChapterId: last })], { "rr-1": list("rr-1", cs) }, at(`ch/${last}.xhtml`), {}, NOW);
    expect(caught.caughtUp).toBe(true);
    expect(caught.upNext).toBeNull();
    expect([shortChapter("Chapter 213: Ink and Stone"), shortChapter("Ch. 4 - Up"), shortChapter("Interlude: Ryoka")]).toEqual(["Chapter 213", "Ch. 4", "Interlude: Ryoka"]);
  });

  it("sorts as Details' columns do, nothing to sort by last, and finds by title or author", () => {
    const make = (id: string, title: string, days: number, unseen = 0) =>
      homeSerials([sub(id, title, { author: `${title} Author` })], { [id]: list(id, chapters(5, i => ({ published: new Date(NOW - (days + 5 - i) * 86_400_000).toISOString(), seenAt: i >= 5 - unseen ? null : 0 }))) }, {}, {}, NOW)[0];
    const a = make("rr-1", "The Alpha", 3, 2);
    const b = make("rr-2", "Beta", 1);
    const c = homeSerials([sub("rr-3", "Gamma")], {}, {}, {}, NOW)[0];
    expect(sortSerials([a, b, c], { key: "updated", reversed: false }).map(s => s.id)).toEqual(["rr-2", "rr-1", "rr-3"]);
    expect(sortSerials([a, b, c], { key: "updated", reversed: true }).map(s => s.id)).toEqual(["rr-1", "rr-2", "rr-3"]);
    expect(sortSerials([c, b, a], { key: "title", reversed: false }).map(s => s.id)).toEqual(["rr-1", "rr-2", "rr-3"]);
    // Unread: the Alpha has 5 unread (not started), Beta 5 too, Gamma none listed; ties by title.
    expect(sortSerials([b, c, a], { key: "unread", reversed: false }).map(s => s.id)).toEqual(["rr-1", "rr-2", "rr-3"]);
    expect(sortSerials([b, c, a], { key: "chapters", reversed: true }).map(s => s.id)).toEqual(["rr-1", "rr-2", "rr-3"]);
    expect(searchSerials([a, b, c], "beta author").map(s => s.id)).toEqual(["rr-2"]);
  });

  it("reads the phones' files leniently", () => {
    expect(parseSubscriptions(JSON.stringify({ stories: [{ bookId: "rr-1", url: "u", title: "T" }, { url: "u" }], version: 1 }))).toHaveLength(1);
    expect(parseSubscriptions(null)).toEqual([]);
    expect(parseChapterList(JSON.stringify({ bookId: "rr-1", device: "S23", chapters: [] }))?.device).toBe("S23");
    expect(parseChapterList(JSON.stringify({ nope: 1 }))).toBeNull();
  });
});

describe("Serials' setup and paths", () => {
  it("keeps Serials' own view, sort and sizes; Library or Serials in front; the chooser's columns are ignored (2026-10-17)", () => {
    expect(decodeHome({}).serials).toEqual(DEFAULT_SERIALS);
    expect(decodeHome({}).tab).toBe("books");
    const home = decodeHome({ tab: "serials", serials: { view: "details", sort: { key: "lastread", reversed: true }, sizes: { expanded: 4 }, columns: { order: ["site", "title"], hidden: ["title", "author"] } } });
    expect(home.tab).toBe("serials");
    expect(home.serials.view).toBe("details");
    expect(home.serials.sort).toEqual({ key: "lastread", reversed: true });
    expect(home.serials.sizes).toEqual({ list: 4, details: 2 });
    expect(home.serials).not.toHaveProperty("columns");
    // Sorted by Latest chapter (a column until the evening of 2026-10-17): Latest published sorts by the same date; Reading and New, columns too, are the default again.
    expect(decodeHome({ serials: { sort: { key: "latest", reversed: true } } }).serials.sort).toEqual({ key: "updated", reversed: true });
    expect(decodeHome({ serials: { sort: { key: "reading" } } }).serials.sort).toEqual(DEFAULT_SERIALS.sort);
    expect(decodeHome({ serials: { sort: { key: "new" } } }).serials.sort).toEqual(DEFAULT_SERIALS.sort);
    // Compact and Expanded (until 2026-10-17) open as List; a Compact size is ignored, Expanded's carries over.
    expect(decodeHome({ sizeScale: 2, serials: { view: "compact", sizes: { compact: 0, expanded: 3 } } }).serials).toEqual({ ...DEFAULT_SERIALS, view: "list", sizes: { list: 3, details: 2 } });
    expect(decodeHome({ serials: { view: "expanded" } }).serials.view).toBe("list");
  });

  it("reads a serial's chapter files only; writes only its sync file (Web's place)", () => {
    expect(chapterListPath("rr-12345")).toBe("/Apps/Read/Sync/chapters/rr-12345.json");
    expect(serialSyncPath("pt-c12345")).toBe("/Apps/Read/Sync/pt-c12345.json");
    expect(isSerialId("pt-name_1")).toBe(true);
    expect(isSerialId("../x")).toBe(false);
    expect(() => chapterListPath("../library")).toThrow();
    expect(isWritablePath("/Apps/Read/Sync/chapters/rr-12345.json")).toBe(false);
    expect(isWritablePath("/Apps/Read/Sync/rr-12345.json")).toBe(true);
  });
});

describe("Reading a serial on the web (step 3b)", () => {
  const cs: SharedChapter[] = [
    { id: "1", title: "One", url: "u1", length: 20_000 },
    { id: "2", title: "Two", url: "u2", locked: true },
    { id: "3", title: "Three", url: "u3", empty: true },
    { id: "4", title: "Four", url: "u4" },
    { id: "5", title: "Five", url: "u5", length: 10_000 },
  ];

  it("is the readable chapters, sized as the phones estimate them", () => {
    expect(readingOrderOf(cs).map(c => c.id)).toEqual(["1", "4", "5"]);
    expect(estimatedLengths(readingOrderOf(cs))).toEqual([20_000, 15_000, 10_000]);
    expect(estimatedLengths([{ id: "a", title: "", url: "" }])).toEqual([12_000]);
    expect(chapterHref("1001")).toBe("ch/1001.xhtml");
  });

  it("shows a chapter no phone has put in Dropbox as its title and a link to the site", () => {
    const page = missingChapterPage("Chapter 216: <The> Survey", "https://www.royalroad.com/fiction/1/x/chapter/216", "Royal Road");
    expect(page).toContain("<head>");
    expect(page).toContain("<h1>Chapter 216: &lt;The&gt; Survey</h1>");
    expect(page).toContain("Not in Dropbox yet.");
    expect(page).toContain('<a href="https://www.royalroad.com/fiction/1/x/chapter/216">Read it on Royal Road ↗</a>');
  });

  it("keeps authors' notes by the serial's own setting, or the phones' newest backup for Default", () => {
    expect(keepsNotes({ authorNotes: "Keep" }, false)).toBe(true);
    expect(keepsNotes({ authorNotes: "Remove" }, true)).toBe(false);
    expect(keepsNotes({ authorNotes: "Default" }, true)).toBe(true);
    expect(keepsNotes(undefined, false)).toBe(false);
    expect(phonesKeepNotes([{ savedAt: 2, settings: { keepAuthorNotes: "true" } }, { savedAt: 5, settings: { keepAuthorNotes: "false" } }])).toBe(false);
    expect(phonesKeepNotes([{ savedAt: 9, settings: {} }, { savedAt: 2, settings: { keepAuthorNotes: "true" } }])).toBe(true);
    expect(phonesKeepNotes([])).toBe(false);
  });

  it("opens a CAUGHT UP serial at the first newer chapter, only while the place is in the ended one", () => {
    expect(nextAfterCaughtUp(["1", "4", "5"], "4", "4")).toBe("5");
    expect(nextAfterCaughtUp(["1", "4", "5"], "5", "5")).toBeNull();
    expect(nextAfterCaughtUp(["1", "4", "5"], "1", "4")).toBeNull();
    expect(nextAfterCaughtUp(["1", "4", "5"], null, "4")).toBeNull();
  });

  it("marks CAUGHT UP in the subscriptions file: that serial's end only, everything else as it was", () => {
    const file = JSON.stringify({ stories: [
      { bookId: "rr-1", url: "u", title: "A", seen: { c1: 5 }, endChapterId: "3", endAt: 100, future: "kept" },
      { bookId: "rr-2", url: "v", title: "B", endChapterId: "9", endAt: 50 },
    ], version: 1, other: true });
    const next = JSON.parse(withEndMark(file, "rr-1", "5", 200)!);
    expect(next.other).toBe(true);
    expect(next.stories[0]).toEqual({ bookId: "rr-1", url: "u", title: "A", seen: { c1: 5 }, endChapterId: "5", endAt: 200, future: "kept" });
    expect(next.stories[1]).toEqual({ bookId: "rr-2", url: "v", title: "B", endChapterId: "9", endAt: 50 });
    // A newer end there already, the same end, or no such serial: nothing to write.
    expect(withEndMark(file, "rr-1", "5", 90)).toBeNull();
    expect(withEndMark(file, "rr-1", "3", 300)).toBeNull();
    expect(withEndMark(file, "rr-9", "1", 300)).toBeNull();
  });

  it("labels the sidebar's rows as the phones do, and Continue is the serial read last", () => {
    expect(progressLabel(storyProgress(215, 211))).toBe("Ch. 212 of 215");
    expect(progressLabel(storyProgress(188, 187))).toBe("Up to date · 188");
    expect(progressLabel(storyProgress(30, null))).toBe("Not started · 30");
    const s = (id: string, lastRead: number | null, n = 3) => homeSerials([sub(id, id)], { [id]: list(id, chapters(n)) }, lastRead ? { [id]: { positions: { a: place("ch/1001.xhtml", 0, lastRead, "S23") } } } : {}, {}, NOW)[0];
    expect(lastReadSerial([s("rr-1", 5), s("rr-2", 9), s("rr-3", null)])?.id).toBe("rr-2");
    expect(lastReadSerial([s("rr-3", null)])).toBeNull();
  });
});
