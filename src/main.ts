import "./style.css";
import { Appearance, applyLook } from "./appearance";
import { APP_KEY, currentToken, finishSignIn, forgetSignIn, signIn } from "./auth";
import { Dropbox } from "./dropbox";
import { furthest, libraryBooks, libraryItems, type IndexEntry, type LibraryBook, type LibraryItem, type SortBy } from "./library";
import { shown } from "./looks";
import { BOOKS_FOLDER, LIBRARY_INDEX_PATH, SYNC_FOLDER, syncFilePath } from "./paths";
import { showReader } from "./reader";
import { h } from "./ui";

const root = document.getElementById("app")!;
let closeReader: (() => Promise<void>) | null = null;
/** Web's setup and the fonts, read once per visit. */
let appearance: Appearance | null = null;

// Quiet in an office: the browser tab says "Library" whatever is open, never a book's title.
document.title = "Library";

/** Stops the Library following setup changes (set while the Library shows). */
let closeLibrary: (() => void) | null = null;

/** Closes the Library's Settings panel on a click outside it or Esc (set while the Library shows). */
let closeLibraryPanel: ((e?: Event) => void) | null = null;
document.addEventListener("click", e => closeLibraryPanel?.(e));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeLibraryPanel?.(); });

function dropbox(): Dropbox | null {
  const token = currentToken();
  return token ? new Dropbox(token, () => { forgetSignIn(); showSignIn(); }) : null;
}

// --- Sign-in ---

function showSignIn(message?: string) {
  closeLibraryPanel = null;
  closeLibrary?.();
  closeLibrary = null;
  document.documentElement.style.removeProperty("--bg");
  document.documentElement.style.removeProperty("--tx");
  appearance?.close();
  appearance = null;
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
  showSignIn("Signed out.");
}

// --- Library ---

let sortBy: SortBy = "recent";
let query = "";

