import { describe, expect, it } from "vitest";
import { chosenLook, decodeLooks, deviceLooks, faceOfFile, fileSafe, hex, isLight, pageText, preferences, stepSize } from "../src/looks";

// Looks as the app's backup writes them (Looks.encode: fields at their default are left out).
const s23 = deviceLooks("S23", {
  looks: JSON.stringify([
    { id: "day", name: "Day" },
    { id: "night", name: "Night", textColor: 0xffc9b27c | 0 },
    { id: "look3", name: "Sepia", background: "Custom", backgroundColor: 0xfff4ecd8 | 0, textColor: 0xff3b2f1e | 0, font: "Open Sans", fontWeight: 500, fontSize: 1.2, margins: 1.5, justify: false, paragraphIndent: 1.0 },
  ]),
  lookId: "night",
});
const boox = deviceLooks("Boox", { looks: JSON.stringify([{ id: "eink", name: "E-ink", background: "Eink", textColor: 0xff000000 | 0 }]), lookId: "eink" });

describe("looks from the backups", () => {
  it("fill in the app's defaults", () => {
    const day = s23.looks[0];
    expect(day).toMatchObject({ background: "Oled", font: "Bookerly", fontWeight: 400, fontSize: 1, lineHeight: 1.5, margins: 1, justify: true, hyphens: true, paragraphSpacing: null });
    expect(hex(day.textColor)).toBe("#e6d8b0");
    expect(s23.current).toBe("night");
  });

  it("are the app's own three when a backup has none", () => {
    expect(decodeLooks(undefined).map(l => l.name)).toEqual(["Day", "Night", "E-ink"]);
    expect(decodeLooks("not json").map(l => l.id)).toEqual(["day", "night", "eink"]);
    expect(deviceLooks("Boox", { lookId: "gone" }).current).toBe("day");
  });

  it("start with the S23's own look; the one picked in this browser after that", () => {
    expect(chosenLook([boox, s23], null)).toMatchObject({ device: "S23", look: { id: "night" } });
    expect(chosenLook([s23, boox], "Boox/eink")).toMatchObject({ device: "Boox", look: { id: "eink" } });
    expect(chosenLook([s23, boox], "Boox/removed")).toMatchObject({ device: "S23", look: { id: "night" } });
    expect(chosenLook([], null)).toBeNull();
  });

  it("decide whether the page around the book is light", () => {
    expect(isLight(s23.looks[1])).toBe(false);
    expect(isLight(boox.looks[0])).toBe(true);
    expect(isLight(s23.looks[2])).toBe(true);
  });

  it("never show pure white text on a dark page", () => {
    const white = { ...s23.looks[0], textColor: 0xffffffff | 0 };
    expect(hex(pageText(white))).toBe("#f2f2f2");
    expect(hex(pageText({ ...boox.looks[0], textColor: 0xffffffff | 0 }))).toBe("#ffffff");
  });

  it("become Readium's page settings as in the app", () => {
    const sepia = s23.looks[2];
    expect(preferences(sepia, "Open Sans", 1.3)).toMatchObject({
      backgroundColor: "#f4ecd8", textColor: "#3b2f1e", fontFamily: "Open Sans", fontSize: 1.3, fontWeight: 500,
      lineHeight: 1.5, pageGutter: 30, textAlign: "left", hyphens: true, paragraphIndent: 1, paragraphSpacing: null, columnCount: 1,
    });
    expect(preferences(boox.looks[0], "Bookerly", 1)).toMatchObject({ backgroundColor: "#ffffff", textColor: "#000000", textAlign: "justify" });
  });
});

describe("text size", () => {
  it("moves in the app's steps, from 60% to 250%", () => {
    expect(stepSize(1, true)).toBe(1.1);
    expect(stepSize(1.1, true)).toBe(1.2);
    expect(stepSize(0.6, false)).toBe(0.6);
    expect(stepSize(2.5, true)).toBe(2.5);
    expect(stepSize(1.25, false)).toBe(1.1);
  });
});

describe("the devices' own fonts", () => {
  it("are found by the names the app gives their files", () => {
    expect(faceOfFile("Literata-700i.ttf")).toEqual({ file: "Literata-700i.ttf", family: "Literata", weight: "700", italic: true });
    expect(faceOfFile("Open-Sans-400.otf")).toMatchObject({ family: "Open-Sans", weight: "400", italic: false });
    expect(faceOfFile("Inter-100-900.ttf")).toMatchObject({ family: "Inter", weight: "100 900" });
    expect(faceOfFile("licences")).toBeNull();
    expect(fileSafe("Open Sans")).toBe("Open-Sans");
    expect(fileSafe(" ")).toBe("Font");
  });
});
