import { describe, expect, it } from "vitest";
import type { FileEntry } from "../src/dropbox";
import { furthest, libraryBooks, searchBooks, sortBooks, titleFromFileName } from "../src/library";

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
