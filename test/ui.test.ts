import { describe, expect, it } from "vitest";
import { menuStep } from "../src/ui";

describe("a menu's keys (2026-10-18)", () => {
  it("↓ and ↑ go round, from nothing focused too", () => {
    expect(menuStep("ArrowDown", -1, 3)).toBe(0);
    expect(menuStep("ArrowDown", 2, 3)).toBe(0);
    expect(menuStep("ArrowUp", 0, 3)).toBe(2);
    expect(menuStep("ArrowUp", -1, 3)).toBe(2);
    expect(menuStep("ArrowUp", 2, 3)).toBe(1);
  });
  it("Home and End go to the ends; other keys and an empty menu move nothing", () => {
    expect(menuStep("Home", 2, 3)).toBe(0);
    expect(menuStep("End", 0, 3)).toBe(2);
    expect(menuStep("Enter", 1, 3)).toBe(-1);
    expect(menuStep("ArrowDown", -1, 0)).toBe(-1);
  });
});
