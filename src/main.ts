import "./style.css";
import { Appearance, applyLook } from "./appearance";
import { APP_KEY, currentToken, finishSignIn, forgetSignIn, signIn } from "./auth";
import { Dropbox } from "./dropbox";
import { booksToFetch, furthest, lastReadBook, libraryBooks, libraryItems, stillKnown, withSyncTimes, type IndexEntry, type KnownProgress, type LibraryBook, type LibraryItem, type SortBy } from "./library";
import { shown, SIDEBAR, sidebarWidth, type Setup } from "./looks";
import { BOOKS_FOLDER, LIBRARY_INDEX_PATH, SYNC_FOLDER, syncFilePath } from "./paths";
import { showReader } from "./reader";
import { forgetAll, keepBook, keptBooks, keepValue, keptValue } from "./store";
import { h, icon, ICONS } from "./ui";

const root = document.getElementById("app")!;
/** Web's setup and the fonts, read once per visit. */
let appearance: Appearance | null = null;
/** Closes the book open in the reader (its place saved first). */
let closeReader: (() => Promise<void>) | null = null;
/** Stops the page following setup changes. */
let stopFollowing: (() => void) | null = null;

// The browser tab says "Library"; a book's says "Read: <title>" (small enough to go unnoticed).
document.title = "Library";

