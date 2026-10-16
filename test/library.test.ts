import { describe, expect, it } from "vitest";
import type { FileEntry } from "../src/dropbox";
import { furthest, lastReadBook, readAt, libraryBooks, libraryItems, searchBooks, sortBooks, titleFromFileName, type LibraryBook, type LibraryItem, stillKnown, booksToFetch, withSyncTimes } from "../src/library";

const hash = (c: string) => c.repeat(64);
const file = (name: string, id: string, folder = "/Books"): FileEntry => ({ path: `${folder}/${name}`, pathLower: `${folder}/${name}`.toLowerCase(), name, contentHash: id, size: 1, modified: "2026-10-01T10:00:00Z" });
const sync = (id: string, modified: string): FileEntry => ({ ...file(`${id}.json`, "", "/Apps/Read/Sync"), modified });

describe("the Library", () => {
  const files = [file("Emma.epub", hash("a")), file("Twig_1.epub", hash("b"), "/Books/Wildbow"), file("notes.txt", hash("c")), file("Persuasion.epub", hash("d")), file("Emma copy.epub", hash("a"))];
  const index = {
    [hash("a")]: { title: "Emma", author: "Jane Austen", read: true, cover: "abc" },
    [hash("d")]: { title: "Persuasion", author: "Jane Austen", hidden: true },
  };
  const all = libraryBooks(files, index, [sync(hash("b"), "2026-10-11T08:00:00Z"), sync(hash("a"), "2026-10-09T08:00:00Z")]);
  const books = all.filter(b => !b.hidden);

  it("lists the EPUBs in /Books/ with the phones' details; hidden books are marked (Show › Hidden)", () => {
    expect(all.map(b => [b.title, b.hidden])).toEqual([["Emma", false], ["Twig 1", false], ["Persuasion", true]]);
    expect(books[0]).toMatchObject({ author: "Jane Austen", read: true, cover: "abc", hasSyncFile: true, path: "/Books/Emma.epub" });
    expect(books[1]).toMatchObject({ author: null, read: false, cover: null, path: "/Books/Wildbow/Twig_1.epub" });
  });

  it("sorts by the last reading on any device, title or author", () => {
    expect(sortBooks(books, "recent").map(b => b.title)).toEqual(["Twig 1", "Emma"]);
    expect(sortBooks(books, "title").map(b => b.title)).toEqual(["Emma", "Twig 1"]);
    expect(sortBooks(books, "author").map(b => b.title)).toEqual(["Emma", "Twig 1"]);
  });

  it("searches titles, authors and series", () => {
    expect(searchBooks(books, "austen").map(b => b.title)).toEqual(["Emma"]);
    expect(searchBooks(books, "  ")).toHaveLength(2);
  });

  it("shows the furthest point any device reached", () => {
    expect(furthest({ positions: { a: { totalProgression: 0.2 }, b: { totalProgression: 0.7 } } })).toBe(0.7);
    expect(furthest(null)).toBe(0);
    expect(titleFromFileName("Mage_Tank_5.EPUB")).toBe("Mage Tank 5");
  });
});

describe("series in the Library", () => {
  const book = (id: string, title: string, series: string | null, n: number | null, lastRead: string | null, read = false): LibraryBook => ({
    id, path: `/Books/${title}.epub`, title, author: "Cornman", series, seriesIndex: n, read, cover: null, lastRead, hasSyncFile: !!lastRead,
  });
  const books = [
    book("1", "Mage Tank 1", "Mage Tank", 1, "2026-09-01", true),
    book("2", "Mage Tank 2", "Mage Tank", 2, "2026-10-01", true),
    book("3", "Mage Tank 5", "Mage Tank", 5, "2026-10-11"),
    book("4", "Alone 1", "Alone", 1, "2026-10-12"),
    book("5", "Katabasis", null, null, "2026-10-05"),
  ];

  it("make one row of two or more books, newest first, placed by the last reading", () => {
    const items = libraryItems(books, "recent", "", true);
    expect(items.map(i => (i.kind === "book" ? i.book.title : `[${i.name}]`))).toEqual(["Alone 1", "[Mage Tank]", "Katabasis"]);
    const series = items[1] as Extract<LibraryItem, { kind: "series" }>;
    expect(series.books.map(b => b.title)).toEqual(["Mage Tank 5", "Mage Tank 2", "Mage Tank 1"]);
    expect(series.read).toBe(2);
    expect(series.author).toBe("Cornman");
  });

  it("sort by the series' name for Title", () => {
    expect(libraryItems(books, "title", "", true).map(i => (i.kind === "book" ? i.book.title : i.name))).toEqual(["Alone 1", "Katabasis", "Mage Tank"]);
  });

  it("keep only the books found by a search", () => {
    const items = libraryItems(books, "recent", "tank 5", true);
    expect(items.map(i => (i.kind === "book" ? i.book.title : i.name))).toEqual(["Mage Tank 5"]);
    expect(libraryItems(books, "recent", "mage", true).map(i => i.kind)).toEqual(["series"]);
  });

  it("are left apart when grouping is off", () => {
    expect(libraryItems(books, "recent", "", false).map(i => i.kind)).toEqual(["book", "book", "book", "book", "book"]);
  });
});

