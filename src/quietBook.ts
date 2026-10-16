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

/** How long a chapter may stay hidden before it's shown anyway (the script failed or never ran). */
export const QUIET_SAFETY_MS = 500;

/**
 * First thing in each chapter's page: hidden until QUIET_BOOK_SCRIPT has measured and corrected it
 * (laid out but not shown), or until QUIET_SAFETY_MS, whichever is first.
 */
export const QUIET_BOOK_HIDE = `(function () {
  var root = document.documentElement;
  root.style.setProperty("visibility", "hidden", "important");
  window.__readQuietShow = function () { clearTimeout(window.__readQuietTimer); root.style.removeProperty("visibility"); };
  window.__readQuietTimer = setTimeout(window.__readQuietShow, ${QUIET_SAFETY_MS});
})();`;

/**
 * Last thing in each chapter's page (every one Readium loads, those kept ready beside it too), once
 * the book's styles have loaded: the page as it comes out, whatever the book calls things, made
 * quiet (2026-10-16). Blank paragraphs and blocks go (a divider stays: a scene break); anything
 * larger than the text is the text's size; floated letters go back into the line; more than about
 * two lines of space above or below a block becomes one; a deep indent on a short line (a title)
 * goes, but not in quotes and lists. Then the page is shown.
 */
export const QUIET_BOOK_SCRIPT = `(function () {
  var visible = new RegExp(${JSON.stringify(VISIBLE)});
  var px = function (v) { return parseFloat(v) || 0; };
  var set = function (el, prop, value) { el.style.setProperty(prop, value, "important"); };
  try {
    var rem = px(getComputedStyle(document.documentElement).fontSize) || 16;
    document.querySelectorAll("p, div").forEach(function (el) {
      if (!visible.test(el.textContent || "") && !el.querySelector("hr")) set(el, "display", "none");
    });
    var all = document.body ? document.body.querySelectorAll("*") : [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (/^(img|svg|image|picture|video|hr|br|sup|sub)$/i.test(el.localName)) continue;
      var cs = getComputedStyle(el);
      if (cs.display === "none") continue;
      if (px(cs.fontSize) > rem * 1.15) set(el, "font-size", "1rem");
      if (cs.float === "left" || cs.float === "right") { set(el, "float", "none"); set(el, "margin", "0"); set(el, "padding", "0"); }
      if (cs.display === "inline") continue;
      ["margin-top", "margin-bottom", "padding-top", "padding-bottom"].forEach(function (p) {
        if (px(cs.getPropertyValue(p)) > rem * 2.25) set(el, p, "1em");
      });
      var short = (el.textContent || "").trim().length < 80;
      if (short && !el.closest("blockquote, ul, ol, dl, table")) {
        if (px(cs.marginLeft) + px(cs.paddingLeft) >= rem * 2.5) { set(el, "margin-left", "0"); set(el, "padding-left", "0"); }
        if (px(cs.textIndent) > rem * 3.25) set(el, "text-indent", "0");
      }
    }
  } finally {
    if (window.__readQuietShow) window.__readQuietShow();
  }
})();`;
