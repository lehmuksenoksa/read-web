// Home: the full Library (WEB.md → Home, agreed 2026-10-15): Covers and Details (Cards went 2026-10-16), a book's or a
// series' panel at the right, the size control, Details and Continue. The data and the
// actions (the book menu, Edit details, opening a book) are the page's own, passed in.

import { sharpCover } from "./covers";
import {
  ago, besideReadingNow, BOOK_VIEWS, clickSort, column, curatedHome, DETAIL_COLUMNS, detailsRows, homeItems, inOrder, megabytes,
  fitColumns, menuSort, nextInSeries, SERIAL_VIEWS, seriesLine, SIZES, sortMenuChoice, textScale, titleWord,
  viewFor, type BookView, type ColumnKey, type Facts, type HomeSetup, type SerialsSetup, type SerialView,
} from "./home";
import {
  chapterDateLabel, lastCheck, lastReadSerial, newChaptersText, panelChapters, readingOrderOf, searchSerials, SERIAL_DETAIL_COLUMNS, serialColumn, shortChapter, sortSerials,
  type Serial, type SerialColumnKey,
} from "./serials";
import { addSummary, outcomeText, type AddOutcome } from "./addBooks";
import { lastReadBook, type LibraryBook, type LibraryItem, type Place, type SortBy } from "./library";
import type { Chrome, Setup } from "./looks";
import { styleFor } from "./styleTokens";
import { parseNumber, type DetailsEdit } from "./details";
import { bookState, furthestPlace, goLabel, seriesLine as seriesProgress, statusAction } from "./panelState";
import { h, icon, ICONS, type Child } from "./ui";
import { WORDMARK_BASELINE, wordmark } from "./wordmark";

export interface HomeContext {
  /** Every book, with the marks set here (hidden ones too). */
  books(): LibraryBook[];
  showHidden(): boolean;
  setShowHidden(on: boolean): void;
  setup(): Setup;
  update(setup: Setup): void;
  /** What the book's sync file told, while it's still its latest; null: not read yet. */
  progress(id: string): number | null;
  places(id: string): Place[] | null;
  /** Reads the book's sync file (once; kept) for its progress and places. */
  load(book: LibraryBook): Promise<void>;
  open(book: LibraryBook): void;
  menu(book: LibraryBook, x: number, y: number): void;
  /** The book's read mark as its menu shows it. */
  readMark(book: LibraryBook): "read" | "auto";
  setRead(book: LibraryBook, read: true | null): void;
  markUnread(book: LibraryBook): void;
  setHidden(book: LibraryBook, hidden: boolean): void;
  edit(book: LibraryBook): void;
  /** The panel's details edited in place (2026-10-16): into the shared details file, as Edit details does. */
  saveDetails(book: LibraryBook, edit: DetailsEdit): void;
  saveSerial(serial: Serial, title: string, author: string | null): void;
  /** The panel's Mark as read: with a message and Undo. */
  markRead(book: LibraryBook): void;
  /** The selection's actions (Details, 2026-10-16): the same marks for every ticked book, one message. */
  /** Set details… for the ticked books: a series and an author for them all. */
  signOut(): void;
  offline(): boolean;
  /** Home (true) or Office (false): this browser's choice, in ⚙. */
  isHome(): boolean;
  setHome(on: boolean): void;
  /** Light or Dark around the page, for the style in use: ⚙ › Interface. */
  chrome(): Chrome;
  setChrome(chrome: Chrome): void;
  /** The Library or Serials page, from the bar's name while a book is open. */
  showLibrary(side: "books" | "serials"): void;
  /** Add books: reads a file (its title and author, for its line), then adds it to /Books/. */
  readFile(file: File): Promise<{ title: string | null; author: string | null; add: () => Promise<AddOutcome> }>;
  /** The serials (WEB.md → Home, step 3a); null until read. */
  serials(): Serial[] | null;
  /** Reads the serials' files from Dropbox (once, and again after a while away). */
  loadSerials(): Promise<void>;
  /** Edit details… for a serial: its title and author. */
  editSerial(serial: Serial): void;
  /** A serial into the reader (step 3b). */
  openSerial(serial: Serial): void;
  /** How many of its chapters are in Dropbox; null until listed (then Home is drawn again). */
  chaptersInDropbox(serial: Serial): number | null;
}

/** The covers' colours when a book has no cover of its own. */
const TONES = [["#2E3B2F", "#E6D8B0"], ["#3A2A22", "#E8C9A0"], ["#4A3B5C", "#EADCF2"], ["#1F3747", "#CFE3EE"], ["#6B2E1F", "#F2D0B8"], ["#3B1216", "#E9C3C3"], ["#1E2A44", "#D9E0F2"], ["#44403A", "#E6E0D6"]];

const GEAR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const CLOSE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg>';

function svgEl(markup: string, cls = "ic"): HTMLElement {
  const el = h("span", { class: cls, "aria-hidden": "true" });
  el.innerHTML = markup;
  return el;
}

/** A title with its first word (not "A", "An", "The") in its own span: wax red on Dark, plain on Light. */
function redTitle(title: string): HTMLElement {
  const [before, word, after] = titleWord(title);
  return h("span", { class: "rt" }, before, h("span", { class: "w" }, word), after);
}

function toneOf(id: string): string[] {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[n % TONES.length];
}

/**
 * A book's cover: its sharp one when it's here (covers.ts), else the phones' small JPEG, or a plain one with
 * its title in its colours. Marked with the book's id, so a sharp cover arriving later takes its place.
 */
function cover(book: LibraryBook, withText: boolean): HTMLElement {
  return coverBox(book.id, book.title, book.author, book.cover ? `data:image/jpeg;base64,${book.cover}` : null, withText);
}

/**
 * A serial's cover (2026-10-17): the sharp one the phones put in the covers folder (the site's own, or
 * a Royal Road or Hardcover match, or the user's pick), else the same plain cover a book without one gets.
 */
function serialCover(x: Serial): HTMLElement {
  return coverBox(x.id, x.title, x.author, null, true);
}

function coverBox(id: string, title: string, author: string | null, small: string | null, withText: boolean): HTMLElement {
  const src = sharpCover(id) ?? small;
  if (src) return h("div", { class: "cv", "data-cover": id }, h("img", { src, alt: "" }));
  const [bg, fg] = toneOf(id);
  return h("div", { class: "cv", "data-cover": id, style: `background:${bg};color:${fg}` },
    withText ? h("span", { class: "ct" }, title) : null,
    withText && author ? h("span", { class: "ca" }, author) : null);
}

/** The cover's or card's one mark: the percentage, READ, or a series' count. */
/** The children that are there. */
const present = (...children: (Node | null)[]) => children.filter((c): c is Node => c != null);

function pct(p: number | null): string {
  return p != null && p > 0 ? `${Math.round(p * 100)}%` : "";
}

/** What the bar shows while a book or serial is open: its title over the page, and where you are. */
export interface ReadingTitle {
  title: string;
  place: string;
  /** The page's box on screen: the title starts at its left edge, the place ends at its right. */
  left: number;
  width: number;
  /** Library in front for a book, Serials for a serial. */
  side: "books" | "serials";
}

