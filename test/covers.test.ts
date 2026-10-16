import { describe, expect, it } from "vitest";
import { coverPlan, coversListed } from "../src/covers";
import type { FileEntry } from "../src/dropbox";

const file = (name: string, contentHash: string): FileEntry =>
  ({ path: `/Apps/Read/Sync/covers/${name}`, pathLower: `/apps/read/sync/covers/${name}`, name, contentHash, size: 1, modified: "" });

describe("sharp covers (2026-10-16)", () => {
  it("lists the covers by book id with their hashes; other files left out", () => {
    expect(coversListed([file("aa.jpg", "h1"), file("bb.jpg", "h2"), file("notes.txt", "h3")])).toEqual({ aa: "h1", bb: "h2" });
  });

  it("the page's order first; a new or changed cover is fetched, a kept one used as it is", () => {
    const listed = { a: "1", b: "2", c: "3", d: "4" };
    const kept = { a: "1", b: "old", gone: "9" };
    expect(coverPlan(listed, kept, ["c", "x", "b"])).toEqual([
      { id: "c", stale: true },
      { id: "b", stale: true },
      { id: "a", stale: false },
      { id: "d", stale: true },
    ]);
  });
});
