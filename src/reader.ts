// The reader: a book from Dropbox, shown by Readium, opened at Web's place, its place saved to
// the book's sync file a few seconds after the last page turn.

import { EpubNavigator, TextAlignment, type EpubNavigatorListeners } from "@readium/navigator";
import { Locator } from "@readium/shared";
import { RevConflict, type Dropbox } from "./dropbox";
import { openBook, startPosition, type Book } from "./epub";
import { syncFilePath } from "./paths";
import { openingPlan, placeLabel, positionFromLocator, withWebPlace, WEB_DEVICE_ID, type Position, type SyncFile } from "./sync";
import { h } from "./ui";

/** Uploads wait this long after the last page turn (the phones wait 5 s). */
export const UPLOAD_DELAY_MS = 4000;

/** The look for now (WEB.md phase 1): the S23's Night, in Literata until Bookerly comes from Dropbox. */
const LOOK = {
  backgroundColor: "#000000",
  textColor: "#C9B27C",
  linkColor: "#C9B27C",
  visitedColor: "#C9B27C",
  selectionBackgroundColor: "#5a3420",
  selectionTextColor: "#C9B27C",
  fontFamily: "Literata",
  lineHeight: 1.6,
  textAlign: TextAlignment.justify,
  hyphens: true,
  columnCount: 1,
  optimalLineLength: 62,
  maximalLineLength: 70,
  pageGutter: 24,
};

const FONTS = [
  { file: "literata_400.ttf", weight: "400", style: "normal" },
  { file: "literata_400_italic.ttf", weight: "400", style: "italic" },
  { file: "literata_700.ttf", weight: "700", style: "normal" },
];

/** Literata for the book's pages, as an in-memory stylesheet (the pages are blob: documents). */
async function fontStylesheet(): Promise<Blob> {
  const faces = await Promise.all(FONTS.map(async f => {
    const bytes = await (await fetch(`${import.meta.env.BASE_URL}fonts/${f.file}`)).blob();
    const url = URL.createObjectURL(new Blob([bytes], { type: "font/ttf" }));
    return `@font-face { font-family: "Literata"; src: url("${url}") format("truetype"); font-weight: ${f.weight}; font-style: ${f.style}; }`;
  }));
  return new Blob([faces.join("\n")], { type: "text/css" });
}

export interface ReaderProps {
  dropbox: Dropbox;
  id: string;
  path: string;
  title: string;
  onClose: () => void;
}

