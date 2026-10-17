import { describe, expect, it } from "vitest";
import {
  ago, besideReadingNow, clickSort, curatedHome, decodeHome, RECENT_DAYS, seriesLine, fitColumns, DETAIL_COLUMNS, DEFAULT_HOME, detailsRows, homeItems, megabytes, menuSort,
  nextInSeries, sizeStep, SIZES, sortMenuChoice, sortRows, textScale, titleWord, type Facts,
} from "../src/home";
import type { LibraryBook } from "../src/library";
import { placesOf } from "../src/library";
import { decodeSetup, isLight, withDefaults } from "../src/looks";

const book = (id: string, title: string, more: Partial<LibraryBook> = {}): LibraryBook => ({
  id, path: `/Books/${title}.epub`, title, author: null, series: null, seriesIndex: null, read: false, hidden: false,
  indexedAt: 0, cover: null, lastRead: null, hasSyncFile: true, ...more,
});
const none: Facts = { progress: () => null, device: () => null };

describe("Home's setup", () => {
  it("reads an old setup file (no home) as Covers, Recent and the middle size", () => {
    const setup = decodeSetup(JSON.stringify({ looks: [{ id: "office", name: "Office" }], lookId: "office" }));
    expect(setup.home).toEqual(DEFAULT_HOME);
    expect(DETAIL_COLUMNS).toEqual(["cover", "title", "author", "series", "progress", "last"]);
  });

  it("keeps what it knows and drops what it doesn't; the chooser's columns and its sorts are ignored (2026-10-17)", () => {
    const home = decodeHome({
      view: "details", sort: { key: "author", reversed: true }, sizes: { grid: 4, details: 0 }, sizeScale: 2,
      columns: { order: ["author", "title", "nope"], hidden: ["title", "series"] },
    });
    expect(home.view).toBe("details");
    expect(home.sort).toEqual({ key: "author", reversed: true });
    expect(home.sizes).toEqual({ grid: 4, details: 0 });
    expect(home).not.toHaveProperty("columns");
    // A sort by a column that went with the chooser (Size, On, Added) is Recent again.
    expect(decodeHome({ sort: { key: "size", reversed: true } }).sort).toEqual({ key: "last", reversed: false });
    expect(decodeHome({ view: "shelf", sort: { key: "cover" } })).toMatchObject({ view: "grid", sort: { key: "last", reversed: false } });
  });

  it("is Dark or Light by the look in use: a light page gives Light", () => {
    expect(isLight(withDefaults({ id: "office", background: "Custom", backgroundColor: 0xffffffff }))).toBe(true);
    expect(isLight(withDefaults({ id: "night", background: "Oled" }))).toBe(false);
  });
});

describe("Details' columns", () => {
  it("a heading sorts by its column, and the other way on a second click; Cover sorts by title", () => {
    const byAuthor = clickSort(DEFAULT_HOME.sort, "author");
    expect(byAuthor).toEqual({ key: "author", reversed: false });
    expect(clickSort(byAuthor, "author")).toEqual({ key: "author", reversed: true });
    expect(clickSort(byAuthor, "cover")).toEqual({ key: "title", reversed: false });
  });

  it("the sort menu's choices are Home's sort, and back", () => {
    expect(menuSort("recent")).toEqual({ key: "last", reversed: false });
    expect(sortMenuChoice({ key: "title", reversed: false })).toBe("title");
    expect(sortMenuChoice({ key: "title", reversed: true })).toBeNull();
    expect(sortMenuChoice({ key: "size", reversed: false })).toBeNull();
  });
});

