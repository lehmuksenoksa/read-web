import "./style.css";
import { Appearance, applyLook } from "./appearance";
import { APP_KEY, currentToken, finishSignIn, forgetSignIn, signIn } from "./auth";
import { parseDetails, parseNumber, withDetails, type BookDetails } from "./details";
import { Dropbox, RevConflict } from "./dropbox";
import { beforeUpload, bookInfo, bookPath, contentHash, isEpubName, thumbnail, type AddOutcome, type BookInfo } from "./addBooks";
import { createHome } from "./homeView";
import { booksToFetch, furthest, lastReadBook, libraryBooks, libraryItems, markedBook, placesOf, stillKnown, titleFromFileName, withSyncTimes, type IndexEntry, type KnownProgress, type LibraryBook, type LibraryItem, type SortBy } from "./library";
import { shown, SIDEBAR, sidebarWidth, type Setup } from "./looks";
import { backupPath, BOOKS_FOLDER, chapterFolderPath, chapterListPath, CHAPTERS_FOLDER, chapterTextPath, DETAILS_PATH, DEVICES_PATH, isSerialId, LIBRARY_INDEX_PATH, serialSyncPath, SUBSCRIPTIONS_PATH, SYNC_FOLDER, syncFilePath } from "./paths";
import { openSerial } from "./serialBook";
import {
  chapterIdOf, homeSerials, keepsNotes, parseChapterList, parseSubscriptions, phonesKeepNotes, progressLabel, readingOrderOf, searchSerials, sortSerials, withEndMark,
  type ChapterList, type Serial, type Subscription,
} from "./serials";
import { keptFile } from "./store";
import { showReader } from "./reader";
import { marksOf, withMarks, type Marks, type ReadMark } from "./sync";
import { forgetAll, keepBook, keptBooks, keepValue, keptValue } from "./store";
import { h, icon, ICONS } from "./ui";

const root = document.getElementById("app")!;
/** Web's setup and the fonts, read once per visit. */
let appearance: Appearance | null = null;
/** Closes the book open in the reader (its place saved first). */
let closeReader: (() => Promise<void>) | null = null;
/** Stops the page following setup changes. */
let stopFollowing: (() => void) | null = null;

// The browser tab says "Read.web", with or without a book open (2026-10-14).
document.title = "Read.web";

/** Closes the sidebar's menus (sort, a book's) on a click outside them or Esc (set while they can be open). */
let closeMenu: ((e?: Event) => void) | null = null;
document.addEventListener("click", e => closeMenu?.(e));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu?.(); });

function dropbox(): Dropbox | null {
  const token = currentToken();
  return token ? new Dropbox(token, () => { forgetSignIn(); showSignIn(); }) : null;
}

// --- Sign-in ---

function showSignIn(message?: string) {
  closeMenu = null;
  stopFollowing?.();
  stopFollowing = null;
  document.documentElement.style.removeProperty("--bg");
  document.documentElement.style.removeProperty("--tx");
  appearance?.close();
  appearance = null;
  root.className = "";
  root.replaceChildren(
    h("main", { class: "signin" },
      h("h1", {}, "Library"),
      APP_KEY
        ? h("button", { class: "btn", onclick: () => void signIn() }, "Sign in with Dropbox")
        : h("p", { class: "muted" }, "This page isn't set up yet: it has no Dropbox app key."),
      message ? h("p", { class: "muted" }, message) : null,
      h("p", { class: "muted small" }, "Signed in until you close the browser."),
    ),
  );
}

async function signOut(api: Dropbox) {
  await closeReader?.();
  closeReader = null;
  await appearance?.flush();
  await api.revoke().catch(() => undefined);
  forgetSignIn();
  // What this browser kept (books, fonts, the Library) goes with the sign-in.
  await forgetAll();
  showSignIn("Signed out.");
}

// --- Home or Office: per browser (WEB.md → Home) ---

const HOME_KEY = "read.home";
function homeMode(): boolean {
  try { return localStorage.getItem(HOME_KEY) === "1"; } catch { return false; }
}
function setHomeMode(on: boolean) {
  try { if (on) localStorage.setItem(HOME_KEY, "1"); else localStorage.removeItem(HOME_KEY); } catch { /* This browser keeps nothing: Office. */ }
}

// --- The Library beside the reader ---

let sortBy: SortBy = "recent";
let query = "";

/** A window this narrow (page pixels) shows the Library over the page, not beside it. */
const NARROW = window.matchMedia("(max-width: 900px)");

