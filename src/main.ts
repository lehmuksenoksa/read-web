import "./style.css";
import { Appearance, applyLook } from "./appearance";
import { APP_KEY, currentToken, finishSignIn, forgetSignIn, signIn } from "./auth";
import { coverLink, DROPBOX_COVER, parseDetails, parseNumber, withCover, withDetails, type BookDetails, type DetailsEdit } from "./details";
import { Dropbox, RevConflict } from "./dropbox";
import { beforeUpload, bookInfo, bookPath, contentHash, isEpubName, thumbnail, type AddOutcome, type BookInfo } from "./addBooks";
import { choose, chosenCoverBytes, coverPath, hasChosen, largeCover, loadChosenCovers, loadSharpCovers } from "./covers";
import { createHome, showSharpCover } from "./homeView";
import { contentsRemembered, CONTENTS_KEY, LAST_PLACE_KEY, lastPlaceText, parseLastPlace, type LastPlace } from "./lastPlace";
import { booksToFetch, furthest, furthestRead, libraryBooks, markedBook, placesOf, readAt, stillKnown, titleFromFileName, withSyncTimes, type IndexEntry, type KnownProgress, type LibraryBook } from "./library";
import { shown, type Setup } from "./looks";
import { backupPath, BOOKS_FOLDER, chosenCoverPath, chapterFolderPath, chapterListPath, CHAPTERS_FOLDER, chapterTextPath, DETAILS_PATH, DEVICES_PATH, isSerialId, LIBRARY_INDEX_PATH, serialSyncPath, SUBSCRIPTIONS_PATH, SYNC_FOLDER, syncFilePath } from "./paths";
import { openSerial } from "./serialBook";
import {
  chapterDateLabel, chapterHref, chapterIdOf, homeSerials, keepsNotes, parseChapterList, parseSubscriptions, phonesKeepNotes, readingOrderOf, setBeforeEnd, withEndMark,
  type ChapterList, type Serial, type Subscription,
} from "./serials";
import { keptFile } from "./store";
import { showReader, type ReaderHandle } from "./reader";
import { marksOf, withMarks, type Marks, type ReadMark } from "./sync";
import { forgetAll, keepBook, keptBooks, keepValue, keptValue } from "./store";
import { styleFor, tokenClasses } from "./styleTokens";
import { focusFirstItem, h, icon, ICONS, menuKeys } from "./ui";

const root = document.getElementById("app")!;
/** Web's setup and the fonts, read once per visit. */
let appearance: Appearance | null = null;
/** Closes the book open in the reader (its place saved first); turns it to a chapter. */
let closeReader: ReaderHandle | null = null;
/** Stops the page following setup changes. */
let stopFollowing: (() => void) | null = null;

// The browser tab says "Read.web", with or without a book open (2026-10-14).
document.title = "Read.web";

/** Closes a book's menu on a click outside it or Esc (set while it can be open). */
let closeMenu: ((e?: Event) => void) | null = null;
document.addEventListener("click", e => closeMenu?.(e));
// Esc closes an open book menu and only that (2026-10-18: it closed the book's panel behind it too).
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !document.querySelector(".bookmenu:not([hidden])")) return;
  e.stopImmediatePropagation();
  closeMenu?.();
});

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
  document.documentElement.style.removeProperty("--pagebg");
  document.documentElement.style.removeProperty("--pagetx");
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

// --- This browser's place and Contents (WEB.md → One app, two styles, 2026-10-15) ---

function lastPlace(): LastPlace {
  try { return parseLastPlace(localStorage.getItem(LAST_PLACE_KEY)); } catch { return { kind: "library" }; }
}
function rememberPlace(place: LastPlace) {
  try { localStorage.setItem(LAST_PLACE_KEY, lastPlaceText(place)); } catch { /* This browser keeps nothing: the Library next time. */ }
}
function contentsOpen(): boolean {
  try { return localStorage.getItem(CONTENTS_KEY) === "1"; } catch { return false; }
}
function rememberContents(open: boolean) {
  try { localStorage.setItem(CONTENTS_KEY, open ? "1" : "0"); } catch { /* Closed next time. */ }
}

/** A window this narrow (page pixels) opens Contents and Aa over the page, not beside it. */
const NARROW = window.matchMedia("(max-width: 900px)");

