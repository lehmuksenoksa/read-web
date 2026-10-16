import { describe, expect, it } from "vitest";
import { NO_SELECTION, pruneSelection, sharedValue, toggleAll, toggleRow } from "../src/select";

const rows = ["a", "b", "c", "d", "e"];

describe("multi-select in Details", () => {
  it("a tick toggles one row and becomes the anchor", () => {
    const one = toggleRow(NO_SELECTION, "b", rows, false);
    expect(one).toEqual({ ids: ["b"], anchor: "b" });
    const two = toggleRow(one, "d", rows, false);
    expect(two.ids).toEqual(["b", "d"]);
    expect(toggleRow(two, "b", rows, false)).toEqual({ ids: ["d"], anchor: "b" });
  });

  it("a shift-tick adds the range from the anchor, either way round, and keeps the anchor", () => {
    const from = toggleRow(NO_SELECTION, "b", rows, false);
    expect(toggleRow(from, "d", rows, true)).toEqual({ ids: ["b", "c", "d"], anchor: "b" });
    expect(toggleRow(toggleRow(NO_SELECTION, "d", rows, false), "b", rows, true).ids).toEqual(["d", "b", "c"]);
    // Without an anchor shown, shift is a plain tick.
    expect(toggleRow(NO_SELECTION, "c", rows, true)).toEqual({ ids: ["c"], anchor: "c" });
    expect(toggleRow({ ids: ["z"], anchor: "z" }, "c", rows, true)).toEqual({ ids: ["z", "c"], anchor: "c" });
  });

  it("the heading box ticks every shown row, or clears them when they all are", () => {
    const all = toggleAll({ ids: ["b"], anchor: "b" }, rows);
    expect(all.ids).toEqual(rows);
    expect(toggleAll(all, rows)).toEqual(NO_SELECTION);
    expect(toggleAll(NO_SELECTION, [])).toEqual(NO_SELECTION);
  });

  it("rows no longer shown drop out; the anchor goes with them", () => {
    const sel = { ids: ["a", "c", "e"], anchor: "c" };
    expect(pruneSelection(sel, rows)).toBe(sel);
    expect(pruneSelection(sel, ["a", "b", "e"])).toEqual({ ids: ["a", "e"], anchor: null });
    expect(pruneSelection(sel, [])).toEqual({ ids: [], anchor: null });
  });

  it("Set details… prefills a series they all share", () => {
    expect(sharedValue(["Mage Tank", "Mage Tank"])).toBe("Mage Tank");
    expect(sharedValue(["Mage Tank", "Other"])).toBeNull();
    expect(sharedValue(["Mage Tank", null])).toBeNull();
    expect(sharedValue([])).toBeNull();
  });
});
