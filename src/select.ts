// Multi-select in Details (2026-10-16): the ticked rows, kept while the Library is drawn again.
// The rules are pure so they can be tested: a tick toggles one row, a shift-tick a range from the
// last tick, the heading box all or none; rows no longer shown (a search, Hidden) drop out.

export interface Selection {
  /** The ticked books, in the order they were ticked. */
  ids: string[];
  /** The row ticked last: where a shift-tick's range starts. */
  anchor: string | null;
}

export const NO_SELECTION: Selection = { ids: [], anchor: null };

/** A row's box clicked: toggles it; with shift, adds the rows from the last tick to it. */
export function toggleRow(selection: Selection, id: string, visible: string[], shift: boolean): Selection {
  const from = selection.anchor ? visible.indexOf(selection.anchor) : -1;
  const to = visible.indexOf(id);
  if (shift && from >= 0 && to >= 0) {
    const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1);
    return { ids: [...selection.ids, ...range.filter(x => !selection.ids.includes(x))], anchor: selection.anchor };
  }
  const on = selection.ids.includes(id);
  return { ids: on ? selection.ids.filter(x => x !== id) : [...selection.ids, id], anchor: id };
}

/** The heading's box: none when anything is ticked (some or all), else every shown row (2026-10-16). */
export function toggleAll(selection: Selection, visible: string[]): Selection {
  return selection.ids.length ? NO_SELECTION : { ids: [...visible], anchor: selection.anchor };
}

/** The selection with the rows no longer shown dropped (a search typed, Hidden switched, Grid). */
export function pruneSelection(selection: Selection, visible: string[]): Selection {
  const ids = selection.ids.filter(id => visible.includes(id));
  if (ids.length === selection.ids.length) return selection;
  return { ids, anchor: selection.anchor && visible.includes(selection.anchor) ? selection.anchor : null };
}

/** The value they all share, or null when they differ or any is empty: what Set details… prefills. */
export function sharedValue(values: (string | null | undefined)[]): string | null {
  const first = values[0] ?? null;
  return first && values.every(v => (v ?? null) === first) ? first : null;
}
