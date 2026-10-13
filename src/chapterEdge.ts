// Scrolling (the look's Page: Scroll) shows a chapter at a time. A new scroll past a chapter's end
// goes on to the next chapter's start, past its start back to the end of the one before
// (WEB.md, 2026-10-13). "New": the scroll began at that end, so a fling that runs into the end
// stops there, and only a further scroll goes on.

/** Which ends of the chapter are in view (both, for a chapter shorter than the window). */
export interface Ends {
  top: boolean;
  bottom: boolean;
}

/** Wheel events further apart than this are separate scrolls. */
export const QUIET_MS = 250;
/** How far a new scroll pushes past the end before the chapter changes: about two wheel notches. */
export const PAST_PX = 150;
/** How far a finger drags past the end on a touch screen. */
export const TOUCH_PAST_PX = 80;

export type Onward = "next" | "previous" | null;

export class ChapterEdge {
  private lastAt = Number.NEGATIVE_INFINITY;
  private began: Ends = { top: false, bottom: false };
  private pushed = 0;

  constructor(private readonly quietMs = QUIET_MS, private readonly needed = PAST_PX) {}

  /** A wheel's [dy] (pixels, down positive) at [now] (ms), with the ends in view [at] before it scrolls. */
  wheel(dy: number, at: Ends, now: number): Onward {
    if (now - this.lastAt > this.quietMs) {
      this.began = { ...at };
      this.pushed = 0;
    }
    this.lastAt = now;
    if (dy === 0) return null;
    const down = dy > 0;
    if (down ? !(this.began.bottom && at.bottom) : !(this.began.top && at.top)) {
      this.pushed = 0;
      return null;
    }
    this.pushed = Math.sign(this.pushed) === Math.sign(dy) ? this.pushed + dy : dy;
    if (Math.abs(this.pushed) < this.needed) return null;
    // The rest of this scroll doesn't go on again in the chapter it arrives in.
    this.began = { top: false, bottom: false };
    this.pushed = 0;
    return down ? "next" : "previous";
  }
}

/** A finger's drag of [dy] (pixels, up positive: the page scrolls down), begun with [began] in view and ended with [at]. */
export function touchOnward(dy: number, began: Ends, at: Ends, needed = TOUCH_PAST_PX): Onward {
  if (dy >= needed && began.bottom && at.bottom) return "next";
  if (dy <= -needed && began.top && at.top) return "previous";
  return null;
}
