import { describe, expect, it } from "vitest";
import { bookByline, continueBookParts, continueRest } from "../src/home";
import { chapterPlace, continueSerialParts, serialBarPlace } from "../src/serials";
import { furtherOnText } from "../src/sync";

// The bar's and Continue's lines (2026-10-25, agreed from mockups; the phones show the same).

describe("the reader bar", () => {
  it("a book: the author and its series with the number after the title", () => {
    expect(bookByline({ author: "Jane Austen", series: "Test Series", seriesIndex: 2 })).toBe("Jane Austen · Test Series 2");
    expect(bookByline({ author: "Jane Austen", series: "Test Series", seriesIndex: null })).toBe("Jane Austen · Test Series");
  });
  it("a book with no series: the author only; no author: the series alone, or nothing", () => {
    expect(bookByline({ author: "Jane Austen", series: null, seriesIndex: null })).toBe("Jane Austen");
    expect(bookByline({ author: null, series: "Test Series", seriesIndex: 2.5 })).toBe("Test Series 2.5");
    expect(bookByline({ author: null, series: null, seriesIndex: null })).toBe("");
  });
  it("a serial: the chapter's short name and the unread count; caught up, the chapter alone", () => {
    expect(serialBarPlace("Chapter 212: North by Lantern", 3)).toBe("Chapter 212 · 3 unread");
    expect(serialBarPlace("Chapter 212: North by Lantern", 0)).toBe("Chapter 212");
    expect(serialBarPlace("Interlude: Ryoka", 1)).toBe("Interlude: Ryoka · 1 unread");
    expect(serialBarPlace(null, 2)).toBe("2 unread");
  });
});

describe("the further-on prompt", () => {
  it("a serial: the chapter and the progression within it", () => {
    expect(chapterPlace("Chapter 214: The Long Stair", 0.38)).toBe("Chapter 214 · 38%");
    expect(furtherOnText({ deviceName: "S23", totalProgression: 0.99 }, chapterPlace("Chapter 214: The Long Stair", 0.38))).toBe("S23 is further on: Chapter 214 · 38%");
  });
  it("a book (or a serial place without a chapter name): the whole book's percentage, as before", () => {
    expect(furtherOnText({ deviceName: "Boox", totalProgression: 0.43 })).toBe("Boox is further on: 43%");
  });
});

describe("Continue", () => {
  it("a book: its author, then the chapter and how far", () => {
    expect(continueRest(continueBookParts("Jane Austen", "Chapter 2", 0.43))).toBe("· Jane Austen · Chapter 2 · 43%");
    expect(continueRest(continueBookParts(null, "Chapter 2", 0))).toBe("· Chapter 2");
    expect(continueRest(continueBookParts("Jane Austen", null, 0))).toBe("· Jane Austen");
  });
  it("a serial: its current chapter's short name, not the author", () => {
    expect(continueRest(continueSerialParts({ current: { id: "212", title: "Chapter 212: North by Lantern", url: "" } as never }))).toBe("· Chapter 212");
    expect(continueSerialParts({ current: null })).toEqual([]);
  });
});
