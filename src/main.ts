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
/** The looks and fonts, read once per visit. */
let appearance: Appearance | null = null;

function dropbox(): Dropbox | null {
  const token = currentToken();
  return token ? new Dropbox(token, () => { forgetSignIn(); showSignIn(); }) : null;
}

// --- Sign-in ---

function showSignIn(message?: string) {
  document.title = "Read";
  appearance?.close();
  appearance = null;
  applyTheme(null);
  root.replaceChildren(
    h("main", { class: "signin" },
      h("div", { class: "word" }, "Read"),
      h("div", { class: "sub" }, "Your books, where you left them."),
      APP_KEY
        ? h("button", { class: "btn", onclick: () => void signIn() }, "Sign in with Dropbox")
        : h("div", { class: "sub" }, "This page isn't set up yet: it has no Dropbox app key."),
      message ? h("div", { class: "note" }, message) : null,
    ),
    h("div", { class: "foot" }, "Signed in until you close the browser"),
  );
}

async function signOut(api: Dropbox) {
  await closeReader?.();
  closeReader = null;
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
  document.title = "Library · Read";
  appearance ??= new Appearance(api);
  void appearance.choice().then(c => applyTheme(c?.look ?? null));
  const grid = h("div", { class: "grid" });
  const note = h("div", { class: "note" }, "Loading your books…");
  const sort = h("select", { class: "sort", "aria-label": "Sort" },
    h("option", { value: "recent" }, "Recent"), h("option", { value: "title" }, "Title"), h("option", { value: "author" }, "Author"));
  sort.value = sortBy;
  const search = h("input", { class: "search", type: "search", placeholder: "Search title or author", value: query });
  root.replaceChildren(
    h("div", { class: "bar" },
      h("span", { class: "mark" }, "Read"),
      h("label", { class: "sortlabel" }, "Sort: ", sort),
      h("button", { class: "link", onclick: () => void signOut(api) }, "Sign out")),
    h("div", { class: "top" }, h("h1", {}, "Library"), search),
    note,
    grid,
  );

  let books: LibraryBook[];
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
  const shown = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      shown.unobserve(entry.target);
      const card = entry.target as HTMLElement;
      const book = books.find(b => b.id === card.dataset.id);
      const bar = card.querySelector<HTMLElement>(".prog i");
      if (book && bar) void progressOf(book).then(p => { bar.style.width = `${Math.round((book.read ? 1 : p) * 100)}%`; });
    }
  });

  const render = () => {
    const list = sortBooks(searchBooks(books, query), sortBy);
    grid.replaceChildren(...list.map(book => card(book)));
    grid.querySelectorAll(".book").forEach(el => shown.observe(el));
    if (!list.length) grid.replaceChildren(h("div", { class: "note" }, books.length ? "No books match." : "No books in Dropbox's /Books/ yet."));
  };
  const card = (book: LibraryBook) => {
    const byline = [book.author, book.series && `${book.series}${book.seriesIndex != null ? ` ${book.seriesIndex}` : ""}`].filter(Boolean).join(" · ");
    const cover = book.cover
      ? h("img", { class: "cover", src: `data:image/jpeg;base64,${book.cover}`, alt: "" })
      : h("div", { class: "cover blank" }, book.title, book.author ? h("small", {}, book.author) : null);
    return h("button", { class: "book", "data-id": book.id, onclick: () => void openReader(api, book) },
      h("div", { class: "coverbox" }, cover, book.read ? h("span", { class: "tag" }, "READ") : null),
      h("div", { class: "t" }, book.title),
      byline ? h("div", { class: "a" }, byline) : null,
      h("div", { class: "prog" }, h("i", {})));
  };
  sort.addEventListener("change", () => { sortBy = sort.value as SortBy; render(); });
  search.addEventListener("input", () => { query = search.value; render(); });
  render();
}

async function openReader(api: Dropbox, book: LibraryBook) {
  document.title = `${book.title} · Read`;
  closeReader = await showReader(root, {
    dropbox: api, appearance: appearance ?? new Appearance(api), id: book.id, path: book.path, title: book.title,
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
