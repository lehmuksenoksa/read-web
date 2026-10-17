import { describe, expect, it } from "vitest";
import type { LibraryBook, Place } from "../src/library";
import { bookState, furthestPlace, goLabel, seriesLine, statusAction } from "../src/panelState";

const place = (device: string, p: number, chapter: string | null, at = 0): Place => ({ device, p, chapter, at });
const book = (id: string, title: string, more: Partial<LibraryBook> = {}): LibraryBook => ({
  id, path: `/Books/${title}.epub`, title, author: null, series: "S", seriesIndex: null, read: false, hidden: false,
  indexedAt: 0, cover: null, lastRead: null, hasSyncFile: true, ...more,
});

describe("the book's panel", () => {
  it("shows the furthest place on any device, whichever read last", () => {
    const places = [place("S23", 0.43, "Chapter 2", 5), place("Web", 0.12, "Chapter 1", 9)];
    expect(furthestPlace(places)?.device).toBe("S23");
    expect(bookState(false, places, true)).toEqual({ kind: "started", p: 0.43, chapter: "Chapter 2" });
    expect(furthestPlace([])).toBeNull();
  });

  it("read wins; not known yet while its file is read; not started without a place past the start", () => {
    expect(bookState(true, null, true)).toEqual({ kind: "read" });
    expect(bookState(false, null, true)).toEqual({ kind: "loading" });
    expect(bookState(false, null, false)).toEqual({ kind: "new" });
    expect(bookState(false, [], true)).toEqual({ kind: "new" });
    expect(bookState(false, [place("S23", 0, null)], true)).toEqual({ kind: "new" });
  });

  it("one button and one status word for each state", () => {
    expect([goLabel({ kind: "new" }), statusAction({ kind: "new" })]).toEqual(["Read", "Mark as read"]);
    expect([goLabel({ kind: "started", p: 0.4, chapter: null }), statusAction({ kind: "started", p: 0.4, chapter: null })]).toEqual(["Continue", "Mark as read"]);
    expect([goLabel({ kind: "read" }), statusAction({ kind: "read" })]).toEqual(["Read again", "Mark as unread"]);
  });
});

describe("the series' panel", () => {
  it("names the next book and fills the bar over the whole series", () => {
    const a = book("a", "Katabasis", { seriesIndex: 1, read: true });
    const b = book("b", "Emma", { seriesIndex: 2 });
    const c = book("c", "Third", { seriesIndex: 3 });
    const progress = (id: string) => (id === "b" ? 0.5 : null);
    expect(seriesLine([a, b, c], b, progress)).toEqual({ left: "1 of 3 read", right: "Emma · 50%", fraction: 0.5 });
    expect(seriesLine([a, b, c], c, () => null)).toMatchObject({ left: "1 of 3 read", right: "Third" });
    expect(seriesLine([{ ...a }, { ...b, read: true }], null, () => null)).toEqual({ left: "All read", right: "", fraction: 1 });
    expect(seriesLine([], null, () => null)).toEqual({ left: "", right: "", fraction: 0 });
  });
});
