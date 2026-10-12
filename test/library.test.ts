import { describe, expect, it } from "vitest";
import type { FileEntry } from "../src/dropbox";
import { furthest, lastReadBook, libraryBooks, libraryItems, searchBooks, sortBooks, titleFromFileName, type LibraryBook, type LibraryItem } from "../src/library";

const hash = (c: string) => c.repeat(64);
const file = (name: string, id: string, folder = "/Books"): FileEntry => ({ path: `${folder}/${name}`, pathLower: `${folder}/${name}`.toLowerCase(), name, contentHash: id, size: 1, modified: "2026-10-01T10:00:00Z" });
const sync = (id: string, modified: string): FileEntry => ({ ...file(`${id}.json`, "", "/Apps/Read/Sync"), modified });

describe("the Library", () => {
  const files = [file("Emma.epub", hash("a")), file("Twig_1.epub", hash("b"), "/Books/Wildbow"), file("notes.txt", hash("c")), file("Persuasion.epub", hash("d")), file("Emma copy.epub", hash("a"))];
  const index = {
    [hash("a")]: { title: "Emma", author: "Jane Austen", read: true, cover: "abc" },
    [hash("d")]: { title: "Persuasion", author: "Jane Austen", hidden: true },
  };
  const books = libraryBooks(files, index, [sync(hash("b"), "2026-10-11T08:00:00Z"), sync(hash("a"), "2026-10-09T08:00:00Z")]);

  it("lists the EPUBs in /Books/ with the phones' details; hidden books aren't shown", () => {
    expect(books.map(b => b.title)).toEqual(["Emma", "Twig 1"]);
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
  });
});
