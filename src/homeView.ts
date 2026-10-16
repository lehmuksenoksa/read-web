// Home: the full Library (WEB.md → Home, agreed 2026-10-15): Grid, Cards and Details, a book's or a
// series' panel at the right, the size control, Details' columns and Continue. The data and the
// actions (the book menu, Edit details, opening a book) are the page's own, passed in.

import {
  ago, BOOK_VIEWS, clickSort, column, DEFAULT_COLUMNS, DEFAULT_SERIAL_COLUMNS, detailsRows, FIXED, homeItems, inOrder, megabytes,
  menuSort, moveColumn, nextInSeries, SERIAL_VIEWS, shortDate, shownColumns, SIZES, sortMenuChoice, textScale, titleWord, toggleColumn,
  viewFor, type BookView, type ColumnKey, type Facts, type HomeSetup, type SerialsSetup, type SerialView,
} from "./home";
import {
  chapterDateLabel, lastCheck, lastReadSerial, newChaptersText, numbersOnly, panelChapters, readingOrderOf, searchSerials, serialColumn, sortSerials,
  type Serial, type SerialColumnKey,
} from "./serials";
import { addSummary, outcomeText, type AddOutcome } from "./addBooks";
import { lastReadBook, type LibraryBook, type LibraryItem, type Place, type SortBy } from "./library";
import type { Chrome, Setup } from "./looks";
import { h, icon, ICONS, type Child } from "./ui";
import { wordmark } from "./wordmark";

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

const SERIES_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 8h11v13H4zM8 5h10v13M11 2h10v13"/></svg>';
const GEAR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const CLOSE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
const LINES = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h10"/></svg>';

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