/** Closes the sidebar's sort menu on a click outside it or Esc (set while it can be open). */
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
  const dropboxLabel = h("span", {}, "Dropbox");
  const handle = h("div", { class: "resizer", title: "Drag to resize; double-click for the usual width", role: "separator", "aria-orientation": "vertical", "aria-label": "Library width" });
  const side = h("aside", { class: "sidebar" },
    handle,
    h("div", { class: "shead" }, hideButton, h("h1", {}, "Library")),
    h("label", { class: "sfilter" }, icon(ICONS.search), search),
    h("div", { class: "lhead" }, count, sortButton, menu),
    note,
    list,
    h("div", { class: "sfoot" },
      h("span", { class: "who" }, icon(ICONS.dropbox), dropboxLabel),
      h("button", { class: "link", onclick: () => void signOut(api) }, "Sign out")));
  const showButton = h("button", { class: "icon showside", title: "Show the Library", "aria-label": "Show the Library" }, icon(ICONS.panel));
  const pane = h("section", { class: "main" }, h("p", { class: "empty muted" }, ""));
  root.replaceChildren(side, h("div", { class: "mainwrap" }, showButton, pane));

  let setup: Setup = await look.setup();
  /** On a narrow window the Library opens over the page now and then; it isn't saved. */
  let overlayOpen = false;
  const layout = () => {
    const visible = NARROW.matches ? overlayOpen : setup.sidebar;
    root.className = `app${visible ? "" : " noside"}${NARROW.matches ? " narrow" : ""}`;
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
  stopFollowing = look.onChange(next => { setup = next; applyLook(shown(next)); layout(); });

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
      }, "Group series", tick(on)));
  };
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
    if (!e || !e.composedPath().some(el => el === menu || el === sortButton)) closeTheMenu();
  };

  // --- The books ---

  // The Library as this browser last saw it shows at once; Dropbox's replaces it when it comes.
  const kept = await keptValue<KeptLibrary>("library");
  let books: LibraryBook[] = kept?.books ?? [];
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

  let progress = new Map<string, Promise<number>>();
  const progressOf = (book: LibraryBook) => {
    if (!book.hasSyncFile) return Promise.resolve(0);
    const was = stillKnown(known.get(book.id), book);
    if (was != null) return Promise.resolve(was);
    let p = progress.get(book.id);
    if (!p) {
      p = api.readText(syncFilePath(book.id)).then(r => (r ? furthest(JSON.parse(r.text)) : 0)).catch(() => 0);
      progress.set(book.id, p);
      void p.then(value => { known.set(book.id, { at: book.lastRead, p: value }); saveLibrary(); });
    }
    return p;
  };
  /** A book's progress now known (Web just saved its place): its row shows it at once. */
  const showProgress = (id: string, p: number) => {
    const book = books.find(b => b.id === id);
    if (!book) return;
    known.set(id, { at: book.lastRead, p });
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
      const book = books.find(b => b.id === row.dataset.id);
      if (!book || book.read) continue;
      void progressOf(book).then(p => showOn(row, p));
    }
  }, { root: list });
  /** Series opened in this visit. */
  const open = new Set<string>();
  /** The book in the reader. */
  let currentId: string | null = null;
  /** The book in the reader is the one the page started with, not one picked: a newer last-read book replaces it. */
  let startedWith = false;

  /** The line under a row: the share read, shown only while in progress. */
  const line = (fraction: number | null) => h("span", { class: "line", hidden: fraction == null },
    h("i", { style: `width: ${Math.round((fraction ?? 0) * 100)}%` }));
  const bookRow = (book: LibraryBook, inSeries: boolean) => {
    const byline = inSeries
      ? (book.seriesIndex != null ? `Book ${book.seriesIndex}` : book.author ?? "")
      : [book.author, book.series && `${book.series}${book.seriesIndex != null ? ` ${book.seriesIndex}` : ""}`].filter(Boolean).join(" · ");
    return h("button", {
      class: `row${inSeries ? " child" : ""}${book.id === currentId ? " cur" : ""}`, "data-id": book.id,
      "aria-current": book.id === currentId ? "true" : undefined,
      onclick: () => void openBook(book),
    },
      h("span", { class: "t" }, h("span", { class: "x" }, book.title), h("span", { class: "p" }, book.read ? "Read" : "")),
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
    const items = libraryItems(books, sortBy, query, setup.groupSeries);
    const found = items.reduce((n, item) => n + (item.kind === "book" ? 1 : item.books.length), 0);
    count.textContent = query.trim() ? `${found} found` : `All books · ${books.length}`;
    list.replaceChildren(...items.flatMap(item => (item.kind === "book" ? [bookRow(item.book, false)] : seriesRows(item))));
    list.querySelectorAll(".row[data-id]").forEach(el => seen.observe(el));
    if (!items.length && !note.isConnected) list.replaceChildren(h("p", { class: "note muted" }, books.length ? "No books match." : "No books in Dropbox's /Books/ yet."));
  };
  search.addEventListener("input", () => { query = search.value; render(); });

  /** A book into the reader: the one open before saves its place and closes first. */
  let opening = Promise.resolve();
  const openBook = (book: LibraryBook, atStart = false) => {
    startedWith = atStart;
    if (book.id === currentId) return opening;
    currentId = book.id;
    // Its series open, so the highlighted row shows.
    if (book.series) open.add(book.series.toLocaleLowerCase());
    render();
    if (NARROW.matches && !atStart) { overlayOpen = false; layout(); }
    opening = opening.then(async () => {
      await closeReader?.();
      closeReader = null;
      if (currentId !== book.id) return;
      closeReader = await showReader(pane, {
        dropbox: api, appearance: look, id: book.id, path: book.path, title: book.title,
        onSaved: text => showProgress(book.id, furthest(JSON.parse(text))),
      });
    }).catch(() => undefined); // One book that fails to open doesn't stop the next.
    return opening;
  };
  /** At the start, the book read last on any device; opening it saves no place. */
  const startWithLastRead = () => {
    const last = lastReadBook(books);
    if (last) void openBook(last, true);
    else if (!currentId) pane.replaceChildren(h("p", { class: "empty muted" }, "Choose a book from the Library."));
  };

  if (kept) {
    note.remove();
    render();
    startWithLastRead();
  }
  try {
    const [files, index, syncFiles] = await Promise.all([
      api.listFolder(BOOKS_FOLDER, true),
      api.readText(LIBRARY_INDEX_PATH).then(r => (r ? (JSON.parse(r.text).books as Record<string, IndexEntry>) : {})).catch(() => ({})),
      api.listFolder(SYNC_FOLDER, false),
    ]);
    books = libraryBooks(files, index, syncFiles);
  } catch (e) {
    // The footer says so; the Library as last seen stays.
    dropboxLabel.textContent = "Dropbox: offline";
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
    const syncFiles = await api.listFolder(SYNC_FOLDER, false).catch(() => null);
    const next = syncFiles && withSyncTimes(books, syncFiles);
    if (!next) return;
    books = next;
    progress = new Map();
    saveLibrary();
    render();
  });
  // Another device may have read another book since: the page starts with that one, unless a book was picked meanwhile.
  if (!currentId || startedWith) startWithLastRead();
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
