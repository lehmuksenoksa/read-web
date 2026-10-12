import { describe, expect, it } from "vitest";
import { booksToDrop, BOOKS_KEPT, type KeptBook } from "../src/store";

const MB = 1024 * 1024;
const book = (id: string, sizeMb: number, usedAt: number, fetched = false): KeptBook => ({ id, size: sizeMb * MB, usedAt, ...(fetched ? { fetched } : {}) });

describe("books kept in this browser", () => {
  it("are all kept within the limits", () => {
    expect(booksToDrop([book("a", 5, 1), book("b", 5, 2)])).toEqual([]);
  });

  it("drop the least recently opened beyond the count", () => {
    const books = Array.from({ length: BOOKS_KEPT.count + 2 }, (_, i) => book(`b${i}`, 1, i));
    expect(booksToDrop(books).sort()).toEqual(["b0", "b1"]);
  });

  it("drop the least recently opened beyond the size", () => {
    const limit = { count: 10, fetched: 3, bytes: 25 * MB };
    expect(booksToDrop([book("old", 10, 1), book("mid", 10, 2), book("new", 10, 3)], limit)).toEqual(["old"]);
  });

  it("always keep the newest, even one bigger than the limit", () => {
    const limit = { count: 10, fetched: 3, bytes: 25 * MB };
    expect(booksToDrop([book("huge", 40, 5), book("small", 1, 1)], limit)).toEqual(["small"]);
  });

  it("fetched in the background are three more, dropped before any book opened here", () => {
    const opened = Array.from({ length: BOOKS_KEPT.count }, (_, i) => book(`o${i}`, 1, 100 + i));
    const fetched = [book("f1", 1, 500, true), book("f2", 1, 400, true), book("f3", 1, 300, true), book("f4", 1, 200, true)];
    expect(booksToDrop([...opened, ...fetched])).toEqual(["f4"]);
    const limit = { count: 10, fetched: 3, bytes: 11 * MB };
    expect(booksToDrop([...opened, ...fetched.slice(0, 3)], limit).sort()).toEqual(["f2", "f3"]);
  });
});