describe("Sorting", () => {
  const books = [
    book("a", "The Sign of the Four", { author: "Arthur Conan Doyle", series: "Sherlock Holmes", seriesIndex: 2, lastRead: "2026-09-01T10:00:00Z", size: 300, added: "2026-03-01T00:00:00Z" }),
    book("b", "A Study in Scarlet", { author: "Arthur Conan Doyle", series: "Sherlock Holmes", seriesIndex: 1, lastRead: "2026-08-01T10:00:00Z", read: true, size: 200, added: "2026-03-01T00:00:00Z" }),
    book("c", "Mage Tank 10", { author: "Cornman", series: "Mage Tank", seriesIndex: 10, lastRead: "2026-10-14T10:00:00Z", size: 900 }),
    book("d", "Mage Tank 2", { author: "Cornman", series: "Mage Tank", seriesIndex: 2, size: 800 }),
    book("e", "Dracula", { author: "Bram Stoker", lastRead: "2026-10-15T08:00:00Z", size: 100 }),
  ];
  const progress: Record<string, number> = { a: 0.35, c: 0.2, e: 0.07 };
  const facts: Facts = { progress: id => progress[id] ?? null, device: id => (id === "e" ? "S23" : id === "c" ? "Boox" : null) };
  const titles = (list: LibraryBook[]) => list.map(b => b.title);

  it("by title without A, An or The; by series name, then number (10 after 2)", () => {
    expect(titles(sortRows(books, { key: "title", reversed: false }, none))).toEqual(["Dracula", "Mage Tank 10", "Mage Tank 2", "The Sign of the Four", "A Study in Scarlet"]);
    expect(titles(sortRows(books, { key: "series", reversed: false }, none))).toEqual(["Mage Tank 2", "Mage Tank 10", "A Study in Scarlet", "The Sign of the Four", "Dracula"]);
  });

  it("newest first for Recent, Added and Size; reversed the other way; nothing to sort by goes last", () => {
    expect(titles(sortRows(books, { key: "last", reversed: false }, none))).toEqual(["Dracula", "Mage Tank 10", "The Sign of the Four", "A Study in Scarlet", "Mage Tank 2"]);
    expect(titles(sortRows(books, { key: "last", reversed: true }, none))).toEqual(["A Study in Scarlet", "The Sign of the Four", "Mage Tank 10", "Dracula", "Mage Tank 2"]);
    expect(titles(sortRows(books, { key: "size", reversed: false }, none))[0]).toBe("Mage Tank 10");
    expect(titles(sortRows(books, { key: "added", reversed: false }, none)).slice(-3)).toEqual(["Dracula", "Mage Tank 10", "Mage Tank 2"]);
  });

  it("by progress (a read book is 100%) and by the device that read last, from the sync files", () => {
    expect(titles(sortRows(books, { key: "progress", reversed: false }, facts))).toEqual(["A Study in Scarlet", "The Sign of the Four", "Mage Tank 10", "Dracula", "Mage Tank 2"]);
    expect(titles(sortRows(books, { key: "on", reversed: false }, facts)).slice(0, 2)).toEqual(["Mage Tank 10", "Dracula"]);
  });

  it("Details lists every book found, series or not", () => {
    expect(titles(detailsRows(books, { key: "title", reversed: false }, "mage", none))).toEqual(["Mage Tank 10", "Mage Tank 2"]);
  });

  it("Covers groups a series; other sorts place it where its first book falls", () => {
    const recent = homeItems(books, { key: "last", reversed: false }, "", true, none);
    expect(recent.map(i => (i.kind === "book" ? i.book.title : i.name))).toEqual(["Dracula", "Mage Tank", "Sherlock Holmes"]);
    const bySize = homeItems(books, { key: "size", reversed: false }, "", true, none);
    expect(bySize.map(i => (i.kind === "book" ? i.book.title : i.name))).toEqual(["Mage Tank", "Sherlock Holmes", "Dracula"]);
    expect(homeItems(books, { key: "size", reversed: false }, "", false, none)).toHaveLength(5);
  });

  it("a series goes on with its book in progress, else the first not read", () => {
    const holmes = books.filter(b => b.series === "Sherlock Holmes");
    expect(nextInSeries(holmes, facts.progress)?.title).toBe("The Sign of the Four");
    expect(nextInSeries(books.filter(b => b.series === "Mage Tank"), () => null)?.title).toBe("Mage Tank 2");
    expect(nextInSeries([books[1]], () => null)).toBeNull();
  });
});

