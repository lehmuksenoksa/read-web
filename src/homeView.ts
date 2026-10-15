// Home: the full Library (WEB.md → Home, agreed 2026-10-15): Grid, Cards and Details, a book's or a
// series' panel at the right, the size control, Details' columns and Continue. The data and the
// actions (the book menu, Edit details, opening a book) are the page's own, passed in.

import {
  ago, BOOK_VIEWS, clickSort, column, DEFAULT_COLUMNS, detailsRows, FIXED, homeItems, inOrder, megabytes,
  menuSort, moveColumn, nextInSeries, shortDate, shownColumns, SIZES, sortMenuChoice, textScale, titleWord, toggleColumn,
  type BookView, type ColumnKey, type Facts, type HomeSetup,
} from "./home";
import { lastReadBook, type LibraryBook, type LibraryItem, type Place, type SortBy } from "./library";
import type { Setup } from "./looks";
import { h, icon, ICONS } from "./ui";
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
  toOffice(): void;
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

export function createHome(ctx: HomeContext): { el: HTMLElement; render: () => void; isOpen: () => boolean; closePanel: () => void } {
  let query = "";
  let menuOpen: HTMLElement | null = null;
  /** The panel's book or series; null when closed. */
  let panelFor: { book: LibraryBook } | { series: LibraryBook[] } | null = null;

  const markEl = h("div", { class: "hmark", "aria-label": "Library & Serials" });
  const m = wordmark(true, 58);
  markEl.innerHTML = `<span class="lib">${m.library}</span><span class="and">${m.ampersand}</span><span class="ser" title="Serials come later">${m.serials}</span>`;
  const search = h("input", { type: "search", placeholder: "Search title or author", "aria-label": "Search title or author" });
  const officeButton = h("button", { onclick: () => ctx.toOffice() }, "Office");
  const gear = h("button", { class: "hicon", title: "Settings", "aria-label": "Settings" }, svgEl(GEAR));
  const header = h("header", { class: "hhead" },
    markEl,
    h("span", { class: "grow" }),
    h("label", { class: "hsearch" }, icon(ICONS.search), search),
    h("div", { class: "hswitch" }, h("button", { class: "on", "aria-pressed": "true" }, "Home"), officeButton),
    gear);
  const count = h("button", { class: "hcount", "aria-haspopup": "menu" });
  const zoomLess = h("button", { class: "zb", title: "Smaller", "aria-label": "Smaller" });
  const zoom = h("input", { type: "range", min: "0", max: String(SIZES.length - 1), step: "1", "aria-label": "Size" });
  const zoomMore = h("button", { class: "zb", title: "Larger", "aria-label": "Larger" });
  const views = h("div", { class: "hviews", role: "tablist" });
  const status = h("div", { class: "hstatus" }, count, h("span", { class: "grow" }), h("div", { class: "hzoom" }, zoomLess, zoom, zoomMore), views);
  const main = h("main", { class: "hmain" });
  const cont = h("button", { class: "hcont", hidden: true });
  const panel = h("aside", { class: "hpanel", "aria-label": "Book" });
  const el = h("div", { class: "home" }, header, status, main, cont, panel);

  const home = () => ctx.setup().home;
  const setHome = (change: Partial<HomeSetup>) => ctx.update({ ...ctx.setup(), home: { ...home(), ...change } });
  const facts: Facts = {
    progress: id => ctx.progress(id),
    device: id => ctx.places(id)?.[0]?.device ?? null,
  };

  // --- Menus: the sort menu (the status line), ☰ (Details' columns), ⚙ ---

  const closeMenu = () => { menuOpen?.remove(); menuOpen = null; };
  const openMenu = (menu: HTMLElement, anchor: HTMLElement, alignRight = false) => {
    closeMenu();
    menu.classList.add("hmenu");
    el.append(menu);
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
  count.addEventListener("click", e => { e.stopPropagation(); if (menuOpen) closeMenu(); else openMenu(sortMenu(), count); });
  gear.addEventListener("click", e => {
    e.stopPropagation();
    if (menuOpen) return closeMenu();
    openMenu(h("div", { role: "menu" },
      ctx.offline() ? h("div", { class: "lab" }, "Dropbox: offline") : null,
      h("button", { class: "r", role: "menuitem", onclick: () => { closeMenu(); ctx.signOut(); } }, "Sign out")), gear, true);
  });

  /** ☰ at the end of Details' headings: a box per column (Title stays), drag a line to move it, and Reset. */
  const columnsMenu = (anchor: HTMLElement) => {
    const cols = home().columns;
    const menu = h("div", { role: "menu", class: "colmenu" }, h("div", { class: "lab" }, "Columns"));
    for (const key of cols.order) {
      const c = column(key);
      const fixed = key === FIXED;
      const box = h("input", { type: "checkbox", "aria-label": c.name });
      box.checked = !cols.hidden.includes(key);
      box.disabled = fixed;
      box.addEventListener("change", () => setHome({ columns: toggleColumn(home().columns, key) }));
      menu.append(h("label", { class: `ci${fixed ? " fixed" : ""}`, "data-col": key, draggable: fixed ? undefined : "true" },
        h("span", { class: "grip" }, fixed ? "" : "⋮⋮"), box, c.name));
    }
    menu.append(h("hr"), h("button", { class: "r", onclick: () => setHome({ columns: DEFAULT_COLUMNS }) }, "Reset"));
    dragColumns(menu);
    openMenu(menu, anchor, true);
  };

  /** Dragging a heading, or a line in ☰'s list, moves its column before the one it's dropped on. */
  let dragging: ColumnKey | null = null;
  const dragColumns = (container: HTMLElement) => {
    container.addEventListener("dragstart", e => {
      const c = (e.target as HTMLElement).closest<HTMLElement>("[data-col][draggable]");
      if (!c) return;
      dragging = c.dataset.col as ColumnKey;
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
      const moved = moveColumn(home().columns, dragging, c.dataset.col as ColumnKey);
      dragging = null;
      setHome({ columns: moved });
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
    const cols = shownColumns(home().columns);
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

  const render = () => {
    // ☰'s list stays open while its boxes change the columns; other menus close.
    const columnsOpen = menuOpen?.classList.contains("colmenu") ?? false;
    closeMenu();
    const hs = home();
    const view = hs.view;
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

  const renderContinue = () => {
    const last = lastReadBook(ctx.books().filter(b => !b.hidden));
    cont.hidden = !last;
    if (!last) return;
    const p = progressOf(last) ?? 0;
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
  const openSeries = (members: LibraryBook[]) => {
    panelFor = { series: members.map(m => m.id).map(id => ctx.books().find(b => b.id === id)!).filter(Boolean) };
    renderPanel();
    for (const m of members) if (ctx.progress(m.id) == null && m.hasSyncFile) void ctx.load(m).then(renderSoon);
  };
  const closePanel = () => {
    if (!panelFor) return;
    panelFor = null;
    panel.classList.remove("open");
    main.querySelector(".tr.on")?.classList.remove("on");
  };
  let fromSeries: LibraryBook[] | null = null;

  const renderPanel = () => {
    if (!panelFor) return;
    const top = h("div", { class: "top" });
    const closeButton = h("button", { class: "hicon", title: "Close", "aria-label": "Close", onclick: closePanel }, svgEl(CLOSE));
    if ("series" in panelFor) {
      fromSeries = panelFor.series;
      const ms = inOrder(panelFor.series.map(m => ctx.books().find(b => b.id === m.id) ?? m));
      const name = ms[0]?.series ?? "";
      const read = ms.filter(m => m.read).length;
      const next = nextInSeries(ms, id => ctx.progress(id));
      top.append(h("span", { class: "grow" }), closeButton);
      panel.replaceChildren(...present(top,
        h("div", { class: "scov" }, ...ms.slice(0, 3).reverse().map((m, i, arr) => h("div", { class: "cvb", style: `left:${(arr.length - 1 - i) * 22}px` }, cover(m, true)))),
        h("h1", {}, redTitle(name)),
        h("div", { class: "by" }, ms.find(m => m.author)?.author ?? ""),
        h("div", { class: "ser" }, `${ms.length} books · ${read} read`),
        next ? h("div", { class: "acts" }, h("button", { class: "seal", onclick: () => ctx.open(next) }, `${(ctx.progress(next.id) ?? 0) > 0 ? "Continue" : "Read"}${next.seriesIndex != null ? ` · Book ${next.seriesIndex}` : ""}`)) : null,
        h("div", { class: "sec" }, h("h3", {}, "Books"), ...ms.map(m => {
          const p = m.read ? 1 : ctx.progress(m.id) ?? 0;
          return h("button", { class: "sbook", "data-id": m.id, onclick: () => { panelFor = { book: m }; renderPanel(); if (!ctx.places(m.id) && m.hasSyncFile) void ctx.load(m).then(renderPanel); } },
            h("span", { class: "cv0" }, cover(m, false)),
            h("span", { class: "sbi" },
              h("span", { class: "sbt" }, h("span", { class: "sbn" }, m.seriesIndex != null ? String(m.seriesIndex) : ""), m.title),
              h("span", { class: "prog" }, h("span", { class: "pl" }, h("i", { style: `width:${Math.round(p * 100)}%` })), h("span", { class: "pc" }, m.read ? "Read" : p > 0 ? pct(p) : ""))));
        }))));
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
      panel.replaceChildren(...present(top,
        h("div", { class: "cvb" }, cover(b, true)),
        h("h1", {}, redTitle(b.title)),
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
        h("div", { class: "sec" }, h("h3", {}, "Read status"),
          h("div", { class: "choice" },
            choice("Automatic", mark === "auto", () => ctx.setRead(b, null)),
            choice("Read", mark === "read", () => ctx.setRead(b, true)),
            choice("Unread", false, () => ctx.markUnread(b)))),
        h("div", { class: "sec" }, h("h3", {}, "File"), h("div", { class: "file" }, [b.path, megabytes(b.size)].filter(Boolean).join(" · "))),
        h("div", { class: "sec" }, h("button", { class: "word", onclick: () => { closePanel(); ctx.setHidden(b, !b.hidden); } }, b.hidden ? "Unhide" : "Hide from the Library"))));
    }
    panel.classList.add("open");
    main.querySelectorAll(".tr.on").forEach(x => x.classList.remove("on"));
    if ("book" in panelFor) main.querySelector(`.tr[data-id="${panelFor.book.id}"]`)?.classList.add("on");
  };

  // --- Events ---

  search.addEventListener("input", () => { query = search.value; render(); });
  const setSize = (step: number) => setHome({ sizes: { ...home().sizes, [home().view]: Math.max(0, Math.min(SIZES.length - 1, step)) } as Record<BookView, number> });
  zoom.addEventListener("input", () => setSize(Number(zoom.value)));
  zoomLess.addEventListener("click", () => setSize(home().sizes[home().view] - 1));
  zoomMore.addEventListener("click", () => setSize(home().sizes[home().view] + 1));
  main.addEventListener("contextmenu", e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
    const book = item && ctx.books().find(b => b.id === item.dataset.id);
    if (!book) return;
    e.preventDefault();
    e.stopPropagation();
    ctx.menu(book, e.clientX, e.clientY);
  });
  // A click outside the panel (and not on a book) closes it; outside a menu closes the menu.
  el.addEventListener("click", e => {
    const path = e.composedPath();
    if (menuOpen && !path.includes(menuOpen)) closeMenu();
    if (!panelFor || path.includes(panel)) return;
    if (path.some(x => x instanceof HTMLElement && (x.matches(".cell, .bcard, .tr[data-id], .hcont, .hmenu") || x.closest(".bookmenu, .dialog, .toast")))) return;
    closePanel();
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !el.isConnected || !el.offsetParent) return;
    if (menuOpen) closeMenu();
    else closePanel();
  });

  return { el, render, isOpen: () => panelFor != null, closePanel };
}

