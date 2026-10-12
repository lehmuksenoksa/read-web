import { describe, expect, it } from "vitest";
import { decide, openingPlan, otherToCompare, positionFromLocator, samePosition, snippet, withWebPlace, WEB_DEVICE_ID, type Position, type SyncFile } from "../src/sync";

function position(p: Partial<Position> = {}): Position {
  const href = p.href ?? "chapter12.xhtml";
  return {
    locator: { href, type: "application/xhtml+xml", locations: { progression: p.progression ?? 0.5, totalProgression: p.totalProgression ?? 0.43 } },
    href,
    progression: 0.5,
    totalProgression: 0.43,
    timestamp: 1000,
    deviceName: "Boox",
    snippet: "In consequence of an agreement…",
    ...p,
  };
}

function file(positions: Record<string, Position>): SyncFile {
  return { bookId: "b", positions };
}

// The app's PositionDecisionTest, case by case.
describe("the app's rules", () => {
  const mine = position({ deviceName: "Web", progression: 0.5, totalProgression: 0.4 });

  it("counts half a percent of the chapter as the same place", () => {
    expect(samePosition(mine, { ...mine, progression: 0.505 })).toBe(true);
    expect(samePosition(mine, { ...mine, progression: 0.495 })).toBe(true);
    expect(samePosition(mine, { ...mine, progression: 0.506 })).toBe(false);
    expect(samePosition(mine, { ...mine, href: "chapter13.xhtml" })).toBe(false);
  });

  it("asks when the other device is further on, stays when it's behind, jumps on a first open", () => {
    const ahead = { ...mine, href: "chapter13.xhtml", totalProgression: 0.45 };
    expect(decide(mine, ahead)).toEqual({ kind: "ask", position: ahead });
    expect(decide(mine, { ...mine, href: "chapter9.xhtml", totalProgression: 0.3 })).toEqual({ kind: "stay" });
    expect(decide(null, ahead)).toEqual({ kind: "jump", position: ahead });
    expect(decide(mine, { ...mine, progression: 0.501 })).toEqual({ kind: "stay" });
  });
});

describe("opening a book on the web", () => {
  it("opens at Web's own place", () => {
    const web = position({ deviceName: "Web", href: "ch5.xhtml", totalProgression: 0.5, timestamp: 9000 });
    const boox = position({ href: "ch3.xhtml", totalProgression: 0.3, timestamp: 5000 });
    expect(openingPlan(file({ [WEB_DEVICE_ID]: web, boox }))).toEqual({ start: web, ask: null });
  });

  it("asks when another device is further on and newer", () => {
    const web = position({ deviceName: "Web", href: "ch3.xhtml", totalProgression: 0.3, timestamp: 2000 });
    const boox = position({ href: "ch9.xhtml", totalProgression: 0.9, timestamp: 5000 });
    expect(openingPlan(file({ [WEB_DEVICE_ID]: web, boox }))).toEqual({ start: web, ask: boox });
  });

  it("asks about the furthest device, not the newest", () => {
    const web = position({ deviceName: "Web", href: "ch4.xhtml", totalProgression: 0.4, timestamp: 2000 });
    const boox = position({ deviceName: "Boox", href: "ch3.xhtml", totalProgression: 0.3, timestamp: 6000 });
    const s23 = position({ deviceName: "Galaxy S23", href: "ch8.xhtml", totalProgression: 0.8, timestamp: 4000 });
    expect(openingPlan(file({ [WEB_DEVICE_ID]: web, boox, s23 })).ask).toBe(s23);
  });

  it("doesn't ask about a place older than Web's last page turn", () => {
    const web = position({ deviceName: "Web", href: "ch4.xhtml", totalProgression: 0.4, timestamp: 7000 });
    const s23 = position({ deviceName: "Galaxy S23", href: "ch8.xhtml", totalProgression: 0.8, timestamp: 4000 });
    expect(openingPlan(file({ [WEB_DEVICE_ID]: web, s23 })).ask).toBeNull();
  });

  it("doesn't ask again after Stay, until that device reads on", () => {
    const web = position({ deviceName: "Web", href: "ch3.xhtml", totalProgression: 0.3, timestamp: 2000 });
    const boox = position({ href: "ch9.xhtml", totalProgression: 0.9, timestamp: 5000 });
    expect(openingPlan(file({ [WEB_DEVICE_ID]: web, boox }), 5000).ask).toBeNull();
    const later = { ...boox, timestamp: 8000, progression: 0.7 };
    expect(openingPlan(file({ [WEB_DEVICE_ID]: web, boox: later }), 5000).ask).toBe(later);
  });

  it("opens a book never read here at the furthest place, without asking", () => {
    const boox = position({ href: "ch3.xhtml", totalProgression: 0.3, timestamp: 6000 });
    const s23 = position({ deviceName: "Galaxy S23", href: "ch8.xhtml", totalProgression: 0.8, timestamp: 4000 });
    expect(openingPlan(file({ boox, s23 }))).toEqual({ start: s23, ask: null });
  });

  it("opens at the start when nobody has read it", () => {
    expect(openingPlan(null)).toEqual({ start: null, ask: null });
    expect(otherToCompare([], null, null)).toBeNull();
  });
});

describe("Web's place in the sync file", () => {
  it("is made from Readium's locator", () => {
    const place = positionFromLocator({
      href: "OEBPS/ch1.xhtml", type: "application/xhtml+xml",
      locations: { progression: 0.25, position: 12, totalProgression: 0.1 },
      text: { highlight: "  She pushed   the door open  " },
    }, 1234);
    expect(place).toMatchObject({ href: "OEBPS/ch1.xhtml", progression: 0.25, totalProgression: 0.1, timestamp: 1234, deviceName: "Web", snippet: "She pushed the door open" });
    expect(positionFromLocator({ locations: {} }, 1)).toBeNull();
  });

  it("goes in without touching anything else", () => {
    const remote = JSON.stringify({
      bookId: "b", positions: { boox: position() }, ttsResume: position({ timestamp: 3 }),
      history: [{ id: "h1", time: 1, position: position(), isTimerStart: true }],
      read: { read: true, updatedAt: 5 }, hidden: null, version: 1, somethingNew: { kept: true },
    });
    const web = position({ deviceName: "Web", timestamp: 9 });
    const out = JSON.parse(withWebPlace(remote, "b", web));
    const before = JSON.parse(remote);
    expect(out.positions.boox).toEqual(before.positions.boox);
    expect(out.positions[WEB_DEVICE_ID]).toEqual(web);
    expect({ ...out, positions: undefined }).toEqual({ ...before, positions: undefined });
  });

  it("starts a file when there's none yet", () => {
    const web = position({ deviceName: "Web" });
    expect(JSON.parse(withWebPlace(null, "b", web))).toEqual({ bookId: "b", positions: { [WEB_DEVICE_ID]: web }, history: [], version: 1 });
  });

  it("cuts snippets at a word", () => {
    expect(snippet("word ".repeat(30))).toMatch(/^(word ){15}word…$/);
  });
});