describe("The panel's places", () => {
  it("each device's place, newest first, with its chapter; places from before a reset left out", () => {
    const file = {
      reset: { at: 1000 },
      positions: {
        s23: { deviceName: "S23", totalProgression: 0.43, timestamp: 5000, locator: { title: "Chapter 12" } },
        boox: { deviceName: "Boox", totalProgression: 0.38, timestamp: 3000, locator: {} },
        web: { deviceName: "Web", totalProgression: 0.9, timestamp: 500 },
      },
    };
    expect(placesOf(file)).toEqual([
      { device: "S23", p: 0.43, chapter: "Chapter 12", at: 5000 },
      { device: "Boox", p: 0.38, chapter: null, at: 3000 },
    ]);
    expect(placesOf(null)).toEqual([]);
  });
});

describe("Words and sizes", () => {
  it("the red word is the first that isn't A, An or The", () => {
    expect(titleWord("The Count of Monte Cristo")).toEqual(["The ", "Count", " of Monte Cristo"]);
    expect(titleWord("Dracula")).toEqual(["", "Dracula", ""]);
    expect(titleWord("The")).toEqual(["", "The", ""]);
  });

  it("says when, the date and the size as the panel and Details do", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(ago("2026-10-15T11:50:00Z", now)).toBe("10 min ago");
    expect(ago("2026-10-14T10:00:00Z", now)).toBe("yesterday");
    expect(ago("2026-10-11T12:00:00Z", now)).toBe("4 days ago");
    expect(ago("2026-09-24T12:00:00Z", now)).toBe("3 weeks ago");
    expect(ago(null, now)).toBe("");
    expect(megabytes(838_861)).toBe("0.8 MB");
  });

  it("five sizes, the middle one to start; text grows less than the covers", () => {
    expect(sizeStep(undefined)).toBe(2);
    expect(sizeStep(4)).toBe(4);
    expect(sizeStep(5)).toBe(2);
    expect(textScale(1.3)).toBeCloseTo(1.21);
    expect(textScale(0.75)).toBeCloseTo(0.825);
  });

  it("the middle is the old smallest (2026-10-16); steps saved on the old scale move up by two, once", () => {
    expect(SIZES[2]).toBe(0.75);
    expect(SIZES[0]).toBe(0.6);
    expect(SIZES[4]).toBe(1);
    // The old file: the smallest Covers, the second Details, the largest Serials' Expanded.
    const old = decodeHome({ sizes: { grid: 0, details: 1 }, serials: { sizes: { expanded: 4 } } });
    expect(old.sizes).toEqual({ grid: 2, details: 3 });
    expect(old.serials.sizes).toEqual({ compact: 2, expanded: 4, details: 2 });
    expect(old.sizeScale).toBe(2);
    // Saved again, it reads the same: no second move.
    expect(decodeHome(JSON.parse(JSON.stringify(old)))).toEqual(old);
    // Nothing saved: the middle.
    expect(decodeHome({}).sizes).toEqual({ grid: 2, details: 2 });
  });
});

describe("Details' columns in a narrow window (2026-10-16)", () => {
  const least = (k: string) => ({ cover: 60, title: 244, author: 164, series: 194, progress: 194, last: 144 } as Record<string, number>)[k];
  const order = ["cover", "series", "last", "progress", "author"];

  it("keeps every column when they fit", () => {
    expect(fitColumns(["title", "author", "progress"], least, 2000, order)).toEqual(["title", "author", "progress"]);
  });

  it("drops the least important first, until the rest fit", () => {
    const cols = ["title", "author", "series", "progress", "last"];
    // 940 needed; 760 of room: series (194) goes and the rest fit.
    expect(fitColumns(cols, least, 760, order)).toEqual(["title", "author", "progress", "last"]);
    // 610: last (144) goes too.
    expect(fitColumns(cols, least, 610, order)).toEqual(["title", "author", "progress"]);
  });

  it("never drops Title", () => {
    expect(fitColumns(["title", "author"], least, 100, order)).toEqual(["title"]);
  });
});

