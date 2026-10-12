import { describe, expect, it } from "vitest";
import { CATALOGUE, fontIndex, fontIndexName, googleCssUrl, parseGoogleCss } from "../src/fonts";

// The shape of Google Fonts' CSS for a browser: one block per style, weight and subset.
const css = `
/* cyrillic */
@font-face {
  font-family: 'Newsreader';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/newsreader/v20/cyr-italic.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin-ext */
@font-face {
  font-family: 'Newsreader';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/newsreader/v20/latinext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5;
}
/* latin */
@font-face {
  font-family: 'Newsreader';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/newsreader/v20/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F;
}
/* latin */
@font-face {
  font-family: 'Newsreader';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/newsreader/v20/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F;
}
/* latin */
@font-face {
  font-family: 'Newsreader';
  font-style: normal;
  font-weight: 500;
  src: url(https://elsewhere.example/x.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`;

describe("fonts from Google Fonts", () => {
  it("are the app's catalogue, Literata aside (the page has it)", () => {
    expect(CATALOGUE).toEqual(["Newsreader", "Source Serif 4", "Spectral", "Jost", "Atkinson Hyperlegible Next", "IBM Plex Sans", "Figtree"]);
  });

  it("are asked for Light to Bold with italics, as the app asks", () => {
    expect(googleCssUrl("Source Serif 4")).toBe("https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap");
  });

  it("keep Latin letters only, and only files from Google's own address", () => {
    const faces = parseGoogleCss(css);
    expect(faces.map(f => `${f.subset} ${f.weight} ${f.italic ? "i" : "r"}`)).toEqual(["latin-ext 400 r", "latin 400 r", "latin 700 r"]);
    expect(faces[1].unicodeRange).toBe("U+0000-00FF, U+0131, U+2000-206F");
  });

  it("keep one file for weights served from the same file (a variable font)", () => {
    const { index, files } = fontIndex("Newsreader", parseGoogleCss(css));
    expect([...files.values()]).toEqual(["Newsreader-r-latin-ext-1.woff2", "Newsreader-r-latin-2.woff2"]);
    expect(index.faces.map(f => `${f.file} ${f.weight}`)).toEqual(["Newsreader-r-latin-ext-1.woff2 400", "Newsreader-r-latin-2.woff2 400", "Newsreader-r-latin-2.woff2 700"]);
    expect(fontIndexName("Source Serif 4")).toBe("Source-Serif-4.json");
  });
});