async function showLibrary() {
  const api = dropbox();
  if (!api) return showSignIn();
  appearance ??= new Appearance(api);
  const look = appearance;
  const list = h("div", { class: "list" });
  const note = h("p", { class: "note muted" }, "Loading your books…");
  const sort = h("select", { class: "sel", "aria-label": "Sort" },
    h("option", { value: "recent" }, "Recent"), h("option", { value: "title" }, "Title"), h("option", { value: "author" }, "Author"));
  sort.value = sortBy;
  const search = h("input", { class: "search", type: "search", placeholder: "Search", "aria-label": "Search title or author", value: query });
  const settingsButton = h("button", { class: "link", "aria-expanded": "false" }, "Settings");
  const settings = h("div", { class: "panel settings", hidden: true });
  root.replaceChildren(
    h("div", { class: "bar" },
      h("h1", {}, "Library"),
      search,
      h("label", { class: "muted" }, "Sort ", sort),
      settingsButton,
      h("button", { class: "link", onclick: () => void signOut(api) }, "Sign out")),
    settings,
    note,
    list,
  );

  // Settings › Group series, kept in Web's setup.
  const fillSettings = async () => {
    const setup = await look.setup();
    const on = setup.groupSeries;
    settings.replaceChildren(h("div", { class: "sec" },
      h("div", { class: "lab" }, "Library"),
      h("button", {
        class: `r${on ? " sel" : ""}`,
        "aria-pressed": String(on),
        onclick: () => {
          look.update({ ...setup, groupSeries: !on });
          void fillSettings();
          render();
        },
      }, "Group series", h("span", { class: "v" }, on ? "On" : "Off"))));
  };
  const closeSettings = () => {
    settings.hidden = true;
    settingsButton.setAttribute("aria-expanded", "false");
  };
  settingsButton.addEventListener("click", () => {
    if (!settings.hidden) return closeSettings();
    void fillSettings().then(() => {
      settings.hidden = false;
      settingsButton.setAttribute("aria-expanded", "true");
    });
  });
  closeLibraryPanel = (e?: Event) => {
    if (!e || !e.composedPath().some(el => el === settings || el === settingsButton)) closeSettings();
  };

  // The page takes the colours of the look in use.
  let setup = await look.setup();
  applyLook(shown(setup));
  const stop = look.onChange(next => { setup = next; applyLook(shown(next)); });
  closeLibrary = stop;

  let books: LibraryBook[] = [];
  try {
    const [files, index, syncFiles] = await Promise.all([
      api.listFolder(BOOKS_FOLDER, true),
      api.readText(LIBRARY_INDEX_PATH).then(r => (r ? (JSON.parse(r.text).books as Record<string, IndexEntry>) : {})).catch(() => ({})),
      api.listFolder(SYNC_FOLDER, false),
    ]);
    books = libraryBooks(files, index, syncFiles);
  } catch (e) {
    note.textContent = `Couldn't reach Dropbox: ${e instanceof Error ? e.message : e}`;
    return;
  }
  note.remove();

  const progress = new Map<string, Promise<number>>();
  const progressOf = (book: LibraryBook) => {
    if (!book.hasSyncFile) return Promise.resolve(0);
    let p = progress.get(book.id);
    if (!p) {
      p = api.readText(syncFilePath(book.id)).then(r => (r ? furthest(JSON.parse(r.text)) : 0)).catch(() => 0);
      progress.set(book.id, p);
    }
    return p;
  };
  // A row's progress is read when it comes into view: the line under it and "38%" (or "Read").
  const seen = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      seen.unobserve(entry.target);
      const row = entry.target as HTMLElement;
      const book = books.find(b => b.id === row.dataset.id);
      if (!book || book.read) continue;
      void progressOf(book).then(p => {
        const cell = row.querySelector<HTMLElement>(".p");
        const line = row.querySelector<HTMLElement>(".line i");
        if (cell) cell.textContent = p > 0 ? `${Math.round(p * 100)}%` : "";
        if (line) line.style.width = `${Math.round(p * 100)}%`;
      });
    }
  });
  /** Series opened in this visit. */
  const open = new Set<string>();

  const line = (fraction: number) => h("span", { class: "line" }, h("i", { style: `width: ${Math.round(fraction * 100)}%` }));
  const bookRow = (book: LibraryBook, inSeries: boolean) => {
    const byline = inSeries
      ? (book.seriesIndex != null ? `Book ${book.seriesIndex}` : book.author ?? "")
      : [book.author, book.series && `${book.series}${book.seriesIndex != null ? ` ${book.seriesIndex}` : ""}`].filter(Boolean).join(" · ");
    return h("button", { class: `row${inSeries ? " child" : ""}`, "data-id": book.id, onclick: () => void openReader(api, book) },
      h("span", { class: "t" }, book.title),
      h("span", { class: "a" }, byline),
      h("span", { class: "p" }, book.read ? "Read" : ""),
      line(book.read ? 1 : 0));
  };
  const seriesRows = (item: Extract<LibraryItem, { kind: "series" }>) => {
    const key = item.name.toLocaleLowerCase();
    const opened = open.has(key) || query.trim() !== "";
    const all = item.read === item.books.length;
    const head = h("button", {
      class: `row series${opened ? " open" : ""}`, "aria-expanded": String(opened),
      onclick: () => { if (open.has(key)) open.delete(key); else open.add(key); render(); },
    },
      h("span", { class: "t" }, item.name),
      h("span", { class: "a" }, [item.author, `${item.books.length} books`, `${item.read} read`].filter(Boolean).join(" · ")),
      h("span", { class: "p" }, all ? "Read" : ""),
      line(item.read / item.books.length));
    return [head, ...(opened ? item.books.map(b => bookRow(b, true)) : [])];
  };

  const render = () => {
    const items = libraryItems(books, sortBy, query, setup.groupSeries);
    list.replaceChildren(...items.flatMap(item => (item.kind === "book" ? [bookRow(item.book, false)] : seriesRows(item))));
    list.querySelectorAll(".row[data-id]").forEach(el => seen.observe(el));
    if (!items.length) list.replaceChildren(h("p", { class: "note muted" }, books.length ? "No books match." : "No books in Dropbox's /Books/ yet."));
  };
  sort.addEventListener("change", () => { sortBy = sort.value as SortBy; render(); });
  search.addEventListener("input", () => { query = search.value; render(); });
  render();
}

async function openReader(api: Dropbox, book: LibraryBook) {
  closeLibraryPanel = null;
  closeLibrary?.();
  closeLibrary = null;
  closeReader = await showReader(root, {
    dropbox: api, appearance: appearance ?? new Appearance(api), id: book.id, path: book.path,
    onClose: () => { closeReader = null; void showLibrary(); },
  });
}

// --- Start ---

(async () => {
  try {
    await finishSignIn();
  } catch {
    // A failed return from Dropbox: sign in again.
  }
  if (currentToken()) await showLibrary();
  else showSignIn();
})();
