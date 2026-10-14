import "./style.css";
import { Appearance, applyLook } from "./appearance";
import { APP_KEY, currentToken, finishSignIn, forgetSignIn, signIn } from "./auth";
import { parseDetails, parseNumber, withDetails } from "./details";
import { Dropbox, RevConflict } from "./dropbox";
import { booksToFetch, furthest, lastReadBook, libraryBooks, libraryItems, markedBook, stillKnown, withSyncTimes, type IndexEntry, type KnownProgress, type LibraryBook, type LibraryItem, type SortBy } from "./library";
import { shown, SIDEBAR, sidebarWidth, type Setup } from "./looks";
import { BOOKS_FOLDER, DETAILS_PATH, LIBRARY_INDEX_PATH, SYNC_FOLDER, syncFilePath } from "./paths";
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
  const showButton = h("button", { class: "icon", title: "Show the Library", "aria-label": "Show the Library" }, icon(ICONS.panel));
  // Contents and Aa (the reader puts them here): in the sidebar's top row, or over the page's top left
  // when the sidebar is hidden or opens over the page (a narrow window).
  const tools = h("span", { class: "tools" });
  const floating = h("div", { class: "floatbar" }, showButton);
  const sideSlot = side.querySelector<HTMLElement>(".shead")!;
  const pane = h("section", { class: "main" }, h("p", { class: "empty muted" }, ""));
  root.replaceChildren(side, h("div", { class: "mainwrap" }, floating, pane));

  let setup: Setup = await look.setup();
  /** On a narrow window the Library opens over the page now and then; it isn't saved. */
  let overlayOpen = false;
  const layout = () => {
    const visible = NARROW.matches ? overlayOpen : setup.sidebar;
    root.className = `app${visible ? "" : " noside"}${NARROW.matches ? " narrow" : ""}`;
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
      p = api.readText(syncFilePath(book.id)).then(r => {
        const file = r ? JSON.parse(r.text) : null;
        syncMarks.set(book.id, marksOf(file));
        return furthest(file);
      }).catch(() => 0);
      progress.set(book.id, p);
      void p.then(value => { known.set(book.id, { at: book.lastRead, p: value }); saveLibrary(); });
    }
    return p;
  };
  /** A book's progress now known (Web just saved its place): its row shows it at once. */
  const showProgress = (id: string, p: number) => {
    const book = bookById(id);
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
      const book = bookById(row.dataset.id);
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
  const editDetails = (book: LibraryBook) => {
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
      titleRow, authorRow, h("div", { class: "two" }, seriesRow, numberRow),
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
      books = books.map(b => (b.id === book.id ? { ...b, title: edit.title, author: edit.author, series: edit.series, seriesIndex: edit.number } : b));
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
        dropbox: api, appearance: look, id: book.id, path: book.path, title: book.title, tools,
        onSaved: text => showProgress(book.id, furthest(JSON.parse(text))),
      });
    }).catch(() => undefined); // One book that fails to open doesn't stop the next.
    return opening;
  };
  /** At the start, the book read last on any device; opening it saves no place. */
  const startWithLastRead = () => {
    const last = lastReadBook(books.map(marked).filter(b => !b.hidden));
    if (last) void openBook(last, true);
    else if (!currentId) pane.replaceChildren(h("p", { class: "empty muted" }, "Choose a book from the Library."));
  };

  if (kept) {
    note.remove();
    render();
    startWithLastRead();
  }
  try {
    const [files, index, syncFiles, details] = await Promise.all([
      api.listFolder(BOOKS_FOLDER, true),
      api.readText(LIBRARY_INDEX_PATH).then(r => (r ? (JSON.parse(r.text).books as Record<string, IndexEntry>) : {})).catch(() => ({})),
      api.listFolder(SYNC_FOLDER, false),
      api.readText(DETAILS_PATH).then(r => parseDetails(r?.text ?? null).books).catch(() => ({})),
    ]);
    books = libraryBooks(files, index, syncFiles, details);
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