export function createHome(ctx: HomeContext): {
  el: HTMLElement; bar: HTMLElement; gear: HTMLElement; render: () => void; isOpen: () => boolean; closePanel: () => void;
  setReading: (title: ReadingTitle | null) => void;
} {
  let query = "";
  let menuOpen: HTMLElement | null = null;
  /** The panel's book, series or serial; null when closed. */
  let panelFor: { book: LibraryBook } | { series: LibraryBook[] } | { serial: string } | null = null;

  /** The style in use as tokens (styleTokens.ts): what may differ between Home and Office, read here, never "is this Office". */
  const style = () => styleFor(ctx.isHome());
  /** Tags as badges ("2 NEW") or plain words ("2 new"): the density's. */
  const badges = () => style().density === "roomy";
  /** A title with its first word marked: wax red with the accent, plain without (the stylesheet decides). */
  const panelTitle = (title: string): Node => redTitle(title);
  /** A book or serial open in the reader: the bar shows its title, and the name goes back to the Library. */
  let reading: ReadingTitle | null = null;

  /** Library & Serials: the one in front is the side shown; a click on the other turns to it. Office: the words. */
  const markEl = h("div", { class: "hmark", "aria-label": "Library & Serials" });
  const renderMark = (books: boolean) => {
    if (style().name === "words") {
      markEl.innerHTML = `<button class="lib txt" aria-pressed="${books}">Library</button><span class="amp">&amp;</span><button class="ser txt" aria-pressed="${!books}">Serials</button>`;
      return;
    }
    const m = wordmark(books, 40);
    markEl.innerHTML = `<button class="lib" aria-pressed="${books}" title="Library">${m.library}</button><span class="and">${m.ampersand}</span><button class="ser" aria-pressed="${!books}" title="Serials">${m.serials}</button>`;
  };
  markEl.addEventListener("click", e => {
    const side = (e.target as HTMLElement).closest(".lib") ? "books" : (e.target as HTMLElement).closest(".ser") ? "serials" : null;
    if (!side) return;
    if (reading) return ctx.showLibrary(side);
    if (side === home().tab) return;
    closePanel();
    setHome({ tab: side });
  });
  const search = h("input", { type: "search", placeholder: "Search title or author", "aria-label": "Search title or author" });
  const searchBox = h("label", { class: "hsearch" }, icon(ICONS.search), search);
  const gear = h("button", { class: "hicon", title: "Settings", "aria-label": "Settings" }, svgEl(GEAR));
  const titleBt = h("span", { class: "bt" });
  const titlePlace = h("span", { class: "pl2" });
  const titleEl = h("div", { class: "httl", hidden: true }, titleBt, titlePlace);
  const header = h("header", { class: "hhead" }, markEl, h("span", { class: "grow" }), searchBox, gear, titleEl);
  const count = h("button", { class: "hcount", "aria-haspopup": "menu" });
  const zoomLess = h("button", { class: "zb", title: "Smaller", "aria-label": "Smaller" });
  const zoom = h("input", { type: "range", min: "0", max: String(SIZES.length - 1), step: "1", "aria-label": "Size" });
  const zoomMore = h("button", { class: "zb", title: "Larger", "aria-label": "Larger" });
  const views = h("div", { class: "hviews", role: "tablist" });
  const addButton = h("button", { class: "hadd" });
  const status = h("div", { class: "hstatus" }, count, h("span", { class: "grow" }), h("div", { class: "hzoom" }, zoomLess, zoom, zoomMore), views, addButton);
  const main = h("main", { class: "hmain" });
  const cont = h("button", { class: "hcont", hidden: true });
  const panel = h("aside", { class: "hpanel", "aria-label": "Book" });
  const el = h("div", { class: "home" }, status, main, cont, panel);

  const home = () => ctx.setup().home;
  const setHome = (change: Partial<HomeSetup>) => ctx.update({ ...ctx.setup(), home: { ...home(), ...change } });
  const serialsSetup = () => home().serials;
  const setSerials = (change: Partial<SerialsSetup>) => setHome({ serials: { ...serialsSetup(), ...change } });
  const onSerials = () => home().tab === "serials";
  const facts: Facts = {
    progress: id => ctx.progress(id),
    device: id => ctx.places(id)?.[0]?.device ?? null,
  };

  // --- Menus: the sort menu (the status line), ⚙ ---

  const closeMenu = () => { menuOpen?.remove(); menuOpen = null; };
  const openMenu = (menu: HTMLElement, anchor: HTMLElement, alignRight = false) => {
    closeMenu();
    menu.classList.add("hmenu");
    // In the app, beside the bar: the menus show over the reader too.
    (header.parentElement ?? el).append(menu);
    const r = anchor.getBoundingClientRect();
    const w = menu.getBoundingClientRect().width;
    menu.style.left = `${Math.max(8, Math.min(alignRight ? r.right - w : r.left, window.innerWidth - w - 8))}px`;
    menu.style.top = `${r.bottom + 6}px`;
    menuOpen = menu;
  };
  const tick = (on: boolean) => h("span", { class: "v" }, on ? icon(ICONS.check) : null);
  /** The sort menu, for Details' sort or the curated page's All ([which]). */
  const sortMenu = (which: "sort" | "gridSort" = "sort") => {
    const now = sortMenuChoice(home()[which]);
    const choice = (by: SortBy, name: string) => h("button", { class: "r", role: "menuitemradio", "aria-checked": String(now === by), onclick: () => { closeMenu(); setHome({ [which]: menuSort(by) }); } }, name, tick(now === by));
    const hidden = ctx.showHidden();
    const group = ctx.setup().groupSeries;
    return h("div", { role: "menu" },
      h("div", { class: "lab" }, "Sort"),
      choice("recent", "Recent"), choice("title", "Title"), choice("author", "Author"),
      h("hr"),
      h("button", { class: "r", role: "menuitemcheckbox", "aria-checked": String(group), onclick: () => { closeMenu(); ctx.update({ ...ctx.setup(), groupSeries: !group }); } }, "Group series", tick(group)),
      h("hr"),
      h("div", { class: "lab" }, "Show"),
      h("button", { class: "r", role: "menuitemradio", "aria-checked": String(!hidden), onclick: () => { closeMenu(); ctx.setShowHidden(false); } }, "All books", tick(!hidden)),
      h("button", { class: "r", role: "menuitemradio", "aria-checked": String(hidden), onclick: () => { closeMenu(); ctx.setShowHidden(true); } }, "Hidden", tick(hidden)));
  };
  count.addEventListener("click", e => { e.stopPropagation(); if (menuOpen) closeMenu(); else if (!onSerials()) openMenu(sortMenu(), count); });
  gear.addEventListener("click", e => {
    e.stopPropagation();
    if (menuOpen) return closeMenu();
    const homeNow = ctx.isHome();
    openMenu(h("div", { role: "menu" },
      ctx.offline() ? h("div", { class: "lab" }, "Dropbox: offline") : null,
      h("div", { class: "lab" }, "Style"),
      h("button", { class: "r", role: "menuitemradio", "aria-checked": String(homeNow), onclick: () => { closeMenu(); if (!homeNow) ctx.setHome(true); } }, "Home", tick(homeNow)),
      h("button", { class: "r", role: "menuitemradio", "aria-checked": String(!homeNow), onclick: () => { closeMenu(); if (homeNow) ctx.setHome(false); } }, "Office", tick(!homeNow)),
      h("hr"),
      h("div", { class: "lab" }, "Interface"),
      ...(["light", "dark"] as const).map(c => h("button", {
        class: "r", role: "menuitemradio", "aria-checked": String(ctx.chrome() === c), onclick: () => { closeMenu(); ctx.setChrome(c); },
      }, c === "light" ? "Light" : "Dark", tick(ctx.chrome() === c))),
      h("hr"),
      h("button", { class: "r", role: "menuitem", onclick: () => { closeMenu(); ctx.signOut(); } }, "Sign out")), gear, true);
  });

  // --- Progress, read when an item comes into view ---

  let renderTimer: number | undefined;
  const renderSoon = () => { window.clearTimeout(renderTimer); renderTimer = window.setTimeout(render, 80); };
  const seen = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      seen.unobserve(entry.target);
      const book = ctx.books().find(b => b.id === (entry.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id);
      if (book && ctx.progress(book.id) == null && book.hasSyncFile) void ctx.load(book).then(renderSoon);
    }
  }, { root: main, rootMargin: "200px" });

  // --- The views ---

  const books = () => ctx.books().filter(b => !!b.hidden === ctx.showHidden());
  const progressOf = (b: LibraryBook) => (b.read ? 1 : ctx.progress(b.id));

  const gridItem = (item: LibraryItem) => {
    if (item.kind === "series") {
      const first = inOrder(item.books)[0];
      return h("button", { class: "cell", onclick: () => openSeries(item.books), "aria-label": `${item.name}, ${item.books.length} books` },
        h("span", { class: "stack" }),
        h("span", { class: "cvw" }, cover({ ...first, title: item.name }, true), h("span", { class: "badge round" }, String(item.books.length))),
        h("span", { class: "t" }, item.name),
        h("span", { class: "a" }, item.author ?? ""));
    }
    const b = item.book;
    const p = progressOf(b);
    return h("button", { class: "cell", "data-id": b.id, onclick: () => openBook(b) },
      h("span", { class: "cvw" }, cover(b, true),
        b.read ? h("span", { class: "badge tag" }, "READ") : pct(p) ? h("span", { class: "badge" }, pct(p)) : null),
      h("span", { class: "t" }, b.title),
      h("span", { class: "a" }, b.author ?? ""));
  };

  const cell = (b: LibraryBook, key: ColumnKey) => {
    const c = column(key);
    // Text in its own span, so a long one ends in "…" a gap short of the next column instead of running into it.
    const td = (child: Node | string, cls = "") => h("div", { class: `td${c.right ? " ra" : ""}${cls ? ` ${cls}` : ""}` }, typeof child === "string" ? h("span", { class: "tx" }, child) : child);
    switch (key) {
      case "cover": return td(cover(b, false), "cvc");
      case "title": return td(h("span", { class: "t" }, b.title));
      case "author": return td(b.author ?? "", "dim");
      // The series with its number: "Mage Tank 5" (the # column went with the chooser, 2026-10-17).
      case "series": return td(b.series ? [b.series, b.seriesIndex != null ? String(b.seriesIndex) : ""].filter(Boolean).join(" ") : "", "dim");
      case "progress": {
        const p = b.read ? 1 : ctx.progress(b.id) ?? 0;
        return td(h("span", { class: "prog" }, h("span", { class: "pl" }, h("i", { style: `width:${Math.round(p * 100)}%` })), h("span", { class: "pc" }, `${Math.round(p * 100)}%`)));
      }
      case "last": return td(ago(b.lastRead, Date.now()), "dim");
      // Sorts only, never shown (2026-10-17).
      case "num": case "on": case "added": case "size": return td("");
    }
  };

  const details = (list: LibraryBook[]) => {
    // Office has no covers: no Cover column (WEB.md → One app, two styles).
    // A narrow window: the less important columns go until the rest fit (2026-10-16).
    const cols = fitColumns(DETAIL_COLUMNS.filter(k => style().covers || k !== "cover"), k => BOOK_LEAST[k] + 24, tableRoom(), ["cover", "series", "last", "progress", "author"]);
    const sort = home().sort;
    const table = h("div", { class: "tbl", role: "table", style: `grid-template-columns:${cols.map(widthOf).join(" ")}` });
    table.append(h("div", { class: "tr hd", role: "row" },
      ...cols.map(key => {
        const c = column(key);
        const on = sort.key === key;
        return h("div", {
          class: `th${c.right ? " ra" : ""}${on ? " sort" : ""}`, role: "columnheader", "data-col": key,
          "aria-sort": on ? (sort.reversed === (c.firstDir === 1) ? "descending" : "ascending") : undefined,
          onclick: () => { if (key !== "cover") setHome({ sort: clickSort(sort, key) }); },
        }, c.heading, on ? (sort.reversed ? " ▴" : " ▾") : "");
      })));
    for (const b of list) {
      table.append(h("div", { class: `tr${panelFor && "book" in panelFor && panelFor.book.id === b.id ? " on" : ""}`, role: "row", "data-id": b.id, onclick: () => openBook(b) },
        ...cols.map(key => cell(b, key))));
    }
    return table;
  };

  /** Each column's least width (the minmax minimum, or its fixed width), for fitting a narrow window. */
  const BOOK_LEAST: Record<ColumnKey, number> = { cover: 36, title: 220, author: 140, series: 170, num: 0, progress: 170, last: 120, on: 0, added: 0, size: 0 };
  const SERIAL_LEAST: Record<SerialColumnKey, number> = { title: 220, author: 200, site: 0, new: 0, unread: 0, updated: 0, latest: 200, reading: 200, lastread: 110 };
  /** The room for a Details table's columns: the books' area less its padding; no limit before it's laid out. */
  const tableRoom = () => {
    if (!main.clientWidth) return Infinity;
    const cs = getComputedStyle(main);
    return main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  const widthOf = (key: ColumnKey) => ({
    cover: "calc(36px*var(--z))", title: "minmax(220px,2.2fr)", author: "minmax(140px,1.3fr)", series: "minmax(170px,1.3fr)",
    num: "0", progress: "minmax(170px,1.3fr)", last: "120px", on: "0", added: "0", size: "0",
  })[key];

  // --- Serials (WEB.md → Home, step 3a): from the phones' chapter lists, read only ---

  const SERIAL_WIDTHS: Record<SerialColumnKey, string> = {
    title: "minmax(220px,2fr)", author: "minmax(200px,1.4fr)", site: "0", new: "0", unread: "0", updated: "0",
    latest: "minmax(200px,1.8fr)", reading: "minmax(200px,1.8fr)", lastread: "110px",
  };
  /** "2 NEW" in the seal's colours. */
  const newTag = (x: Serial) => x.progress.newCount ? h("span", { class: "tag new" }, `${x.progress.newCount} ${badges() ? "NEW" : "new"}`) : null;
  /** "30 UNREAD" (the unread ones not NEW), or CAUGHT UP. */
  const unreadTag = (x: Serial) => {
    const n = x.progress.olderUnreadCount;
    if (n) return h("span", { class: "tag" }, `${n} ${badges() ? "UNREAD" : "unread"}`);
    return x.caughtUp ? h("span", { class: "tag cu" }, badges() ? "CAUGHT UP" : "Caught up") : null;
  };
  const tagRow = (x: Serial) => h("span", { class: "tagrow" }, ...present(newTag(x), unreadTag(x)));
  const bySite = (x: Serial) => [x.author, x.site].filter(Boolean).join(" · ");
  /** "214 of 215 chapters in Dropbox", once listed. */
  const inDropbox = (x: Serial) => {
    const n = ctx.chaptersInDropbox(x);
    const of = readingOrderOf(x.chapters).length;
    return n == null || !of ? "" : `${Math.min(n, of)} of ${of} chapters in Dropbox`;
  };
  const serialOpen = (x: Serial) => panelFor != null && "serial" in panelFor && panelFor.serial === x.id;

  /** The List row (2026-10-17, after Royal Road's follow list): the cover at the left, the lines at its foot. */
  const serialCard = (x: Serial) => {
    const lines = () => {
      const now = Date.now();
      const latest = x.latest;
      const same = latest && x.current && latest.id === x.current.id;
      return h("span", { class: "lines" },
        ...(latest ? [h("span", { class: "k" }, "LATEST"), h("span", {}, latest.title), h("span", { class: "d" }, chapterDateLabel(latest.published, now, true) ?? "")] : []),
        ...(same ? [] : [h("span", { class: "k" }, "READING"), h("span", { class: x.current ? "" : "dim" }, x.current?.title ?? "Not started"), h("span", { class: "d" }, chapterDateLabel(x.current?.published, now, true) ?? "")]));
    };
    return h("button", { class: `scard${serialOpen(x) ? " on" : ""}`, "data-sid": x.id, onclick: () => openSerial(x) },
      serialCover(x),
      h("span", { class: "body" },
        h("span", { class: "head" }, h("span", { class: "t" }, redTitle(x.title)), tagRow(x)),
        h("span", { class: "a" }, bySite(x)),
        lines()));
  };

  const serialCell = (x: Serial, key: SerialColumnKey) => {
    const td = (child: Node | string | null, cls = "") => h("div", { class: `td${cls ? ` ${cls}` : ""}` }, ...present(typeof child === "string" ? document.createTextNode(child) : child));
    switch (key) {
      case "title": return td(h("span", { class: "t" }, x.title));
      case "author": return td(bySite(x), "dim");
      case "latest": return td(x.latest?.title ?? "", "dim");
      case "reading": return td(x.current?.title ?? (x.chapters.length ? "Not started" : ""), "dim");
      case "lastread": return td(x.lastRead ? ago(new Date(x.lastRead).toISOString(), Date.now()) : "", "dim");
      // Sorts only, never shown (2026-10-17).
      case "site": case "new": case "unread": case "updated": return td("");
    }
  };

  const serialDetails = (list: Serial[]) => {
    const sort = serialsSetup().sort;
    const cols = fitColumns(SERIAL_DETAIL_COLUMNS, k => SERIAL_LEAST[k] + 24, tableRoom(), ["lastread", "reading", "latest", "author"]);
    const box = h("div", { class: "tbl ser", role: "table", style: `grid-template-columns:${cols.map(k => SERIAL_WIDTHS[k]).join(" ")}` });
    box.append(h("div", { class: "tr hd", role: "row" },
      ...cols.map(key => {
        const on = sort.key === key;
        return h("div", {
          class: `th${on ? " sort" : ""}`, role: "columnheader", "data-col": key,
          onclick: () => setSerials({ sort: sort.key === key ? { key, reversed: !sort.reversed } : { key, reversed: false } }),
        }, serialColumn(key).heading, on ? (sort.reversed ? " ▴" : " ▾") : "");
      })));
    for (const x of list) {
      box.append(h("div", { class: `tr${serialOpen(x) ? " on" : ""}`, role: "row", "data-sid": x.id, onclick: () => openSerial(x) },
        ...cols.map(key => serialCell(x, key))));
    }
    return box;
  };

  /** The Serials side: its status line, views and size, and the serials found, in Details' sort. */
  const renderSerials = () => {
    const ss = serialsSetup();
    // Office: Details only.
    const view: SerialView = viewFor(ss.view, style().views);
    const all = ctx.serials();
    if (all == null) void ctx.loadSerials().then(renderSoon);
    const shown = sortSerials(searchSerials(all ?? [], query), ss.sort);
    const z = SIZES[ss.sizes[view]];
    main.style.setProperty("--z", String(z));
    main.style.setProperty("--f", String(textScale(z)));
    main.className = `hmain s-${view}`;
    const check = all && lastCheck(all);
    count.textContent = all == null ? "" : [newChaptersText(all), check ? `checked ${ago(new Date(check.at).toISOString(), Date.now())} on ${check.device}` : ""].filter(Boolean).join(" · ");
    count.classList.add("plain");
    const letter = (n: number) => `<svg width="20" height="20" viewBox="0 0 20 20"><text x="10" y="${(10 + n * 0.36).toFixed(1)}" text-anchor="middle" font-family="Figtree, sans-serif" font-weight="600" font-size="${n}" fill="currentColor">A</text></svg>`;
    zoomLess.innerHTML = letter(11);
    zoomMore.innerHTML = letter(19);
    zoom.value = String(ss.sizes[view]);
    zoomLess.disabled = ss.sizes[view] === 0;
    zoomMore.disabled = ss.sizes[view] === SIZES.length - 1;
    views.replaceChildren(...SERIAL_VIEWS.map(v => h("button", { class: v.view === view ? "on" : "", role: "tab", "aria-selected": String(v.view === view), onclick: () => setSerials({ view: v.view }) }, v.name)));
    seen.disconnect();
    if (all == null) main.replaceChildren();
    else if (!shown.length) main.replaceChildren(h("p", { class: "hempty" }, all.length ? "No serials match." : "No serials yet."));
    else if (view === "details") main.replaceChildren(serialDetails(shown));
    else main.replaceChildren(h("div", { class: "scards" }, ...shown.map(serialCard)));
    // Continue: the serial read last on any device, and its chapter.
    const last = all && lastReadSerial(all);
    cont.hidden = !last;
    if (last) {
      cont.classList.add("sv");
      // The chapter only (2026-10-17): the unread count left every serial row.
      cont.replaceChildren(...quietLine(last.title, [last.current?.title ?? ""]));
      cont.onclick = () => ctx.openSerial(last);
    }
    renderPanel();
  };

  // --- The bar on one line (2026-10-16): the name, the title, the place and Continue rest on the name's
  // baseline; ⚙, Contents, Aa and search are centred on the capitals of the text beside them. ---

  /** Where a box's text sits: a zero-size probe on its baseline. */
  const baselineOf = (box: HTMLElement): number => {
    const probe = h("span", { class: "blprobe", "aria-hidden": "true" });
    box.append(probe);
    const y = probe.getBoundingClientRect().top;
    probe.remove();
    return y;
  };
  /** Moves [el] up or down so its text's baseline is at [y] (screen pixels). */
  const restOn = (el: HTMLElement, y: number) => {
    const now = Number(el.dataset.shift ?? 0);
    const next = now + (y - baselineOf(el));
    el.dataset.shift = String(next);
    el.style.translate = `0 ${next.toFixed(1)}px`;
  };
  const alignBar = () => {
    if (!header.isConnected || !markEl.firstElementChild) return;
    const top = header.getBoundingClientRect().top;
    // Home's wordmark is drawn: its baseline is a known share down its canvas. Office's is text.
    const svg = markEl.querySelector("svg");
    const base = svg ? svg.getBoundingClientRect().top + WORDMARK_BASELINE * 40 : baselineOf(markEl.querySelector<HTMLElement>(".lib") ?? markEl);
    if (!titleEl.hidden) { restOn(titleBt, base); restOn(titlePlace, base); }
    if (cont.parentElement === header && !cont.hidden && getComputedStyle(cont).position === "absolute") restOn(cont, base);
    // The icons' middle on the capitals of the smaller text (the place, or Continue): about 0.7 of its size.
    const small = parseFloat(getComputedStyle(titleEl.hidden ? cont : titlePlace).fontSize) || 13;
    header.style.setProperty("--icons-y", `${(base - top - small * 0.35 - header.offsetHeight / 2).toFixed(1)}px`);
  };
  let alignQueued = false;
  const queueAlign = () => {
    if (alignQueued) return;
    alignQueued = true;
    requestAnimationFrame(() => { alignQueued = false; alignBar(); });
  };
  window.addEventListener("resize", queueAlign);
  // A Details table refits its columns to the window.
  let refitTimer: number | undefined;
  window.addEventListener("resize", () => {
    window.clearTimeout(refitTimer);
    refitTimer = window.setTimeout(() => { if (main.querySelector(".tbl") && el.offsetParent) render(); }, 150);
  });
  void document.fonts?.ready.then(queueAlign);

  /** The panel open or not, as the last render laid the Library out (a Details table refits when that changes). */
  let renderedWithPanel = false;
  const refitForPanel = () => { if ((panelFor != null) !== renderedWithPanel && main.querySelector(".tbl")) render(); };

  const render = () => {
    renderedWithPanel = panelFor != null;
    queueAlign();
    closeMenu();
    renderMark(reading ? reading.side === "books" : !onSerials());
    addButton.textContent = badges() ? "+ Add books" : "Add books";
    // Serials can't be added here: the phones subscribe (2026-10-16).
    addButton.style.display = onSerials() ? "none" : "";
    // Continue is a small pill in the middle of the bar (Office's C1, then Home's too, 2026-10-16).
    cont.classList.add("pill");
    if (cont.parentElement !== header) header.append(cont);
    if (onSerials()) return renderSerials();
    count.classList.remove("plain");
    const hs = home();
    // Office: Details only.
    const view: BookView = viewFor(hs.view, style().views);
    const all = books();
    const sort = hs.sort;
    const z = SIZES[hs.sizes[view]];
    main.style.setProperty("--z", String(z));
    main.style.setProperty("--f", String(textScale(z)));
    main.className = `hmain v-${view}`;
    // The status line: the count, the sort's name, Series grouped (not in Details).
    // Covers without a search or Hidden is the curated page (2026-10-16): its All has its own sort.
    const curated = view === "grid" && !query.trim() && !ctx.showHidden();
    const listSort = curated ? hs.gridSort : sort;
    const sortName = column(listSort.key).sortName + (listSort.reversed ? " ▴" : "");
    const shown = view === "details" ? detailsRows(all, sort, query, facts) : null;
    const items = view === "details" ? null : homeItems(all, listSort, query, ctx.setup().groupSeries, facts);
    const n = shown ? shown.length : items!.reduce((k, i) => k + (i.kind === "book" ? 1 : i.books.length), 0);
    const what = ctx.showHidden() ? `${n} hidden` : query.trim() ? `${n} found` : `${n} books`;
    count.textContent = [what, sortName, view !== "details" && ctx.setup().groupSeries ? "Series grouped" : ""].filter(Boolean).join(" · ");
    // On the curated page the count and sort head All instead.
    count.style.visibility = curated ? "hidden" : "";
    hideContinue = false;
    // The size: a small and a large cover, or A and A in Details.
    const covers = view !== "details";
    const shape = (w: number, ht: number) => `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="${10 - w / 2}" y="${10 - ht / 2}" width="${w}" height="${ht}" rx="1.5" fill="currentColor"/></svg>`;
    const letter = (s: number) => `<svg width="20" height="20" viewBox="0 0 20 20"><text x="10" y="${(10 + s * 0.36).toFixed(1)}" text-anchor="middle" font-family="Figtree, sans-serif" font-weight="600" font-size="${s}" fill="currentColor">A</text></svg>`;
    zoomLess.innerHTML = covers ? shape(8, 12) : letter(11);
    zoomMore.innerHTML = covers ? shape(12, 18) : letter(19);
    zoom.value = String(hs.sizes[view]);
    zoomLess.disabled = hs.sizes[view] === 0;
    zoomMore.disabled = hs.sizes[view] === SIZES.length - 1;
    views.replaceChildren(...BOOK_VIEWS.map(v => h("button", { class: v.view === view ? "on" : "", role: "tab", "aria-selected": String(v.view === view), onclick: () => setHome({ view: v.view }) }, v.name)));

    seen.disconnect();
    if (shown) {
      main.replaceChildren(shown.length ? details(shown) : empty());
      // Sorting by what only the sync files tell reads the ones not known yet, once.
      if ((sort.key === "progress" || sort.key === "on") && shown.some(b => b.hasSyncFile && ctx.progress(b.id) == null)) {
        void Promise.all(shown.filter(b => b.hasSyncFile && ctx.progress(b.id) == null).map(b => ctx.load(b))).then(renderSoon);
      }
    } else if (curated && items!.length) {
      main.replaceChildren(...curatedPage(all, items!, `${count.textContent}`));
    } else {
      const box = h("div", { class: "grid" }, ...items!.map(gridItem));
      main.replaceChildren(items!.length ? box : empty());
    }
    // Details' rows have no box of their own (display: contents): their first cell is watched.
    main.querySelectorAll<HTMLElement>("[data-id]").forEach(x => { if (ctx.progress(x.dataset.id!) == null) seen.observe(x.classList.contains("tr") ? x.firstElementChild! : x); });
    renderContinue();
    renderPanel();
  };
  // --- The curated Covers page (WEB.md → Home; agreed from mockups 2026-10-16) ---

  /**
   * Reading now's cover as tall as a whole book beside it, cover to bar or date (the user, 2026-10-16):
   * measured once drawn and whenever that row changes size; not while the row is below it (narrow).
   */
  let fitObserver: ResizeObserver | null = null;
  const fitReadingNow = (top: HTMLElement) => {
    fitObserver?.disconnect();
    const now = top.querySelector<HTMLElement>(".cur-now");
    const beside = top.querySelector<HTMLElement>(".cur-also");
    if (!now || !beside) return;
    const fit = () => {
      const cell = beside.querySelector<HTMLElement>(".cell");
      const sideBySide = Math.abs(beside.getBoundingClientRect().top - now.getBoundingClientRect().top) < 2;
      top.classList.toggle("fitted", !!cell && sideBySide);
      if (cell && sideBySide) top.style.setProperty("--fh", `${Math.round(cell.getBoundingClientRect().height)}px`);
    };
    fitObserver = new ResizeObserver(fit);
    fitObserver.observe(beside);
    requestAnimationFrame(fit);
  };
  /** The bar's Continue steps aside while Reading now shows the same book. */
  let hideContinue = false;
  /** Reading now, Also reading, Recently added, then All (its count and sort in its heading). */
  const curatedPage = (all: LibraryBook[], items: LibraryItem[], allLine: string): HTMLElement[] => {
    const progressNow = (b: LibraryBook) => (b.hasSyncFile ? ctx.progress(b.id) : 0);
    // Which books are in progress needs their sync files: the recently synced ones are read, once.
    const unknown = all.filter(b => !b.hidden && b.hasSyncFile && ctx.progress(b.id) == null)
      .sort((a, b) => (b.lastRead ?? "").localeCompare(a.lastRead ?? "")).slice(0, 40);
    if (unknown.length) void Promise.all(unknown.map(b => ctx.load(b))).then(renderSoon);
    const c = curatedHome(all, progressNow, Date.now());
    const head = (title: string, extra: HTMLElement | string | null = null) =>
      h("div", { class: "cur-head" }, h("h2", {}, title), typeof extra === "string" ? h("span", { class: "n" }, extra) : extra);
    const bar = (p: number) => h("span", { class: "pl" }, h("i", { style: `width:${Math.round(p * 100)}%` }));
    /** A cover with its title, author and a bar with the percentage (Also reading). */
    const reading = (b: LibraryBook) => {
      const cell = gridItem({ kind: "book", book: b });
      cell.querySelector(".badge")?.remove();
      const p = progressNow(b) ?? 0;
      cell.append(h("span", { class: "cbar" }, bar(p), h("span", { class: "cp" }, pct(p))));
      return cell;
    };
    /** A recently added book beside Reading now: when it came, where the others show their progress. */
    const added = (b: LibraryBook) => {
      const cell = gridItem({ kind: "book", book: b });
      cell.querySelector(".badge")?.remove();
      cell.append(h("span", { class: "cbar" }, h("span", { class: "cadded" }, `Added ${ago(b.added ?? null, Date.now())}`)));
      return cell;
    };
    const beside = besideReadingNow(c);
    const out: HTMLElement[] = [];
    if (c.now) {
      const f = c.now;
      const p = progressNow(f) ?? 0;
      const far = furthestPlace(ctx.places(f.id) ?? []);
      const series = seriesLine(f);
      hideContinue = true;
      const top: HTMLElement = h("section", { class: "cur cur-top" },
        h("div", { class: "cur-now" }, head("Reading now"),
          h("div", { class: "cur-feat" },
            h("button", { class: "cur-cover", "data-id": f.id, onclick: () => openBook(f), "aria-label": `${f.title}: details` }, cover(f, true)),
            h("div", { class: "cur-info" },
              h("button", { class: "cur-title", onclick: () => ctx.open(f) }, redTitle(f.title)),
              h("div", { class: "cur-by" }, f.author ?? ""),
              series ? h("div", { class: "cur-series" }, series) : null,
              h("div", { class: "cur-bar" }, bar(p)),
              h("div", { class: "cur-place" }, [pct(p), far?.chapter ?? ""].filter(Boolean).join(" · ")),
              h("button", { class: "cur-go", onclick: () => ctx.open(f) }, h("span", { class: "play", "aria-hidden": "true" }, "▶"), "Continue")))),
        // The books beside it sit in the grid's own columns, as the covers below do (2026-10-16).
        beside ? h("div", { class: `cur-also ${beside.kind}` }, head(beside.title, beside.kind === "added" ? String(beside.books.length) : null),
          ...beside.books.map(b => (beside.kind === "also" ? reading(b) : added(b)))) : null);
      out.push(top);
      fitReadingNow(top);
    }
    // Recently added gets its own row unless it already sits beside Reading now.
    if (c.added.length && beside?.kind !== "added") {
      out.push(h("section", { class: "cur" }, head("Recently added", String(c.added.length)),
        h("div", { class: "grid shelf" }, ...c.added.map(b => gridItem({ kind: "book", book: b })))));
    }
    const sortButton = h("button", { class: "n sortby", "aria-haspopup": "menu" }, allLine);
    sortButton.addEventListener("click", e => { e.stopPropagation(); if (menuOpen) closeMenu(); else openMenu(sortMenu("gridSort"), sortButton); });
    out.push(h("section", { class: "cur" }, head("All", sortButton), h("div", { class: "grid" }, ...items.map(gridItem))));
    return out;
  };

  const empty = () => h("p", { class: "hempty" }, ctx.showHidden() ? "No hidden books." : ctx.books().length ? "No books match." : "No books in Dropbox's /Books/ yet.");

  // --- Continue: the book read last on any device ---

  /** Continue as a pill in the bar (Office, then Home, 2026-10-16): "Continue Title · Chapter 12 · 43% ›". */
  const quietLine = (title: string, rest: string[]): Node[] => present(
    // With the accent, a round ▶ in the seal's colours first and no box, as Continue ▶ on the phones (2026-10-16).
    style().accent ? h("span", { class: "play", "aria-hidden": "true" }, "▶") : null,
    h("span", { class: "k kw" }, "Continue"), h("b", {}, panelTitle(title)),
    h("span", { class: "k kr" }, rest.filter(Boolean).map(t => `· ${t}`).join(" ")),
    style().accent ? null : h("span", { class: "go", "aria-hidden": "true" }, "›"),
  );
  const renderContinue = () => {
    const last = lastReadBook(ctx.books().filter(b => !b.hidden));
    cont.hidden = !last || (hideContinue && !onSerials() && !reading);
    if (!last) return;
    const p = progressOf(last) ?? 0;
    cont.classList.remove("sv");
    cont.replaceChildren(...quietLine(last.title, [ctx.places(last.id)?.[0]?.chapter ?? "", p > 0 ? `${Math.round(p * 100)}%` : ""]));
    cont.onclick = () => ctx.open(last);
    if (ctx.progress(last.id) == null && last.hasSyncFile) void ctx.load(last).then(renderSoon);
  };

  // --- The panel ---

  const openBook = (b: LibraryBook) => {
    if (!(panelFor && "book" in panelFor && panelFor.book.id === b.id)) devicesOpen = false;
    panelFor = { book: b };
    renderPanel();
    if (!ctx.places(b.id) && b.hasSyncFile) void ctx.load(b).then(() => { if (panelFor && "book" in panelFor && panelFor.book.id === b.id) renderPanel(); });
  };
  const openSerial = (x: Serial) => {
    if (!(panelFor && "serial" in panelFor && panelFor.serial === x.id)) chaptersOpen = false;
    panelFor = { serial: x.id };
    main.querySelectorAll(".scard.on, .tr.on").forEach(e => e.classList.remove("on"));
    main.querySelectorAll(`[data-sid="${x.id}"]`).forEach(e => e.classList.add("on"));
    renderPanel();
  };
  const openSeries = (members: LibraryBook[]) => {
    panelFor = { series: members.map(m => m.id).map(id => ctx.books().find(b => b.id === id)!).filter(Boolean) };
    renderPanel();
    for (const m of members) if (ctx.progress(m.id) == null && m.hasSyncFile) void ctx.load(m).then(renderSoon);
  };
  const closePanel = () => {
    if (!panelFor) return;
    panelFor = null;
    panel.classList.remove("open");
    main.querySelectorAll(".tr.on, .scard.on").forEach(e => e.classList.remove("on"));
    refitForPanel();
  };
  let fromSeries: LibraryBook[] | null = null;

  // The panels (WEB.md → One app, two styles → the panels; agreed from mockups 2026-10-16), the same in
  // both styles through the tokens: the details together and editable in place, one line for where you
  // are over a bar, one button and one status word, then the fine print.

  /** The device list under a book's line: open after a click on the line, until another book's panel. */
  let devicesOpen = false;
  /** A serial's whole chapter list, after a click on "N more", until another serial's panel. */
  let chaptersOpen = false;

  /**
   * Text that turns into fields on a click: Enter or a click away saves, Esc puts it back. [save] gets the
   * fields' values; the panel is drawn again from the saved details.
   */
  /** [hint]: what an empty field says (2026-10-17: "Add author"; a series only a faint "Series", as most books have none). */
  const editable = (shown: Node | string, cls: string, fields: { value: string; label: string; cls?: string }[], save: (values: string[]) => void, hint?: { text: string; faint?: boolean }) => {
    const empty = typeof shown === "string" && !shown;
    const text = h("span", { class: `bp-ed ${cls}${empty ? ` empty${hint?.faint ? " faint" : ""}` : ""}`, role: "button", tabindex: "0", title: "Click to edit" }, empty ? hint?.text ?? fields.map(f => f.label).join(" · ") : shown);
    const start = () => {
      const inputs = fields.map(f => h("input", { class: `bp-in${f.cls ? ` ${f.cls}` : ""}`, value: f.value, placeholder: f.label, "aria-label": f.label }));
      const box = h("span", { class: `bp-edit ${cls}` }, ...inputs);
      let done = false;
      const finish = (keep: boolean) => {
        if (done) return;
        done = true;
        const values = inputs.map(i => i.value.trim());
        box.replaceWith(text);
        if (keep && values.some((v, i) => v !== fields[i].value.trim())) save(values);
      };
      for (const input of inputs) {
        input.addEventListener("keydown", e => {
          if (e.key === "Enter") { e.preventDefault(); finish(true); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        // A click away saves; moving between the series and its number doesn't.
        input.addEventListener("blur", () => window.setTimeout(() => { if (!box.contains(document.activeElement)) finish(true); }, 0));
      }
      text.replaceWith(box);
      inputs[0].focus();
      inputs[0].select();
    };
    text.addEventListener("click", start);
    text.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); start(); } });
    return text;
  };
  /** The line over the bar, and the bar: [fraction] 0..1. */
  const lineAndBar = (row: HTMLElement, fraction: number, under: HTMLElement | null = null) =>
    h("div", { class: "bp-prog" }, row, h("span", { class: "bp-bar" }, h("i", { style: `width:${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` })), under);
  const lineRow = (left: string, right: Child, tag: "div" | "button" = "div", attrs: Record<string, string> = {}) =>
    h(tag, { class: `bp-line${tag === "div" ? " still" : ""}`, ...attrs }, h("span", { class: "bp-l" }, left), h("span", { class: "bp-r" }, right));
  const hero = (art: HTMLElement | null, ...lines: (HTMLElement | null)[]) =>
    h("div", { class: "bp-hero" }, ...present(style().covers ? art : null, h("div", { class: "bp-info" }, ...present(...lines))));

  const renderPanel = () => {
    if (!panelFor) return;
    // Not while a field is being edited: the panel is drawn again once it's saved.
    if (panel.querySelector(".bp-edit")) return;
    const top = h("div", { class: "top" });
    const closeButton = h("button", { class: "hicon", title: "Close", "aria-label": "Close", onclick: closePanel }, svgEl(CLOSE));
    if ("serial" in panelFor) {
      const id = panelFor.serial;
      const x = ctx.serials()?.find(s => s.id === id);
      if (!x) return closePanel();
      top.append(h("span", { class: "grow" }), closeButton);
      const now = Date.now();
      const link = (c: { title: string; url: string }, cls = "") => h("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", class: cls }, c.title);
      // The list (2026-10-16): with a long backlog, the newest and where you pick up, "N more" between.
      const rows = panelChapters(x, chaptersOpen);
      const chapters = rows.length ? h("div", { class: "chap" }, ...rows.flatMap(r => {
        if ("more" in r) return [h("button", { class: "chapmore", onclick: () => { chaptersOpen = true; renderPanel(); } }, `··· ${r.more} more`), h("span", {})];
        const { chapter: c, index } = r;
        const cls = [index === x.progress.currentIndex ? "cur" : "", x.progress.isRead(index) ? "read" : "", c.locked ? "locked" : ""].filter(Boolean).join(" ");
        return [h("span", {}, link(c, cls), x.progress.isNew(index) ? h("span", { class: "nw" }, badges() ? "NEW" : "new") : null), h("span", { class: "d" }, chapterDateLabel(c.published, now, true) ?? "")];
      })) : null;
      const checked = x.checkedAt && x.device ? [`Checked ${ago(new Date(x.checkedAt).toISOString(), now)} on ${x.device}`, inDropbox(x)].filter(Boolean).join(" · ") : "No chapters from the phones yet.";
      const counts = [x.progress.unreadCount ? `${x.progress.unreadCount} unread` : "", x.progress.newCount ? `${x.progress.newCount} new` : ""].filter(Boolean).join(" · ");
      // The button says the state: Start, Continue Chapter 213, or Caught up (not a button then).
      const go = x.caughtUp
        ? h("button", { class: "bp-go off", disabled: "true" }, "Caught up")
        : x.upNext ? h("button", { class: "bp-go", onclick: () => ctx.openSerial(x) }, x.current ? `Continue ${shortChapter(x.upNext.title)}` : "Start") : null;
      panel.replaceChildren(...present(top, h("div", { class: "bp sv" },
        hero(h("div", { class: "cvb" }, serialCover(x)),
          editable(panelTitle(x.title), "bp-title", [{ value: x.title, label: "Title" }], ([title]) => { if (title) ctx.saveSerial(x, title, x.author); }),
          h("div", { class: "bp-sub" },
            editable(x.author ?? "", "bp-by", [{ value: x.author ?? "", label: "Author" }], ([author]) => ctx.saveSerial(x, x.title, author || null), { text: "Add author" }),
            h("span", { class: "bp-site" }, "· ", h("a", { class: "bp-sitelink", href: x.url, target: "_blank", rel: "noopener noreferrer", title: `Open on ${x.site}` }, `${x.site} ↗`)))),
        go ? h("div", { class: "bp-acts" }, go) : null,
        chapters ? h("div", { class: "bp-chaps" }, h("div", { class: "bp-head" }, h("span", {}, "Chapters"), h("span", { class: "c" }, counts)), chapters) : null,
        h("div", { class: "bp-fine" }, checked))));
    } else if ("series" in panelFor) {
      fromSeries = panelFor.series;
      const ms = inOrder(panelFor.series.map(m => ctx.books().find(b => b.id === m.id) ?? m));
      const name = ms[0]?.series ?? "";
      const next = nextInSeries(ms, id => ctx.progress(id));
      top.append(h("span", { class: "grow" }), closeButton);
      const line = seriesProgress(ms, next, id => ctx.progress(id));
      // The first covers small and fanned, beside the name.
      const fan = h("div", { class: "scov" }, ...ms.slice(0, 3).reverse().map((m, i, arr) => h("div", { class: "cvb", style: `left:${(arr.length - 1 - i) * 14}px` }, cover(m, true))));
      const bookRows = ms.map(m => {
        const q = m.read ? 1 : ctx.progress(m.id) ?? 0;
        return h("button", { class: "bp-book", "data-id": m.id, onclick: () => { devicesOpen = false; panelFor = { book: m }; renderPanel(); if (!ctx.places(m.id) && m.hasSyncFile) void ctx.load(m).then(renderPanel); } },
          h("span", { class: "n" }, m.seriesIndex != null ? String(m.seriesIndex) : ""), h("span", { class: "t" }, m.title), h("span", { class: "p" }, m.read ? "Read" : q > 0 ? pct(q) : ""));
      });
      const nextP = next ? ctx.progress(next.id) ?? 0 : 0;
      panel.replaceChildren(...present(top, h("div", { class: "bp" },
        hero(fan, h("div", { class: "bp-ed bp-title still" }, panelTitle(name)), h("div", { class: "bp-sub" }, h("span", { class: "bp-by" }, ms.find(m => m.author)?.author ?? ""))),
        line.left ? lineAndBar(lineRow(line.left, line.right), line.fraction) : null,
        next ? h("div", { class: "bp-acts" }, h("button", { class: "bp-go", onclick: () => ctx.open(next) }, nextP > 0 ? "Continue" : "Read")) : null,
        h("div", { class: "bp-books" }, ...bookRows))));
    } else {
      const b = ctx.books().find(x => x.id === (panelFor as { book: LibraryBook }).book.id) ?? panelFor.book;
      const inSeries = fromSeries?.some(m => m.id === b.id) ? fromSeries : null;
      if (inSeries) top.append(h("button", { class: "back", onclick: () => { panelFor = { series: inSeries }; renderPanel(); } }, `‹ ${b.series ?? "Series"}`));
      else fromSeries = null;
      top.append(h("span", { class: "grow" }), closeButton);
      const places = ctx.places(b.id);
      const state = bookState(b.read, places, b.hasSyncFile);
      const file = [b.path, megabytes(b.size)].filter(Boolean).join(" · ");
      const save = (change: Partial<DetailsEdit>) => ctx.saveDetails(b, { title: b.title, author: b.author, series: b.series, number: b.seriesIndex, ...change });
      // The line: how far (the furthest device), or Read, or Not started; a click opens the devices.
      const left = state.kind === "read" ? "Read" : state.kind === "started" ? pct(state.p) : state.kind === "loading" ? "…" : "Not started";
      const far = places ? furthestPlace(places) : null;
      const right = state.kind === "started" ? state.chapter ?? "" : "";
      const hasDevices = (places?.length ?? 0) > 0;
      const row = hasDevices
        ? lineRow(left, h("span", {}, right, h("span", { class: "chev", "aria-hidden": "true" }, devicesOpen ? "⌃" : "⌄")), "button", { "aria-expanded": String(devicesOpen), title: "Devices" })
        : lineRow(left, right);
      if (hasDevices) row.addEventListener("click", () => { devicesOpen = !devicesOpen; renderPanel(); });
      const devices = devicesOpen && places?.length ? h("div", { class: "bp-devs" }, ...places.map(pl => h("div", { class: "bp-dev" },
        h("span", {}, pl.device), h("span", { class: "n" }, pct(pl.p)), h("span", { class: "c" }, pl.chapter ?? ""), h("span", { class: "w" }, ago(new Date(pl.at).toISOString(), Date.now()))))) : null;
      const action = statusAction(state);
      panel.replaceChildren(...present(top, h("div", { class: "bp" },
        hero(h("div", { class: "cvb" }, cover(b, true)),
          editable(panelTitle(b.title), "bp-title", [{ value: b.title, label: "Title" }], ([title]) => { if (title) save({ title }); }),
          editable(b.author ?? "", "bp-by", [{ value: b.author ?? "", label: "Author" }], ([author]) => save({ author: author || null }), { text: "Add author" }),
          editable(b.series ? `${b.series}${b.seriesIndex != null ? ` · ${b.seriesIndex}` : ""}` : "", "bp-by",
            [{ value: b.series ?? "", label: "Series" }, { value: b.seriesIndex != null ? String(b.seriesIndex) : "", label: "#", cls: "num" }],
            ([series, number]) => {
              const n = parseNumber(number);
              if (number && n == null) return;
              save({ series: series || null, number: series ? n : null });
            }, { text: "Series", faint: true })),
        lineAndBar(row, state.kind === "read" ? 1 : far?.p ?? 0, devices),
        h("div", { class: "bp-acts" },
          h("button", { class: "bp-go", onclick: () => ctx.open(b) }, goLabel(state)),
          h("button", { class: "bp-word", onclick: () => (action === "Mark as read" ? ctx.markRead(b) : ctx.markUnread(b)) }, action)),
        h("div", { class: "bp-fine" }, file))));
    }
    panel.classList.add("open");
    refitForPanel();
    main.querySelectorAll(".tr.on").forEach(x => x.classList.remove("on"));
    if ("book" in panelFor) main.querySelector(`.tr[data-id="${panelFor.book.id}"]`)?.classList.add("on");
  };

  // --- Add books (WEB.md → Home, step 2): drop EPUBs on Home or the dialog, or choose them ---

  let addDialog: { el: HTMLElement; lines: HTMLElement; summary: HTMLElement } | null = null;
  const picker = h("input", { type: "file", multiple: true, accept: ".epub,application/epub+zip", hidden: true });
  el.append(picker);
  const openAdd = () => {
    if (addDialog) return addDialog;
    const lines = h("div", { class: "addlines" });
    const summary = h("div", { class: "addsum" });
    const drop = h("button", { class: "adddrop" }, h("b", {}, "Drop EPUB files here"), h("span", { class: "word" }, "or choose files"));
    const close = () => { addDialog?.el.remove(); addDialog = null; document.removeEventListener("keydown", onKey, true); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const box = h("div", { class: "addbox", role: "dialog", "aria-modal": "true", "aria-label": "Add books" },
      h("div", { class: "addhead" }, h("h2", {}, "Add books"), h("button", { class: "hicon", title: "Close", "aria-label": "Close", onclick: close }, svgEl(CLOSE))),
      drop, lines, summary,
      h("div", { class: "addbtns" }, h("button", { class: "seal", onclick: close }, "Done")));
    const dialog = h("div", { class: "hdialog" }, box);
    dialog.addEventListener("click", e => { if (e.target === dialog) close(); });
    drop.addEventListener("click", () => picker.click());
    document.addEventListener("keydown", onKey, true);
    el.append(dialog);
    addDialog = { el: dialog, lines, summary };
    return addDialog;
  };
  /** The files one by one: a line each, "Adding…" until it's done. */
  let adding = Promise.resolve();
  const outcomes: AddOutcome[] = [];
  const addFiles = (files: File[]) => {
    const dialog = openAdd();
    for (const file of files) {
      const state = h("span", { class: "st" }, "Adding…");
      const name = h("span", { class: "nm" }, h("b", {}, file.name));
      const line = h("div", { class: "addline" }, name, state);
      dialog.lines.append(line);
      adding = adding.then(async () => {
        let outcome: AddOutcome;
        try {
          const read = await ctx.readFile(file);
          if (read.title) name.replaceChildren(h("b", {}, read.title), read.author ? ` · ${read.author}` : "");
          outcome = await read.add();
        } catch {
          outcome = { kind: "failed" };
        }
        outcomes.push(outcome);
        state.textContent = outcomeText(outcome);
        line.classList.add(outcome.kind === "added" ? "ok" : outcome.kind === "already" ? "same" : "bad");
        dialog.summary.textContent = addSummary(outcomes);
      });
    }
  };
  addButton.addEventListener("click", () => { outcomes.length = 0; openAdd(); });
  picker.addEventListener("change", () => { if (picker.files?.length) addFiles([...picker.files]); picker.value = ""; });
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  el.addEventListener("dragover", e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; el.classList.add("dropping"); });
  el.addEventListener("dragleave", e => { if (e.target === el || !el.contains(e.relatedTarget as Node)) el.classList.remove("dropping"); });
  el.addEventListener("drop", e => {
    el.classList.remove("dropping");
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!addDialog) outcomes.length = 0;
    addFiles([...e.dataTransfer!.files]);
  });

  // --- Events ---

  search.addEventListener("input", () => { query = search.value; render(); });
  const sizeNow = () => (onSerials() ? serialsSetup().sizes[serialsSetup().view] : home().sizes[home().view]);
  const setSize = (step: number) => {
    const at = Math.max(0, Math.min(SIZES.length - 1, step));
    if (onSerials()) setSerials({ sizes: { ...serialsSetup().sizes, [serialsSetup().view]: at } as Record<SerialView, number> });
    else setHome({ sizes: { ...home().sizes, [home().view]: at } as Record<BookView, number> });
  };
  zoom.addEventListener("input", () => setSize(Number(zoom.value)));
  zoomLess.addEventListener("click", () => setSize(sizeNow() - 1));
  zoomMore.addEventListener("click", () => setSize(sizeNow() + 1));
  main.addEventListener("contextmenu", e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
    const book = item && ctx.books().find(b => b.id === item.dataset.id);
    if (!book) return;
    e.preventDefault();
    e.stopPropagation();
    ctx.menu(book, e.clientX, e.clientY);
  });
  // A click outside a menu closes it (in the Library or the reader); outside the panel (and not on a book), the panel.
  document.addEventListener("click", e => {
    if (menuOpen && !e.composedPath().includes(menuOpen)) closeMenu();
  });
  el.addEventListener("click", e => {
    const path = e.composedPath();
    if (!panelFor || path.includes(panel)) return;
    if (path.some(x => x instanceof HTMLElement && (x.matches(".cell, .scard, .tr[data-id], .tr[data-sid], .hcont, .hmenu, .hmark") || x.closest(".bookmenu, .dialog, .toast")))) return;
    closePanel();
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !el.isConnected) return;
    if (menuOpen) closeMenu();
    else if (el.offsetParent) closePanel();
  });

  /** A book or serial open (or none): the bar shows its title over the page instead of search. */
  const setReading = (title: ReadingTitle | null) => {
    const was = reading;
    reading = title;
    searchBox.hidden = title != null;
    titleEl.hidden = title == null;
    titleEl.classList.toggle("sv", title?.side === "serials");
    if (!was !== !title || was?.side !== title?.side) renderMark(title ? title.side === "books" : !onSerials());
    queueAlign();
    if (title) {
      titleBt.replaceChildren(redTitle(title.title));
      titlePlace.textContent = title.place;
      // Over the page, but clear of the name and ⚙ when the page is wider than the gap between them.
      const bar = header.getBoundingClientRect();
      // The right end: Contents and Aa beside ⚙ while reading, else ⚙.
      const tools = gear.previousElementSibling?.getBoundingClientRect();
      const rightEdge = tools && tools.width > 0 ? tools.left : gear.getBoundingClientRect().left;
      const from = Math.max(title.left, markEl.getBoundingClientRect().right + 24) - bar.left;
      const to = Math.min(title.left + title.width, rightEdge - 16) - bar.left;
      titleEl.style.left = `${Math.round(from)}px`;
      titleEl.style.width = `${Math.max(0, Math.round(to - from))}px`;
    }
  };

  return { el, bar: header, gear, render, isOpen: () => panelFor != null, closePanel, setReading };
}


/** A sharp cover just arrived (covers.ts): it takes the place of the small or plain one wherever the book is shown. */
export function showSharpCover(id: string, url: string): void {
  for (const cv of document.querySelectorAll<HTMLElement>(`.cv[data-cover="${id}"]`)) {
    const img = cv.querySelector("img");
    if (img) {
      img.src = url;
      continue;
    }
    cv.removeAttribute("style");
    cv.replaceChildren(h("img", { src: url, alt: "" }));
  }
}
