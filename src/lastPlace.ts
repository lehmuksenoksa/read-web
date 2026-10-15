// What this browser alone remembers between visits (WEB.md → One app, two styles, 2026-10-15):
// where it was (a book, a serial, or the Library) and whether Contents was open beside the page.
// Nothing here goes to Dropbox.

/** Where this browser was: it opens there next time. The Library's side (Library or Serials) is Web's setup's. */
export type LastPlace = { kind: "library" } | { kind: "book"; id: string } | { kind: "serial"; id: string };

export const LAST_PLACE_KEY = "read.last";
export const CONTENTS_KEY = "read.contents";

/** The kept text read back; anything else (nothing kept, an older or broken value): the Library. */
export function parseLastPlace(text: string | null): LastPlace {
  try {
    const raw = text ? JSON.parse(text) : null;
    if ((raw?.kind === "book" || raw?.kind === "serial") && typeof raw.id === "string" && raw.id) return { kind: raw.kind, id: raw.id };
  } catch {
    // Not JSON: the Library.
  }
  return { kind: "library" };
}

export function lastPlaceText(place: LastPlace): string {
  return JSON.stringify(place);
}

/**
 * Contents remembered open after the reader's panels changed to [open]: open when Contents is,
 * closed when Aa replaced it or it was closed. Over the page (a narrow window) it's a passing
 * look and changes nothing.
 */
export function contentsRemembered(was: boolean, open: "contents" | "aa" | null, overlay: boolean): boolean {
  return overlay ? was : open === "contents";
}