describe("the start", () => {
  const b = (id: string, lastRead: string | null): LibraryBook => ({ id, path: `/Books/${id}.epub`, title: id, author: null, series: null, seriesIndex: null, read: false, cover: null, lastRead, hasSyncFile: !!lastRead });

  it("opens the book read last on any device", () => {
    expect(lastReadBook([b("a", "2026-10-01T10:00:00Z"), b("b", "2026-10-12T09:00:00Z"), b("c", null)])!.id).toBe("b");
  });

  it("opens nothing before any reading", () => {
    expect(lastReadBook([b("a", null)])).toBeNull();
    expect(lastReadBook([])).toBeNull();
    // A book marked read has nothing to continue: the one read before it comes up.
    expect(lastReadBook([b("a", "2026-10-01T10:00:00Z"), { ...b("b", "2026-10-12T09:00:00Z"), read: true }])!.id).toBe("a");
  });
});

describe("progress kept in this browser", () => {
  const book = { id: "a", path: "/Books/a.epub", title: "A", author: null, series: null, seriesIndex: null, read: false, cover: null, lastRead: "2026-10-12T10:00:00Z", hasSyncFile: true };

  it("is used while the book's sync file is unchanged", () => {
    expect(stillKnown({ at: "2026-10-12T10:00:00Z", p: 0.4 }, book)).toBe(0.4);
  });

  it("is read again when another device saved a place since, or when there's none", () => {
    expect(stillKnown({ at: "2026-10-11T10:00:00Z", p: 0.4 }, book)).toBeNull();
    expect(stillKnown(undefined, book)).toBeNull();
  });
});

describe("books fetched in the background", () => {
  const at = (id: string, lastRead: string | null) => ({ id, path: `/Books/${id}.epub`, title: id, author: null, series: null, seriesIndex: null, read: false, cover: null, lastRead, hasSyncFile: lastRead != null });
  const books = [at("a", "2026-10-10"), at("b", "2026-10-12"), at("c", null), at("d", "2026-10-11"), at("e", "2026-10-09")];

  it("are the three read last on any device that this browser doesn't have", () => {
    expect(booksToFetch(books, new Set(), null).map(b => b.id)).toEqual(["b", "d", "a"]);
    expect(booksToFetch(books, new Set(["d"]), "b").map(b => b.id)).toEqual(["a"]);
  });
});

describe("the Library after another device read", () => {
  const files = [file("Emma.epub", hash("a")), file("Twig_1.epub", hash("b"))];
  const books = libraryBooks(files, {}, [sync(hash("a"), "2026-10-09T08:00:00Z")]);

  it("takes the new times of changed and new sync files", () => {
    const next = withSyncTimes(books, [sync(hash("a"), "2026-10-13T08:00:00Z"), sync(hash("b"), "2026-10-13T09:00:00Z")]);
    expect(next?.map(b => [b.lastRead, b.hasSyncFile])).toEqual([["2026-10-13T08:00:00Z", true], ["2026-10-13T09:00:00Z", true]]);
  });

  it("is null when nothing changed, keeping the rows as they are", () => {
    expect(withSyncTimes(books, [sync(hash("a"), "2026-10-09T08:00:00Z")])).toBeNull();
  });
});

describe("progress after a book was started over", () => {
  it("counts only places from after the reset", () => {
    const positions = { boox: { totalProgression: 0.6, timestamp: 100 }, s23: { totalProgression: 0.05, timestamp: 300 } };
    expect(furthest({ positions })).toBe(0.6);
    expect(furthest({ positions, reset: { at: 200 } })).toBe(0.05);
    expect(furthest({ positions, reset: { at: 400 } })).toBe(0);
  });
});

describe("when a book was last read", () => {
  const book = (lastRead: string | null): LibraryBook => ({
    id: "x", path: "/Books/x.epub", title: "X", author: null, series: null, seriesIndex: null, read: false, hidden: false,
    indexedAt: 0, cover: null, lastRead, hasSyncFile: true,
  });
  it("is the newest place, not the sync file's time, which marks move too", () => {
    // Marked read today: the file changed today, but the last reading was days ago.
    const file = "2026-10-16T09:00:00Z";
    const places = [{ device: "S23", p: 0.4, chapter: "Chapter 3", at: Date.parse("2026-10-10T20:00:00Z") }, { device: "Web", p: 0.2, chapter: null, at: Date.parse("2026-10-05T08:00:00Z") }];
    expect(readAt(book(file), { at: file, p: 0.4, places })).toBe("2026-10-10T20:00:00.000Z");
  });
  it("is the file's time until its places are known, or when the file changed since they were read", () => {
    expect(readAt(book("2026-10-16T09:00:00Z"), undefined)).toBe("2026-10-16T09:00:00Z");
    expect(readAt(book("2026-10-16T09:00:00Z"), { at: "2026-10-01T00:00:00Z", p: 0.1, places: [{ device: "S23", p: 0.1, chapter: null, at: 5 }] })).toBe("2026-10-16T09:00:00Z");
    // A kept entry from before places were kept.
    expect(readAt(book("2026-10-16T09:00:00Z"), { at: "2026-10-16T09:00:00Z", p: 0.1 })).toBe("2026-10-16T09:00:00Z");
  });
  it("is nothing after Mark as unread took every place away", () => {
    expect(readAt(book("2026-10-16T09:00:00Z"), { at: "2026-10-16T09:00:00Z", p: 0, places: [] })).toBeNull();
  });
});
