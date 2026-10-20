// Covers chosen by hand (2026-10-20): the link rule, the details.json write, the Dropbox path.
import { describe, expect, it } from "vitest";
import { coverLink, dropboxCoverPath, DROPBOX_COVER, parseDetails, withCover } from "../src/details";
import { chosenCoverPath, isChosenCoverPath, isWritablePath } from "../src/paths";

const ID = "ab".repeat(32);
const shown = { title: "Emma", author: "Jane Austen", series: "Test Series", number: 2 };

describe("a cover chosen by hand", () => {
  it("takes an https link, upgrades http, refuses anything else", () => {
    expect(coverLink("  https://example.com/c.jpg ")).toBe("https://example.com/c.jpg");
    expect(coverLink("http://example.com/c.jpg")).toBe("https://example.com/c.jpg");
    expect(coverLink("example.com/c.jpg")).toBeNull();
    expect(coverLink("file:///c.jpg")).toBeNull();
    expect(coverLink("javascript:alert(1)")).toBeNull();
    expect(coverLink("https://localhost/c.jpg")).toBeNull();
  });

  it("names a file's image by its Dropbox path", () => {
    const path = chosenCoverPath(ID);
    expect(path).toBe(`/Apps/Read/Sync/covers/chosen/${ID}.jpg`);
    expect(dropboxCoverPath(DROPBOX_COVER + path)).toBe(path);
    // The phones' form, with the pick's time after the path: the same file.
    expect(dropboxCoverPath(`${DROPBOX_COVER}${path}#1760000000000`)).toBe(path);
    expect(dropboxCoverPath("https://example.com/c.jpg")).toBeNull();
    expect(dropboxCoverPath(null)).toBeNull();
  });

  it("writes only chosen covers' own path, and never a book's or a sync file there", () => {
    expect(isChosenCoverPath(chosenCoverPath(ID))).toBe(true);
    expect(isChosenCoverPath(chosenCoverPath("rr-12345"))).toBe(true);
    expect(isChosenCoverPath("/Apps/Read/Sync/covers/chosen/../details.json")).toBe(false);
    expect(isChosenCoverPath(`/Apps/Read/Sync/covers/${ID}.jpg`)).toBe(false);
    expect(isChosenCoverPath("/Books/x.jpg")).toBe(false);
    expect(isWritablePath(chosenCoverPath(ID))).toBe(false);
  });

  it("sets the cover in details.json and keeps the book's other details and other books", () => {
    const remote = JSON.stringify({ books: { [ID]: { title: "Emma, Revised", author: "J. A.", updatedAt: 1 }, other: { title: "Other", updatedAt: 2 } }, version: 1, extra: true });
    const file = parseDetails(withCover(remote, ID, "https://example.com/c.jpg", shown, 50));
    expect(file.books[ID]).toEqual({ title: "Emma, Revised", author: "J. A.", coverUrl: "https://example.com/c.jpg", updatedAt: 50 });
    expect(file.books.other).toEqual({ title: "Other", updatedAt: 2 });
    expect(file.extra).toBe(true);
  });

  it("gives a book without an entry one from what the Library shows, so nothing else changes", () => {
    const file = parseDetails(withCover(null, ID, DROPBOX_COVER + chosenCoverPath(ID), shown, 7));
    expect(file.books[ID]).toEqual({ ...shown, coverUrl: `dropbox:/Apps/Read/Sync/covers/chosen/${ID}.jpg`, updatedAt: 7 });
  });

  it("goes back to the book's own with null", () => {
    const remote = JSON.stringify({ books: { [ID]: { title: "Emma", coverUrl: "https://example.com/c.jpg", updatedAt: 1 } } });
    expect(parseDetails(withCover(remote, ID, null, shown, 9)).books[ID]).toEqual({ title: "Emma", coverUrl: null, updatedAt: 9 });
  });
});
