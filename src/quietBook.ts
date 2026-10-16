// Office reads books quietly (WEB.md → One app, two styles, 2026-10-16): a stylesheet over the
// book's own, and blank paragraphs hidden as each chapter loads. Visible scene breaks stay.

/**
 * Office's quiet book (2026-10-16): headings at the text's size, drop caps back to a letter, no
 * images, no extra blank lines (repeated line breaks, empty blocks, the book's own spacing on
 * chapter blocks). Laid over the book's own styles; Home keeps them.
 */
export const QUIET_BOOK_CSS = `
h1, h2, h3, h4, h5, h6 { font-size: 1em !important; font-weight: 600 !important; text-align: start !important; margin: 1.2em 0 .8em !important; padding: 0 !important; line-height: inherit !important; letter-spacing: normal !important; text-transform: none !important; font-variant: normal !important; }
::first-letter { font-size: inherit !important; float: none !important; }
[class*="drop" i], [class*="initial" i], [class*="firstletter" i], [class*="first-letter" i] { font-size: inherit !important; float: none !important; line-height: inherit !important; margin: 0 !important; }
img, svg, picture, video, image { display: none !important; }
br + br { display: none !important; }
p:empty, div:empty { display: none !important; }
section, article, body > div, :is(section, article, body > div) > :first-child { margin-top: 0 !important; margin-bottom: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; }
`;

/** A character that shows: anything but spaces, no-break spaces and zero-width characters. */
const VISIBLE = "[^\\s\\u00a0\\u200b\\u200c\\u200d\\u2060\\ufeff]";

/** Text with nothing visible in it. */
export function isBlankText(text: string): boolean {
  return !new RegExp(VISIBLE).test(text);
}

/**
 * Run in each chapter's page (every one Readium loads, the ones kept ready beside it too): the
 * paragraphs and blocks with no visible text and no divider are hidden (a scene break's line stays).
 */
export const QUIET_BOOK_SCRIPT = `(function () {
  var visible = new RegExp(${JSON.stringify(VISIBLE)});
  function run() {
    document.querySelectorAll("p, div").forEach(function (el) {
      if (!visible.test(el.textContent || "") && !el.querySelector("hr")) el.style.setProperty("display", "none", "important");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();`;
