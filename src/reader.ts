// The reader: a book from Dropbox, shown by Readium, opened at Web's place, its place saved to
// the book's sync file a few seconds after the last page turn.

import { EpubNavigator, EpubPreferences, type EpubNavigatorListeners, type IEpubPreferences } from "@readium/navigator";
import { Locator, LocatorLocations } from "@readium/shared";
import { applyTheme, type Appearance, type Choice } from "./appearance";
import { RevConflict, type Dropbox } from "./dropbox";
import { currentEntry, flatToc, openBook, startPosition, type Book } from "./epub";
import { DEFAULT_LOOKS, hex, isLight, lookKey, pageBackground, pageText, preferences, SIZE, stepSize } from "./looks";
import { syncFilePath } from "./paths";
import { openingPlan, placeLabel, positionFromLocator, withWebPlace, WEB_DEVICE_ID, type Position, type SyncFile } from "./sync";
import { h } from "./ui";

/** Uploads wait this long after the last page turn (the phones wait 5 s). */
export const UPLOAD_DELAY_MS = 4000;

export interface ReaderProps {
  dropbox: Dropbox;
  appearance: Appearance;
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
  const contentsButton = h("button", { class: "link", "aria-expanded": "false" }, "Contents");
  const aaButton = h("button", { class: "link", "aria-expanded": "false" }, "Aa");
  const contents = h("div", { class: "toc", hidden: true });
  const aa = h("div", { class: "panel", hidden: true });
  root.replaceChildren(
    h("div", { class: "rbar" }, back, h("span", { class: "title" }, props.title), contentsButton, aaButton),
    h("div", { class: "stage" }, left, page, right),
    contents,
    aa,
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
  let choice: Choice | null = null;
  const fonts = new Map<string, Promise<{ family: string; css: string }>>();

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
    document.removeEventListener("click", onOutside);
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
    if (e.key === "Escape") return closePanels();
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

  // --- Aa and Contents ---

  const closePanels = () => {
    contents.hidden = true;
    aa.hidden = true;
    contentsButton.setAttribute("aria-expanded", "false");
    aaButton.setAttribute("aria-expanded", "false");
  };
  const toggle = (panel: HTMLElement, button: HTMLElement, fill: () => void) => {
    const open = panel.hidden;
    closePanels();
    if (!open) return;
    fill();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };
  const onOutside = (e: MouseEvent) => {
    // The click's path as it was: a panel redrawn by the click no longer holds what was clicked.
    const path = e.composedPath();
    if ([contents, aa, contentsButton, aaButton].some(el => path.includes(el))) return;
    closePanels();
  };
  document.addEventListener("click", onOutside);
  contentsButton.addEventListener("click", () => toggle(contents, contentsButton, fillContents));
  aaButton.addEventListener("click", () => toggle(aa, aaButton, () => void fillAa()));

  const fillContents = () => {
    if (!book) return;
    const flat = flatToc(book.toc);
    const at = current ? currentEntry(flat, book.readingOrder, current.href) : -1;
    const percent = `${Math.round((current?.locations.totalProgression ?? 0) * 100)}%`;
    contents.replaceChildren(...(flat.length
      ? flat.map(({ entry, depth }, i) => h("button", {
          class: `item${i === at ? " cur" : i < at ? " read" : ""}`,
          style: depth ? `padding-left: ${14 + depth * 20}px` : undefined,
          onclick: () => { closePanels(); goTo(entry.href); },
        }, entry.title || "Untitled", i === at ? h("span", {}, percent) : null))
      : [h("div", { class: "item" }, "This book has no contents.")]));
    contents.querySelector(".cur")?.scrollIntoView({ block: "center" });
  };
  const goTo = (href: string) => {
    if (!book || !nav) return;
    const [base, fragment] = href.split("#");
    const entry = startPosition(book.positions, { href: base, locations: { progression: 0 } });
    if (!entry) return tell("Couldn't find that chapter in this book.");
    moved = true;
    nav.go(new Locator({ href: entry.href, type: entry.type, locations: new LocatorLocations({ progression: 0, fragments: fragment ? [fragment] : [] }) }), false, () => undefined);
  };

  const fillAa = async () => {
    const devices = await props.appearance.devices();
    const groups = devices.map(d => h("div", { class: "group" },
      h("div", { class: "label" }, d.device),
      ...d.looks.map(look => {
        const picked = choice != null && lookKey(choice.device, choice.look) === lookKey(d.device, look);
        return h("button", {
          class: `row${picked ? " sel" : ""}`,
          onclick: () => { props.appearance.pick(d.device, look); void restyle(true); },
        },
        h("span", { class: "sw", style: `background:${hex(pageBackground(look))};color:${hex(pageText(look))}${isLight(look) ? ";border:1px solid currentColor" : ""}` }, "Aa"),
        look.name,
        picked ? h("span", { class: "tick" }, "✓") : null);
      })));
    const size = choice?.size ?? 1;
    const own = choice?.look.fontSize ?? 1;
    const percent = (v: number) => `${Math.round(v * 100)}%`;
    const sizeRow = h("div", { class: "size" },
      h("div", {}, h("div", { class: "label" }, "Text size"),
        h("div", { class: "val" }, percent(size), Math.abs(size - own) > 1e-9 ? h("span", { class: "reset" }, ` · the look's is ${percent(own)}`) : null)),
      h("div", { class: "ctl" },
        h("button", { "aria-label": "Smaller text", disabled: !choice || size <= SIZE.min + 1e-9, onclick: () => resize(false) }, "−"),
        h("button", { "aria-label": "Larger text", disabled: !choice || size >= SIZE.max - 1e-9, onclick: () => resize(true) }, "+")));
    aa.replaceChildren(...(groups.length ? groups : [h("div", { class: "group" }, h("div", { class: "label" }, "No looks in Dropbox yet"))]), sizeRow);
  };
  const resize = (up: boolean) => {
    if (!choice || !nav) return;
    choice = { ...choice, size: stepSize(choice.size, up) };
    props.appearance.setSize(choice, choice.size);
    void fontFor(choice).then(font => nav?.submitPreferences(new EpubPreferences(prefsFor(font.family))));
    void fillAa();
  };

  /** The page settings now: the chosen look, or (with no backups) the app's Night in Literata. */
  const prefsFor = (family: string): IEpubPreferences =>
    preferences(choice?.look ?? DEFAULT_LOOKS[1], family, choice?.size ?? 1);
  const fontFor = (c: Choice | null) => {
    const key = c ? `${c.device}|${c.look.font}` : "none";
    let font = fonts.get(key);
    if (!font) {
      font = c ? props.appearance.font(c) : props.appearance.font({ device: "", look: { ...DEFAULT_LOOKS[1], font: "Serif" }, size: 1 });
      fonts.set(key, font);
    }
    return font;
  };

  /** A look was picked: the page is set up again in it, at the same place. */
  const restyle = async (fromPanel: boolean) => {
    choice = await props.appearance.choice();
    applyTheme(choice?.look ?? null);
    if (fromPanel) void fillAa();
    if (book) await mount(current);
  };

  // --- The book's pages ---

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
    // A click on the page with a panel open only closes the panel.
    if (!contents.hidden || !aa.hidden) {
      closePanels();
      return true;
    }
    const width = (page.clientWidth || 1) * window.devicePixelRatio;
    if (x < width / 3) turn(false);
    else if (x > (width * 2) / 3) turn(true);
    return true;
  };

