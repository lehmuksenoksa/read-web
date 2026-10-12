import "./style.css";
import { Appearance, applyTheme } from "./appearance";
import { APP_KEY, currentToken, finishSignIn, forgetSignIn, signIn } from "./auth";
import { Dropbox } from "./dropbox";
import { furthest, libraryBooks, searchBooks, sortBooks, type IndexEntry, type LibraryBook, type SortBy } from "./library";
import { BOOKS_FOLDER, LIBRARY_INDEX_PATH, SYNC_FOLDER, syncFilePath } from "./paths";
import { showReader } from "./reader";
import { h } from "./ui";

const root = document.getElementById("app")!;
let closeReader: (() => Promise<void>) | null = null;
/** Web's setup and the fonts, read once per visit. */
let appearance: Appearance | null = null;

// Quiet in an office: the browser tab says "Library" whatever is open, never a book's title.
document.title = "Library";

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

  // Settings › Interface: light or dark, kept in Web's setup.
  const fillSettings = async () => {
    const setup = await look.setup();
    settings.replaceChildren(h("div", { class: "sec" },
      h("div", { class: "lab" }, "Interface"),
      ...(["Light", "Dark"] as const).map(theme => h("button", {
        class: `r${setup.interface === theme ? " sel" : ""}`,
        onclick: () => {
          look.update({ ...setup, interface: theme });
          applyTheme(theme);
          void fillSettings();
        },
      }, theme, setup.interface === theme ? h("span", { class: "v" }, "✓") : null))));
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

  let books: LibraryBook[];
  try {
    const [files, index, syncFiles, setup] = await Promise.all([
      api.listFolder(BOOKS_FOLDER, true),
      api.readText(LIBRARY_INDEX_PATH).then(r => (r ? (JSON.parse(r.text).books as Record<string, IndexEntry>) : {})).catch(() => ({})),
      api.listFolder(SYNC_FOLDER, false),
      look.setup(),
    ]);
    applyTheme(setup.interface);
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
  // A row's progress is read when it comes into view: "38%", "Read", or nothing before the first page.
  const shown = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      shown.unobserve(entry.target);
      const row = entry.target as HTMLElement;
      const book = books.find(b => b.id === row.dataset.id);
      const cell = row.querySelector<HTMLElement>(".p");
      if (!book || !cell || book.read) continue;
      void progressOf(book).then(p => { cell.textContent = p > 0 ? `${Math.round(p * 100)}%` : ""; });
    }
  });

  const render = () => {
    const found = sortBooks(searchBooks(books, query), sortBy);
    list.replaceChildren(...found.map(book => row(book)));
    list.querySelectorAll(".row").forEach(el => shown.observe(el));
    if (!found.length) list.replaceChildren(h("p", { class: "note muted" }, books.length ? "No books match." : "No books in Dropbox's /Books/ yet."));
  };
  const row = (book: LibraryBook) => {
    const byline = [book.author, book.series && `${book.series}${book.seriesIndex != null ? ` ${book.seriesIndex}` : ""}`].filter(Boolean).join(" · ");
    return h("button", { class: "row", "data-id": book.id, onclick: () => void openReader(api, book) },
      h("span", { class: "t" }, book.title),
      h("span", { class: "a" }, byline),
      h("span", { class: "p" }, book.read ? "Read" : ""));
  };
  sort.addEventListener("change", () => { sortBy = sort.value as SortBy; render(); });
  search.addEventListener("input", () => { query = search.value; render(); });
  render();
}

async function openReader(api: Dropbox, book: LibraryBook) {
  closeLibraryPanel = null;
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