async function showApp() {
  const api = dropbox();
  if (!api) return showSignIn();
  appearance ??= new Appearance(api);
  const look = appearance;

  // The bar on every screen (Home's), and under it the Library or the reader: Contents and Aa beside
  // ⚙, the panel they open at the right, and the page (WEB.md → One app, two styles).
  const tools = h("span", { class: "htools", role: "group", "aria-label": "Reading" });
  const panelHost = h("aside", { class: "rpanel" });
  const pane = h("section", { class: "main" });
  const readerArea = h("div", { class: "readerarea" }, panelHost, pane);
  /** Dropbox out of reach: ⚙ says so. */
  let offline = false;

  // Home and Office each have their own look (WEB.md → One app, two styles).
  look.setStyle(homeMode());
  let setup: Setup = await look.setup();
  /** The Library (its Library or Serials side) or the reader; at the start, where this browser was. */
  let screen: "library" | "reader" = lastPlace().kind === "library" ? "library" : "reader";
  /** Contents or Aa open beside the page. */
  let panelOpen = false;
  let home: ReturnType<typeof createHome> | null = null;
  const layout = () => {
    // Light or Dark around the page: each style its own (2026-10-15).
    // The style's palette class (homeon / office), then one class per token (styleTokens.ts, 2026-10-16).
    root.className = `app ${homeMode() ? "homeon" : "office"} ${tokenClasses(styleFor(homeMode())).join(" ")} ${setup.chrome[homeMode() ? "home" : "office"]} ${screen}${NARROW.matches ? " narrow" : ""}${panelOpen && screen === "reader" ? " panelopen" : ""}`;
  };
  NARROW.addEventListener("change", layout);
  applyLook(look.page(shown(setup)));
  layout();
  stopFollowing?.();
  stopFollowing = look.onChange(next => { setup = next; applyLook(look.page(shown(next))); layout(); render(); });

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
      let far: KnownProgress["far"] = null;
      p = api.readText(syncFilePath(book.id)).then(r => {
        const file = r ? JSON.parse(r.text) : null;
        syncMarks.set(book.id, marksOf(file));
        places = placesOf(file);
        far = furthestRead(file);
        return furthest(file);
      }).catch(() => 0);
      progress.set(book.id, p);
      void p.then(value => { known.set(book.id, { at: book.lastRead, p: value, places, far }); saveLibrary(); });
    }
    return p;
  };
  /** A book's progress now known (Web just saved its place): its row shows it at once. */
  const showProgress = (id: string, p: number, places?: KnownProgress["places"], far?: KnownProgress["far"]) => {
    const book = bookById(id);
    if (!book) return;
    known.set(id, { at: book.lastRead, p, places: places ?? known.get(id)?.places, far: far !== undefined ? far : known.get(id)?.far });
    progress.set(id, Promise.resolve(p));
    saveLibrary();
  };
  /** The book or serial in the reader. */
  let currentId: string | null = null;

  /** Show › Hidden: the hidden books instead of the others. Not kept. */
  let showHidden = false;
  /** The Library redrawn (only while it shows: showing it draws it). */
  const render = () => { if (screen === "library") home?.render(); };

  // --- A book's menu: ⋯ on hover, or a right-click (WEB.md → The book menu, 2026-10-14) ---

  const bookMenu = h("div", { class: "panel menu bookmenu", role: "menu", hidden: true });
  menuKeys(bookMenu);
  /** Where focus was when the book menu opened: it goes back there when the menu closes with focus inside. */
  let menuReturn: HTMLElement | null = null;
  const toast = h("div", { class: "msg toast", hidden: true });
  closeMenu = (e?: Event) => { if (!e?.composedPath().includes(bookMenu)) closeBookMenu(); };
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
    const hadFocus = bookMenu.contains(document.activeElement);
    bookMenu.hidden = true;
    menuFor = null;
    if (hadFocus && menuReturn?.isConnected) menuReturn.focus({ preventScroll: true });
  };
  const tick = (on: boolean) => h("span", { class: "v" }, on ? icon(ICONS.check) : null);
  /** The newer of two read marks. */
  const newer = (a?: ReadMark, b?: ReadMark) => (!a ? b : !b ? a : a.updatedAt >= b.updatedAt ? a : b);
  const fillBookMenu = (book: LibraryBook) => {
    const shownBook = marked(book);
    const mark = newer(marks[book.id]?.read, syncMarks.get(book.id)?.read);
    const p = known.get(book.id)?.p ?? 0;
    const item = (name: string, action: () => void, on?: boolean) =>
      h("button", { class: "r", role: on === undefined ? "menuitem" : "menuitemradio", "aria-checked": on === undefined ? undefined : String(on), onclick: () => { closeBookMenu(); action(); } }, name, on === undefined ? null : tick(on));
    bookMenu.replaceChildren(
      h("div", { class: "lab plain" }, book.title),
      // As on the phones (2026-10-18): Mark as read again, while it's ticked, gives the mark back to the place.
      item("Mark as read", () => void setRead(book, mark?.read === true ? null : true), mark?.read === true),
      ...(p > 0 || shownBook.read ? [item("Mark as unread", () => markUnread(book))] : []),
      h("hr"),
      item("Edit details…", () => editDetails(book)),
      h("hr"),
      item(shownBook.hidden ? "Unhide" : "Hide", () => void setHidden(book, !shownBook.hidden)),
    );
  };
  const openBookMenu = (book: LibraryBook, x: number, y: number) => {
    closeMenu?.();
    menuReturn = document.activeElement as HTMLElement | null;
    menuFor = book.id;
    fillBookMenu(book);
    bookMenu.hidden = false;
    focusFirstItem(bookMenu);
    const r = bookMenu.getBoundingClientRect();
    bookMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
    bookMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
    // The ✓ needs the book's own marks: read now when they aren't known yet.
    if (!syncMarks.has(book.id) && book.hasSyncFile) {
      void api.readText(syncFilePath(book.id)).then(r => {
        syncMarks.set(book.id, marksOf(r ? JSON.parse(r.text) : null));
        if (menuFor === book.id) { fillBookMenu(book); focusFirstItem(bookMenu); }
      }).catch(() => undefined);
    }
  };
  /** The reader's furthest-read menu, under the bar's icon (2026-10-20): the book menu's panel, two lines. */
  const openFurthestMenu = (anchor: HTMLElement) => {
    closeMenu?.();
    if (!closeReader) return;
    menuReturn = anchor;
    const reader = closeReader;
    const item = (name: string, action: () => void) =>
      h("button", { class: "r", role: "menuitem", onclick: () => { closeBookMenu(); action(); } }, name);
    bookMenu.replaceChildren(
      item("Go to furthest read", () => void reader.goToFurthest()),
      item("Set as furthest read", () => reader.setFurthest()),
    );
    bookMenu.hidden = false;
    focusFirstItem(bookMenu);
    const a = anchor.getBoundingClientRect();
    const r = bookMenu.getBoundingClientRect();
    bookMenu.style.left = `${Math.max(8, Math.min(a.left, window.innerWidth - r.width - 8))}px`;
    bookMenu.style.top = `${Math.round(a.bottom + 6)}px`;
  };
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
  const setRead = async (book: LibraryBook, read: true | null, undo = false) => {
    const before = newer(marks[book.id]?.read, syncMarks.get(book.id)?.read);
    const change: Marks = { read: { read, updatedAt: Date.now() } };
    setMarks(book.id, change);
    // From the panel: one message with Undo, back to the mark it had (2026-10-16).
    if (undo) tell(`Marked “${book.title}” read`, () => void setRead(book, before?.read === true ? true : null));
    await writeMarks(book.id, change).catch(failed);
  };

  /** Mark as unread: back to 0% on every device, as on the phones; Undo before it's sent (sent after 10 s). */
  const unreadTimers = new Map<string, number>();
  const markUnread = (book: LibraryBook) => markUnreadMany([book]);
  const markUnreadMany = (list: LibraryBook[]) => {
    if (!list.length) return;
    const before = list.map(book => ({ book, marks: marks[book.id], known: known.get(book.id) }));
    const now = Date.now();
    for (const book of list) {
      setMarks(book.id, { read: { read: null, updatedAt: now }, reset: { at: now } });
      // Every device's place from before goes too: the panel and Reading now show places, not only the number (2026-10-19).
      showProgress(book.id, 0, [], null);
      window.clearTimeout(unreadTimers.get(book.id));
    }
    render();
    const timer = window.setTimeout(async () => {
      for (const book of list) unreadTimers.delete(book.id);
      // The open book closes first (its place is saved before the reset, so it doesn't count), then opens at the start.
      const open = list.find(book => currentId === book.id);
      if (open) {
        currentId = null;
        await (opening = opening.then(async () => { await closeReader?.(); closeReader = null; }));
      }
      const at = Date.now();
      const change: Marks = { read: { read: null, updatedAt: at }, reset: { at } };
      for (const book of list) setMarks(book.id, change);
      const results = await Promise.allSettled(list.map(book => writeMarks(book.id, change)));
      if (results.some(r => r.status === "rejected")) failed();
      if (open && currentId === null) void openBook(open);
    }, UNREAD_SEND_AFTER_MS);
    for (const book of list) unreadTimers.set(book.id, timer);
    tell(list.length === 1 ? "Marked unread: back to 0%" : `Marked ${list.length} unread: back to 0%`, () => {
      window.clearTimeout(timer);
      for (const { book, marks: m, known: k } of before) {
        unreadTimers.delete(book.id);
        if (m) marks[book.id] = m; else delete marks[book.id];
        if (k) known.set(book.id, k); else known.delete(book.id);
        progress.delete(book.id);
      }
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
      await saveDetails(book, edit);
    });
    root.append(dialog);
    titleIn.focus();
    titleIn.select();
  };

  /** A book's or serial's details into the shared details file (the newer edit wins per book): here at once, back if Dropbox refuses. */
  const saveDetails = async (book: LibraryBook, edit: DetailsEdit) => {
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
  };

  /**
   * A cover chosen for a book or serial (2026-10-20, WEB.md → the panels): a file (scaled, uploaded to
   * `covers/chosen/<id>.jpg`), a link (kept as the address), or the book's own again. Into details.json as
   * an edit; shown here at once, back as it was if Dropbox refuses. True when it was saved.
   */
  const chooseCover = async (target: LibraryBook, pick: { file: Blob } | { link: string } | { own: true }): Promise<boolean> => {
    let coverUrl: string | null = null;
    let shown: string | null = null;
    if ("link" in pick) {
      coverUrl = coverLink(pick.link);
      if (!coverUrl) { tell("That isn't a link to an image."); return false; }
      shown = coverUrl;
    } else if ("file" in pick) {
      const bytes = await chosenCoverBytes(pick.file);
      if (!bytes) { tell("Couldn't use that image."); return false; }
      const path = chosenCoverPath(target.id);
      try {
        await api.putChosenCover(path, bytes);
      } catch {
        failed();
        return false;
      }
      coverUrl = DROPBOX_COVER + path;
      shown = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
    }
    const detailsBefore = detailsNow;
    const shownDetails: DetailsEdit = { title: target.title, author: target.author, series: target.series, number: target.seriesIndex };
    detailsNow = { ...detailsNow, [target.id]: { ...shownDetails, ...detailsNow[target.id], coverUrl, updatedAt: Date.now() } };
    choose(target.id, shown);
    if (shown) showSharpCover(target.id, shown);
    render();
    try {
      for (let attempt = 0; ; attempt++) {
        const remote = await api.readText(DETAILS_PATH);
        try {
          await api.writeText(DETAILS_PATH, withCover(remote?.text ?? null, target.id, coverUrl, shownDetails, Date.now()), remote?.rev ?? null);
          return true;
        } catch (err) {
          if (!(err instanceof RevConflict) || attempt >= 2) throw err;
        }
      }
    } catch {
      detailsNow = detailsBefore;
      failed();
      render();
      return false;
    }
  };

  // --- The reader ---

  /** The page's box on screen, and what's open: the bar shows its title over the page. */
  let pageBox = { left: 0, width: 0 };
  let reading: { title: string; side: "books" | "serials"; place: string } | null = null;
  const showTitle = () => { if (screen === "reader") home?.setReading(reading && { ...reading, ...pageBox }); };
  /**
   * The browser's Back and Forward (2026-10-18): opening a book or serial is a step in this tab's history, so
   * Back returns to the Library side it came from and Forward to the book. The name still goes back too.
   */
  const READER_STEP = { read: "reader" };
  const inReaderStep = () => (history.state as { read?: string } | null)?.read === "reader";
  /** The side the name's click asked for, while the Back it started arrives. */
  let backTo: "books" | "serials" | null = null;
  history.replaceState(inReaderStep() ? history.state : { read: "library" }, "");
  if (screen === "reader" && !inReaderStep()) history.pushState(READER_STEP, "");
  window.addEventListener("popstate", () => {
    if (inReaderStep()) {
      if (screen === "library" && currentId) toReader();
      return;
    }
    if (screen === "reader") showLibraryNow(backTo ?? reading?.side ?? setup.home.tab);
    backTo = null;
  });
  /** The reader in front: the Library's panel closes. */
  const toReader = () => {
    if (!inReaderStep()) history.pushState(READER_STEP, "");
    if (screen === "reader") return;
    screen = "reader";
    home?.closePanel();
    layout();
    showTitle();
  };
  /** The Library or Serials page, from the bar's name: the step back in this tab's history, as Back is. */
  const showLibrary = (side: "books" | "serials") => {
    if (screen === "reader" && inReaderStep()) {
      backTo = side;
      history.back();
      return;
    }
    showLibraryNow(side);
  };
  /** The Library or Serials page; the book stays open behind it. */
  const showLibraryNow = (side: "books" | "serials") => {
    screen = "library";
    rememberPlace({ kind: "library" });
    home?.setReading(null);
    layout();
    if (setup.home.tab !== side) look.update({ ...setup, home: { ...setup.home, tab: side } });
    else render();
  };
  /** What every book and serial gives the reader: the rail, the panel beside the page, the bar's title. */
  const chrome = (title: string, side: "books" | "serials", place: (p: { href: string; chapter: string | null; totalProgression: number }) => string) => {
    reading = { title, side, place: "" };
    panelOpen = false;
    layout();
    showTitle();
    return {
      tools, panelHost,
      openContents: !NARROW.matches && contentsOpen(),
      overlay: () => NARROW.matches,
      onPanel: (open: "contents" | "aa" | null) => {
        panelOpen = open != null;
        rememberContents(contentsRemembered(contentsOpen(), open, NARROW.matches));
        layout();
      },
      onPlace: (p: { href: string; chapter: string | null; totalProgression: number }) => {
        if (reading?.title !== title) return;
        reading = { ...reading, place: place(p) };
        showTitle();
      },
      onPageBox: (box: { left: number; width: number }) => {
        if (screen !== "reader" || !box.width) return;
        pageBox = box;
        showTitle();
      },
    };
  };

  /** A book into the reader: the one open before saves its place and closes first. */
  let opening = Promise.resolve();
  const openBook = (book: LibraryBook) => {
    toReader();
    rememberPlace({ kind: "book", id: book.id });
    if (book.id === currentId) return opening;
    currentId = book.id;
    // Front matter is often named after the book: then just the percentage.
    const sameAsBook = (chapter: string | null) => !chapter || chapter.trim().toLocaleLowerCase() === book.title.trim().toLocaleLowerCase();
    const props = chrome(book.title, "books", p => [sameAsBook(p.chapter) ? null : p.chapter, `${Math.round(p.totalProgression * 100)}%`].filter(Boolean).join(" · "));
    opening = opening.then(async () => {
      await closeReader?.();
      closeReader = null;
      if (currentId !== book.id) return;
      closeReader = await showReader(pane, {
        ...props, dropbox: api, appearance: look, id: book.id, path: book.path, title: book.title,
        onSaved: text => { const file = JSON.parse(text); showProgress(book.id, furthest(file), placesOf(file), furthestRead(file)); },
      });
    }).catch(() => undefined); // One book that fails to open doesn't stop the next.
    return opening;
  };
  /** A serial into the reader (WEB.md → Home, step 3b): its chapters from Dropbox, its place in its sync file. */
  const openSerialNow = (x: Serial, chapterId?: string) => {
    toReader();
    rememberPlace({ kind: "serial", id: x.id });
    // Already open: it turns to the chapter.
    if (x.id === currentId) return chapterId ? (opening = opening.then(() => closeReader?.goTo(chapterHref(chapterId)))) : opening;
    currentId = x.id;
    const order = readingOrderOf(x.chapters).map(c => c.id);
    /** The serial as last read (its NEW marks and chapters change while it's open). */
    const now = () => serialsNow()?.find(s => s.id === x.id) ?? x;
    const props = chrome(x.title, "serials", p => {
      // "Chapter 213 · 2 unread": the readable chapters after this one.
      const at = x.chapters.findIndex(c => c.id === chapterIdOf(p.href));
      const unread = at < 0 ? 0 : readingOrderOf(x.chapters.slice(at + 1)).length;
      return [p.chapter, unread ? `${unread} unread` : "Up to date"].filter(Boolean).join(" · ");
    });
    opening = opening.then(async () => {
      await closeReader?.();
      closeReader = null;
      if (currentId !== x.id) return;
      const [inDropbox, keep] = await Promise.all([chaptersInDropbox(x.id), phonesKeep()]);
      const sub = serialData?.subs.find(s => s.bookId === x.id);
      const text = (chapterId: string) => keptFile(chapterTextPath(x.id, chapterId), () => api.download(chapterTextPath(x.id, chapterId)).then(f => f?.bytes ?? null))
        .then(bytes => (bytes ? new TextDecoder().decode(bytes) : null));
      closeReader = await showReader(pane, {
        ...props, dropbox: api, appearance: look, id: x.id, path: "", title: x.title,
        startAt: chapterId ? chapterHref(chapterId) : undefined,
        onSaved: saved => {
          if (serialData) serialData = { ...serialData, places: { ...serialData.places, [x.id]: JSON.parse(saved) } };
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
          // Set as furthest read before the CAUGHT UP mark: the mark goes, on every device (2026-10-20).
          onFurthestSet: place => {
            const end = serialData?.subs.find(s => s.bookId === x.id)?.endChapterId ?? null;
            if (setBeforeEnd(x.chapters.map(c => c.id), place.href, place.progression, end)) void markCaughtUp(x.id, null);
            render();
          },
          // Contents: newest first, with their dates and NEW, as on the phones.
          contents: () => {
            const s = now();
            const at = Date.now();
            return s.chapters.map((c, index) => ({ c, index })).filter(r => order.includes(r.c.id)).reverse()
              .map(({ c, index }) => ({ href: chapterHref(c.id), title: c.title, date: chapterDateLabel(c.published, at, true) ?? "", isNew: s.progress.isNew(index) }));
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
  /** The same lists as sets, for the panel's chapters (in the reader or on the site). */
  const inDropboxIds = new Map<string, Set<string>>();
  /** The phones' "keep author notes" setting, from their setup backups; read once. */
  let phonesKeepRead: Promise<boolean> | null = null;
  const phonesKeep = () => phonesKeepRead ??= (async () => {
    const devices = await api.readText(DEVICES_PATH).then(r => (r ? (JSON.parse(r.text).devices as string[]) : [])).catch(() => []);
    const backups = await Promise.all(devices.filter(d => /^[A-Za-z0-9 _.-]+$/.test(d)).map(d => api.readText(backupPath(d)).then(r => (r ? JSON.parse(r.text) : null)).catch(() => null)));
    return phonesKeepNotes(backups.filter(Boolean));
  })();
  /** Read to the end of the newest chapter: CAUGHT UP, in the subscriptions file (that serial's end mark only). */
  const markCaughtUp = async (id: string, chapterId: string | null) => {
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
      if (chapterId) tell("Caught up");
      render();
    } catch {
      failed();
    }
  };

  /** At the start, where this browser was: a book or serial at its place, else the Library (WEB.md → One app). */
  let restored = false;
  const restore = (final: boolean) => {
    if (restored || currentId) return;
    const place = lastPlace();
    if (place.kind === "book") {
      const book = bookById(place.id);
      // Not in the Library as kept: once Dropbox's is read, or the Library.
      if (!book && !final) return;
      restored = true;
      if (book) void openBook(book);
      else showLibrary(setup.home.tab);
    } else if (place.kind === "serial") {
      restored = true;
      void loadSerials().then(() => {
        const x = serialsNow()?.find(s => s.id === place.id);
        if (currentId) return;
        if (x) void openSerialNow(x);
        else showLibrary("serials");
      });
    } else {
      restored = true;
    }
  };

  // --- Home (WEB.md → Home) ---

  /** The kept facts while the book's sync file is unchanged since they were read. */
  const knownNow = (id: string) => {
    const book = books.find(b => b.id === id);
    const was = known.get(id);
    return book && was && stillKnown(was, book) != null ? was : null;
  };
  // Serials (WEB.md → Home, step 3a): the subscriptions file, each serial's chapter list and sync file, read when Serials is first shown.
  type SerialData = { subs: Subscription[]; lists: Record<string, ChapterList | null>; places: Record<string, Parameters<typeof homeSerials>[2][string]> };
  let serialData: SerialData | null = null;
  /*
   * Serials kept in this browser (2026-10-19, as the books' Library is): the list shows at once from
   * the last visit; then one listing of each folder says which files changed (Dropbox's content hash),
   * and only those are read again. Which chapters of a serial with locked posts are in Dropbox is kept too.
   */
  type KeptSerials = SerialData & { hashes: Record<string, string>; inDropbox: Record<string, string[]> };
  let keptSerials = await keptValue<KeptSerials>("serials");
  const keepSerials = () => {
    if (!serialData || !currentToken()) return;
    keptSerials = { ...serialData, hashes: keptSerials?.hashes ?? {}, inDropbox: Object.fromEntries([...inDropboxIds].map(([id, set]) => [id, [...set]])) };
    void keepValue("serials", keptSerials);
  };
  let serialsLoading: Promise<void> | null = null;
  const loadSerials = () => serialsLoading ??= (async () => {
    if (!serialData && keptSerials) {
      serialData = { subs: keptSerials.subs, lists: keptSerials.lists, places: keptSerials.places };
      for (const [id, ids] of Object.entries(keptSerials.inDropbox ?? {})) { inDropboxIds.set(id, new Set(ids)); inDropboxCount.set(id, ids.length); }
      render();
    }
    try {
      const [listed, syncListed] = await Promise.all([api.listFolder(CHAPTERS_FOLDER, false), api.listFolder(SYNC_FOLDER, false)]);
      const was = keptSerials?.hashes ?? {};
      const hashes: Record<string, string> = {};
      const hashOf = (files: { name: string; contentHash: string }[], prefix: string) => {
        const map = new Map(files.map(f => [f.name.toLowerCase(), f.contentHash]));
        return (name: string) => { const h = map.get(name.toLowerCase()); if (h) hashes[prefix + name.toLowerCase()] = h; return h; };
      };
      const listHash = hashOf(listed, "chapters/");
      const syncHash = hashOf(syncListed, "sync/");
      // A file unchanged since it was kept isn't read again.
      const unchanged = (key: string, hash: string | undefined) => hash != null && was[key] === hash && keptSerials != null;
      const subsHash = syncHash("subscriptions.json");
      const subs = unchanged("sync/subscriptions.json", subsHash) ? keptSerials!.subs
        : parseSubscriptions((await api.readText(SUBSCRIPTIONS_PATH))?.text ?? null).filter(sub => !sub.removed && isSerialId(sub.bookId));
      const lists: Record<string, ChapterList | null> = {};
      const places: Record<string, Parameters<typeof homeSerials>[2][string]> = {};
      await Promise.all(subs.map(async sub => {
        const file = `${sub.bookId}.json`;
        const lh = listHash(file);
        const sh = syncHash(file);
        const [list, sync] = await Promise.all([
          !lh ? null : unchanged(`chapters/${file.toLowerCase()}`, lh) ? keptSerials!.lists[sub.bookId] ?? null
            : api.readText(chapterListPath(sub.bookId)).then(r => parseChapterList(r?.text ?? null)).catch(() => null),
          !sh ? null : unchanged(`sync/${file.toLowerCase()}`, sh) ? keptSerials!.places[sub.bookId] ?? null
            : api.readText(serialSyncPath(sub.bookId)).then(r => (r ? JSON.parse(r.text) : null)).catch(() => null),
        ]);
        lists[sub.bookId] = list;
        places[sub.bookId] = sync;
      }));
      serialData = { subs, lists, places };
      keptSerials = { ...serialData, hashes, inDropbox: keptSerials?.inDropbox ?? {} };
      keepSerials();
      // Which chapters' text is in Dropbox matters only where the site has locked posts (a Patreon
      // subscription that ended): those serials' folders are listed after the list shows, one each, and
      // the list is drawn again (2026-10-19; one listing of every chapter first made Serials slow).
      for (const sub of subs) {
        if (!lists[sub.bookId]?.chapters.some(c => c.locked)) continue;
        void chaptersInDropbox(sub.bookId).then(set => {
          inDropboxIds.set(sub.bookId, set);
          inDropboxCount.set(sub.bookId, set.size);
          keepSerials();
          render();
        });
      }
    } catch {
      // ⚙ says so; the serials as last read stay (none: an empty list).
      offline = true;
      serialData ??= { subs: [], lists: {}, places: {} };
    }
  })();
  const serialsNow = (): Serial[] | null => serialData && homeSerials(serialData.subs, serialData.lists, serialData.places, detailsNow, Date.now(), Object.fromEntries(inDropboxIds));
  const serialAsBook = (x: Serial): LibraryBook => ({
    id: x.id, path: "", title: x.title, author: x.author, series: null, seriesIndex: null, read: false, hidden: false,
    indexedAt: 0, cover: null, lastRead: null, hasSyncFile: false,
  });
  home = createHome({
    // Last read is when a device read it, not when its sync file last changed (readAt, 2026-10-16).
    books: () => books.map(b => ({ ...marked(b), lastRead: readAt(b, known.get(b.id)) })),
    showHidden: () => showHidden,
    setShowHidden: on => { showHidden = on; render(); },
    setup: () => setup,
    update: next => look.update(next),
    progress: id => knownNow(id)?.p ?? (books.find(b => b.id === id)?.hasSyncFile === false ? 0 : null),
    places: id => knownNow(id)?.places ?? (books.find(b => b.id === id)?.hasSyncFile === false ? [] : null),
    furthestRead: id => knownNow(id)?.far ?? null,
    furthestMenu: anchor => openFurthestMenu(anchor),
    load: async book => {
      // A kept entry from before Home has no places: read the file again.
      if (knownNow(book.id) && !knownNow(book.id)!.places) { known.delete(book.id); progress.delete(book.id); }
      // The book as listed, with its sync file's own time: the Library's carries the reading time.
      await progressOf(books.find(b => b.id === book.id) ?? book);
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
    saveDetails: (book, edit) => void saveDetails(book, edit),
    saveSerial: (x, title, author) => void saveDetails(serialAsBook(x), { title, author, series: null, number: null }),
    chosenCover: id => detailsNow[id]?.coverUrl ?? null,
    chooseCover: (id, pick) => {
      const book = books.find(b => b.id === id);
      const serial = book ? null : serialsNow()?.find(x => x.id === id);
      const target = book ? marked(book) : serial ? serialAsBook(serial) : null;
      return target ? chooseCover(target, pick) : Promise.resolve(false);
    },
    markRead: book => void setRead(book, true, true),
    signOut: () => void signOut(api),
    offline: () => offline,
    isHome: homeMode,
    chrome: () => setup.chrome[homeMode() ? "home" : "office"],
    setChrome: chrome => look.update({ ...setup, chrome: { ...setup.chrome, [homeMode() ? "home" : "office"]: chrome } }),
    setHome: on => {
      setHomeMode(on);
      // The page takes that style's look (the listener lays out and draws again).
      look.setStyle(on);
      layout();
      home?.render();
      showTitle();
    },
    showLibrary,
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
    openSerialAt: (x, chapterId) => void openSerialNow(x, chapterId),
    chapterIdsInDropbox: x => inDropboxIds.get(x.id) ?? null,
    chaptersInDropbox: x => {
      if (!inDropboxCount.has(x.id)) void chaptersInDropbox(x.id).then(set => { inDropboxCount.set(x.id, set.size); inDropboxIds.set(x.id, set); render(); });
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
    // Its sharp cover beside the phones' (never over one there).
    if (info?.cover) void largeCover(info.cover).then(large => large && api.addFile(coverPath(got), large)).catch(() => undefined);
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
  // Contents and Aa beside ⚙ while reading (2026-10-16).
  home.gear.before(tools);
  root.replaceChildren(home.bar, home.el, readerArea, bookMenu, toast);
  layout();
  if (screen === "library") home.render();

  if (kept) {
    render();
    restore(false);
  }
  try {
    const [files, index, syncFiles, details] = await Promise.all([
      api.listFolder(BOOKS_FOLDER, true),
      api.readText(LIBRARY_INDEX_PATH).then(r => (r ? (JSON.parse(r.text).books as Record<string, IndexEntry>) : {})).catch(() => ({})),
      api.listFolder(SYNC_FOLDER, false),
      api.readText(DETAILS_PATH).then(r => parseDetails(r?.text ?? null).books).catch(() => ({})),
    ]);
    detailsNow = details;
    // Covers chosen by hand: a file's image from Dropbox, a link as it is (the phones' sharp copy wins for a link).
    void loadChosenCovers(api, details, showSharpCover);
    books = libraryBooks(files, index, syncFiles, details, addedHere);
    // Once a phone has listed a book added here, its entry is the one shown.
    const listed = Object.keys(addedHere).filter(id => (index as Record<string, IndexEntry>)[id]);
    if (listed.length) { for (const id of listed) delete addedHere[id]; void keepValue("added", addedHere); }
  } catch (e) {
    // ⚙ says so; the Library as last seen stays.
    offline = true;
    render();
    restore(true);
    return;
  }
  progress = new Map();
  saveLibrary();
  render();
  // Sharp covers, the books read last first (covers.ts).
  void loadSharpCovers(api, [...books].sort((a, b) => (b.lastRead ?? "").localeCompare(a.lastRead ?? "")).map(b => b.id), (id, url) => { if (!hasChosen(id)) showSharpCover(id, url); });
  // Back to this tab after a while: other devices may have read meanwhile, and their progress shows.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    if (Date.now() - hiddenAt < RECHECK_AFTER_MS || !currentToken()) return;
    // The serials are read again too, when they've been shown.
    if (serialData) { serialsLoading = null; inDropboxNow.clear(); inDropboxCount.clear(); inDropboxIds.clear(); void loadSerials().then(render); }
    const syncFiles = await api.listFolder(SYNC_FOLDER, false).catch(() => null);
    const next = syncFiles && withSyncTimes(books, syncFiles);
    if (!next) return;
    books = next;
    progress = new Map();
    saveLibrary();
    render();
  });
  restore(true);
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
