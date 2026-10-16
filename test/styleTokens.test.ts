import { describe, expect, it } from "vitest";
import { HOME_STYLE, OFFICE_STYLE, styleFor, tokenClasses } from "../src/styleTokens";

describe("the two styles as tokens", () => {
  it("Home and Office differ in every token, and each gives one class per token", () => {
    for (const key of Object.keys(HOME_STYLE) as (keyof typeof HOME_STYLE)[]) expect(HOME_STYLE[key]).not.toEqual(OFFICE_STYLE[key]);
    expect(tokenClasses(HOME_STYLE)).toEqual(["t-wordmark", "t-serif", "t-accent", "t-cards", "t-covers", "t-views", "t-roomy"]);
    expect(tokenClasses(OFFICE_STYLE)).toEqual(["t-words", "t-sans", "t-ink", "t-hairline", "t-nocovers", "t-oneview", "t-tight"]);
    expect(styleFor(true)).toBe(HOME_STYLE);
    expect(styleFor(false)).toBe(OFFICE_STYLE);
  });
});
