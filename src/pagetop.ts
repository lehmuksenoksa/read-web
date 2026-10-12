// The words at the top of the web's page, saved with its place, so the phones' Go there finds the
// same page (their Readium looks a place up by its words and its paragraph's name before its
// progress; SPEC → Sync, report 2026-10-12: the progress alone landed on another page).

/** Letters inside a word: a cut never splits one. */
const inWord = (c: string) => /[\p{L}\p{N}'’]/u.test(c);

/**
 * The quote for a place [offset] characters into a block's [text]: from the start of the word
 * there ([highlight], at most [length] characters, whole words) and the words just before it
 * ([before], at most [beforeLength]). Null when there's no text there.
 */
export function quoteAt(text: string, offset: number, length = 120, beforeLength = 40): { highlight: string; before: string } | null {
  let start = Math.max(0, Math.min(offset, text.length));
  while (start > 0 && inWord(text[start - 1]) && start < text.length && inWord(text[start])) start--;
  while (start < text.length && /\s/.test(text[start])) start++;
  if (start >= text.length) return null;
  let highlight = text.slice(start, start + length);
  if (start + length < text.length && !/\s/.test(text[start + length])) {
    const cut = highlight.search(/\s\S*$/);
    if (cut > 0) highlight = highlight.slice(0, cut);
  }
  highlight = highlight.trimEnd();
  if (!highlight) return null;
  let before = text.slice(Math.max(0, start - beforeLength), start);
  if (start - beforeLength > 0) before = before.replace(/^\S*\s/, "");
  return { highlight, before };
}

const TEXT_BLOCKS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dd", "dt", "td", "th", "caption",
  "blockquote", "pre", "figcaption", "section", "article", "aside", "header", "footer", "address", "center",
]);

export interface PageTop {
  cssSelector: string;
  highlight: string;
  before: string;
}

/**
 * The first words showing in a book page's window [wnd] (Readium's paginated frame: the page in
 * view spans x from 0 to its width), with the name of the block holding them (`#read-bN`, as the
 * app names it). Null when the page shows no text (a picture).
 */
export function pageTop(wnd: Window): PageTop | null {
  const doc = wnd.document;
  const width = wnd.innerWidth;
  const height = wnd.innerHeight;
  const range = doc.createRange();
  const shows = (r: DOMRect) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < width && r.bottom > 0 && r.top < height;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.textContent && n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    range.selectNodeContents(node);
    if (!Array.from(range.getClientRects()).some(shows)) continue;
    // The first character in view: characters run left to right across the pages, and top to bottom when scrolling.
    let lo = 0;
    let hi = node.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      range.setStart(node, mid);
      range.setEnd(node, mid + 1);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { lo = mid + 1; continue; }
      if (r.right <= 0 || r.bottom <= 0) lo = mid + 1;
      else hi = mid;
    }
    let block: Element | null = node.parentElement;
    while (block && !(TEXT_BLOCKS.has(block.localName) && block.id)) block = block.parentElement;
    if (!block) return null;
    range.setStart(block, 0);
    range.setEnd(node, lo);
    const quote = quoteAt(block.textContent ?? "", range.toString().length);
    if (!quote) return null;
    return { cssSelector: `#${CSS.escape(block.id)}`, ...quote };
  }
  return null;
}

/** Readium's locator JSON with the page's top words and their block in it. */
export function withPageTop(locator: Record<string, unknown>, top: PageTop | null): Record<string, unknown> {
  if (!top) return locator;
  const locations = { ...((locator.locations as Record<string, unknown>) ?? {}), cssSelector: top.cssSelector };
  return { ...locator, locations, text: { highlight: top.highlight, before: top.before } };
}
