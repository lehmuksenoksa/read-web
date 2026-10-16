// A few lines instead of a UI library: elements with attributes, handlers and children.

export type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | number | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.replace(/^on/, ""), value as EventListener);
    else if (name === "hidden") el.hidden = Boolean(value);
    else if (value === true) el.setAttribute(name, "");
    else el.setAttribute(name, String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

/** A line icon from SVG markup: 16 px, drawn in the text colour. */
export function icon(markup: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "ic";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = markup;
  return el;
}

const svg = (body: string, size = 16, width = 1.3) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const aa = (body: string) =>
  `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** The sidebar's icons (WEB.md → The sidebar, 2026-10-14). */
export const ICONS = {
  panel: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M6 2.5v11"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.4 10.4 3.4 3.4"/>'),
  sliders: svg('<path d="M3 4.5h6M12.5 4.5H13M3 11.5h.5M7 11.5h6"/><circle cx="10.8" cy="4.5" r="1.6"/><circle cx="5.2" cy="11.5" r="1.6"/>'),
  /** Android's Contents icon (ReadIcons.Contents). */
  contents: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
  more: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>',
  check: svg('<path d="m3.5 8.3 3 3 6-6.6"/>'),
  dropbox: svg('<path d="m4.5 2.8-3 2 3 2 3.5-2zM11.5 2.8l-3.5 2 3.5 2 3-2zM1.5 8.8l3 2 3.5-2-3.5-2zM14.5 8.8l-3-2-3.5 2 3.5 2zM5 11.6l3 2 3-2-3-2z"/>'),
  right: svg('<path d="M6 3.5 10.5 8 6 12.5"/>', 12, 2),
  down: svg('<path d="M3.5 6 8 10.5 12.5 6"/>', 12, 2),
  // Aa (WEB.md → Aa, 2026-10-14): thin − and +, and Layout's choices as pictures.
  minus: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 7h8"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 7h8M7 3v8"/></svg>',
  columns1: aa('<rect x="3" y="2" width="12" height="14" rx="1.5"/><path d="M5.5 5.5h7M5.5 8h7M5.5 10.5h7M5.5 13h4"/>'),
  columns2: aa('<rect x="1.5" y="2" width="15" height="14" rx="1.5"/><path d="M4 5.5h4M4 8h4M4 10.5h4M10 5.5h4M10 8h4M10 10.5h3"/>'),
  scroll: aa('<path d="M4 2v14M7 4h7M7 7h7M7 10h5"/><path d="m2.5 13 1.5 3 1.5-3"/>'),
  posLeft: aa('<path d="M2 3v12"/><path d="M5 5h7M5 8h7M5 11h7M5 14h5" stroke-width="1.6"/>'),
  posCentre: aa('<path d="M5.5 5h7M5.5 8h7M5.5 11h7M5.5 14h5" stroke-width="1.6"/>'),
  posRight: aa('<path d="M16 3v12"/><path d="M6 5h7M6 8h7M6 11h7M6 14h5" stroke-width="1.6"/>'),
};