  /**
   * Readium shown in the page, in the current look, at [at]: it opens at an entry of its page
   * list (the chapter), and the exact spot follows, as Go there finds it. False when [at]'s
   * chapter isn't in the book.
   */
  const mount = async (at: Locator | null): Promise<boolean> => {
    if (!book) return false;
    const font = await fontFor(choice);
    if (nav) {
      await nav.destroy();
      page.replaceChildren();
    }
    const entry = at ? startPosition(book.positions, at) : null;
    nav = new EpubNavigator(page, book.publication, listeners as EpubNavigatorListeners, book.positions, entry ?? undefined, {
      preferences: prefsFor(font.family),
      defaults: {},
      injectables: {
        rules: [{ resources: [/.*/], prepend: [{ as: "link", rel: "stylesheet", blob: new Blob([font.css], { type: "text/css" }), target: "head" }] }],
        allowedDomains: [],
      },
    });
    await nav.load();
    if (at && entry) {
      const there = new Locator({ href: entry.href, type: at.type, title: at.title, locations: at.locations, text: at.text });
      await new Promise<void>(done => nav!.go(there, false, () => done()));
    }
    return !at || entry != null;
  };

  // --- Opening ---

  try {
    const [file, syncFile, chosen] = await Promise.all([dropbox.download(props.path), readSyncFile(), props.appearance.choice()]);
    if (!file) throw new Error("This book is no longer in Dropbox.");
    choice = chosen;
    applyTheme(choice?.look ?? null);
    book = await openBook(file.bytes);
    const plan = openingPlan(syncFile, null);
    const saved = plan.start ? Locator.deserialize(plan.start.locator) ?? null : null;
    if (!(await mount(saved))) tell("Couldn't find your place in this book.");
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
