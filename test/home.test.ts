import { describe, expect, it } from "vitest";
import {
  ago, clickSort, decodeHome, fitColumns, DEFAULT_COLUMNS, DEFAULT_HOME, detailsRows, homeItems, megabytes, menuSort, moveColumn,
  nextInSeries, shownColumns, sizeStep, sortMenuChoice, sortRows, textScale, titleWord, toggleColumn, type Facts,
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
  it("reads an old setup file (no home) as Grid, Recent, the middle size and the first columns", () => {
    const setup = decodeSetup(JSON.stringify({ looks: [{ id: "office", name: "Office" }], lookId: "office" }));
    expect(setup.home).toEqual(DEFAULT_HOME);
    expect(shownColumns(setup.home.columns)).toEqual(["title", "author", "series", "num", "progress", "last", "on"]);
  });

  it("keeps what it knows and drops what it doesn't; Title is never hidden; new columns join at the end", () => {
    const home = decodeHome({
      view: "details", sort: { key: "size", reversed: true }, sizes: { grid: 4, cards: 9, details: 0 },
      columns: { order: ["author", "title", "nope"], hidden: ["title", "series"] },
    });
    expect(home.view).toBe("details");
    expect(home.sort).toEqual({ key: "size", reversed: true });
    expect(home.sizes).toEqual({ grid: 4, cards: 2, details: 0 });
    expect(home.columns.order.slice(0, 3)).toEqual(["author", "title", "cover"]);
    expect(home.columns.order).toHaveLength(DEFAULT_COLUMNS.order.length);
    expect(home.columns.hidden).toEqual(["series"]);
    expect(decodeHome({ view: "shelf", sort: { key: "cover" } })).toMatchObject({ view: "grid", sort: { key: "last", reversed: false } });
  });

  it("is Dark or Light by the look in use: a light page gives Light", () => {
    expect(isLight(withDefaults({ id: "office", background: "Custom", backgroundColor: 0xffffffff }))).toBe(true);
    expect(isLight(withDefaults({ id: "night", background: "Oled" }))).toBe(false);
  });
});

describe("Details' columns", () => {
  it("moves a column before another, or to the end; Title stays", () => {
    const moved = moveColumn(DEFAULT_COLUMNS, "last", "author");
    expect(moved.order.slice(0, 4)).toEqual(["cover", "title", "last", "author"]);
    expect(moveColumn(DEFAULT_COLUMNS, "author", null).order.at(-1)).toBe("author");
    expect(moveColumn(DEFAULT_COLUMNS, "title", "size")).toBe(DEFAULT_COLUMNS);
  });

  it("hides and shows a column; Title can't be hidden", () => {
    const hidden = toggleColumn(DEFAULT_COLUMNS, "series");
    expect(shownColumns(hidden)).not.toContain("series");
    expect(shownColumns(toggleColumn(hidden, "series"))).toContain("series");
    expect(toggleColumn(DEFAULT_COLUMNS, "title")).toBe(DEFAULT_COLUMNS);
    expect(shownColumns(toggleColumn(DEFAULT_COLUMNS, "size"))).toContain("size");
  });

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

  it("Grid and Cards group a series; other sorts place it where its first book falls", () => {
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
});

describe("Details' columns in a narrow window (2026-10-16)", () => {
  const least = (k: string) => ({ title: 244, author: 164, series: 164, num: 72, progress: 194, last: 144, on: 104, added: 134, size: 104 } as Record<string, number>)[k];
  const order = ["size", "added", "on", "cover", "num", "series", "last", "progress", "author"];

  it("keeps every column when they fit", () => {
    expect(fitColumns(["title", "author", "progress"], least, 2000, order)).toEqual(["title", "author", "progress"]);
  });

  it("drops the least important first, until the rest fit", () => {
    const cols = ["title", "author", "series", "num", "progress", "last", "on"];
    // 1086 needed; 760 of room: size and added aren't shown, on (104) and num (72) go, then series (164).
    expect(fitColumns(cols, least, 760, order)).toEqual(["title", "author", "progress", "last"]);
  });

  it("never drops Title", () => {
    expect(fitColumns(["title", "author"], least, 100, order)).toEqual(["title"]);
  });
});
