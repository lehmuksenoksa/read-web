import { describe, expect, it } from "vitest";
import { parseDetails, parseNumber, withDetails } from "../src/details";
import type { FileEntry } from "../src/dropbox";
import { libraryBooks, markedBook, READ_AT, type LibraryBook } from "../src/library";
import { marksOf, withMarks } from "../src/sync";

const id = "b".repeat(64);

describe("the book menu's marks in the sync file (as the phones keep them)", () => {
  it("puts read, hidden and reset marks in and keeps everything else", () => {
    const remote = JSON.stringify({ bookId: id, positions: { boox: { totalProgression: 0.4, timestamp: 5 } }, history: [{ id: "h" }], unknown: 1, version: 1 });
    const text = withMarks(remote, id, { read: { read: true, updatedAt: 10 } });
    const file = JSON.parse(text);
    expect(file.read).toEqual({ read: true, updatedAt: 10 });
    expect(file.positions.boox.totalProgression).toBe(0.4);
    expect(file.history).toEqual([{ id: "h" }]);
    expect(file.unknown).toBe(1);
    // Mark as unread: a reset mark and Automatic, as Android's markUnread writes them.
    const unread = JSON.parse(withMarks(text, id, { reset: { at: 20 }, read: { read: null, updatedAt: 20 } }));
    expect(unread.reset).toEqual({ at: 20 });
    expect(unread.read).toEqual({ read: null, updatedAt: 20 });
    expect(marksOf(unread)).toEqual({ read: { read: null, updatedAt: 20 }, reset: { at: 20 } });
    const hidden = JSON.parse(withMarks(null, id, { hidden: { hidden: true, updatedAt: 30 } }));
    expect(hidden).toMatchObject({ bookId: id, positions: {}, history: [], version: 1, hidden: { hidden: true, updatedAt: 30 } });
  });

  it("shows the web's marks over the index only while they're newer than its entry", () => {
    const book = { id, read: false, hidden: false, indexedAt: 100 } as LibraryBook;
    expect(markedBook(book, { read: { read: true, updatedAt: 150 } }, 0.2).read).toBe(true);
    expect(markedBook(book, { read: { read: true, updatedAt: 50 } }, 0.2).read).toBe(false);
    expect(markedBook(book, { hidden: { hidden: true, updatedAt: 150 } }, null).hidden).toBe(true);
    // Automatic: read from the furthest place; just after Mark as unread, not read.
    expect(markedBook(book, { read: { read: null, updatedAt: 150 } }, READ_AT).read).toBe(true);
    expect(markedBook({ ...book, read: true }, { read: { read: null, updatedAt: 150 }, reset: { at: 150 } }, 1).read).toBe(false);
    expect(markedBook(book, undefined, 1)).toBe(book);
  });
});

describe("Edit details (details.json, shared with the phones)", () => {
  it("puts one book's edit in, keeps the others and a phone's chosen cover", () => {
    const other = "c".repeat(64);
    const remote = JSON.stringify({ books: { [id]: { title: "Old", coverUrl: "https://x/c.jpg", updatedAt: 1 }, [other]: { title: "Other", updatedAt: 2 } }, version: 1 });
    const file = parseDetails(withDetails(remote, id, { title: "Mage Tank 5", author: "Cornman", series: "Mage Tank", number: 5 }, 99));
    expect(file.books[id]).toEqual({ title: "Mage Tank 5", author: "Cornman", series: "Mage Tank", number: 5, coverUrl: "https://x/c.jpg", updatedAt: 99 });
    expect(file.books[other]).toEqual({ title: "Other", updatedAt: 2 });
    expect(parseDetails(withDetails(null, id, { title: "T", author: null, series: null, number: null }, 5)).books[id].coverUrl).toBeNull();
  });

  it("reads the number as the phones do", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber(" 2,5 ")).toBe(2.5);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("x")).toBeNull();
  });

  it("shows edits over the index, and keeps hidden books (marked) for Show › Hidden", () => {
    const files: FileEntry[] = [{ name: "a.epub", path: "/Books/a.epub", pathLower: "/books/a.epub", contentHash: id, modified: "2026-10-14T10:00:00Z" } as FileEntry];
    const index = { [id]: { title: "Index title", author: "A", series: "S", seriesIndex: 1, hidden: true, updatedAt: 7 } };
    const [book] = libraryBooks(files, index, [], { [id]: { title: "Edited", author: null, series: "New", number: 2, updatedAt: 8 } });
    expect(book).toMatchObject({ title: "Edited", author: null, series: "New", seriesIndex: 2, hidden: true, indexedAt: 7 });
    expect(libraryBooks(files, index, [])[0]).toMatchObject({ title: "Index title", author: "A", series: "S", seriesIndex: 1 });
  });
});
