import { describe, expect, it } from "vitest";
import { afterKeptOpening, afterReset, decide, openingPlan, otherToCompare, type Position, positionFromLocator, resolve, samePosition, serialOrder, snippet, type SyncFile, WEB_DEVICE_ID, withWebPlace } from "../src/sync";

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

describe("opening at the place this browser kept, before Dropbox answers", () => {
  const kept = position({ deviceName: "Web", progression: 0.3, totalProgression: 0.3, timestamp: 5000 });

  it("stays when Dropbox has the same or nothing newer", () => {
    expect(afterKeptOpening(file({ [WEB_DEVICE_ID]: kept }), "b", kept, false)).toEqual({ moveTo: null, ask: null, restart: false });
    expect(afterKeptOpening(null, "b", kept, false)).toEqual({ moveTo: null, ask: null, restart: false });
  });

  it("moves to Web's place from another browser while no page was turned", () => {
    const elsewhere = position({ deviceName: "Web", progression: 0.6, totalProgression: 0.35, timestamp: 9000 });
    expect(afterKeptOpening(file({ [WEB_DEVICE_ID]: elsewhere }), "b", kept, false).moveTo).toEqual(elsewhere);
    expect(afterKeptOpening(file({ [WEB_DEVICE_ID]: elsewhere }), "b", kept, true).moveTo).toBeNull();
  });

  it("asks when another device is further on, as at any opening", () => {
    const boox = position({ deviceName: "Boox", href: "chapter20.xhtml", progression: 0.2, totalProgression: 0.7, timestamp: 8000 });
    const next = afterKeptOpening(file({ [WEB_DEVICE_ID]: kept, "boox-id": boox }), "b", kept, false);
    expect(next.moveTo).toBeNull();
    expect(next.ask).toEqual(boox);
  });

  it("compares with the kept place when Dropbox's is older (an upload that didn't get through)", () => {
    const old = position({ deviceName: "Web", href: "chapter3.xhtml", progression: 0.1, totalProgression: 0.1, timestamp: 1000 });
    const further = position({ deviceName: "Web", href: "chapter30.xhtml", progression: 0.5, totalProgression: 0.9, timestamp: 6000 });
    const boox = position({ deviceName: "Boox", href: "chapter20.xhtml", progression: 0.2, totalProgression: 0.7, timestamp: 4000 });
    expect(afterKeptOpening(file({ [WEB_DEVICE_ID]: old, "boox-id": boox }), "b", further, false)).toEqual({ moveTo: null, ask: null, restart: false });
  });
});

describe("a book started over on a phone (Mark as unread, 2026-10-13)", () => {
  const kept = position({ deviceName: "Web", progression: 0.3, totalProgression: 0.3, timestamp: 5000 });
  const boox = position({ deviceName: "Boox", href: "chapter20.xhtml", totalProgression: 0.7, timestamp: 4000 });
  const reset = (positions: Record<string, Position>, at: number): SyncFile => ({ bookId: "b", positions, reset: { at } });

  it("leaves out every place from before it", () => {
    expect(afterReset(reset({ [WEB_DEVICE_ID]: kept, "boox-id": boox }, 6000))!.positions).toEqual({});
    expect(afterReset(reset({ [WEB_DEVICE_ID]: kept, "boox-id": boox }, 4500))!.positions).toEqual({ [WEB_DEVICE_ID]: kept });
    expect(openingPlan(reset({ [WEB_DEVICE_ID]: kept, "boox-id": boox }, 6000))).toEqual({ start: null, ask: null });
  });

  it("opens at the start instead of the place this browser kept", () => {
    expect(afterKeptOpening(reset({ [WEB_DEVICE_ID]: kept, "boox-id": boox }, 6000), "b", kept, false)).toEqual({ moveTo: null, ask: null, restart: true });
    // A page turned here since: nothing moves.
    expect(afterKeptOpening(reset({ "boox-id": boox }, 6000), "b", kept, true).restart).toBe(false);
  });

  it("goes to where another device read after it", () => {
    const later = position({ deviceName: "Boox", href: "chapter2.xhtml", totalProgression: 0.05, timestamp: 7000 });
    expect(afterKeptOpening(reset({ "boox-id": later }, 6000), "b", kept, false)).toEqual({ moveTo: later, ask: null, restart: false });
  });
});

describe("a serial's places (report #81)", () => {
  const order = serialOrder(["948", "949", "950"]);
  const at = (chapter: string, progression: number, total: number, timestamp = 2_000, deviceName = "Go7"): Position =>
    ({ locator: {}, href: `ch/${chapter}.xhtml`, progression, totalProgression: total, timestamp, deviceName, snippet: "" });

  it("doesn't take the end of a chapter for further on than the start of the next", () => {
    const web = at("950", 0, 0.951, 1_000, "Web");
    const boox = at("949", 1, 0.962);
    expect(decide(web, boox, order)).toEqual({ kind: "stay" });
    expect(resolve(web, boox, null, order)).toEqual({ kind: "stay" });
    expect(decide(boox, { ...web, timestamp: 3_000 }, order)).toEqual({ kind: "stay" });
    // As a book, the estimates would have asked.
    expect(decide(web, boox)).toEqual({ kind: "ask", position: boox });
  });

  it("asks when another device is in a later chapter, whatever the estimates", () => {
    const mine = at("949", 0.3, 0.97, 1_000, "Web");
    const s23 = at("950", 0.2, 0.9, 2_000, "S23");
    expect(decide(mine, s23, order)).toEqual({ kind: "ask", position: s23 });
    expect(decide(s23, { ...mine, timestamp: 3_000 }, order)).toEqual({ kind: "stay" });
    const file: SyncFile = { bookId: "pt-x", positions: { web: mine, s23, boox: at("949", 1, 0.99, 2_500, "Boox") } };
    expect(openingPlan(file, null, order).ask?.deviceName).toBe("S23");
    expect(openingPlan(file, null).ask?.deviceName).toBe("Boox");
  });
});