async function showApp() {
  const api = dropbox();
  if (!api) return showSignIn();
  appearance ??= new Appearance(api);
  const look = appearance;

  const list = h("div", { class: "list" });
  const note = h("p", { class: "note muted" }, "Loading your books…");
  // WEB.md → The sidebar (2026-10-14): ◫ Library; search; "All books · 142" with sort and group; the books; Dropbox and Sign out.
  const search = h("input", { class: "search", type: "search", placeholder: "Search title or author", "aria-label": "Search title or author", value: query });
  const hideButton = h("button", { class: "icon", title: "Hide the Library", "aria-label": "Hide the Library" }, icon(ICONS.panel));
  const count = h("span", { class: "count" });
  const sortButton = h("button", { class: "icon", title: "Sort and group", "aria-label": "Sort and group", "aria-expanded": "false" }, icon(ICONS.sliders));
  const menu = h("div", { class: "panel menu sortmenu", role: "menu", hidden: true });
  // The footer (2026-10-15): Home (in Office) and Sign out; "Dropbox: offline" only while Dropbox is out of reach.
  const dropboxLabel = h("span", { hidden: true }, "Dropbox: offline");
  const homeLink = h("button", { class: "link", onclick: () => toHome() }, "Home");
  const heading = h("h1", {}, "Library");
  const handle = h("div", { class: "resizer", title: "Drag to resize; double-click for the usual width", role: "separator", "aria-orientation": "vertical", "aria-label": "Library width" });
  const side = h("aside", { class: "sidebar" },
    handle,
    h("div", { class: "shead" }, hideButton, heading),
    h("label", { class: "sfilter" }, icon(ICONS.search), search),
    h("div", { class: "lhead" }, count, sortButton, menu),
    note,
    list,
    h("div", { class: "sfoot" },
      h("span", { class: "who" }, dropboxLabel),
      homeLink,
      h("button", { class: "link", onclick: () => void signOut(api) }, "Sign out")));
  const showButton = h("button", { class: "icon", title: "Show the Library", "aria-label": "Show the Library" }, icon(ICONS.panel));
  // Contents and Aa (the reader puts them here): in the sidebar's top row, or over the page's top left
  // when the sidebar is hidden or opens over the page (a narrow window).
  const tools = h("span", { class: "tools" });
  const floating = h("div", { class: "floatbar" }, showButton);
  const sideSlot = side.querySelector<HTMLElement>(".shead")!;
  const pane = h("section", { class: "main" }, h("p", { class: "empty muted" }, ""));
  root.replaceChildren(side, h("div", { class: "mainwrap" }, floating, pane));

  let setup: Setup = await look.setup();
  let toastReady = false;
  /** On a narrow window the Library opens over the page now and then; it isn't saved. */
  let overlayOpen = false;
  /** Home's full Library shows (not the reader). */
  let homeShown = homeMode();
  let home: ReturnType<typeof createHome> | null = null;
  const layout = () => {
    const visible = NARROW.matches ? overlayOpen : setup.sidebar;
    root.className = homeShown
      // Home is always Dark for now (2026-10-15); Light waits for choosing the look in Home.
      ? "app homeon dark"
      : `app${visible ? "" : " noside"}${NARROW.matches ? " narrow" : ""}`;
    homeLink.hidden = homeMode();
    heading.classList.toggle("tohome", homeMode());
    heading.title = homeMode() ? "Back to the Library" : "";
    // Messages show over whichever is showing.
    if (toastReady) (homeShown && home ? home.el : pane.parentElement!).append(toast);
    (visible && !NARROW.matches ? sideSlot : floating).append(tools);
    side.style.width = `${setup.sidebarWidth}px`;
  };
  // Dragging the sidebar's edge resizes it; the width is kept in Web's setup when the drag ends.
  handle.addEventListener("pointerdown", e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    root.classList.add("dragging");
    const left = side.getBoundingClientRect().left;
    const move = (m: PointerEvent) => { side.style.width = `${sidebarWidth(m.clientX - left)}px`; };
    const done = () => {
      handle.removeEventListener("pointermove", move);
      root.classList.remove("dragging");
      look.update({ ...setup, sidebarWidth: sidebarWidth(side.getBoundingClientRect().width) });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", done, { once: true });
    handle.addEventListener("pointercancel", done, { once: true });
  });
  handle.addEventListener("dblclick", () => look.update({ ...setup, sidebarWidth: SIDEBAR.normal }));
  const setSidebar = (visible: boolean) => {
    if (NARROW.matches) overlayOpen = visible;
    else look.update({ ...setup, sidebar: visible });
    layout();
  };
  hideButton.addEventListener("click", () => setSidebar(false));
  showButton.addEventListener("click", () => setSidebar(true));
  NARROW.addEventListener("change", layout);
  applyLook(shown(setup));
  layout();
  stopFollowing?.();
  stopFollowing = look.onChange(next => { setup = next; applyLook(shown(next)); layout(); if (homeShown) home?.render(); });

  // Sort and group: Recent, Title or Author, and Group series.
  const tick = (on: boolean) => h("span", { class: "v" }, on ? icon(ICONS.check) : null);
  const fillMenu = () => {
    const choice = (by: SortBy, name: string) => h("button", {
      class: "r", role: "menuitemradio", "aria-checked": String(sortBy === by),
      onclick: () => { sortBy = by; fillMenu(); render(); },
    }, name, tick(sortBy === by));
    const on = setup.groupSeries;
    menu.replaceChildren(
      h("div", { class: "lab" }, "Sort"),
      choice("recent", "Recent"), choice("title", "Title"), choice("author", "Author"),
      h("hr"),
      h("button", {
        class: "r", role: "menuitemcheckbox", "aria-checked": String(on),
        onclick: () => { look.update({ ...setup, groupSeries: !on }); fillMenu(); render(); },
      }, "Group series", tick(on)),
      h("hr"),
      // Hidden books (Hide on any device) are listed apart, to Unhide.
      h("div", { class: "lab" }, "Show"),
      h("button", { class: "r", role: "menuitemradio", "aria-checked": String(!showHidden), onclick: () => { showHidden = false; fillMenu(); render(); } }, "All books", tick(!showHidden)),
      h("button", { class: "r", role: "menuitemradio", "aria-checked": String(showHidden), onclick: () => { showHidden = true; fillMenu(); render(); } }, "Hidden", tick(showHidden)));
  };
  /** Show › Hidden: the hidden books instead of the others. Not kept. */
  let showHidden = false;
  const closeTheMenu = () => {
    menu.hidden = true;
    sortButton.setAttribute("aria-expanded", "false");
  };
  sortButton.addEventListener("click", () => {
    if (!menu.hidden) return closeTheMenu();
    fillMenu();
    menu.hidden = false;
    sortButton.setAttribute("aria-expanded", "true");
  });
  closeMenu = (e?: Event) => {
    const path = e?.composedPath() ?? [];
    if (!path.some(el => el === menu || el === sortButton)) closeTheMenu();
    if (!path.includes(bookMenu)) closeBookMenu();
  };

  // --- The books ---

  // The Library as this browser last saw it shows at once; Dropbox's replaces it when it comes.
  const kept = await keptValue<KeptLibrary>("library");
  /** Books added from Home: what their EPUBs say, until a phone lists them in library.json. */
  const addedHere: Record<string, IndexEntry> = (await keptValue<Record<string, IndexEntry>>("added")) ?? {};
  let books: LibraryBook[] = kept?.books ?? [];
  /** The shared details file's edits, books' and serials'. */
  let detailsNow: Record<string, BookDetails> = {};
  /** Each book's furthest place, with the time of the sync file it was read from: read again only when that changes. */
  const known = new Map<string, KnownProgress>(Object.entries(kept?.progress ?? {}));
  let saveTimer: number | undefined;
  const saveLibrary = () => {
    window.clearTimeout(saveTimer);
    // Not after Sign out, which empties what this browser kept.
    saveTimer = window.setTimeout(() => currentToken() && void keepValue("library", {
      books: books.map(b => ({ ...b, cover: null })),
      progress: Object.fromEntries(known),
    } satisfies KeptLibrary), 1000);
  };

  /** The book menu's marks set in this browser (WEB.md → The book menu): shown over the index while newer than its entry. */
  const marks: Record<string, Marks> = (await keptValue<Record<string, Marks>>("marks")) ?? {};
  const saveMarks = () => { if (currentToken()) void keepValue("marks", marks); };
  /** The marks in the books' sync files as last read (for the menu's ✓). */
  const syncMarks = new Map<string, Marks>();
  /** A book as the Library shows it: with the marks set here. */
  const marked = (book: LibraryBook) => markedBook(book, marks[book.id], known.get(book.id)?.p ?? null);
  const bookById = (id: string | undefined) => { const b = books.find(x => x.id === id); return b ? marked(b) : undefined; };

  let progress = new Map<string, Promise<number>>();
  const progressOf = (book: LibraryBook) => {
    if (!book.hasSyncFile) return Promise.resolve(0);
    const was = stillKnown(known.get(book.id), book);
    if (was != null) return Promise.resolve(was);
    let p = progress.get(book.id);
    if (!p) {
      let places: KnownProgress["places"];
      p = api.readText(syncFilePath(book.id)).then(r => {
        const file = r ? JSON.parse(r.text) : null;
        syncMarks.set(book.id, marksOf(file));
        places = placesOf(file);
        return furthest(file);
      }).catch(() => 0);
      progress.set(book.id, p);
      void p.then(value => { known.set(book.id, { at: book.lastRead, p: value, places }); saveLibrary(); });
    }
    return p;
  };
  /** A book's progress now known (Web just saved its place): its row shows it at once. */
  const showProgress = (id: string, p: number, places?: KnownProgress["places"]) => {
    const book = bookById(id);
    if (!book) return;
    known.set(id, { at: book.lastRead, p, places: places ?? known.get(id)?.places });
    progress.set(id, Promise.resolve(p));
    saveLibrary();
    const row = list.querySelector<HTMLElement>(`.row[data-id="${id}"]`);
    if (row && !book.read) showOn(row, p);
  };
  /** A book in progress: "38%" on its title line and the line under it; none until started. */
  const showOn = (row: HTMLElement, p: number) => {
    const cell = row.querySelector<HTMLElement>(".p");
    const bar = row.querySelector<HTMLElement>(".line");
    if (cell) cell.textContent = p > 0 ? `${Math.round(p * 100)}%` : "";
    if (bar) {
      bar.hidden = !(p > 0);
      (bar.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    }
  };
  // A row's progress is read when it comes into view: "38%" and the line under it ("Read" needs neither).
  const seen = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      seen.unobserve(entry.target);
      const row = entry.target as HTMLElement;
      const book = bookById(row.dataset.id);
      if (!book || book.read) continue;
      void progressOf(book).then(p => showOn(row, p));
    }
  }, { root: list });
  /** Series opened in this visit. */
  const open = new Set<string>();
  /** The book or serial in the reader. */
  let currentId: string | null = null;
  /** What's in the reader: the sidebar lists books, or serials while a serial is open. */
  let currentKind: "book" | "serial" = "book";
  /** The book in the reader is the one the page started with, not one picked: a newer last-read book replaces it. */
  let startedWith = false;

  /** The line under a row: the share read, shown only while in progress. */
  const line = (fraction: number | null) => h("span", { class: "line", hidden: fraction == null },
    h("i", { style: `width: ${Math.round((fraction ?? 0) * 100)}%` }));
  const bookRow = (book: LibraryBook, inSeries: boolean) => {
    const byline = inSeries
      ? (book.seriesIndex != null ? `Book ${book.seriesIndex}` : book.author ?? "")
      : [book.author, book.series && `${book.series}${book.seriesIndex != null ? ` ${book.seriesIndex}` : ""}`].filter(Boolean).join(" · ");
    const more = h("span", { class: "more", role: "button", title: "More", "aria-label": `More for ${book.title}` }, icon(ICONS.more));
    more.addEventListener("click", e => {
      e.stopPropagation();
      const r = more.getBoundingClientRect();
      openBookMenu(book, r.right - 8, r.bottom + 4);
    });
    return h("button", {
      class: `row${inSeries ? " child" : ""}${book.id === currentId ? " cur" : ""}${book.id === menuFor ? " menuon" : ""}`, "data-id": book.id,
      "aria-current": book.id === currentId ? "true" : undefined,
      onclick: () => void openBook(book),
    },
      h("span", { class: "t" }, h("span", { class: "x" }, book.title), h("span", { class: "p" }, book.read ? "Read" : ""), more),
      h("span", { class: "a" }, byline),
      line(null));
  };
  const seriesRows = (item: Extract<LibraryItem, { kind: "series" }>) => {
    const key = item.name.toLocaleLowerCase();
    const opened = open.has(key) || query.trim() !== "";
    const all = item.read === item.books.length;
    const head = h("button", {
      class: `row series${opened ? " open" : ""}`, "aria-expanded": String(opened),
      onclick: () => { if (open.has(key)) open.delete(key); else open.add(key); render(); },
    },
      h("span", { class: "t" }, h("span", { class: "x" }, item.name), h("span", { class: "chev" }, icon(opened ? ICONS.down : ICONS.right))),
      h("span", { class: "a" }, [item.author, `${item.books.length} books`, `${item.read} read`].filter(Boolean).join(" · ")),
      line(all || item.read === 0 ? null : item.read / item.books.length));
    return [head, ...(opened ? item.books.map(b => bookRow(b, true)) : [])];
  };

  const render = () => {
    renderSide();
    if (homeShown) home?.render();
  };
  /** A serial's row in the sidebar while a serial is open (WEB.md → Home, step 3b). */
  const serialRow = (x: Serial) => h("button", {
    class: `row${x.id === currentId ? " cur" : ""}`, "data-sid": x.id, "aria-current": x.id === currentId ? "true" : undefined,
    onclick: () => void openSerialNow(x),
  },
    h("span", { class: "t" }, h("span", { class: "x" }, x.title)),
    h("span", { class: "a" }, x.chapters.length ? progressLabel(x.progress) : x.site));
  const renderSide = () => {
    sortButton.style.display = currentKind === "serial" ? "none" : "";
    heading.textContent = currentKind === "serial" ? "Serials" : "Library";
    if (currentKind === "serial") {
      const all = serialsNow() ?? [];
      const found = sortSerials(searchSerials(all, query), { key: "lastread", reversed: false });
      count.textContent = query.trim() ? `${found.length} found` : `Serials · ${all.length}`;
      list.replaceChildren(...(found.length ? found.map(serialRow) : [h("p", { class: "note muted" }, all.length ? "No serials match." : "No serials yet.")]));
      return;
    }
    const listed = books.map(marked).filter(b => !!b.hidden === showHidden);
    const items = libraryItems(listed, sortBy, query, setup.groupSeries);
    const found = items.reduce((n, item) => n + (item.kind === "book" ? 1 : item.books.length), 0);
    count.textContent = showHidden ? `Hidden · ${found}` : query.trim() ? `${found} found` : `All books · ${listed.length}`;
    list.replaceChildren(...items.flatMap(item => (item.kind === "book" ? [bookRow(item.book, false)] : seriesRows(item))));
    list.querySelectorAll(".row[data-id]").forEach(el => seen.observe(el));
    if (!items.length && !note.isConnected) list.replaceChildren(h("p", { class: "note muted" }, showHidden ? "No hidden books." : books.length ? "No books match." : "No books in Dropbox's /Books/ yet."));
  };
  search.addEventListener("input", () => { query = search.value; render(); });

  // --- A book's menu: ⋯ on hover, or a right-click (WEB.md → The book menu, 2026-10-14) ---

  const bookMenu = h("div", { class: "panel menu bookmenu", role: "menu", hidden: true });
  const toast = h("div", { class: "msg toast", hidden: true });
  root.append(bookMenu);
  pane.parentElement!.append(toast);
  toastReady = true;
  /** The book whose menu is open: its row keeps the hover outline. */
  let menuFor: string | null = null;
  let toastTimer: number | undefined;
  const tell = (text: string, undo?: () => void) => {
    window.clearTimeout(toastTimer);
    toast.replaceChildren(h("span", {}, text), ...(undo ? [h("button", { class: "link strong", onclick: () => { toast.hidden = true; undo(); } }, "Undo")] : []));
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 8000);
  };
  const closeBookMenu = () => {
    if (bookMenu.hidden) return;
    bookMenu.hidden = true;
    menuFor = null;
    list.querySelector(".row.menuon")?.classList.remove("menuon");
  };
  /** The newer of two read marks. */
  const newer = (a?: ReadMark, b?: ReadMark) => (!a ? b : !b ? a : a.updatedAt >= b.updatedAt ? a : b);
  const fillBookMenu = (book: LibraryBook) => {
    const shownBook = marked(book);
    const mark = newer(marks[book.id]?.read, syncMarks.get(book.id)?.read);
    const p = known.get(book.id)?.p ?? 0;
    const item = (name: string, action: () => void, on?: boolean) =>
      h("button", { class: "r", role: on === undefined ? "menuitem" : "menuitemradio", "aria-checked": on === undefined ? undefined : String(on), onclick: () => { closeBookMenu(); action(); } }, name, on === undefined ? null : tick(on));
    bookMenu.replaceChildren(
      h("div", { class: "lab" }, book.title),
      item("Mark as read", () => void setRead(book, true), mark?.read === true),
      ...(p > 0 || shownBook.read ? [item("Mark as unread", () => markUnread(book))] : []),
      item("Automatic", () => void setRead(book, null), !mark || mark.read === null),
      h("hr"),
      item("Edit details…", () => editDetails(book)),
      h("hr"),
      item(shownBook.hidden ? "Unhide" : "Hide", () => void setHidden(book, !shownBook.hidden)),
    );
  };
  const openBookMenu = (book: LibraryBook, x: number, y: number) => {
    closeMenu?.();
    menuFor = book.id;
    list.querySelector(`.row[data-id="${book.id}"]`)?.classList.add("menuon");
    fillBookMenu(book);
    bookMenu.hidden = false;
    const r = bookMenu.getBoundingClientRect();
    bookMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
    bookMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
    // The ✓ needs the book's own marks: read now when they aren't known yet.
    if (!syncMarks.has(book.id) && book.hasSyncFile) {
      void api.readText(syncFilePath(book.id)).then(r => {
        syncMarks.set(book.id, marksOf(r ? JSON.parse(r.text) : null));
        if (menuFor === book.id) fillBookMenu(book);
      }).catch(() => undefined);
    }
  };
  list.addEventListener("contextmenu", e => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".row[data-id]");
    const book = books.find(b => b.id === row?.dataset.id);
    if (!row || !book) return;
    e.preventDefault();
    e.stopPropagation();
    const r = row.getBoundingClientRect();
    // A keyboard's menu key has no pointer: under the row's title.
    openBookMenu(book, e.clientX || r.left + 24, e.clientY || r.top + 24);
  });

  /** Changes a book's marks in its sync file (read first, then written with its revision; tried again if it moved meanwhile). */
  const writeMarks = async (id: string, change: Marks) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await api.readText(syncFilePath(id));
      try {
        await api.writeText(syncFilePath(id), withMarks(remote?.text ?? null, id, change), remote?.rev ?? null);
        syncMarks.set(id, { ...syncMarks.get(id), ...change });
        return;
      } catch (e) {
        if (!(e instanceof RevConflict)) throw e;
      }
    }
    throw new Error("The sync file kept changing");
  };
  const setMarks = (id: string, change: Marks) => {
    marks[id] = { ...marks[id], ...change };
    saveMarks();
    render();
  };
  const failed = () => tell("Couldn't reach Dropbox. Try again in a moment.");

  /** Mark as read (true) or Automatic (null): here at once, then in the sync file. */
  const setRead = async (book: LibraryBook, read: true | null) => {
    const change: Marks = { read: { read, updatedAt: Date.now() } };
    setMarks(book.id, change);
    await writeMarks(book.id, change).catch(failed);
  };

  /** Mark as unread: back to 0% on every device, as on the phones; Undo before it's sent. */
  const unreadTimers = new Map<string, number>();
  const markUnread = (book: LibraryBook) => {
    const before = { marks: marks[book.id], known: known.get(book.id) };
    const now = Date.now();
    setMarks(book.id, { read: { read: null, updatedAt: now }, reset: { at: now } });
    showProgress(book.id, 0);
    window.clearTimeout(unreadTimers.get(book.id));
    unreadTimers.set(book.id, window.setTimeout(async () => {
      unreadTimers.delete(book.id);
      // The open book closes first (its place is saved before the reset, so it doesn't count), then opens at the start.
      const wasOpen = currentId === book.id;
      if (wasOpen) {
        currentId = null;
        await (opening = opening.then(async () => { await closeReader?.(); closeReader = null; }));
      }
      const at = Date.now();
      const change: Marks = { read: { read: null, updatedAt: at }, reset: { at } };
      setMarks(book.id, change);
      await writeMarks(book.id, change).catch(failed);
      if (wasOpen && currentId === null) void openBook(book);
    }, UNREAD_SEND_AFTER_MS));
    tell("Marked unread: back to 0%", () => {
      window.clearTimeout(unreadTimers.get(book.id));
      unreadTimers.delete(book.id);
      if (before.marks) marks[book.id] = before.marks; else delete marks[book.id];
      if (before.known) known.set(book.id, before.known); else known.delete(book.id);
      progress.delete(book.id);
      saveMarks();
      saveLibrary();
      render();
    });
  };

  /** Hide or Unhide: on every device (the newer wins), with Undo. */
  const setHidden = async (book: LibraryBook, hidden: boolean) => {
    const change: Marks = { hidden: { hidden, updatedAt: Date.now() } };
    setMarks(book.id, change);
    tell(hidden ? `Hid “${book.title}”` : `“${book.title}” is back`, () => void setHidden(book, !hidden));
    await writeMarks(book.id, change).catch(failed);
  };

  /** Edit details…: title, author, series and number, into the shared details file (the newer edit wins per book). */
  const editDetails = (book: LibraryBook, serial = false) => {
    const field = (label: string, value: string, attrs: Record<string, string> = {}) => {
      const input = h("input", { value, "aria-label": label, ...attrs });
      return [h("label", {}, label, input), input] as const;
    };
    const [titleRow, titleIn] = field("Title", book.title);
    const [authorRow, authorIn] = field("Author", book.author ?? "");
    const [seriesRow, seriesIn] = field("Series", book.series ?? "");
    const [numberRow, numberIn] = field("Number", book.seriesIndex != null ? String(book.seriesIndex) : "", { inputmode: "decimal" });
    const save = h("button", { class: "btn primary", type: "submit" }, "Save");
    const form = h("form", { class: "box" },
      h("h2", {}, "Edit details"),
      titleRow, authorRow, serial ? null : h("div", { class: "two" }, seriesRow, numberRow),
      h("div", { class: "btns" }, h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"), save));
    const dialog = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Edit details" }, form);
    const close = () => { dialog.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const check = () => {
      const numberOk = !numberIn.value.trim() || parseNumber(numberIn.value) != null;
      save.disabled = !titleIn.value.trim() || !numberOk;
    };
    form.addEventListener("input", check);
    dialog.addEventListener("click", e => { if (e.target === dialog) close(); });
    document.addEventListener("keydown", onKey, true);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      check();
      if (save.disabled) return;
      const edit = {
        title: titleIn.value.trim(),
        author: authorIn.value.trim() || null,
        series: seriesIn.value.trim() || null,
        number: parseNumber(numberIn.value),
      };
      close();
      const before = books.find(b => b.id === book.id);
      const detailsBefore = detailsNow;
      books = books.map(b => (b.id === book.id ? { ...b, title: edit.title, author: edit.author, series: edit.series, seriesIndex: edit.number } : b));
      detailsNow = { ...detailsNow, [book.id]: { ...detailsNow[book.id], ...edit, updatedAt: Date.now() } };
      saveLibrary();
      render();
      try {
        for (let attempt = 0; ; attempt++) {
          const remote = await api.readText(DETAILS_PATH);
          try {
            await api.writeText(DETAILS_PATH, withDetails(remote?.text ?? null, book.id, edit, Date.now()), remote?.rev ?? null);
            break;
          } catch (err) {
            if (!(err instanceof RevConflict) || attempt >= 2) throw err;
          }
        }
      } catch {
        if (before) books = books.map(b => (b.id === book.id ? before : b));
        detailsNow = detailsBefore;
        render();
        failed();
      }
    });
    root.append(dialog);
    titleIn.focus();
    titleIn.select();
  };

  /** A book into the reader: the one open before saves its place and closes first. */
  let opening = Promise.resolve();
  const openBook = (book: LibraryBook, atStart = false) => {
    if (homeShown && !atStart) {
      homeShown = false;
      home?.closePanel();
      layout();
    }
    startedWith = atStart;
    if (book.id === currentId) return opening;
    currentId = book.id;
    currentKind = "book";
    // Its series open, so the highlighted row shows.
    if (book.series) open.add(book.series.toLocaleLowerCase());
    render();
    if (NARROW.matches && !atStart) { overlayOpen = false; layout(); }
    opening = opening.then(async () => {
      await closeReader?.();
      closeReader = null;
      if (currentId !== book.id) return;
      closeReader = await showReader(pane, {
        dropbox: api, appearance: look, id: book.id, path: book.path, title: book.title, tools,
        onSaved: text => showProgress(book.id, furthest(JSON.parse(text)), placesOf(JSON.parse(text))),
      });
    }).catch(() => undefined); // One book that fails to open doesn't stop the next.
    return opening;
  };
  /** A serial into the reader (WEB.md → Home, step 3b): its chapters from Dropbox, its place in its sync file. */
  const openSerialNow = (x: Serial) => {
    if (homeShown) {
      homeShown = false;
      home?.closePanel();
      layout();
    }
    startedWith = false;
    if (x.id === currentId) return opening;
    currentId = x.id;
    currentKind = "serial";
    render();
    if (NARROW.matches) { overlayOpen = false; layout(); }
    opening = opening.then(async () => {
      await closeReader?.();
      closeReader = null;
      if (currentId !== x.id) return;
      const [inDropbox, keep] = await Promise.all([chaptersInDropbox(x.id), phonesKeep()]);
      const sub = serialData?.subs.find(s => s.bookId === x.id);
      const order = readingOrderOf(x.chapters).map(c => c.id);
      const text = (chapterId: string) => keptFile(chapterTextPath(x.id, chapterId), () => api.download(chapterTextPath(x.id, chapterId)).then(f => f?.bytes ?? null))
        .then(bytes => (bytes ? new TextDecoder().decode(bytes) : null));
      closeReader = await showReader(pane, {
        dropbox: api, appearance: look, id: x.id, path: "", title: x.title, tools,
        onSaved: saved => {
          if (serialData) serialData = { ...serialData, places: { ...serialData.places, [x.id]: JSON.parse(saved) } };
          render();
        },
        serial: {
          open: () => openSerial({ id: x.id, title: x.title, author: x.author, site: x.site, chapters: x.chapters, inDropbox, keepNotes: keepsNotes(sub, keep), text }),
          syncPath: serialSyncPath(x.id),
          endChapterId: sub?.endChapterId ?? null,
          onChapter: href => {
            // The next two chapters, fetched ahead and kept in this browser.
            const at = order.indexOf(chapterIdOf(href) ?? "");
            for (const next of order.slice(at + 1, at + 3)) if (at >= 0 && inDropbox.has(next)) void text(next).catch(() => null);
          },
          onPastEnd: href => {
            const chapterId = chapterIdOf(href);
            if (chapterId && inDropbox.has(chapterId)) void markCaughtUp(x.id, chapterId);
          },
        },
      });
    }).catch(() => undefined);
    return opening;
  };
  /** Which chapters of a serial are in Dropbox: listed when it's first opened or shown, and kept. */
  const inDropboxNow = new Map<string, Promise<Set<string>>>();
  const chaptersInDropbox = (id: string): Promise<Set<string>> => {
    let got = inDropboxNow.get(id);
    if (!got) {
      got = api.listFolder(chapterFolderPath(id), false)
        .then(files => new Set(files.filter(f => f.name.endsWith(".xhtml")).map(f => f.name.slice(0, -".xhtml".length))))
        .catch(() => { inDropboxNow.delete(id); return new Set<string>(); });
      inDropboxNow.set(id, got);
    }
    return got;
  };
  const inDropboxCount = new Map<string, number>();
  /** The phones' "keep author notes" setting, from their setup backups; read once. */
  let phonesKeepRead: Promise<boolean> | null = null;
  const phonesKeep = () => phonesKeepRead ??= (async () => {
    const devices = await api.readText(DEVICES_PATH).then(r => (r ? (JSON.parse(r.text).devices as string[]) : [])).catch(() => []);
    const backups = await Promise.all(devices.filter(d => /^[A-Za-z0-9 _.-]+$/.test(d)).map(d => api.readText(backupPath(d)).then(r => (r ? JSON.parse(r.text) : null)).catch(() => null)));
    return phonesKeepNotes(backups.filter(Boolean));
  })();
  /** Read to the end of the newest chapter: CAUGHT UP, in the subscriptions file (that serial's end mark only). */
  const markCaughtUp = async (id: string, chapterId: string) => {
    try {
      for (let attempt = 0; ; attempt++) {
        const remote = await api.readText(SUBSCRIPTIONS_PATH);
        const next = remote && withEndMark(remote.text, id, chapterId, Date.now());
        if (!next) break;
        try {
          await api.writeText(SUBSCRIPTIONS_PATH, next, remote.rev);
          if (serialData) serialData = { ...serialData, subs: parseSubscriptions(next) };
          break;
        } catch (err) {
          if (!(err instanceof RevConflict) || attempt >= 2) throw err;
        }
      }
      tell("Caught up");
      render();
    } catch {
      failed();
    }
  };

  /** At the start, the book read last on any device; opening it saves no place. */
  const startWithLastRead = () => {
    const last = lastReadBook(books.map(marked).filter(b => !b.hidden));
    if (last) void openBook(last, true);
    else if (!currentId) pane.replaceChildren(h("p", { class: "empty muted" }, "Choose a book from the Library."));
  };

  // --- Home (WEB.md → Home) ---

  /** The kept facts while the book's sync file is unchanged since they were read. */
  const knownNow = (id: string) => {
    const book = books.find(b => b.id === id);
    const was = known.get(id);
    return book && was && stillKnown(was, book) != null ? was : null;
  };
  // Serials (WEB.md → Home, step 3a): the subscriptions file, each serial's chapter list and sync file, read when Serials is first shown.
  let serialData: { subs: Subscription[]; lists: Record<string, ChapterList | null>; places: Record<string, Parameters<typeof homeSerials>[2][string]> } | null = null;
  let serialsLoading: Promise<void> | null = null;
  const loadSerials = () => serialsLoading ??= (async () => {
    try {
      const [subsText, listed, syncListed] = await Promise.all([
        api.readText(SUBSCRIPTIONS_PATH), api.listFolder(CHAPTERS_FOLDER, false), api.listFolder(SYNC_FOLDER, false),
      ]);
      const subs = parseSubscriptions(subsText?.text ?? null).filter(sub => !sub.removed && isSerialId(sub.bookId));
      const lists: Record<string, ChapterList | null> = {};
      const places: Record<string, Parameters<typeof homeSerials>[2][string]> = {};
      const named = (files: { name: string }[]) => new Set(files.map(f => f.name.toLowerCase()));
      const haveList = named(listed);
      const haveSync = named(syncListed);
      await Promise.all(subs.map(async sub => {
        const file = `${sub.bookId}.json`.toLowerCase();
        const [list, sync] = await Promise.all([
          haveList.has(file) ? api.readText(chapterListPath(sub.bookId)).then(r => parseChapterList(r?.text ?? null)).catch(() => null) : null,
          haveSync.has(file) ? api.readText(serialSyncPath(sub.bookId)).then(r => (r ? JSON.parse(r.text) : null)).catch(() => null) : null,
        ]);
        lists[sub.bookId] = list;
        places[sub.bookId] = sync;
      }));
      serialData = { subs, lists, places };
    } catch {
      // The footer says so; the serials as last read stay (none: an empty list).
      dropboxLabel.hidden = false;
      serialData ??= { subs: [], lists: {}, places: {} };
    }
  })();
  const serialsNow = (): Serial[] | null => serialData && homeSerials(serialData.subs, serialData.lists, serialData.places, detailsNow, Date.now());
  const serialAsBook = (x: Serial): LibraryBook => ({
    id: x.id, path: "", title: x.title, author: x.author, series: null, seriesIndex: null, read: false, hidden: false,
    indexedAt: 0, cover: null, lastRead: null, hasSyncFile: false,
  });
  home = createHome({
    books: () => books.map(marked),
    showHidden: () => showHidden,
    setShowHidden: on => { showHidden = on; render(); },
    setup: () => setup,
    update: next => look.update(next),
    progress: id => knownNow(id)?.p ?? (books.find(b => b.id === id)?.hasSyncFile === false ? 0 : null),
    places: id => knownNow(id)?.places ?? (books.find(b => b.id === id)?.hasSyncFile === false ? [] : null),
    load: async book => {
      // A kept entry from before Home has no places: read the file again.
      if (knownNow(book.id) && !knownNow(book.id)!.places) { known.delete(book.id); progress.delete(book.id); }
      await progressOf(book);
    },
    open: book => void openBook(book),
    menu: (book, x, y) => openBookMenu(book, x, y),
    readMark: book => {
      const mark = newer(marks[book.id]?.read, syncMarks.get(book.id)?.read);
      return mark?.read === true ? "read" : "auto";
    },
    setRead: (book, read) => void setRead(book, read),
    markUnread: book => markUnread(book),
    setHidden: (book, hidden) => void setHidden(book, hidden),
    edit: book => editDetails(book),
    signOut: () => void signOut(api),
    offline: () => !dropboxLabel.hidden,
    toOffice: () => toOffice(),
    readFile: async file => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let info: BookInfo | null = null;
      let id: string | null = null;
      if (isEpubName(file.name)) {
        try { info = await bookInfo(bytes); id = await contentHash(bytes); } catch { /* Not an EPUB. */ }
      }
      return { title: info?.title ?? null, author: info?.author ?? null, add: () => addBook(file.name, bytes, info, id) };
    },
    serials: serialsNow,
    loadSerials,
    editSerial: x => editDetails(serialAsBook(x), true),
    openSerial: x => void openSerialNow(x),
    chaptersInDropbox: x => {
      if (!inDropboxCount.has(x.id)) void chaptersInDropbox(x.id).then(set => { inDropboxCount.set(x.id, set.size); render(); });
      inDropboxCount.set(x.id, inDropboxCount.get(x.id) ?? -1);
      const n = inDropboxCount.get(x.id)!;
      return n < 0 ? null : n;
    },
  });
  /** One book into /Books/ (never over a file there); shown at once with what its EPUB says. */
  const addBook = async (name: string, bytes: Uint8Array, info: BookInfo | null, id: string | null): Promise<AddOutcome> => {
    const before = beforeUpload({ name, size: bytes.byteLength, id, title: info?.title ?? null }, books);
    if (before) return before;
    const path = bookPath(name);
    const got = await api.addBook(bookPath(name), bytes).catch(() => undefined);
    if (got === undefined) return { kind: "failed" };
    if (got === null) return { kind: "name-taken", name };
    const cover = info?.cover ? await thumbnail(info.cover) : null;
    const entry: IndexEntry = {
      title: info?.title || titleFromFileName(name),
      ...(info?.author ? { author: info.author } : {}),
      ...(info?.series ? { series: info.series, ...(info.seriesIndex != null ? { seriesIndex: info.seriesIndex } : {}) } : {}),
      ...(cover ? { cover } : {}),
      updatedAt: 0,
    };
    addedHere[got] = entry;
    void keepValue("added", addedHere);
    books = [...books.filter(b => b.id !== got), {
      id: got, path, title: entry.title, author: entry.author ?? null, series: entry.series ?? null, seriesIndex: entry.seriesIndex ?? null,
      read: false, hidden: false, indexedAt: 0, cover: entry.cover ?? null, lastRead: null, hasSyncFile: false,
      added: new Date().toISOString(), size: bytes.byteLength,
    }];
    saveLibrary();
    render();
    // Opening it needn't download what was just uploaded.
    void keepBook(got, bytes);
    return { kind: "added", id: got };
  };
  root.append(home.el);
  const toHome = () => {
    setHomeMode(true);
    homeShown = true;
    layout();
    home!.render();
  };
  const toOffice = () => {
    setHomeMode(false);
    homeShown = false;
    layout();
    render();
    // Office lists books: a serial in the reader gives way to the book read last.
    if (!currentId || currentKind === "serial") startWithLastRead();
  };
  heading.addEventListener("click", () => { if (homeMode()) toHome(); });
  layout();

  if (kept) {
    note.remove();
    render();
    if (!homeShown) startWithLastRead();
  }
  try {
    const [files, index, syncFiles, details] = await Promise.all([
      api.listFolder(BOOKS_FOLDER, true),
      api.readText(LIBRARY_INDEX_PATH).then(r => (r ? (JSON.parse(r.text).books as Record<string, IndexEntry>) : {})).catch(() => ({})),
      api.listFolder(SYNC_FOLDER, false),
      api.readText(DETAILS_PATH).then(r => parseDetails(r?.text ?? null).books).catch(() => ({})),
    ]);
    detailsNow = details;
    books = libraryBooks(files, index, syncFiles, details, addedHere);
    // Once a phone has listed a book added here, its entry is the one shown.
    const listed = Object.keys(addedHere).filter(id => (index as Record<string, IndexEntry>)[id]);
    if (listed.length) { for (const id of listed) delete addedHere[id]; void keepValue("added", addedHere); }
  } catch (e) {
    // The footer says so; the Library as last seen stays.
    dropboxLabel.hidden = false;
    render();
    if (!kept) note.textContent = `Couldn't reach Dropbox: ${e instanceof Error ? e.message : e}`;
    return;
  }
  note.remove();
  progress = new Map();
  saveLibrary();
  render();
  // Back to this tab after a while: other devices may have read meanwhile, and their progress shows.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    if (Date.now() - hiddenAt < RECHECK_AFTER_MS || !currentToken()) return;
    // The serials are read again too, when they've been shown.
    if (serialData) { serialsLoading = null; inDropboxNow.clear(); inDropboxCount.clear(); void loadSerials().then(render); }
    const syncFiles = await api.listFolder(SYNC_FOLDER, false).catch(() => null);
    const next = syncFiles && withSyncTimes(books, syncFiles);
    if (!next) return;
    books = next;
    progress = new Map();
    saveLibrary();
    render();
  });
  // Another device may have read another book since: the page starts with that one, unless a book was picked meanwhile.
  // Home starts with its Library; the reader waits for a book.
  if (!homeShown && (!currentId || startedWith)) startWithLastRead();
  // Then, quietly, the books read last that this browser doesn't have yet, one at a time.
  void opening.then(async () => {
    const kept = new Set((await keptBooks()).map(b => b.id));
    for (const book of booksToFetch(books, kept, currentId)) {
      if (!currentToken()) return;
      const file = await api.download(book.path).catch(() => null);
      if (file) await keepBook(book.id, file.bytes, { lastReadAt: Date.parse(book.lastRead ?? "") || 0 });
    }
  });
}

/** Mark as unread waits this long for Undo before it's sent, as on the phones. */
const UNREAD_SEND_AFTER_MS = 10_000;

/** Back to the tab after this long away, the Library looks for other devices' reading. */
const RECHECK_AFTER_MS = 60_000;

/** The Library as this browser last saw it (WEB.md → Kept in this browser). */
interface KeptLibrary {
  books: LibraryBook[];
  progress: Record<string, KnownProgress>;
}

// --- Start ---

(async () => {
  try {
    await finishSignIn();
  } catch {
    // A failed return from Dropbox: sign in again.
  }
  if (currentToken()) await showApp();
  else showSignIn();
})();
