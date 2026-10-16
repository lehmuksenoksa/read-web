// What a book's or a series' panel says (WEB.md → One app, two styles → the panels, agreed from
// mockups 2026-10-16): one line for where you are, one button, one status word.
import type { LibraryBook, Place } from "./library";

export type BookState =
  | { kind: "read" }
  | { kind: "loading" }
  | { kind: "new" }
  | { kind: "started"; p: number; chapter: string | null };

/** The furthest place on any device: at first glance the device doesn't matter. */
export function furthestPlace(places: Place[]): Place | null {
  return places.reduce<Place | null>((best, x) => (!best || x.p > best.p ? x : best), null);
}

/** Read (its mark, or read to the end); not known yet; not started; or how far, at the furthest device. */
export function bookState(read: boolean, places: Place[] | null, hasSyncFile: boolean): BookState {
  if (read) return { kind: "read" };
  if (places == null) return hasSyncFile ? { kind: "loading" } : { kind: "new" };
  const far = furthestPlace(places);
  return far && far.p > 0 ? { kind: "started", p: far.p, chapter: far.chapter } : { kind: "new" };
}

/** The one button. */
export function goLabel(state: BookState): string {
  return state.kind === "read" ? "Read again" : state.kind === "started" ? "Continue" : "Read";
}

/** The one status word beside it (two clicks to reset a book partway through: read, then unread). */
export function statusAction(state: BookState): "Mark as read" | "Mark as unread" {
  return state.kind === "read" ? "Mark as unread" : "Mark as read";
}

/** A series' line: which book is next ("Book 2 of 3"), its title and how far, and the bar over the whole series. */
export function seriesLine(books: LibraryBook[], next: LibraryBook | null, progress: (id: string) => number | null): { left: string; right: string; fraction: number } {
  const n = books.length;
  const read = books.filter(b => b.read).length;
  if (!n) return { left: "", right: "", fraction: 0 };
  if (!next) return { left: read === n ? "All read" : "", right: "", fraction: read / n };
  const p = progress(next.id) ?? 0;
  const at = next.seriesIndex ?? books.indexOf(next) + 1;
  return {
    left: `Book ${at} of ${n}`,
    right: `${next.title}${p > 0 ? ` · ${Math.round(p * 100)}%` : ""}`,
    fraction: (read + p) / n,
  };
}
