import { describe, expect, it } from "vitest";
import {
  argb, canRename, canSaveAs, cantRemove, CUSTOM_ID, customInUse, decodeSetup, DEFAULT_SETUP, edit, faceOfFile, fileSafe, hex, isLight, lookNamed, pageText,
  preferences, removeCustom, removeFont, removeLook, renameLook, replaceWithCustom, restoreCustom, restoreFont, restoreLook, saveCustomAs, saveName, shown,
  charWidth, forStyle, inInterface, PAGE_COLOURS, pageBackground, pageLayout, sidebarWidth, step, stepOptional, STEPS, stepWeight, suggestedName, useLook, weightsOf, WEB_LOOKS, withDefaults,
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
  it("makes Custom from the look in use; the saved look stays as it was", () => {
    const setup = edit(DEFAULT_SETUP, { fontSize: 1.2 });
    expect(setup.lookId).toBe(CUSTOM_ID);
    expect(setup.customFrom).toBe("office");
    expect(shown(setup)).toMatchObject({ id: CUSTOM_ID, name: "Custom", fontSize: 1.2 });
    expect(setup.looks[0].fontSize).toBe(1);
    // Further changes change Custom, even back to how the look was.
    const back = edit(setup, { fontSize: 1 });
    expect(customInUse(back)).toBe(true);
    expect(back.customFrom).toBe("office");
    // A "change" that changes nothing makes no Custom.
    expect(edit(DEFAULT_SETUP, { fontSize: 1 })).toBe(DEFAULT_SETUP);
  });

  it("keeps one Custom: using a look leaves it among the looks, changing another look replaces it", () => {
    const custom = edit(DEFAULT_SETUP, { fontSize: 1.2 });
    const dark = useLook(custom, "office-dark");
    expect(dark.lookId).toBe("office-dark");
    expect(dark.custom?.fontSize).toBe(1.2);
    expect(useLook(dark, CUSTOM_ID).lookId).toBe(CUSTOM_ID);
    const changed = edit(dark, { columns: 2 });
    expect(changed.customFrom).toBe("office-dark");
    expect(changed.custom).toMatchObject({ columns: 2, fontSize: 1, textColor: WEB_LOOKS[1].textColor });
    expect(useLook(DEFAULT_SETUP, CUSTOM_ID)).toBe(DEFAULT_SETUP);
    expect(useLook(dark, "gone")).toBe(dark);
  });

  it("saves Custom under a new name, or over the look with that name", () => {
    const custom = edit(DEFAULT_SETUP, { columns: 2 });
    expect(suggestedName(custom)).toBe("Office 2");
    const saved = saveCustomAs(custom, " Wide ");
    expect(saved.looks.map(l => l.name)).toEqual(["Office", "Office dark", "Wide"]);
    expect(shown(saved)).toMatchObject({ name: "Wide", columns: 2 });
    expect(saved.custom).toBeNull();
    expect(saved.lookId).not.toBe(CUSTOM_ID);
    // A name taken (any case) replaces that look, which keeps its id and name.
    expect(lookNamed(custom, "office DARK")?.id).toBe("office-dark");
    const over = saveCustomAs(custom, "office DARK");
    expect(over.looks.map(l => l.name)).toEqual(["Office", "Office dark"]);
    expect(shown(over)).toMatchObject({ id: "office-dark", name: "Office dark", columns: 2 });
    expect(saveCustomAs(custom, " ")).toBe(custom);
    expect(saveCustomAs(custom, "custom")).toBe(custom);
    expect(canSaveAs("Custom")).toBe(false);
  });

  it("puts Custom in a look's place", () => {
    const custom = edit(DEFAULT_SETUP, { textColor: argb("#333333") });
    const replaced = replaceWithCustom(custom, "office-dark");
    expect(replaced.lookId).toBe("office-dark");
    expect(replaced.custom).toBeNull();
    expect(shown(replaced)).toMatchObject({ id: "office-dark", name: "Office dark", textColor: argb("#333333") });
    expect(replaceWithCustom(DEFAULT_SETUP, "office-dark")).toBe(DEFAULT_SETUP);
  });

  it("removes Custom back to the look it came from, and undoes it", () => {
    const custom = useLook(edit(DEFAULT_SETUP, { fontSize: 1.2 }), CUSTOM_ID);
    const done = removeCustom(custom)!;
    expect(done.setup.custom).toBeNull();
    expect(done.setup.lookId).toBe("office");
    expect(restoreCustom(done.setup, done.removed)).toEqual(custom);
    // Not in use: what you see stays.
    const away = useLook(custom, "office-dark");
    expect(removeCustom(away)!.setup.lookId).toBe("office-dark");
    // The look it came from gone: the first look.
    const gone = { ...custom, customFrom: "nothing" };
    expect(removeCustom(gone)!.setup.lookId).toBe("office");
    expect(removeCustom(DEFAULT_SETUP)).toBeNull();
  });

  it("renames a look, never to another look's name or Custom's", () => {
    expect(renameLook(DEFAULT_SETUP, "office", "Desk").looks[0].name).toBe("Desk");
    expect(canRename(DEFAULT_SETUP, "office", "OFFICE")).toBe(true);
    expect(canRename(DEFAULT_SETUP, "office", "office dark")).toBe(false);
    expect(canRename(DEFAULT_SETUP, "office", "Custom")).toBe(false);
    expect(renameLook(DEFAULT_SETUP, "office", "")).toBe(DEFAULT_SETUP);
    expect(saveName("Office 2", [...WEB_LOOKS, { ...WEB_LOOKS[0], id: "x", name: "office 2" }])).toBe("Office 3");
  });

  it("reads an older file's changes as Custom", () => {
    const old = { looks: WEB_LOOKS, lookId: "office-dark", page: { ...WEB_LOOKS[1], fontSize: 1.4 } };
    const setup = decodeSetup(JSON.stringify(old));
    expect(setup.lookId).toBe(CUSTOM_ID);
    expect(setup.customFrom).toBe("office-dark");
    expect(shown(setup)).toMatchObject({ name: "Custom", fontSize: 1.4 });
    expect("page" in setup).toBe(false);
    // Unchanged: no Custom.
    expect(decodeSetup(JSON.stringify({ ...old, page: WEB_LOOKS[1] })).custom).toBeNull();
    // Custom in use without a Custom: the first look.
    expect(decodeSetup(JSON.stringify({ looks: WEB_LOOKS, lookId: CUSTOM_ID })).lookId).toBe("office");
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
    expect(step(STEPS.textWidth, 70, false)).toBe(65);
    expect(step(STEPS.textWidth, 100, true)).toBe(100);
    expect(step(STEPS.letterSpacing, 0.05, true)).toBe(0.06);
    expect(step(STEPS.letterSpacing, 0.2, true)).toBe(0.2);
    expect(step(STEPS.wordSpacing, 0.1, true)).toBe(0.15);
    expect(step(STEPS.wordSpacing, 0.5, true)).toBe(0.5);
    // A value from before the finer steps: back within them.
    expect(step(STEPS.letterSpacing, 0.5, false)).toBe(0.2);
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
    const look = shown(edit(DEFAULT_SETUP, { columns: 2, textWidth: 80, justify: false, paragraphIndent: 1 }));
    expect(preferences(look, "Bookerly")).toMatchObject({
      backgroundColor: "#ffffff", textColor: "#1f1f1f", fontFamily: "Bookerly", fontSize: 1, fontWeight: 400,
      lineHeight: 1.5, pageGutter: 20, textAlign: "left", hyphens: true, paragraphIndent: 1, paragraphSpacing: null, columnCount: 2,
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

describe("widths", () => {
  it("of the text: the look's characters per line, the same in any pane wide enough", () => {
    const look = { textWidth: 70, columns: 1 as const, scroll: false, position: "centre" as const };
    // 70 characters of 8 px, with Readium's gutter of 20 px a side.
    expect(pageLayout(1040, look, 8).page).toBe(600);
    expect(pageLayout(1360, look, 8).page).toBe(600);
    // Two columns: 70 characters each.
    expect(pageLayout(1360, { ...look, columns: 2 }, 8).page).toBe(1200);
    // Scrolling is one column whatever the look's columns.
    expect(pageLayout(1360, { ...look, columns: 2, scroll: true }, 8).page).toBe(600);
    // A pane too narrow: the text narrows, the arrows keep their space.
    expect(pageLayout(500, look, 8)).toEqual({ page: 420, left: 40, right: 40 });
    expect(pageLayout(150, look, 8).page).toBe(150);
  });

  it("of a character: the font's, with the look's letter and word spacing", () => {
    const sample = "ab cd";
    expect(charWidth(40, sample, { fontSize: 1, letterSpacing: 0, wordSpacing: 0 })).toBe(8);
    // Letter spacing 0.05 em at 16 px adds 0.8 px a character; word spacing 0.25 em adds 4 px a space.
    expect(charWidth(40, sample, { fontSize: 1, letterSpacing: 0.05, wordSpacing: 0.25 })).toBeCloseTo(9.6);
  });

  it("of the sidebar: 240 to 520 pixels, 320 to start with", () => {
    expect(sidebarWidth(100)).toBe(240);
    expect(sidebarWidth(900)).toBe(520);
    expect(sidebarWidth(401.6)).toBe(402);
    expect(sidebarWidth(NaN)).toBe(320);
    expect(decodeSetup(null).sidebarWidth).toBe(320);
    expect(decodeSetup(JSON.stringify({ looks: [{ id: "a" }], sidebarWidth: 9999 })).sidebarWidth).toBe(520);
  });

  it("beside the text: even in the centre; at a side, only the arrow's space there", () => {
    const look = { textWidth: 70, columns: 1 as const, scroll: false };
    expect(pageLayout(1040, { ...look, position: "centre" }, 8)).toEqual({ page: 600, left: 220, right: 220 });
    expect(pageLayout(1040, { ...look, position: "left" }, 8)).toEqual({ page: 600, left: 40, right: 400 });
    expect(pageLayout(1040, { ...look, position: "right" }, 8)).toEqual({ page: 600, left: 400, right: 40 });
    // The sidebar hidden: the same page, more space beside it.
    expect(pageLayout(1360, { ...look, position: "centre" }, 8)).toEqual({ page: 600, left: 380, right: 380 });
  });
});

describe("page and position", () => {
  it("are centre and turning pages for looks saved before them", () => {
    const setup = decodeSetup(JSON.stringify({ looks: [{ id: "a", columns: 2 }], lookId: "a" }));
    expect(shown(setup)).toMatchObject({ columns: 2, scroll: false, position: "centre", textWidth: 70 });
    expect(setup.custom).toBeNull();
  });

  it("scroll in one column, keeping the look's columns for when it turns pages again", () => {
    const look = shown(edit(DEFAULT_SETUP, { columns: 2, scroll: true, position: "left" }));
    expect(preferences(look, "Bookerly")).toMatchObject({ scroll: true, columnCount: 1 });
    expect(look.columns).toBe(2);
    expect(preferences({ ...look, scroll: false }, "Bookerly")).toMatchObject({ scroll: false, columnCount: 2 });
  });
});

describe("fonts in Text's list", () => {
  it("removes a downloaded font: the looks and Custom using it use Bookerly; Undo puts it back", () => {
    const looks = [{ ...WEB_LOOKS[0], font: "Jost" }, { ...WEB_LOOKS[1], font: "Figtree" }];
    const setup = edit({ ...DEFAULT_SETUP, looks, lookId: "office-dark" }, { fontSize: 1.2, font: "Jost" });
    const done = removeFont(setup, "Jost")!;
    expect(done.setup.removedFonts).toEqual(["Jost"]);
    expect(done.setup.looks.map(l => l.font)).toEqual(["Bookerly", "Figtree"]);
    expect(done.setup.custom?.font).toBe("Bookerly");
    expect(done.switched).toEqual(["office", CUSTOM_ID]);
    expect(restoreFont(done.setup, "Jost", done.switched)).toEqual(setup);
    // Download brings it back to the list; the looks keep Bookerly.
    const downloaded = restoreFont(done.setup, "Jost");
    expect(downloaded.removedFonts).toEqual([]);
    expect(downloaded.looks[0].font).toBe("Bookerly");
  });

  it("never removes Bookerly or Literata, and keeps the list in the setup file", () => {
    expect(removeFont(DEFAULT_SETUP, "Bookerly")).toBeNull();
    expect(removeFont(DEFAULT_SETUP, "Literata")).toBeNull();
    const removed = removeFont(DEFAULT_SETUP, "Jost")!.setup;
    expect(removeFont(removed, "Jost")).toBeNull();
    expect(decodeSetup(JSON.stringify(removed)).removedFonts).toEqual(["Jost"]);
    expect(decodeSetup(JSON.stringify({ ...removed, removedFonts: "Jost" })).removedFonts).toEqual([]);
  });
});

describe("Home and Office each have their own look (2026-10-15)", () => {
  const file = (extra: object) => JSON.stringify({
    looks: [{ id: "paper", name: "Paper", background: "Custom", backgroundColor: -1, textColor: -14737633 }, { id: "night", name: "Night", background: "Custom", backgroundColor: -15592942, textColor: -3557760 }],
    lookId: "paper", ...extra,
  });

  it("starts Home with Office's look when the file has none for it", () => {
    const setup = decodeSetup(file({}));
    expect(setup.homeLook).toEqual({ lookId: "paper", custom: null, customFrom: null });
    expect(shown(forStyle(setup, true)).id).toBe("paper");
  });

  it("shows and changes each style's own look", () => {
    const setup = decodeSetup(file({ homeLook: { lookId: "night" } }));
    expect(shown(forStyle(setup, false)).id).toBe("paper");
    expect(shown(forStyle(setup, true)).id).toBe("night");
    // Aa in Home makes Home's Custom; Office's look stays.
    const changed = forStyle(edit(forStyle(setup, true), { fontSize: 1.3 }), true);
    expect(changed.lookId).toBe("paper");
    expect(changed.custom).toBeNull();
    expect(changed.homeLook).toMatchObject({ lookId: CUSTOM_ID, customFrom: "night" });
    expect(shown(forStyle(changed, true)).fontSize).toBe(1.3);
    expect(decodeSetup(JSON.stringify(changed))).toEqual(changed);
  });

  it("keeps a look the other style uses", () => {
    const setup = decodeSetup(file({ homeLook: { lookId: "night" } }));
    expect(cantRemove(setup, "night")).not.toBeNull();
    expect(cantRemove(forStyle(setup, true), "paper")).not.toBeNull();
  });

  it("gives each style Light or Dark chrome: Home Dark, Office as its look was", () => {
    expect(decodeSetup(file({})).chrome).toEqual({ home: "dark", office: "light" });
    expect(decodeSetup(file({ lookId: "night" })).chrome).toEqual({ home: "dark", office: "dark" });
    expect(decodeSetup(file({ chrome: { home: "light", office: "dark" } })).chrome).toEqual({ home: "light", office: "dark" });
  });
});

describe("the page in the Interface's colours (2026-10-15)", () => {
  const night = withDefaults({ id: "n", background: "Custom", backgroundColor: -15592942, textColor: -1, fontSize: 1.3 });

  it("takes each style's Light or Dark, whatever the look's own colours", () => {
    expect(hex(pageBackground(inInterface(night, false, "light")))).toBe("#ffffff");
    expect(hex(pageText(inInterface(night, false, "light")))).toBe("#1f1f1f");
    expect(hex(pageBackground(inInterface(night, false, "dark")))).toBe("#121212");
    expect(hex(pageBackground(inInterface(night, true, "dark")))).toBe("#000000");
    expect(hex(pageText(inInterface(night, true, "dark")))).toBe("#c9b27c");
    expect(hex(pageBackground(inInterface(night, true, "light")))).toBe("#fbf8f2");
  });

  it("keeps the rest of the look", () => {
    expect(inInterface(night, true, "light").fontSize).toBe(1.3);
  });

  it("never shows pure white text on dark", () => {
    for (const style of [PAGE_COLOURS.home.dark, PAGE_COLOURS.office.dark]) expect(style.text | 0).not.toBe(-1);
  });
});

describe("Book's styling (2026-10-16)", () => {
  it("starts on in Home and off in Office, and is kept per style", () => {
    const setup = decodeSetup(JSON.stringify({ looks: [{ id: "paper", name: "Paper" }], lookId: "paper" }));
    expect(setup.bookStyling).toEqual({ home: true, office: false });
    const changed = { ...setup, bookStyling: { home: false, office: true } };
    expect(decodeSetup(JSON.stringify(changed)).bookStyling).toEqual({ home: false, office: true });
  });
});