describe("the curated Covers page", () => {
  const NOW = Date.parse("2026-10-16T12:00:00Z");
  const days = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
  const lib = [
    book("a", "Mage Tank 5", { lastRead: days(0.1), added: days(40) }),
    book("b", "Excession", { lastRead: days(1), added: days(60) }),
    book("c", "The Crippled King", { lastRead: days(3), added: days(20) }),
    book("d", "Spear", { lastRead: days(5), added: days(90) }),
    book("e", "Will of the Many", { lastRead: days(9), added: days(100) }),
    book("f", "Katabasis", { added: days(1), hasSyncFile: false }),
    book("g", "Mouth of Fire", { added: days(2), hasSyncFile: false }),
    book("h", "Old unread", { added: days(RECENT_DAYS + 5), hasSyncFile: false }),
    book("i", "Finished", { lastRead: days(0.01), added: days(3), read: true }),
    book("j", "Hidden one", { lastRead: days(0.02), added: days(1), hidden: true }),
    book("k", "Not yet known", { lastRead: days(0.03), added: days(1) }),
  ];
  const p: Record<string, number | null> = { a: 0.67, b: 0.31, c: 0.12, d: 0.55, e: 0.83, f: 0, g: 0, h: 0, i: 1, j: 0.5, k: null };
  const progress = (b: LibraryBook) => p[b.id] ?? null;

  it("Reading now is the book in progress read last; Also reading the next three; read, hidden and not yet known books are in neither", () => {
    const c = curatedHome(lib, progress, NOW);
    expect(c.now?.id).toBe("a");
    expect(c.also.map(b => b.id)).toEqual(["b", "c", "d"]);
  });

  it("Recently added: not started, added in the last sixty days, newest first; never a book in progress", () => {
    expect(curatedHome(lib, progress, NOW).added.map(b => b.id)).toEqual(["f", "g"]);
  });

  it("no books in progress: no Reading now, nothing beside it", () => {
    const c = curatedHome(lib.filter(b => !["a", "b", "c", "d", "e"].includes(b.id)), progress, NOW);
    expect(c.now).toBeNull();
    expect(c.also).toEqual([]);
  });

  it("beside Reading now: the other books in progress, or the recently added when there are none", () => {
    expect(besideReadingNow(curatedHome(lib, progress, NOW))?.kind).toBe("also");
    const alone = curatedHome(lib.filter(b => !["b", "c", "d", "e"].includes(b.id)), progress, NOW);
    expect(besideReadingNow(alone)).toMatchObject({ title: "Recently added", kind: "added" });
    expect(besideReadingNow(alone)!.books.map(b => b.id)).toEqual(["f", "g"]);
    expect(besideReadingNow(curatedHome(lib.filter(b => b.id === "a"), progress, NOW))).toBeNull();
  });

  it("the series shows unless the title already says it", () => {
    expect(seriesLine(book("x", "Mage Tank 5", { series: "Mage Tank", seriesIndex: 5 }))).toBe("");
    expect(seriesLine(book("x", "Excession", { series: "The Culture", seriesIndex: 5 }))).toBe("The Culture · 5");
    expect(seriesLine(book("x", "Excession"))).toBe("");
  });

  it("its All has its own sort, Title to start with; an older setup file reads as Title", () => {
    expect(DEFAULT_HOME.gridSort).toEqual({ key: "title", reversed: false });
    expect(decodeHome({ sort: { key: "size" } }).gridSort).toEqual({ key: "title", reversed: false });
    expect(decodeHome({ gridSort: { key: "author", reversed: true } }).gridSort).toEqual({ key: "author", reversed: true });
  });
});
