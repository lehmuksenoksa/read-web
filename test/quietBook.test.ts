import { describe, expect, it } from "vitest";
import { isBlankText, QUIET_BOOK_CSS } from "../src/quietBook";

describe("Office's quiet book", () => {
  it("counts spaces, no-break spaces and zero-width characters as blank", () => {
    for (const text of ["", " ", "\n\t ", " ", "   ", "​", "﻿‍"]) expect(isBlankText(text)).toBe(true);
  });

  it("keeps anything visible, scene breaks included", () => {
    for (const text of ["a", " * * * ", "⁂", "#", "—", " . "]) expect(isBlankText(text)).toBe(false);
  });

  it("hides images, sizes headings to the text and collapses repeated line breaks", () => {
    expect(QUIET_BOOK_CSS).toContain("img, svg, picture, video, image { display: none !important; }");
    expect(QUIET_BOOK_CSS).toMatch(/h1, h2, h3, h4, h5, h6 \{ font-size: 1em !important;/);
    expect(QUIET_BOOK_CSS).toContain("br + br { display: none !important; }");
  });
});