export async function showReader(root: HTMLElement, props: ReaderProps): Promise<() => Promise<void>> {
  const { dropbox, id } = props;
  const status = h("div", { class: "foot" }, "Opening…");
  const prompt = h("div", { class: "msg", hidden: true });
  const page = h("div", { class: "page", id: "page" });
  const back = h("button", { class: "link", onclick: () => close().then(props.onClose) }, "‹ Library");
  const left = h("button", { class: "side left", "aria-label": "Previous page" }, "‹");
  const right = h("button", { class: "side right", "aria-label": "Next page" }, "›");
  root.replaceChildren(
    h("div", { class: "rbar" }, back, h("span", { class: "title" }, props.title)),
    h("div", { class: "stage" }, left, page, right),
    prompt,
    status,
  );

  let book: Book | null = null;
  let nav: EpubNavigator | null = null;
  let current: Locator | null = null;
  let moved = false;
  let uploadTimer: number | undefined;
  let dismissedAt: number | null = null;
  let closed = false;

  // --- Saving the place ---

  const upload = async () => {
    uploadTimer = undefined;
    if (!current) return;
    const place = positionFromLocator(current.serialize() as Record<string, unknown>, Date.now());
    if (!place) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await dropbox.readText(syncFilePath(id));
      try {
        await dropbox.writeText(syncFilePath(id), withWebPlace(remote?.text ?? null, id, place), remote?.rev ?? null);
        return;
      } catch (e) {
        if (!(e instanceof RevConflict)) throw e;
      }
    }
  };
  const scheduleUpload = () => {
    window.clearTimeout(uploadTimer);
    uploadTimer = window.setTimeout(() => upload().catch(e => showStatus(`Couldn't save your place: ${e}`)), UPLOAD_DELAY_MS);
  };
  const flush = async () => {
    if (uploadTimer === undefined) return;
    window.clearTimeout(uploadTimer);
    await upload().catch(() => undefined);
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisible);
    await flush();
    await nav?.destroy();
    book?.close();
  };

  // --- Turning pages ---

  const turn = (forward: boolean) => {
    if (!nav) return;
    moved = true;
    if (forward) nav.goForward(false, () => undefined);
    else nav.goBackward(false, () => undefined);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    switch (e.key) {
      case "ArrowRight": case "ArrowDown": case "PageDown": case " ":
        e.preventDefault();
        turn(!(e.key === " " && e.shiftKey));
        break;
      case "ArrowLeft": case "ArrowUp": case "PageUp":
        e.preventDefault();
        turn(false);
        break;
    }
  };
  window.addEventListener("keydown", onKey);
  left.addEventListener("click", () => turn(false));
  right.addEventListener("click", () => turn(true));
  swipes(left.parentElement!, turn);

  // --- The other devices ---

  const showStatus = (text: string) => { status.textContent = text; };
  const showPlace = () => {
    if (!current || !book) return;
    const chapter = book.titles.get(current.href.split("#")[0]);
    const percent = `${Math.round((current.locations.totalProgression ?? 0) * 100)}%`;
    showStatus(chapter ? `${chapter} · ${percent}` : percent);
    status.dataset.href = current.href;
    status.dataset.progression = String(current.locations.progression ?? 0);
  };

  const ask = (other: Position) => {
    const chapter = book?.titles.get(other.href.split("#")[0]) ?? null;
    prompt.replaceChildren(
      h("span", {}, `${other.deviceName} is further on: ${placeLabel(other, chapter)}`),
      h("button", { class: "link accent", onclick: () => { prompt.hidden = true; goThere(other); } }, "Go there"),
      h("button", { class: "link accent", onclick: () => { prompt.hidden = true; dismissedAt = other.timestamp; } }, "Stay"),
    );
    prompt.hidden = false;
  };
  const tell = (text: string) => {
    prompt.replaceChildren(h("span", {}, text), h("button", { class: "link accent", onclick: () => { prompt.hidden = true; } }, "OK"));
    prompt.hidden = false;
  };
  const goThere = (other: Position) => {
    const locator = Locator.deserialize(other.locator);
    const entry = locator && book ? startPosition(book.positions, locator) : null;
    if (!locator || !entry || !nav) return tell("Couldn't find that place in this book.");
    moved = true;
    nav.go(new Locator({ href: entry.href, type: locator.type, title: locator.title, locations: locator.locations, text: locator.text }), false, () => undefined);
  };

  const readSyncFile = async (): Promise<SyncFile | null> => {
    const remote = await dropbox.readText(syncFilePath(id));
    if (!remote) return null;
    try {
      return JSON.parse(remote.text) as SyncFile;
    } catch {
      return null;
    }
  };

  // Back to this tab: another device may have read on meanwhile.
  const onVisible = async () => {
    if (document.visibilityState !== "visible" || !nav || closed) return;
    const file = await readSyncFile().catch(() => null);
    const plan = openingPlan(withCurrent(file), dismissedAt);
    if (plan.ask) ask(plan.ask);
  };
  /** The sync file with Web's place as it is on screen now (not yet uploaded). */
  const withCurrent = (file: SyncFile | null): SyncFile | null => {
    if (!file || !current || !moved) return file;
    const place = positionFromLocator(current.serialize() as Record<string, unknown>, Date.now());
    return place ? { ...file, positions: { ...file.positions, [WEB_DEVICE_ID]: place } } : file;
  };
  document.addEventListener("visibilitychange", onVisible);

  // --- Opening ---

  try {
    const [file, syncFile] = await Promise.all([dropbox.download(props.path), readSyncFile()]);
    if (!file) throw new Error("This book is no longer in Dropbox.");
    book = await openBook(file.bytes);
    const plan = openingPlan(syncFile, null);
    const saved = plan.start ? Locator.deserialize(plan.start.locator) : undefined;
    // Readium opens at an entry of its page list (the chapter); the exact spot follows, as Go there finds it.
    const entry = saved ? startPosition(book.positions, saved) : null;
    const fonts = await fontStylesheet();

    const listeners: Partial<EpubNavigatorListeners> = {
      frameLoaded: (wnd: Window) => {
        wnd.addEventListener("keydown", onKey);
        swipes(wnd.document.documentElement, turn);
      },
      positionChanged: (locator: Locator) => {
        current = locator;
        showPlace();
        if (moved) scheduleUpload();
      },
      tap: e => clickTurn(e.x),
      click: e => clickTurn(e.x),
      // Links to other sites aren't followed from a book.
      handleLocator: () => true,
    };
    const clickTurn = (x: number) => {
      const width = (page.clientWidth || 1) * window.devicePixelRatio;
      if (x < width / 3) turn(false);
      else if (x > (width * 2) / 3) turn(true);
      return true;
    };

    nav = new EpubNavigator(page, book.publication, listeners as EpubNavigatorListeners, book.positions, entry ?? undefined, {
      preferences: LOOK,
      defaults: {},
      injectables: {
        rules: [{ resources: [/.*/], prepend: [{ as: "link", rel: "stylesheet", blob: fonts, target: "head" }] }],
        allowedDomains: [],
      },
    });
    await nav.load();
    if (saved && entry) {
      const there = new Locator({ href: entry.href, type: saved.type, title: saved.title, locations: saved.locations, text: saved.text });
      await new Promise<void>(done => nav!.go(there, false, () => done()));
    } else if (saved) {
      tell("Couldn't find your place in this book.");
    }
    if (plan.ask) ask(plan.ask);
  } catch (e) {
    showStatus(e instanceof Error ? e.message : String(e));
  }

  return close;
}

/** A sideways swipe on a touch screen turns the page once the finger lifts, as a click would. */
function swipes(el: HTMLElement, turn: (forward: boolean) => void) {
  let x = 0;
  let y = 0;
  el.addEventListener("touchstart", e => { x = e.touches[0].clientX; y = e.touches[0].clientY; }, { passive: true });
  el.addEventListener("touchend", e => {
    const t = e.changedTouches[0];
    const dx = t.clientX - x;
    const dy = t.clientY - y;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) turn(dx < 0);
  });
}
