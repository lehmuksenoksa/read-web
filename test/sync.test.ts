import { describe, expect, it } from "vitest";
import { afterKeptOpening, afterReset, decide, furthestOf, type Furthest, keptSince, mergeFurthest, openingPlan, otherToCompare, type Position, positionFromLocator, resolve, samePosition, serialOrder, sinceSubscribed, snippet, type SyncFile, WEB_DEVICE_ID, withFurthestSet, withWebPlace } from "../src/sync";

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
    // However the href was escaped (Readium on the web, the phones' files).
    expect(samePosition({ ...mine, href: "OEBPS/chapter 2.xhtml" }, { ...mine, href: "OEBPS/chapter%202.xhtml" })).toBe(true);
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
    // The furthest read rises with it (2026-10-20); nothing else changes.
    expect(out.furthest).toEqual({ ...web, set: false });
    expect({ ...out, positions: undefined, furthest: undefined }).toEqual({ ...before, positions: undefined });
  });

  it("starts a file when there's none yet", () => {
    const web = position({ deviceName: "Web" });
    expect(JSON.parse(withWebPlace(null, "b", web))).toEqual({ bookId: "b", positions: { [WEB_DEVICE_ID]: web }, history: [], version: 1, furthest: { ...web, set: false } });
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

  it("read here before it: at the start, asked about another device that read on since (2026-10-23)", () => {
    const later = position({ deviceName: "Boox", href: "chapter2.xhtml", totalProgression: 0.05, timestamp: 7000 });
    expect(afterKeptOpening(reset({ "boox-id": later }, 6000), "b", kept, false)).toEqual({ moveTo: null, ask: later, restart: true });
    // Web's place in the file from before it, kept in this browser or not.
    expect(openingPlan(reset({ [WEB_DEVICE_ID]: kept, "boox-id": later }, 6000))).toEqual({ start: null, ask: later });
    expect(openingPlan(reset({ "boox-id": later }, 6000), null, undefined, true)).toEqual({ start: null, ask: later });
    // Stay said to that place: not asked again.
    expect(openingPlan(reset({ [WEB_DEVICE_ID]: kept, "boox-id": later }, 6000), 7000)).toEqual({ start: null, ask: null });
    // Nobody read on since: nothing to ask; another device at the start isn't further on.
    expect(openingPlan(reset({ [WEB_DEVICE_ID]: kept }, 6000))).toEqual({ start: null, ask: null });
    const atStart = position({ deviceName: "Boox", href: "chapter1.xhtml", progression: 0, totalProgression: 0, timestamp: 7000 });
    expect(openingPlan(reset({ [WEB_DEVICE_ID]: kept, "boox-id": atStart }, 6000))).toEqual({ start: null, ask: null });
  });

  it("never read here: opens where another device read after it, without asking", () => {
    const later = position({ deviceName: "Boox", href: "chapter2.xhtml", totalProgression: 0.05, timestamp: 7000 });
    expect(openingPlan(reset({ "boox-id": later }, 6000))).toEqual({ start: later, ask: null });
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

// Furthest read (2026-10-20): the same rules as the phones' sync/Furthest.kt.
describe("the furthest read", () => {
  const at = (href: string, totalProgression: number, timestamp: number, deviceName = "Boox", progression = 0.5) =>
    position({ href, totalProgression, timestamp, deviceName, progression });

  it("merges: the further wins, the older kept at the same place, a newer one set by hand always wins", () => {
    const ch8 = at("ch8.xhtml", 0.8, 4000);
    const ch5 = at("ch5.xhtml", 0.5, 6000);
    expect(mergeFurthest(ch8, ch5)).toBe(ch8);
    expect(mergeFurthest(ch5, ch8)).toBe(ch8);
    const later = { ...ch8, timestamp: 9000, deviceName: "S23", progression: 0.503 };
    expect(mergeFurthest(ch8, later)).toBe(ch8);
    const set: Furthest = { ...ch5, timestamp: 7000, set: true };
    expect(mergeFurthest(ch8, set)).toBe(set);
    // An older place set by hand gives way to a newer one further on, not to one behind it.
    expect(mergeFurthest(set, at("ch9.xhtml", 0.9, 8000))).toMatchObject({ href: "ch9.xhtml", set: true });
    expect(mergeFurthest(set, at("ch4.xhtml", 0.4, 8000))).toBe(set);
    expect(mergeFurthest(null, ch5)).toBe(ch5);
    expect(mergeFurthest(ch5, null)).toBe(ch5);
  });

  it("compares a serial by chapter, the end of one and the start of the next being the same place", () => {
    const order = serialOrder(["101", "102", "103"]);
    const end = at("ch/101.xhtml", 0.2, 1000, "Boox", 0.99);
    const start = at("ch/102.xhtml", 0.1, 2000, "S23", 0);
    expect(mergeFurthest(end, start, order)).toBe(end);
    expect(mergeFurthest(start, at("ch/101.xhtml", 0.9, 3000, "Web", 0.5), order)).toBe(start);
  });

  it("is the file's field merged with the devices' places; an older file is the furthest device", () => {
    const boox = at("ch3.xhtml", 0.3, 6000);
    const s23 = at("ch8.xhtml", 0.8, 4000, "Galaxy S23");
    expect(furthestOf(file({ boox, s23 }))).toBe(s23);
    // The S23 went back after reading to chapter 9: the field keeps chapter 9.
    const field = { ...at("ch9.xhtml", 0.9, 3500, "Galaxy S23"), set: false };
    expect(furthestOf({ ...file({ boox, s23 }), furthest: field })).toEqual(field);
    expect(furthestOf(null)).toBeNull();
  });

  it("set by hand behind: places saved before it don't count, places saved after it further on do", () => {
    const s23 = at("ch8.xhtml", 0.8, 4000, "Galaxy S23");
    const set = { ...at("ch5.xhtml", 0.5, 5000, "Web"), set: true };
    expect(furthestOf({ ...file({ s23 }), furthest: set })).toEqual(set);
    const readOn = at("ch6.xhtml", 0.6, 7000, "Galaxy S23");
    expect(furthestOf({ ...file({ s23: readOn }), furthest: set })).toEqual({ ...readOn, set: true });
  });

  it("is cleared by Mark as unread (a reset after it)", () => {
    const field = { ...at("ch9.xhtml", 0.9, 3000), set: false };
    expect(furthestOf({ ...file({}), furthest: field, reset: { at: 4000 } })).toBeNull();
    const after = at("ch1.xhtml", 0.1, 5000);
    expect(furthestOf({ ...file({ boox: after }), furthest: field, reset: { at: 4000 } })).toBe(after);
  });

  it("asks on opening about the furthest read, naming the device that read it, never about anything behind", () => {
    const web = at("ch4.xhtml", 0.4, 6000, "Web");
    const s23 = at("ch3.xhtml", 0.3, 7000, "Galaxy S23");
    // The S23 read to chapter 9, then went back to chapter 3: Web is asked about chapter 9 on the S23.
    const field = { ...at("ch9.xhtml", 0.9, 6500, "Galaxy S23"), set: false };
    expect(openingPlan({ ...file({ [WEB_DEVICE_ID]: web, s23 }), furthest: field }).ask).toEqual(field);
    // Set behind Web's place on another device: nothing is asked.
    const setBehind = { ...at("ch2.xhtml", 0.2, 8000, "Galaxy S23"), set: true };
    expect(openingPlan({ ...file({ [WEB_DEVICE_ID]: web, s23 }), furthest: setBehind }).ask).toBeNull();
  });

  it("rises with Web's place, never lowered by it; set by hand, it's Web's place too", () => {
    const set = { ...at("ch6.xhtml", 0.6, 5000, "Galaxy S23"), set: true };
    const remote = JSON.stringify({ ...file({}), furthest: set });
    const behind = at("ch4.xhtml", 0.4, 6000, "Web");
    expect(JSON.parse(withWebPlace(remote, "b", behind)).furthest).toEqual(set);
    const ahead = at("ch8.xhtml", 0.8, 7000, "Web");
    expect(JSON.parse(withWebPlace(remote, "b", ahead)).furthest).toEqual({ ...ahead, set: true });
    const out = JSON.parse(withFurthestSet(remote, "b", behind));
    expect(out.furthest).toEqual({ ...behind, set: true });
    expect(out.positions[WEB_DEVICE_ID]).toEqual(behind);
  });
});

// 2026-10-23: a Set as furthest read isn't undone by places saved before it, whatever their order.
describe("the furthest read set by hand, then read on from", () => {
  const at = (href: string, totalProgression: number, timestamp: number, deviceName = "Boox", progression = 0.5) =>
    position({ href, totalProgression, timestamp, deviceName, progression });
  // The Boox at 80% long ago; the S23 back to 40%, Set as furthest read, then on to 45%.
  const boox = at("ch8.xhtml", 0.8, 1000);
  const set: Furthest = { ...at("ch4.xhtml", 0.4, 2000, "Galaxy S23"), set: true };
  const s23 = at("ch4.xhtml", 0.45, 3000, "Galaxy S23", 0.9);

  it("stays where it was set, raised by reading on, the places from before it left out", () => {
    expect(furthestOf({ ...file({ s23, boox }), furthest: set })).toEqual({ ...s23, set: true });
    expect(furthestOf({ ...file({ boox, s23 }), furthest: set })).toEqual({ ...s23, set: true });
    // A place behind it after that doesn't lower it; one further on raises it again, still set by hand.
    const behind = at("ch4.xhtml", 0.42, 4000, "Boox", 0.7);
    expect(furthestOf({ ...file({ s23, boox: behind }), furthest: set })).toEqual({ ...s23, set: true });
    const ahead = at("ch9.xhtml", 0.9, 4000);
    expect(furthestOf({ ...file({ s23, boox: ahead }), furthest: set })).toEqual({ ...ahead, set: true });
  });

  it("is the same whatever order the file lists the places in", () => {
    const places = { boox: at("ch3.xhtml", 0.3, 5000), s23: at("ch7.xhtml", 0.7, 4000, "Galaxy S23"), web: at("ch5.xhtml", 0.5, 6000, "Web") };
    const orders = [["boox", "s23", "web"], ["web", "s23", "boox"], ["s23", "web", "boox"]] as const;
    for (const field of [undefined, set, { ...at("ch6.xhtml", 0.6, 4500), set: true }]) {
      const results = orders.map(o => furthestOf({ ...file(Object.fromEntries(o.map(k => [k, places[k]]))), ...(field ? { furthest: field } : {}) }));
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
    }
    // The Boox from before the Set listed first or last.
    expect(furthestOf({ ...file({ boox, s23 }), furthest: set })).toEqual(furthestOf({ ...file({ s23, boox }), furthest: set }));
  });

  it("on a tie in time, the one set by hand counts as the newer", () => {
    const plain = at("ch9.xhtml", 0.9, 2000, "Galaxy S23");
    expect(mergeFurthest(set, plain)).toBe(set);
    expect(mergeFurthest(plain, set)).toBe(set);
    // Neither set by hand: the further.
    const other = at("ch2.xhtml", 0.2, 2000);
    expect(mergeFurthest(other, plain)).toBe(plain);
    expect(mergeFurthest(plain, other)).toBe(plain);
  });

  it("is cleared by a reset after it; the places since count, those before don't", () => {
    const since = at("ch2.xhtml", 0.2, 6000, "Galaxy S23");
    expect(furthestOf({ ...file({ s23: since, boox }), furthest: set, reset: { at: 5000 } })).toBe(since);
    expect(furthestOf({ ...file({ s23, boox }), furthest: set, reset: { at: 5000 } })).toBeNull();
  });

  it("Web's place doesn't bring back a place from before it", () => {
    const remote = JSON.stringify({ ...file({ boox, s23 }), furthest: set });
    const web = at("ch3.xhtml", 0.3, 7000, "Web");
    expect(JSON.parse(withWebPlace(remote, "b", web)).furthest).toEqual({ ...s23, set: true });
  });

  it("sent once its Undo lapsed, keeps a page turned here since as Web's place", () => {
    const setHere = at("ch5.xhtml", 0.5, 8000, "Web");
    const pageOn = at("ch5.xhtml", 0.52, 9000, "Web", 0.6);
    const out = JSON.parse(withFurthestSet(JSON.stringify(file({ [WEB_DEVICE_ID]: pageOn, boox })), "b", setHere));
    expect(out.positions[WEB_DEVICE_ID]).toEqual(pageOn);
    expect(out.furthest).toEqual({ ...pageOn, set: true });
    // A page back since: Web's place, the Set stays the furthest read.
    const pageBack = at("ch5.xhtml", 0.48, 9000, "Web", 0.4);
    const back = JSON.parse(withFurthestSet(JSON.stringify(file({ [WEB_DEVICE_ID]: pageBack, boox })), "b", setHere));
    expect(back.positions[WEB_DEVICE_ID]).toEqual(pageBack);
    expect(back.furthest).toEqual({ ...setHere, set: true });
  });
});

// 2026-10-23: a serial subscribed again; its sync file still has the places from the subscription before.
describe("a serial subscribed again (subscribedAt)", () => {
  const order = serialOrder(["1", "2", "3", "10", "11"]);
  const at = (chapter: string, timestamp: number, deviceName: string, progression = 0.5): Position =>
    position({ href: `ch/${chapter}.xhtml`, progression, totalProgression: 0, timestamp, deviceName });
  const SINCE = 10_000;
  const oldS23 = at("10", 3000, "Galaxy S23");
  const oldWeb = at("3", 2000, "Web");
  const oldFurthest = { ...oldS23, set: false };
  const old = (): SyncFile => ({ bookId: "rr-1", positions: { s23: oldS23, [WEB_DEVICE_ID]: oldWeb }, furthest: oldFurthest, reset: { at: 1000 } });

  it("leaves out the places, the furthest read and the reset from before it; a place at that very time counts", () => {
    const now = at("2", SINCE, "Galaxy S23");
    const view = sinceSubscribed({ ...old(), positions: { ...old().positions, boox: now } }, SINCE)!;
    expect(view.positions).toEqual({ boox: now });
    expect(view.furthest).toBeUndefined();
    expect(view.reset).toBeUndefined();
    expect(view.bookId).toBe("rr-1");
    expect(furthestOf(view, order)).toEqual(now);
    // A reset since then still counts.
    expect(sinceSubscribed({ ...old(), reset: { at: SINCE + 1 } }, SINCE)!.reset).toEqual({ at: SINCE + 1 });
  });

  it("without it, the file as it is", () => {
    const file = old();
    expect(sinceSubscribed(file, undefined)).toBe(file);
    expect(sinceSubscribed(file, null)).toBe(file);
    expect(furthestOf(sinceSubscribed(file, null), order)).toEqual(oldFurthest);
  });

  it("opens as never read here: no question about the old places", () => {
    expect(openingPlan(sinceSubscribed(old(), SINCE), null, order)).toEqual({ start: null, ask: null });
    // Read since on the S23: opens there, without asking (Web's old place doesn't count as read here).
    const s23 = at("1", SINCE + 500, "Galaxy S23");
    const file = { ...old(), positions: { s23, [WEB_DEVICE_ID]: oldWeb } };
    expect(openingPlan(sinceSubscribed(file, SINCE), null, order)).toEqual({ start: s23, ask: null });
    // As today without it: Web's old place, and the S23 in chapter 1 is behind it.
    expect(openingPlan(file, null, order).start).toEqual(oldWeb);
  });

  it("asks, coming back to the tab, only about a place read since", () => {
    const web = at("1", SINCE + 100, "Web");
    expect(openingPlan(sinceSubscribed({ ...old(), positions: { s23: oldS23, [WEB_DEVICE_ID]: web } }, SINCE), null, order).ask).toBeNull();
    const s23 = at("2", SINCE + 200, "Galaxy S23");
    expect(openingPlan(sinceSubscribed({ ...old(), positions: { s23, [WEB_DEVICE_ID]: web } }, SINCE), null, order).ask).toEqual(s23);
  });

  it("doesn't write the old furthest read back with Web's place, or with a Set", () => {
    const web = at("1", SINCE + 100, "Web");
    expect(JSON.parse(withWebPlace(JSON.stringify(old()), "rr-1", web, order, SINCE)).furthest).toEqual({ ...web, set: false });
    expect(JSON.parse(withFurthestSet(JSON.stringify(old()), "rr-1", web, order, SINCE)).furthest).toEqual({ ...web, set: true });
    // The file keeps the S23's own old place: only that device writes it.
    expect(JSON.parse(withWebPlace(JSON.stringify(old()), "rr-1", web, order, SINCE)).positions.s23).toEqual(oldS23);
    // As today without it.
    expect(JSON.parse(withWebPlace(JSON.stringify(old()), "rr-1", web, order)).furthest).toEqual(oldFurthest);
  });

  it("ignores a place this browser kept from before it; one at that very time counts", () => {
    expect(keptSince(oldWeb, SINCE)).toBeNull();
    const kept = at("1", SINCE, "Web");
    expect(keptSince(kept, SINCE)).toBe(kept);
    expect(keptSince(oldWeb, null)).toBe(oldWeb);
    expect(keptSince(undefined, SINCE)).toBeNull();
  });
});