/** A book's cover: the phones' small JPEG, or a plain one with its title in its colours. */
function cover(book: LibraryBook, withText: boolean): HTMLElement {
  if (book.cover) return h("div", { class: "cv" }, h("img", { src: `data:image/jpeg;base64,${book.cover}`, alt: "" }));
  const [bg, fg] = toneOf(book.id);
  return h("div", { class: "cv", style: `background:${bg};color:${fg}` },
    withText ? h("span", { class: "ct" }, book.title) : null,
    withText && book.author ? h("span", { class: "ca" }, book.author) : null);
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
  el: HTMLElement; bar: HTMLElement; render: () => void; isOpen: () => boolean; closePanel: () => void;
  setReading: (title: ReadingTitle | null) => void;
} {
  let query = "";
  let menuOpen: HTMLElement | null = null;
  /** The panel's book, series or serial; null when closed. */
  let panelFor: { book: LibraryBook } | { series: LibraryBook[] } | { serial: string } | null = null;

  /** Office: the same Library, quieter (WEB.md → One app, 2026-10-15): Details only, plain words. */
  const quiet = () => !ctx.isHome();
  /** A panel's title: Home's first word in wax red; Office's plain. */
  const panelTitle = (title: string): Node => (quiet() ? document.createTextNode(title) : redTitle(title));
  /** A book or serial open in the reader: the bar shows its title, and the name goes back to the Library. */
  let reading: ReadingTitle | null = null;

  /** Library & Serials: the one in front is the side shown; a click on the other turns to it. Office: the words. */
  const markEl = h("div", { class: "hmark", "aria-label": "Library & Serials" });
  const renderMark = (books: boolean) => {
    if (quiet()) {
      markEl.innerHTML = `<button class="lib txt" aria-pressed="${books}">Library</button><button class="ser txt" aria-pressed="${!books}">Serials</button>`;
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

  // --- Menus: the sort menu (the status line), ☰ (Details' columns), ⚙ ---

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
  const sortMenu = () => {
    const now = sortMenuChoice(home().sort);
    const choice = (by: SortBy, name: string) => h("button", { class: "r", role: "menuitemradio", "aria-checked": String(now === by), onclick: () => { closeMenu(); setHome({ sort: menuSort(by) }); } }, name, tick(now === by));
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
      h("div", { class: "lab" }, "Show"),
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

  /** Details' columns, the Library's or the Serials': what ☰ and dragging change. */
  type Columns = { order: string[]; hidden: string[] };
  const table = () => onSerials()
    ? { cols: serialsSetup().columns as Columns, name: (k: string) => serialColumn(k as SerialColumnKey).name, set: (c: Columns) => setSerials({ columns: c as SerialsSetup["columns"] }), reset: DEFAULT_SERIAL_COLUMNS as Columns }
    : { cols: home().columns as Columns, name: (k: string) => column(k as ColumnKey).name, set: (c: Columns) => setHome({ columns: c as HomeSetup["columns"] }), reset: DEFAULT_COLUMNS as Columns };

  /** ☰ at the end of Details' headings: a box per column (Title stays), drag a line to move it, and Reset. */
  const columnsMenu = (anchor: HTMLElement) => {
    const t = table();
    const menu = h("div", { role: "menu", class: "colmenu" }, h("div", { class: "lab" }, "Columns"));
    for (const key of t.cols.order) {
      if (quiet() && key === "cover") continue;
      const fixed = key === FIXED;
      const box = h("input", { type: "checkbox", "aria-label": t.name(key) });
      box.checked = !t.cols.hidden.includes(key);
      box.disabled = fixed;
      box.addEventListener("change", () => table().set(toggleColumn(table().cols, key)));
      menu.append(h("label", { class: `ci${fixed ? " fixed" : ""}`, "data-col": key, draggable: fixed ? undefined : "true" },
        h("span", { class: "grip" }, fixed ? "" : "⋮⋮"), box, t.name(key)));
    }
    menu.append(h("hr"), h("button", { class: "r", onclick: () => table().set(table().reset) }, "Reset"));
    dragColumns(menu);
    openMenu(menu, anchor, true);
  };

  /** Dragging a heading, or a line in ☰'s list, moves its column before the one it's dropped on. */
  let dragging: string | null = null;
  const dragColumns = (container: HTMLElement) => {
    container.addEventListener("dragstart", e => {
      const c = (e.target as HTMLElement).closest<HTMLElement>("[data-col][draggable]");
      if (!c) return;
      dragging = c.dataset.col!;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", dragging);
    });
    container.addEventListener("dragover", e => {
      const c = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
      if (!dragging || !c || c.dataset.col === FIXED) return;
      e.preventDefault();
      container.querySelectorAll(".over").forEach(x => x.classList.remove("over"));
      c.classList.add("over");
    });
    container.addEventListener("dragleave", e => (e.target as HTMLElement).closest?.(".over")?.classList.remove("over"));
    container.addEventListener("drop", e => {
      const c = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
      container.querySelectorAll(".over").forEach(x => x.classList.remove("over"));
      if (!dragging || !c) return;
      e.preventDefault();
      const moved = moveColumn(table().cols, dragging, c.dataset.col!);
      dragging = null;
      table().set(moved);
    });
    container.addEventListener("dragend", () => { dragging = null; });
  };

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

  const cardItem = (item: LibraryItem) => {
    if (item.kind === "series") {
      const first = inOrder(item.books)[0];
      return h("button", { class: "bcard", onclick: () => openSeries(item.books) },
        cover({ ...first, title: item.name }, false),
        h("span", { class: "info" },
          h("span", { class: "head" }, h("span", { class: "t" }, redTitle(item.name)), h("span", { class: "serico" }, String(item.books.length), svgEl(SERIES_ICON))),
          h("span", { class: "a" }, item.author ?? "")));
    }
    const b = item.book;
    const p = progressOf(b);
    return h("button", { class: "bcard", "data-id": b.id, onclick: () => openBook(b) },
      cover(b, false),
      h("span", { class: "info" },
        h("span", { class: "head" }, h("span", { class: "t" }, redTitle(b.title)),
          b.read ? h("span", { class: "tag" }, "READ") : pct(p) ? h("span", { class: "bpct" }, pct(p)) : null),
        h("span", { class: "a" }, b.author ?? ""),
        h("span", { class: "bfoot" }, !b.read && p ? h("span", { class: "pl" }, h("i", { style: `width:${Math.round(p * 100)}%` })) : null)));
  };

  const cell = (b: LibraryBook, key: ColumnKey) => {
    const c = column(key);
    const td = (child: Node | string, cls = "") => h("div", { class: `td${c.right ? " ra" : ""}${cls ? ` ${cls}` : ""}` }, child);
    const last = ctx.places(b.id)?.[0];
    switch (key) {
      case "cover": return td(cover(b, false), "cvc");
      case "title": return td(h("span", { class: "t" }, b.title));
      case "author": return td(b.author ?? "", "dim");
      case "series": return td(b.series ?? "", "dim");
      case "num": return td(b.series && b.seriesIndex != null ? String(b.seriesIndex) : "", "dim");
      case "progress": {
        const p = b.read ? 1 : ctx.progress(b.id) ?? 0;
        return td(h("span", { class: "prog" }, h("span", { class: "pl" }, h("i", { style: `width:${Math.round(p * 100)}%` })), h("span", { class: "pc" }, `${Math.round(p * 100)}%`)));
      }
      case "last": return td(ago(b.lastRead, Date.now()), "dim");
      case "on": return td(last?.device ?? "", "dim");
      case "added": return td(shortDate(b.added ?? null), "dim");
      case "size": return td(megabytes(b.size), "dim");
    }
  };

  const details = (list: LibraryBook[]) => {
    // Office has no covers: no Cover column (WEB.md → One app, two styles).
    const cols = shownColumns(home().columns).filter(k => !quiet() || k !== "cover");
    const sort = home().sort;
    const table = h("div", { class: "tbl", role: "table", style: `grid-template-columns:${cols.map(widthOf).join(" ")} 40px` });
    const headings = h("div", { class: "tr hd", role: "row" },
      ...cols.map(key => {
        const c = column(key);
        const on = sort.key === key;
        return h("div", {
          class: `th${c.right ? " ra" : ""}${on ? " sort" : ""}`, role: "columnheader", "data-col": key,
          draggable: key === FIXED ? undefined : "true",
          "aria-sort": on ? (sort.reversed === (c.firstDir === 1) ? "descending" : "ascending") : undefined,
          onclick: () => { if (key !== "cover") setHome({ sort: clickSort(sort, key) }); },
        }, c.heading, on ? (sort.reversed ? " ▴" : " ▾") : "");
      }),
      h("div", { class: "th colbtn" }, h("button", { title: "Columns", "aria-label": "Columns", onclick: (e: Event) => { e.stopPropagation(); if (menuOpen?.classList.contains("colmenu")) closeMenu(); else columnsMenu(e.currentTarget as HTMLElement); } }, svgEl(LINES))));
    dragColumns(headings);
    table.append(headings);
    for (const b of list) {
      table.append(h("div", { class: `tr${panelFor && "book" in panelFor && panelFor.book.id === b.id ? " on" : ""}`, role: "row", "data-id": b.id, onclick: () => openBook(b) },
        ...cols.map(key => cell(b, key)), h("div", { class: "td" })));
    }
    return table;
  };

  const widthOf = (key: ColumnKey) => ({
    cover: "calc(36px*var(--z))", title: "minmax(220px,2.2fr)", author: "minmax(140px,1.3fr)", series: "minmax(140px,1.2fr)",
    num: "48px", progress: "minmax(170px,1.3fr)", last: "120px", on: "80px", added: "110px", size: "80px",
  })[key];

  // --- Serials (WEB.md → Home, step 3a): from the phones' chapter lists, read only ---

  const SERIAL_WIDTHS: Record<SerialColumnKey, [string, string]> = {
    title: ["minmax(220px,2fr)", "minmax(220px,2fr)"], author: ["minmax(130px,1.2fr)", "minmax(130px,1.2fr)"], site: ["110px", "110px"],
    new: ["100px", "64px"], unread: ["130px", "72px"], updated: ["100px", "100px"],
    latest: ["minmax(200px,1.8fr)", "minmax(200px,1.8fr)"], reading: ["minmax(200px,1.8fr)", "minmax(200px,1.8fr)"], lastread: ["110px", "110px"],
  };
  /** "2 NEW" in the seal's colours; just "2" where Details is crowded. */
  const newTag = (x: Serial, numbers = false) => x.progress.newCount ? h("span", { class: `tag new${numbers ? " n" : ""}` }, numbers ? String(x.progress.newCount) : `${x.progress.newCount} ${quiet() ? "new" : "NEW"}`) : null;
  /** "30 UNREAD" (the unread ones not NEW), or CAUGHT UP; in Details only the number, never CAUGHT UP. */
  const unreadTag = (x: Serial, inDetails = false, numbers = false) => {
    const n = x.progress.olderUnreadCount;
    if (n) return h("span", { class: `tag${numbers ? " n" : ""}` }, numbers ? String(n) : `${n} ${quiet() ? "unread" : "UNREAD"}`);
    return x.caughtUp && !inDetails ? h("span", { class: "tag cu" }, quiet() ? "Caught up" : "CAUGHT UP") : null;
  };
  const tagRow = (x: Serial) => h("span", { class: "tagrow" }, ...present(newTag(x), unreadTag(x)));
  const updatedLabel = (x: Serial) => chapterDateLabel(x.latest?.published, Date.now(), true);
  const bySite = (x: Serial) => [x.author, x.site].filter(Boolean).join(" · ");
  /** "214 of 215 chapters in Dropbox", once listed. */
  const inDropbox = (x: Serial) => {
    const n = ctx.chaptersInDropbox(x);
    const of = readingOrderOf(x.chapters).length;
    return n == null || !of ? "" : `${Math.min(n, of)} of ${of} chapters in Dropbox`;
  };
  const serialOpen = (x: Serial) => panelFor != null && "serial" in panelFor && panelFor.serial === x.id;

  const serialCard = (x: Serial, expanded: boolean) => {
    const updated = updatedLabel(x);
    const lines = () => {
      const now = Date.now();
      const latest = x.latest;
      const same = latest && x.current && latest.id === x.current.id;
      return h("span", { class: "lines" },
        ...(latest ? [h("span", { class: "k" }, "LATEST"), h("span", {}, latest.title), h("span", { class: "d" }, chapterDateLabel(latest.published, now, true) ?? "")] : []),
        ...(same ? [] : [h("span", { class: "k" }, "READING"), h("span", { class: x.current ? "" : "dim" }, x.current?.title ?? "Not started"), h("span", { class: "d" }, chapterDateLabel(x.current?.published, now, true) ?? "")]));
    };
    return h("button", { class: `scard${serialOpen(x) ? " on" : ""}`, "data-sid": x.id, onclick: () => openSerial(x) },
      h("span", { class: "head" }, h("span", { class: "t" }, redTitle(x.title)), tagRow(x)),
      h("span", { class: "a" }, bySite(x)),
      expanded ? lines() : h("span", { class: "m" }, h("span", { class: "grow" }), updated ? `Updated ${updated}` : ""));
  };

  const serialCell = (x: Serial, key: SerialColumnKey, numbers: boolean) => {
    const td = (child: Node | string | null, cls = "") => h("div", { class: `td${cls ? ` ${cls}` : ""}` }, ...present(typeof child === "string" ? document.createTextNode(child) : child));
    switch (key) {
      case "title": return td(h("span", { class: "t" }, x.title));
      case "author": return td(x.author ?? "", "dim");
      case "site": return td(x.site, "dim");
      case "new": return td(newTag(x, numbers));
      case "unread": return td(unreadTag(x, true, numbers));
      case "updated": return td(updatedLabel(x) ?? "", "dim");
      case "latest": return td(x.latest?.title ?? "", "dim");
      case "reading": return td(x.current?.title ?? (x.chapters.length ? "Not started" : ""), "dim");
      case "lastread": return td(x.lastRead ? ago(new Date(x.lastRead).toISOString(), Date.now()) : "", "dim");
    }
  };

  const serialDetails = (list: Serial[]) => {
    const cols = shownColumns(serialsSetup().columns);
    const sort = serialsSetup().sort;
    const numbers = numbersOnly(cols.length, window.innerWidth);
    const box = h("div", { class: "tbl ser", role: "table", style: `grid-template-columns:${cols.map(k => SERIAL_WIDTHS[k][numbers ? 1 : 0]).join(" ")} 40px` });
    const headings = h("div", { class: "tr hd", role: "row" },
      ...cols.map(key => {
        const on = sort.key === key;
        return h("div", {
          class: `th${on ? " sort" : ""}`, role: "columnheader", "data-col": key,
          draggable: key === FIXED ? undefined : "true",
          onclick: () => setSerials({ sort: sort.key === key ? { key, reversed: !sort.reversed } : { key, reversed: false } }),
        }, serialColumn(key).heading, on ? (sort.reversed ? " ▴" : " ▾") : "");
      }),
      h("div", { class: "th colbtn" }, h("button", { title: "Columns", "aria-label": "Columns", onclick: (e: Event) => { e.stopPropagation(); if (menuOpen?.classList.contains("colmenu")) closeMenu(); else columnsMenu(e.currentTarget as HTMLElement); } }, svgEl(LINES))));
    dragColumns(headings);
    box.append(headings);
    for (const x of list) {
      box.append(h("div", { class: `tr${serialOpen(x) ? " on" : ""}`, role: "row", "data-sid": x.id, onclick: () => openSerial(x) },
        ...cols.map(key => serialCell(x, key, numbers)), h("div", { class: "td" })));
    }
    return box;
  };

  /** The Serials side: its status line, views and size, and the serials found, in Details' sort. */
  const renderSerials = (columnsOpen: boolean) => {
    const ss = serialsSetup();
    // Office: Details only.
    const view: SerialView = viewFor(ss.view, !quiet());
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
    else main.replaceChildren(h("div", { class: `scards${view === "expanded" ? " long" : ""}` }, ...shown.map(x => serialCard(x, view === "expanded"))));
    const anchor = columnsOpen ? main.querySelector<HTMLElement>(".colbtn button") : null;
    if (anchor) columnsMenu(anchor);
    // Continue: the serial read last on any device, and its chapter.
    const last = all && lastReadSerial(all);
    cont.hidden = !last;
    if (last && quiet()) {
      cont.replaceChildren(...quietLine(last.title, [last.current?.title ?? "", last.progress.unreadCount ? `${last.progress.unreadCount} unread` : "Up to date"]));
      cont.onclick = () => ctx.openSerial(last);
    } else if (last) {
      cont.replaceChildren(h("span", { class: "ci" }, h("span", { class: "k" }, "Continue"), h("span", { class: "t sans" }, redTitle(last.title)),
        h("span", { class: "k ch" }, last.current?.title ?? "")));
      cont.onclick = () => ctx.openSerial(last);
    }
    renderPanel();
  };

  const render = () => {
    // ☰'s list stays open while its boxes change the columns; other menus close.
    const columnsOpen = menuOpen?.classList.contains("colmenu") ?? false;
    closeMenu();
    renderMark(reading ? reading.side === "books" : !onSerials());
    addButton.textContent = quiet() ? "Add books" : "+ Add books";
    cont.classList.toggle("quiet", quiet());
    if (onSerials()) return renderSerials(columnsOpen);
    count.classList.remove("plain");
    const hs = home();
    // Office: Details only.
    const view: BookView = viewFor(hs.view, !quiet());
    const all = books();
    const sort = hs.sort;
    const z = SIZES[hs.sizes[view]];
    main.style.setProperty("--z", String(z));
    main.style.setProperty("--f", String(textScale(z)));
    main.className = `hmain v-${view}`;
    // The status line: the count, the sort's name, Series grouped (not in Details).
    const sortName = column(sort.key).sortName + (sort.reversed ? " ▴" : "");
    const shown = view === "details" ? detailsRows(all, sort, query, facts) : null;
    const items = view === "details" ? null : homeItems(all, sort, query, ctx.setup().groupSeries, facts);
    const n = shown ? shown.length : items!.reduce((k, i) => k + (i.kind === "book" ? 1 : i.books.length), 0);
    const what = ctx.showHidden() ? `${n} hidden` : query.trim() ? `${n} found` : `${n} books`;
    count.textContent = [what, sortName, view !== "details" && ctx.setup().groupSeries ? "Series grouped" : ""].filter(Boolean).join(" · ");
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
    } else {
      const box = h("div", { class: view === "grid" ? "grid" : "bcards" }, ...items!.map(view === "grid" ? gridItem : cardItem));
      main.replaceChildren(items!.length ? box : empty());
    }
    // Details' rows have no box of their own (display: contents): their first cell is watched.
    main.querySelectorAll<HTMLElement>("[data-id]").forEach(x => { if (ctx.progress(x.dataset.id!) == null) seen.observe(x.classList.contains("tr") ? x.firstElementChild! : x); });
    const anchor = columnsOpen ? main.querySelector<HTMLElement>(".colbtn button") : null;
    if (anchor) columnsMenu(anchor);
    renderContinue();
    renderPanel();
  };
  const empty = () => h("p", { class: "hempty" }, ctx.showHidden() ? "No hidden books." : ctx.books().length ? "No books match." : "No books in Dropbox's /Books/ yet.");

  // --- Continue: the book read last on any device ---

  /** Office's Continue: one quiet line, "Continue  Title · Chapter 12 · 43%   Read". */
  const quietLine = (title: string, rest: string[]) => [
    h("span", { class: "k" }, "Continue"), h("b", {}, title),
    h("span", { class: "k" }, rest.filter(Boolean).map(t => `· ${t}`).join(" ")),
    h("span", { class: "go" }, "Read"),
  ];
  const renderContinue = () => {
    const last = lastReadBook(ctx.books().filter(b => !b.hidden));
    cont.hidden = !last;
    if (!last) return;
    const p = progressOf(last) ?? 0;
    if (quiet()) {
      cont.replaceChildren(...quietLine(last.title, [ctx.places(last.id)?.[0]?.chapter ?? "", p > 0 ? `${Math.round(p * 100)}%` : ""]));
      cont.onclick = () => ctx.open(last);
      if (ctx.progress(last.id) == null && last.hasSyncFile) void ctx.load(last).then(renderSoon);
      return;
    }
    cont.replaceChildren(cover(last, false),
      h("span", { class: "ci" }, h("span", { class: "k" }, "Continue"), h("span", { class: "t" }, redTitle(last.title)),
        h("span", { class: "pl" }, h("i", { style: `width:${Math.round(p * 100)}%` }))));
    cont.onclick = () => ctx.open(last);
    if (ctx.progress(last.id) == null && last.hasSyncFile) void ctx.load(last).then(renderSoon);
  };

  // --- The panel ---

  const openBook = (b: LibraryBook) => {
    panelFor = { book: b };
    renderPanel();
    if (!ctx.places(b.id) && b.hasSyncFile) void ctx.load(b).then(() => { if (panelFor && "book" in panelFor && panelFor.book.id === b.id) renderPanel(); });
  };
  const openSerial = (x: Serial) => {
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
  };
  let fromSeries: LibraryBook[] | null = null;

  // Office's panels (WEB.md → One app, two styles, 2026-10-16): the title on one line with its one
  // button, then the facts as label and value rows, the rest as quiet words at the foot.
  const opHead = (title: string, action: HTMLElement | null) => h("div", { class: "ophead" }, h("div", { class: "opt" }, title), action);
  const opButton = (name: string, action: () => void) => h("button", { class: "opbtn", onclick: action }, name);
  const opGrid = (rows: [string, Child][]) => h("div", { class: "opgrid" },
    ...rows.filter(([, v]) => v != null && v !== "").flatMap(([k, v]) => [h("div", { class: "pk" }, k), h("div", { class: "pv" }, v)]));
  const opLinks = (...links: (HTMLElement | null)[]) => h("div", { class: "oplinks" }, ...present(...links));

  const renderPanel = () => {
    if (!panelFor) return;
    const top = h("div", { class: "top" });
    const closeButton = h("button", { class: "hicon", title: "Close", "aria-label": "Close", onclick: closePanel }, svgEl(CLOSE));
    if ("serial" in panelFor) {
      const id = panelFor.serial;
      const x = ctx.serials()?.find(s => s.id === id);
      if (!x) return closePanel();
      top.append(h("span", { class: "grow" }), closeButton);
      const now = Date.now();
      const updated = updatedLabel(x);
      const link = (c: { title: string; url: string }, cls = "") => h("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", class: cls }, c.title);
      const rows = panelChapters(x);
      const chapters = rows.length ? h("div", { class: "chap" }, ...rows.flatMap(({ chapter: c, index }) => {
        const cls = [index === x.progress.currentIndex ? "cur" : "", x.progress.isRead(index) ? "read" : "", c.locked ? "locked" : ""].filter(Boolean).join(" ");
        return [h("span", {}, link(c, cls), x.progress.isNew(index) ? h("span", { class: "nw" }, quiet() ? "new" : "NEW") : null), h("span", { class: "d" }, chapterDateLabel(c.published, now, true) ?? "")];
      })) : null;
      const checked = x.checkedAt && x.device ? [`Checked ${ago(new Date(x.checkedAt).toISOString(), now)} on ${x.device}`, inDropbox(x)].filter(Boolean).join(" · ") : "No chapters from the phones yet.";
      const readable = readingOrderOf(x.chapters).length > 0;
      if (quiet()) {
        panel.replaceChildren(...present(top,
          opHead(x.title, readable ? opButton(x.current ? "Continue" : "Read", () => ctx.openSerial(x)) : null),
          opGrid([
            ["Author", bySite(x)],
            ["Chapters", [x.progress.newCount ? `${x.progress.newCount} new` : "", x.progress.unreadCount ? `${x.progress.unreadCount} unread` : x.caughtUp ? "Caught up" : "", updated ? `updated ${updated}` : ""].filter(Boolean).join(" · ")],
            ["Reading", x.chapters.length ? (x.current ? link(x.current) : "Not started") : null],
            ["Checked", checked.replace(/^Checked /, "")],
          ]),
          chapters ? h("div", { class: "sec" }, h("h3", {}, "Chapters"), chapters) : null,
          opLinks(h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, `Open on ${x.site} ↗`), h("button", { onclick: () => ctx.editSerial(x) }, "Edit details…"))));
        panel.classList.add("open");
        return;
      }
      panel.replaceChildren(...present(top,
        h("h1", { class: "sans" }, panelTitle(x.title)),
        h("div", { class: "by" }, bySite(x)),
        h("div", { class: "stline" }, ...present(newTag(x), unreadTag(x)), updated ? h("span", {}, `Updated ${updated}`) : null),
        h("div", { class: "acts" },
          readable ? h("button", { class: "seal", onclick: () => ctx.openSerial(x) }, x.current ? "Continue" : "Read") : null,
          h("a", { class: "well", href: x.url, target: "_blank", rel: "noopener noreferrer" }, `Open on ${x.site} ↗`)),
        x.chapters.length ? h("div", { class: "sec" }, h("h3", {}, "Reading"),
          h("div", { class: "chap" }, ...(x.current
            ? [link(x.current), h("span", { class: "d" }, chapterDateLabel(x.current.published, now, true) ?? "")]
            : [h("span", { class: "dim" }, "Not started"), h("span", {})]))) : null,
        chapters ? h("div", { class: "sec" }, h("h3", {}, "Chapters"), chapters) : null,
        h("div", { class: "sec" }, h("button", { class: "word", onclick: () => ctx.editSerial(x) }, "Edit details…")),
        h("div", { class: "foot2" }, checked)));
      panel.classList.add("open");
      return;
    }
    if ("series" in panelFor) {
      fromSeries = panelFor.series;
      const ms = inOrder(panelFor.series.map(m => ctx.books().find(b => b.id === m.id) ?? m));
      const name = ms[0]?.series ?? "";
      const read = ms.filter(m => m.read).length;
      const next = nextInSeries(ms, id => ctx.progress(id));
      top.append(h("span", { class: "grow" }), closeButton);
      const nextName = next ? `${(ctx.progress(next.id) ?? 0) > 0 ? "Continue" : "Read"}${next.seriesIndex != null ? ` · Book ${next.seriesIndex}` : ""}` : "";
      const bookRows = ms.map(m => {
        const p = m.read ? 1 : ctx.progress(m.id) ?? 0;
        return h("button", { class: "sbook", "data-id": m.id, onclick: () => { panelFor = { book: m }; renderPanel(); if (!ctx.places(m.id) && m.hasSyncFile) void ctx.load(m).then(renderPanel); } },
          h("span", { class: "cv0" }, cover(m, false)),
          h("span", { class: "sbi" },
            h("span", { class: "sbt" }, h("span", { class: "sbn" }, m.seriesIndex != null ? String(m.seriesIndex) : ""), m.title),
            h("span", { class: "prog" }, h("span", { class: "pl" }, h("i", { style: `width:${Math.round(p * 100)}%` })), h("span", { class: "pc" }, m.read ? "Read" : p > 0 ? pct(p) : ""))));
      });
      if (quiet()) {
        panel.replaceChildren(...present(top,
          opHead(name, next ? opButton(nextName, () => ctx.open(next)) : null),
          opGrid([["Author", ms.find(m => m.author)?.author ?? ""], ["Books", `${ms.length} books · ${read} read`]]),
          h("div", { class: "sec" }, h("h3", {}, "Books"), ...bookRows)));
      } else panel.replaceChildren(...present(top,
        h("div", { class: "scov" }, ...ms.slice(0, 3).reverse().map((m, i, arr) => h("div", { class: "cvb", style: `left:${(arr.length - 1 - i) * 22}px` }, cover(m, true)))),
        h("h1", {}, panelTitle(name)),
        h("div", { class: "by" }, ms.find(m => m.author)?.author ?? ""),
        h("div", { class: "ser" }, `${ms.length} books · ${read} read`),
        next ? h("div", { class: "acts" }, h("button", { class: "seal", onclick: () => ctx.open(next) }, nextName)) : null,
        h("div", { class: "sec" }, h("h3", {}, "Books"), ...bookRows)));
    } else {
      const b = ctx.books().find(x => x.id === (panelFor as { book: LibraryBook }).book.id) ?? panelFor.book;
      const inSeries = fromSeries?.some(m => m.id === b.id) ? fromSeries : null;
      if (inSeries) top.append(h("button", { class: "back", onclick: () => { panelFor = { series: inSeries }; renderPanel(); } }, `‹ ${b.series ?? "Series"}`));
      else fromSeries = null;
      top.append(h("span", { class: "grow" }), closeButton);
      const places = ctx.places(b.id);
      const mark = ctx.readMark(b);
      const p = ctx.progress(b.id) ?? 0;
      const choice = (name: string, on: boolean, action: () => void) => h("button", { class: on ? "on" : "", "aria-pressed": String(on), onclick: action }, name);
      const status = h("div", { class: "choice" },
        choice("Automatic", mark === "auto", () => ctx.setRead(b, null)),
        choice("Read", mark === "read", () => ctx.setRead(b, true)),
        choice("Unread", false, () => ctx.markUnread(b)));
      const file = [b.path, megabytes(b.size)].filter(Boolean).join(" · ");
      const hide = h("button", { class: quiet() ? undefined : "word", onclick: () => { closePanel(); ctx.setHidden(b, !b.hidden); } }, b.hidden ? "Unhide" : "Hide from the Library");
      if (quiet()) {
        const where = places == null ? (b.hasSyncFile ? "…" : "Not started on any device.")
          : places.length ? h("div", {}, ...places.map(pl => h("div", {}, [`${pl.device} ${Math.round(pl.p * 100)}%`, pl.chapter, ago(new Date(pl.at).toISOString(), Date.now())].filter(Boolean).join(" · "))))
            : "Not started on any device.";
        panel.replaceChildren(...present(top,
          opHead(b.title, opButton(p > 0 && !b.read ? "Continue" : "Read", () => ctx.open(b))),
          opGrid([
            ["Author", b.author ?? ""],
            ["Series", b.series ? `${b.series}${b.seriesIndex != null ? ` · ${b.seriesIndex}` : ""}` : ""],
            ["Places", where],
            ["Read status", status],
            ["File", file],
          ]),
          opLinks(h("button", { onclick: () => ctx.edit(b) }, "Edit details…"), hide)));
      } else panel.replaceChildren(...present(top,
        h("div", { class: "cvb" }, cover(b, true)),
        h("h1", {}, panelTitle(b.title)),
        h("div", { class: "by" }, b.author ?? ""),
        b.series ? h("div", { class: "ser" }, `${b.series}${b.seriesIndex != null ? ` · ${b.seriesIndex}` : ""}`) : null,
        h("div", { class: "acts" },
          h("button", { class: "seal", onclick: () => ctx.open(b) }, p > 0 && !b.read ? "Continue" : "Read"),
          h("button", { class: "well", onclick: () => ctx.edit(b) }, "Edit details…")),
        h("div", { class: "sec" }, h("h3", {}, "Places"),
          places == null ? h("div", { class: "file" }, b.hasSyncFile ? "…" : "Not started on any device.")
            : places.length ? h("div", { class: "places" }, ...places.map(pl => h("div", { class: "place" },
              h("span", { class: "dv" }, pl.device),
              h("span", { class: "pl" }, h("i", { style: `width:${Math.round(pl.p * 100)}%` })),
              h("span", { class: "pct" }, `${Math.round(pl.p * 100)}%`),
              h("span", { class: "when" }, [pl.chapter, ago(new Date(pl.at).toISOString(), Date.now())].filter(Boolean).join(" · ")))))
              : h("div", { class: "file" }, "Not started on any device.")),
        h("div", { class: "sec" }, h("h3", {}, "Read status"), status),
        h("div", { class: "sec" }, h("h3", {}, "File"), h("div", { class: "file" }, file)),
        h("div", { class: "sec" }, hide)));
    }
    panel.classList.add("open");
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
    if (path.some(x => x instanceof HTMLElement && (x.matches(".cell, .bcard, .scard, .tr[data-id], .tr[data-sid], .hcont, .hmenu, .hmark") || x.closest(".bookmenu, .dialog, .toast")))) return;
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
    if (!was !== !title || was?.side !== title?.side) renderMark(title ? title.side === "books" : !onSerials());
    if (title) {
      titleBt.replaceChildren(quiet() ? document.createTextNode(title.title) : redTitle(title.title));
      titlePlace.textContent = title.place;
      // Over the page, but clear of the name and ⚙ when the page is wider than the gap between them.
      const bar = header.getBoundingClientRect();
      const from = Math.max(title.left, markEl.getBoundingClientRect().right + 24) - bar.left;
      const to = Math.min(title.left + title.width, gear.getBoundingClientRect().left - 16) - bar.left;
      titleEl.style.left = `${Math.round(from)}px`;
      titleEl.style.width = `${Math.max(0, Math.round(to - from))}px`;
    }
  };

  return { el, bar: header, render, isOpen: () => panelFor != null, closePanel, setReading };
}

