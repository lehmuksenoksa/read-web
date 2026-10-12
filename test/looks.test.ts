import { describe, expect, it } from "vitest";
import {
  argb, cantRemove, decodeSetup, DEFAULT_SETUP, edit, faceOfFile, fileSafe, hex, isChanged, isLight, pageText, preferences,
  removeLook, restoreLook, saveAsNew, saveName, shown, step, stepOptional, STEPS, stepWeight, useLook, weightsOf, WEB_LOOKS,
} from "../src/looks";

describe("Web's setup", () => {
  it("starts with two quiet looks, Office in use, series grouped", () => {
    const setup = decodeSetup(null);
    expect(setup.looks.map(l => l.name)).toEqual(["Office", "Office dark"]);
    expect(setup.lookId).toBe("office");
    expect(setup.groupSeries).toBe(true);
    expect(setup.sidebar).toBe(true);
    expect(hex(shown(setup).textColor)).toBe("#1f1f1f");
    expect(isLight(WEB_LOOKS[0])).toBe(true);
    expect(isLight(WEB_LOOKS[1])).toBe(false);
  });

  it("is read leniently: missing fields take the defaults, a gone look falls back", () => {
    const setup = decodeSetup(JSON.stringify({ looks: [{ id: "a", name: "A", fontSize: 1.3 }], lookId: "gone", interface: "Dark", groupSeries: false, sidebar: false }));
    expect(setup.lookId).toBe("a");
    expect(setup.groupSeries).toBe(false);
    expect(setup.sidebar).toBe(false);
    expect("interface" in setup).toBe(false);
    expect(shown(setup)).toMatchObject({ font: "Bookerly", lineHeight: 1.5, columns: 1, fontSize: 1.3 });
    expect(decodeSetup("{broken")).toEqual(DEFAULT_SETUP);
  });

  it("survives a round trip through its file", () => {
    const changed = edit(DEFAULT_SETUP, { columns: 2, fontSize: 1.2 });
    expect(decodeSetup(JSON.stringify(changed))).toEqual(changed);
  });
});

describe("Aa and Looks, with the app's rules", () => {
  it("changes what you see, never the saved look; the look shows changed", () => {
    const setup = edit(DEFAULT_SETUP, { fontSize: 1.2 });
    expect(shown(setup).fontSize).toBe(1.2);
    expect(setup.looks[0].fontSize).toBe(1);
    expect(isChanged(setup)).toBe(true);
    // Changed back: no longer changed.
    expect(isChanged(edit(setup, { fontSize: 1 }))).toBe(false);
    expect(edit(setup, { fontSize: 1 }).page).toBeNull();
  });

  it("using a look makes what you see a copy of it", () => {
    const setup = useLook(edit(DEFAULT_SETUP, { fontSize: 1.2 }), "office-dark");
    expect(setup.lookId).toBe("office-dark");
    expect(setup.page).toBeNull();
    expect(useLook(setup, "gone")).toBe(setup);
  });

  it("saves what you see as a new look with a free name, in use", () => {
    const setup = saveAsNew(edit(DEFAULT_SETUP, { columns: 2 }));
    expect(setup.looks.map(l => l.name)).toEqual(["Office", "Office dark", "Office 2"]);
    expect(shown(setup)).toMatchObject({ name: "Office 2", columns: 2 });
    expect(setup.page).toBeNull();
    expect(saveName("Office 2", setup.looks)).toBe("Office 3");
  });

  it("keeps the look in use and the last look; removing can be undone", () => {
    expect(cantRemove(DEFAULT_SETUP, "office")).toBe("Use another look first.");
    const one = { ...DEFAULT_SETUP, looks: [WEB_LOOKS[0]] };
    expect(cantRemove(one, "office")).toBe("The last look stays.");
    const done = removeLook(DEFAULT_SETUP, "office-dark")!;
    expect(done.setup.looks.map(l => l.id)).toEqual(["office"]);
    expect(restoreLook(done.setup, done.removed, done.index).looks.map(l => l.id)).toEqual(["office", "office-dark"]);
    expect(removeLook(DEFAULT_SETUP, "office")).toBeNull();
  });

  it("brings an undone look back under a new id if one saved meanwhile took it", () => {
    const done = removeLook(DEFAULT_SETUP, "office-dark")!;
    const meanwhile = { ...done.setup, looks: [...done.setup.looks, { ...WEB_LOOKS[0], id: "office-dark", name: "New" }] };
    const back = restoreLook(meanwhile, done.removed, done.index);
    expect(back.looks.map(l => l.name)).toEqual(["Office", "Office dark", "New"]);
    expect(new Set(back.looks.map(l => l.id)).size).toBe(3);
  });
});

describe("steps", () => {
  it("move as the app's do", () => {
    expect(step(STEPS.fontSize, 1, true)).toBe(1.1);
    expect(step(STEPS.fontSize, 2.5, true)).toBe(2.5);
    expect(step(STEPS.margins, 1, false)).toBe(0.75);
    expect(step(STEPS.letterSpacing, 0.05, true)).toBe(0.1);
    expect(step(STEPS.lineHeight, 1.55, false)).toBe(1.4);
  });

  it("go from the book's own to the default, and back below the minimum", () => {
    expect(stepOptional(STEPS.paragraphIndent, null, true)).toBe(1);
    expect(stepOptional(STEPS.paragraphIndent, null, false)).toBeNull();
    expect(stepOptional(STEPS.paragraphIndent, 0, false)).toBeNull();
    expect(stepOptional(STEPS.paragraphSpacing, 0.5, true)).toBe(0.75);
  });

  it("move a font's weight among the weights it has", () => {
    expect(stepWeight([400, 700], 400, true)).toBe(700);
    expect(stepWeight([400, 700], 700, true)).toBe(700);
    expect(stepWeight([400, 700], 700, false)).toBe(400);
    expect(stepWeight([400, 700], 500, false)).toBe(400);
    expect(stepWeight([400, 700], 500, true)).toBe(700);
    expect(weightsOf([faceOfFile("Inter-100-900.ttf")!])).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });
});

describe("the page", () => {
  it("gets Readium's settings as in the app, with the columns", () => {
    const look = shown(edit(DEFAULT_SETUP, { columns: 2, margins: 1.5, justify: false, paragraphIndent: 1 }));
    expect(preferences(look, "Bookerly")).toMatchObject({
      backgroundColor: "#ffffff", textColor: "#1f1f1f", fontFamily: "Bookerly", fontSize: 1, fontWeight: 400,
      lineHeight: 1.5, pageGutter: 30, textAlign: "left", hyphens: true, paragraphIndent: 1, paragraphSpacing: null, columnCount: 2,
    });
  });

  it("never shows pure white text on a dark page", () => {
    const white = shown(edit(useLook(DEFAULT_SETUP, "office-dark"), { textColor: argb("#ffffff") }));
    expect(hex(pageText(white))).toBe("#f2f2f2");
  });

  it("finds the phones' own fonts by the names the app gives their files", () => {
    expect(faceOfFile("Literata-700i.ttf")).toEqual({ file: "Literata-700i.ttf", family: "Literata", weight: "700", italic: true });
    expect(faceOfFile("Open-Sans-400.otf")).toMatchObject({ family: "Open-Sans", weight: "400", italic: false });
    expect(faceOfFile("licences")).toBeNull();
    expect(fileSafe("Open Sans")).toBe("Open-Sans");
  });
});
