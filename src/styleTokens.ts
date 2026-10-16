// One app, two styles, as tokens (WEB.md → One app, two styles; agreed 2026-10-16). Everything Home and
// Office may differ in is one of these values; everything else is the same in both by rule. The code
// reads a token, never "is this Office"; the stylesheet keys on the token's class on #app (t-…), and
// the palette (Light and Dark per style) stays on the style's class (homeon / office).
// The book's styling is the eighth difference; it lives in Web's setup (bookStyling), per style.

export interface StyleTokens {
  /** The name at the left of the bar: the drawn wordmark, or the words "Library & Serials". */
  name: "wordmark" | "words";
  /** The display face: titles in the panels, the bar's title, Continue, a serial's chapters. */
  face: "serif" | "sans";
  /** The accent: a title's first word in wax red and filled buttons; or ink only. */
  accent: boolean;
  /** Surfaces: panels as inset cards with a faint edge and no lines; or hanging from a hairline under the bar. */
  surface: "cards" | "hairline";
  /** Covers in the panels and Details' Cover column. */
  covers: boolean;
  /** The views and the size control; without them, Details only. */
  views: boolean;
  /** Roomy: the tall bar, tags as badges, "+ Add books" as a button. Tight: the short bar, plain words. */
  density: "roomy" | "tight";
}

export const HOME_STYLE: StyleTokens = { name: "wordmark", face: "serif", accent: true, surface: "cards", covers: true, views: true, density: "roomy" };
export const OFFICE_STYLE: StyleTokens = { name: "words", face: "sans", accent: false, surface: "hairline", covers: false, views: false, density: "tight" };

export const styleFor = (home: boolean): StyleTokens => (home ? HOME_STYLE : OFFICE_STYLE);

/** The classes on #app that the stylesheet keys on, one per token. */
export function tokenClasses(t: StyleTokens): string[] {
  return [
    `t-${t.name}`,
    `t-${t.face}`,
    t.accent ? "t-accent" : "t-ink",
    `t-${t.surface}`,
    t.covers ? "t-covers" : "t-nocovers",
    t.views ? "t-views" : "t-oneview",
    `t-${t.density}`,
  ];
}
