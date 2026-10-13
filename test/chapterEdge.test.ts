import { describe, expect, it } from "vitest";
import { ChapterEdge, touchOnward } from "../src/chapterEdge";

const middle = { top: false, bottom: false };
const bottom = { top: false, bottom: true };
const top = { top: true, bottom: false };

describe("scrolling past a chapter's end", () => {
  it("goes on once a new scroll at the end pushes far enough", () => {
    const edge = new ChapterEdge();
    expect(edge.wheel(100, bottom, 1000)).toBeNull();
    expect(edge.wheel(100, bottom, 1050)).toBe("next");
  });

  it("doesn't carry a fling that runs into the end over into the next chapter", () => {
    const edge = new ChapterEdge();
    let t = 0;
    expect(edge.wheel(100, middle, t)).toBeNull();
    for (let i = 0; i < 30; i++) expect(edge.wheel(60, bottom, (t += 16))).toBeNull();
    // After a pause, a new scroll goes on.
    expect(edge.wheel(100, bottom, (t += 400))).toBeNull();
    expect(edge.wheel(100, bottom, (t += 30))).toBe("next");
  });

  it("goes back from the start to the previous chapter", () => {
    const edge = new ChapterEdge();
    expect(edge.wheel(-80, top, 0)).toBeNull();
    expect(edge.wheel(-80, top, 20)).toBe("previous");
  });

  it("doesn't go on again with the rest of the same scroll", () => {
    const edge = new ChapterEdge();
    edge.wheel(100, bottom, 0);
    expect(edge.wheel(100, bottom, 20)).toBe("next");
    // The next chapter is short: both ends in view, the scroll still going.
    for (let t = 40; t < 400; t += 20) expect(edge.wheel(100, { top: true, bottom: true }, t)).toBeNull();
  });

  it("scrolling back up at the end starts over", () => {
    const edge = new ChapterEdge();
    edge.wheel(100, bottom, 0);
    expect(edge.wheel(-50, bottom, 20)).toBeNull();
    expect(edge.wheel(100, bottom, 40)).toBeNull();
  });

  it("a finger dragged past the end", () => {
    expect(touchOnward(120, bottom, bottom)).toBe("next");
    expect(touchOnward(-120, top, top)).toBe("previous");
    expect(touchOnward(120, middle, bottom)).toBeNull();
    expect(touchOnward(30, bottom, bottom)).toBeNull();
  });
});
