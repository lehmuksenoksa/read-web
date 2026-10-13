// The reader: a book from Dropbox, shown by Readium in Web's look, opened at Web's place, its
// place saved to the book's sync file a few seconds after the last page turn. Quiet for an office
// (WEB.md): no title on the page, only the percentage; the browser tab says "Read: <title>".

import { EpubNavigator, EpubPreferences, type EpubNavigatorListeners } from "@readium/navigator";
import { Locator, LocatorLocations } from "@readium/shared";
import { ChapterEdge, touchOnward, type Ends } from "./chapterEdge";
import { applyLook, type Appearance, type FontChoice, type PageFont } from "./appearance";
import { RevConflict, type Dropbox } from "./dropbox";
import { currentEntry, flatToc, openBook, startPosition, type Book } from "./epub";
import {
  argb, cantRemove, edit, hex, isChanged, besideText, textWidth, pageBackground, pageText, preferences, removeLook, restoreLook, saveAsNew,
  shown, step, stepOptional, STEPS, stepWeight, useLook, weightName, type Look, type Setup, type TextPosition, type Steps,
} from "./looks";
import { pageTop, withPageTop, type PageTop } from "./pagetop";
import { syncFilePath } from "./paths";
import { keepBook, keptBook, keepValue, keptValue } from "./store";
import { afterKeptOpening, openingPlan, positionFromLocator, withWebPlace, WEB_DEVICE_ID, type Position, type SyncFile } from "./sync";
import { h } from "./ui";

/** Uploads wait this long after the last page turn (the phones wait 5 s). */
export const UPLOAD_DELAY_MS = 4000;
/** How long opening waits for Readium to find the place before showing the chapter as it is. */
const GO_TIMEOUT_MS = 8000;

type AaTab = "Text" | "Layout" | "Colour" | "Looks";

export interface ReaderProps {
  dropbox: Dropbox;
  appearance: Appearance;
  id: string;
  path: string;
  /** For the browser tab only ("Read: Mage Tank 5"); the page itself shows no title. */
  title: string;
  /** The book's sync file as just uploaded with Web's place: the Library's progress follows. */
  onSaved?: (syncText: string) => void;
}

/** The book in [root] (the pane beside the Library); returns how to close it, its place saved first. */
export async function showReader(root: HTMLElement, props: ReaderProps): Promise<() => Promise<void>> {
  const { dropbox, id, appearance } = props;
  document.title = `Read: ${props.title}`;
  const status = h("div", { class: "foot" }, "Opening…");
  const prompt = h("div", { class: "msg", hidden: true });
  const page = h("div", { class: "page", id: "page" });
  const left = h("button", { class: "side left", "aria-label": "Previous page" }, "‹");
  const right = h("button", { class: "side right", "aria-label": "Next page" }, "›");
  const contentsButton = h("button", { class: "link", "aria-expanded": "false" }, "Contents");
  const aaButton = h("button", { class: "link", "aria-expanded": "false" }, "Aa");
  const contents = h("div", { class: "toc", hidden: true });
  const aa = h("div", { class: "panel", hidden: true });
  root.replaceChildren(
    h("div", { class: "rbar" }, h("span", { class: "spacer" }), contentsButton, aaButton),
    h("div", { class: "stage" }, left, h("div", { class: "pagebox" }, page), right),
    contents,
    aa,
    prompt,
    status,
  );

  let book: Book | null = null;
  let nav: EpubNavigator | null = null;
  let current: Locator | null = null;
  /** The words at the top of the page shown, read when it settles after a move. */
  let currentTop: PageTop | null = null;
  let moved = false;
  let uploadTimer: number | undefined;
  let dismissedAt: number | null = null;
  let closed = false;
  let setup: Setup = await appearance.setup();
  let mountedFont: string | null = null;
  let mountedColumns = 1;
  /** The chapter Readium shows scrolls (the look's Page: Scroll) instead of turning pages. */
  let mountedScroll = false;
  let aaTab: AaTab = "Text";
  let fontChoices: { ready: FontChoice[]; toDownload: string[] } | null = null;
  /** Fonts being downloaded now. */
  const downloading = new Set<string>();
  let undoTimer: number | undefined;
  /** Where the reader was before Aa changes set the page up again: kept until a page is turned, so changes don't creep backwards. */
  let anchor: Locator | null = null;

  // --- Saving the place ---

  const upload = async () => {
    uploadTimer = undefined;
    if (!current) return;
    const place = positionFromLocator(withPageTop(current.serialize() as Record<string, unknown>, currentTop), Date.now());
    if (!place) return;
    // This browser keeps it too, to open here next time without waiting for Dropbox.
    void keepValue(`place:${id}`, place);
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await dropbox.readText(syncFilePath(id));
      try {
        const text = withWebPlace(remote?.text ?? null, id, place);
        await dropbox.writeText(syncFilePath(id), text, remote?.rev ?? null);
        props.onSaved?.(text);
        return;
      } catch (e) {
        if (!(e instanceof RevConflict)) throw e;
      }
    }
  };
  const scheduleUpload = () => {
    window.clearTimeout(uploadTimer);
    uploadTimer = window.setTimeout(() => upload().catch(() => tell("Couldn't save your place. It's tried again at the next page turn.")), UPLOAD_DELAY_MS);
  };
  const flush = async () => {
    if (uploadTimer === undefined) return;
    window.clearTimeout(uploadTimer);
    await upload().catch(() => undefined);
  };

  const stopListening = appearance.onChange(next => {
    setup = next;
    void restyle();
  });

  const close = async () => {
    if (closed) return;
    closed = true;
    document.title = "Library";
    stopListening();
    resized.disconnect();
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("click", onOutside);
    await Promise.all([flush(), appearance.flush()]);
    await nav?.destroy();
    book?.close();
  };

  // --- Turning pages ---

  const turn = (forward: boolean) => {
    if (!nav) return;
    moved = true;
    anchor = null;
    if (forward) nav.goForward(false, () => undefined);
    else nav.goBackward(false, () => undefined);
  };
  /** Scrolling: a moved place is saved, as after a page turn. */
  const userScrolled = () => {
    if (!mountedScroll) return;
    moved = true;
    anchor = null;
  };
  /** Scrolling: which ends of the chapter are in view; null when the page can't be read. */
  const chapterEnds = (): Ends | null => {
    const wnd = frameWindow();
    const el = wnd?.document.scrollingElement;
    if (!wnd || !el) return null;
    return { top: el.scrollTop <= 0, bottom: el.scrollTop + wnd.innerHeight >= el.scrollHeight - 2 };
  };
  /** Scrolling: a screen down or up; past the chapter's end or start, the next or previous chapter. */
  const scrollScreen = (forward: boolean) => {
    const wnd = frameWindow();
    const el = wnd?.document.scrollingElement;
    const ends = chapterEnds();
    if (!wnd || !el || !ends) return turn(forward);
    if (forward ? ends.bottom : ends.top) return turn(forward);
    userScrolled();
    el.scrollBy({ top: (forward ? 0.9 : -0.9) * wnd.innerHeight, behavior: "instant" });
  };
  /** Scrolling with the wheel or touchpad: a new scroll past a chapter's end goes on into the next one. */
  const edge = new ChapterEdge();
  const onWheel = (e: WheelEvent) => {
    userScrolled();
    if (!mountedScroll) return;
    const ends = chapterEnds();
    if (!ends) return;
    const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1);
    const onward = edge.wheel(px, ends, performance.now());
    if (onward) turn(onward === "next");
  };
  /** The same with a finger on a touch screen. */
  let touchBegan: { y: number; ends: Ends } | null = null;
  const onTouchStart = (e: TouchEvent) => {
    const ends = mountedScroll ? chapterEnds() : null;
    touchBegan = ends && e.touches.length === 1 ? { y: e.touches[0].clientY, ends } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const began = touchBegan;
    touchBegan = null;
    const ends = began ? chapterEnds() : null;
    if (!began || !ends) return;
    const onward = touchOnward(began.y - e.changedTouches[0].clientY, began.ends, ends);
    if (onward) turn(onward === "next");
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return closePanels();
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (mountedScroll) {
      switch (e.key) {
        case "ArrowDown": case "PageDown": case " ":
          e.preventDefault();
          scrollScreen(!(e.key === " " && e.shiftKey));
          break;
        case "ArrowUp": case "PageUp":
          e.preventDefault();
          scrollScreen(false);
          break;
        case "ArrowRight": case "ArrowLeft":
          // Scrolling, ← → do nothing: they'd jump a whole chapter (2026-10-13).
          e.preventDefault();
          break;
      }
      return;
    }
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
  const swiped = (forward: boolean) => { if (!mountedScroll) turn(forward); };
  swipes(left.parentElement!, swiped);

  // --- The place and the other devices ---

  const showPlace = () => {
    if (!current) return;
    status.textContent = `${Math.round((current.locations.totalProgression ?? 0) * 100)}%`;
    status.dataset.href = current.href;
    status.dataset.progression = String(current.locations.progression ?? 0);
  };

  const ask = (other: Position) => {
    prompt.replaceChildren(
      h("span", {}, `${other.deviceName} is further on: ${Math.round(other.totalProgression * 100)}%`),
      h("button", { class: "link strong", onclick: () => { prompt.hidden = true; goThere(other); } }, "Go there"),
      h("button", { class: "link strong", onclick: () => { prompt.hidden = true; dismissedAt = other.timestamp; } }, "Stay"),
    );
    prompt.hidden = false;
  };
  const tell = (text: string, action?: { label: string; run: () => void }) => {
    window.clearTimeout(undoTimer);
    const buttons = action ? [h("button", { class: "link strong", onclick: () => { prompt.hidden = true; action.run(); } }, action.label)] : [];
    prompt.replaceChildren(
      h("span", {}, text),
      ...buttons,
      h("button", { class: "link strong", onclick: () => { prompt.hidden = true; } }, action ? "×" : "OK"),
    );
    prompt.hidden = false;
    if (action) undoTimer = window.setTimeout(() => { prompt.hidden = true; }, 8000);
  };
  /** To [other]'s place; [ownPlace]: Web's own, from another browser, so nothing new to save. */
  const goThere = (other: Position, ownPlace = false) => {
    const locator = Locator.deserialize(other.locator);
    const entry = locator && book ? startPosition(book.positions, locator) : null;
    if (!locator || !entry || !nav) return tell("Couldn't find that place in this book.");
    if (!ownPlace) moved = true;
    anchor = null;
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

  // --- Panels ---

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
    if ([contents, aa, contentsButton, aaButton, prompt].some(el => path.includes(el))) return;
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
          style: depth ? `padding-left: ${12 + depth * 20}px` : undefined,
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
    anchor = null;
    nav.go(new Locator({ href: entry.href, type: entry.type, locations: new LocatorLocations({ progression: 0, fragments: fragment ? [fragment] : [] }) }), false, () => undefined);
  };

  // --- Aa: Text, Layout, Colour, Looks ---

  const change = (patch: Partial<Look>) => appearance.update(edit(setup, patch));

  const stepper = (label: string, value: string, down: (() => void) | null, up: (() => void) | null) =>
    h("div", { class: "r" }, label, h("span", { class: "st" },
      h("button", { "aria-label": `${label} down`, disabled: !down, onclick: () => down?.() }, "−"),
      h("i", {}, value),
      h("button", { "aria-label": `${label} up`, disabled: !up, onclick: () => up?.() }, "+")));
  const choice = (label: string, options: { name: string; on: boolean; pick: () => void }[]) =>
    h("div", { class: "r" }, label, h("span", { class: "st" },
      ...options.map(o => h("button", { class: `opt${o.on ? " on" : ""}`, "aria-pressed": String(o.on), onclick: o.pick }, o.name))));
  const stepped = (label: string, key: "fontSize" | "margins" | "lineHeight" | "letterSpacing" | "wordSpacing", format: (v: number) => string) => {
    const look = shown(setup);
    const steps: Steps = STEPS[key];
    const value = look[key];
    return stepper(label, format(value),
      value > steps.min + 1e-9 ? () => change({ [key]: step(steps, value, false) }) : null,
      value < steps.max - 1e-9 ? () => change({ [key]: step(steps, value, true) }) : null);
  };
  const optional = (label: string, key: "paragraphSpacing" | "paragraphIndent") => {
    const steps: Steps = STEPS[key];
    const value = shown(setup)[key];
    return stepper(label, value == null ? "Book's" : fixed(value),
      value != null ? () => change({ [key]: stepOptional(steps, value, false) }) : null,
      value == null || value < steps.max - 1e-9 ? () => change({ [key]: stepOptional(steps, value, true) }) : null);
  };

  const fillAa = async () => {
    const look = shown(setup);
    const tabs = h("div", { class: "tabs" }, ...(["Text", "Layout", "Colour", "Looks"] as AaTab[]).map(tab =>
      h("button", { class: tab === aaTab ? "cur" : "", onclick: () => { aaTab = tab; void fillAa(); } }, tab)));
    let body: HTMLElement;
    switch (aaTab) {
      case "Text": {
        const choices = fontChoices ??= await appearance.fontChoices();
        const font = await appearance.font(look.font);
        body = h("div", { class: "sec" },
          h("div", { class: "lab" }, "Font"),
          ...choices.ready.map(f => h("button", {
            class: `r${f.family === look.font ? " sel" : ""}`,
            onclick: () => change({ font: f.family }),
          }, f.family, f.family === look.font ? h("span", { class: "v" }, "✓") : null)),
          ...(choices.toDownload.length ? [h("div", { class: "lab" }, "From Google Fonts")] : []),
          ...choices.toDownload.map(family => h("div", { class: "r" }, family, downloading.has(family)
            ? h("span", { class: "v small" }, "Downloading…")
            : h("button", { class: "dl", onclick: () => void download(family) }, "Download"))),
          h("div", { class: "lab" }, "Size and weight"),
          stepped("Size", "fontSize", v => `${Math.round(v * 100)}%`),
          stepper("Weight", weightName(look.fontWeight),
            stepWeight(font.weights, look.fontWeight, false) !== look.fontWeight ? () => change({ fontWeight: stepWeight(font.weights, look.fontWeight, false) }) : null,
            stepWeight(font.weights, look.fontWeight, true) !== look.fontWeight ? () => change({ fontWeight: stepWeight(font.weights, look.fontWeight, true) }) : null));
        break;
      }
      case "Layout":
        body = h("div", { class: "sec" },
          choice("Page", [
            { name: "1 column", on: !look.scroll && look.columns === 1, pick: () => change({ columns: 1, scroll: false }) },
            { name: "2 columns", on: !look.scroll && look.columns === 2, pick: () => change({ columns: 2, scroll: false }) },
            { name: "Scroll", on: look.scroll, pick: () => change({ scroll: true }) },
          ]),
          stepped("Line spacing", "lineHeight", v => v.toFixed(1)),
          stepped("Margins", "margins", fixed),
          choice("Position", (["left", "centre", "right"] as TextPosition[]).map(p => ({
            name: p === "left" ? "Left" : p === "centre" ? "Centre" : "Right",
            on: look.position === p,
            pick: () => change({ position: p }),
          }))),
          choice("Alignment", [
            { name: "Justified", on: look.justify, pick: () => change({ justify: true }) },
            { name: "Left", on: !look.justify, pick: () => change({ justify: false }) },
          ]),
          optional("Paragraph spacing", "paragraphSpacing"),
          optional("First-line indent", "paragraphIndent"),
          choice("Hyphenation", [
            { name: "On", on: look.hyphens, pick: () => change({ hyphens: true }) },
            { name: "Off", on: !look.hyphens, pick: () => change({ hyphens: false }) },
          ]),
          stepped("Letter spacing", "letterSpacing", v => v.toFixed(2)),
          stepped("Word spacing", "wordSpacing", v => v.toFixed(1)));
        break;
      case "Colour": {
        const colourRow = (label: string, value: number, set: (color: number) => void) => {
          const input = h("input", { type: "color", value: hex(value), "aria-label": label });
          input.addEventListener("input", () => set(argb(input.value)));
          return h("label", { class: "r" }, label, h("span", { class: "dotwrap" }, input));
        };
        body = h("div", { class: "sec" },
          colourRow("Background", pageBackground(look), color => change({ background: "Custom", backgroundColor: color })),
          colourRow("Text", pageText(look), color => change({ textColor: color })));
        break;
      }
      case "Looks": {
        const changed = isChanged(setup);
        body = h("div", { class: "sec" },
          h("div", { class: "lab" }, "Looks"),
          ...setup.looks.map(l => {
            const inUse = l.id === setup.lookId;
            return h("div", { class: `r look${inUse ? " sel" : ""}` },
              h("button", { class: "use", onclick: () => appearance.update(useLook(setup, l.id)) },
                h("span", { class: "sw", style: `background:${hex(pageBackground(l))};color:${hex(pageText(l))}` }, "Aa"),
                l.name,
                inUse && changed ? h("span", { class: "from" }, "changed") : null),
              inUse ? h("span", { class: "v" }, "✓") : h("button", { class: "remove", "aria-label": `Remove ${l.name}`, onclick: () => remove(l.id) }, "Remove"));
          }),
          h("div", { class: "btnrow" }, h("button", { class: "btn", onclick: () => appearance.update(saveAsNew(setup)) }, "+ Save as new look")));
        break;
      }
    }
    aa.replaceChildren(tabs, body);
  };
  /** Download: the font goes to Dropbox, then it's used. */
  const download = async (family: string) => {
    downloading.add(family);
    void fillAa();
    try {
      await appearance.download(family);
      fontChoices = null;
      change({ font: family });
    } catch {
      tell(`Couldn't download ${family}. Try again later.`);
    } finally {
      downloading.delete(family);
      void fillAa();
    }
  };

  const remove = (lookId: string) => {
    const why = cantRemove(setup, lookId);
    if (why) return tell(why);
    const done = removeLook(setup, lookId);
    if (!done) return;
    appearance.update(done.setup);
    tell(`Removed “${done.removed.name}”`, { label: "Undo", run: () => appearance.update(restoreLook(setup, done.removed, done.index)) });
  };

  // --- The book's pages ---

  const listeners: Partial<EpubNavigatorListeners> = {
    frameLoaded: (wnd: Window) => {
      wnd.addEventListener("keydown", onKey);
      wnd.addEventListener("wheel", onWheel, { passive: true });
      wnd.addEventListener("touchmove", userScrolled, { passive: true });
      wnd.addEventListener("touchstart", onTouchStart, { passive: true });
      wnd.addEventListener("touchend", onTouchEnd, { passive: true });
      swipes(wnd.document.documentElement, swiped);
    },
    positionChanged: (locator: Locator) => {
      current = locator;
      currentTop = readPageTop();
      showPlace();
      if (moved) scheduleUpload();
    },
    tap: () => pageClicked(),
    click: () => pageClicked(),
    // Links to other sites aren't followed from a book.
    handleLocator: () => true,
  };
  /** The words at the top of the page in view (null if it can't be read: the place keeps its progress only). */
  const readPageTop = (): PageTop | null => {
    try {
      const wnd = frameWindow();
      return wnd ? pageTop(wnd) : null;
    } catch {
      return null;
    }
  };
  const frameWindow = (): Window | null => {
    const frame = nav?._cframes.find(f => f != null) as { window?: Window } | undefined;
    return frame?.window ?? null;
  };
  /** A click or tap on the text never turns the page: the ‹ › beside it do (2026-10-13). It closes an open panel. */
  const pageClicked = () => {
    if (!contents.hidden || !aa.hidden) closePanels();
    return true;
  };

  /** The page around the book takes the look's colours too; the text takes the pane's width less the margins. */
  const fitPage = (look: Look) => {
    // Readium sizes the page from its parent: the box is the width the margins leave, placed by the look's position.
    (page.parentElement as HTMLElement).style.width = `${textWidth(stage.clientWidth, look.margins)}px`;
    const beside = besideText(stage.clientWidth, look.margins, look.position);
    for (const [arrow, width] of [[left, beside.left], [right, beside.right]] as const) {
      arrow.style.flex = `0 0 ${width}px`;
      arrow.style.minWidth = "0";
      // Scrolling, ‹ › aren't there (they'd jump a whole chapter); their space stays, so the text doesn't move.
      arrow.style.visibility = look.scroll ? "hidden" : "";
      arrow.disabled = look.scroll;
    }
    applyLook(look);
  };
  const stage = left.parentElement!;
  // A narrower or wider pane (the window, the sidebar): the page follows, once it has opened
  // (resizing Readium while it loads can leave it never arriving).
  let mounting = false;
  const resized = new ResizeObserver(() => { if (!mounting) fitPage(shown(setup)); });
  resized.observe(stage);

  /**
   * Readium shown in the page, in what you see now, at [at]: it opens at an entry of its page
   * list (the chapter), and the exact spot follows, as Go there finds it. False when [at]'s
   * chapter isn't in the book.
   */
  const mount = async (at: Locator | null): Promise<boolean> => {
    if (!book) return false;
    mounting = true;
    try {
      return await mountNow(at);
    } finally {
      mounting = false;
      fitPage(shown(setup));
    }
  };
  const mountNow = async (at: Locator | null): Promise<boolean> => {
    if (!book) return false;
    const look = shown(setup);
    const font: PageFont = await appearance.font(look.font);
    if (nav) {
      await nav.destroy();
      page.replaceChildren();
    }
    fitPage(look);
    mountedFont = look.font;
    mountedColumns = look.columns;
    mountedScroll = look.scroll;
    const entry = at ? startPosition(book.positions, at) : null;
    nav = new EpubNavigator(page, book.publication, listeners as EpubNavigatorListeners, book.positions, entry ?? undefined, {
      preferences: preferences(look, font.family),
      defaults: {},
      injectables: {
        rules: [{ resources: [/.*/], prepend: [{ as: "link", rel: "stylesheet", blob: new Blob([font.css], { type: "text/css" }), target: "head" }] }],
        allowedDomains: [],
      },
    });
    await nav.load();
    if (at && entry) {
      const there = new Locator({ href: entry.href, type: at.type, title: at.title, locations: at.locations, text: at.text });
      await Promise.race([
        new Promise<void>(done => nav!.go(there, false, () => done())),
        new Promise<void>(done => window.setTimeout(done, GO_TIMEOUT_MS)),
      ]);
    }
    return !at || entry != null;
  };

  /** What you see changed: a new font or column count sets the page up again; anything else is applied as it is. */
  let restyling = Promise.resolve();
  const restyle = () => {
    restyling = restyling.then(async () => {
      if (!aa.hidden) await fillAa();
      if (!book || !nav) return;
      const look = shown(setup);
      if (look.font !== mountedFont || look.columns !== mountedColumns || look.scroll !== mountedScroll) {
        anchor ??= current;
        await mount(anchor);
      } else {
        const font = await appearance.font(look.font);
        fitPage(look);
        await nav.submitPreferences(new EpubPreferences(preferences(look, font.family)));
      }
    }).catch(() => undefined);
    return restyling;
  };

  // --- Opening ---

  try {
    // The book as this browser kept it, else from Dropbox (and kept). The place: as this browser
    // kept it, at once, with Dropbox's read alongside (WEB.md → Kept in this browser); else Dropbox's.
    const syncRead = readSyncFile();
    syncRead.catch(() => undefined);
    const [bytes, kept] = await Promise.all([bookFile(dropbox, id, props.path), keptValue<Position>(`place:${id}`)]);
    book = await openBook(bytes);
    if (kept) {
      if (!(await mount(Locator.deserialize(kept.locator) ?? null))) tell("Couldn't find your place in this book.");
      void syncRead.then(file => {
        if (closed) return;
        const next = afterKeptOpening(withCurrent(file), id, kept, moved, dismissedAt);
        if (next.moveTo) goThere(next.moveTo, true);
        // Started over on a phone (Mark as unread): back to the start, and this browser forgets its place.
        if (next.restart && book) {
          void keepValue(`place:${id}`, null);
          goTo(book.publication.readingOrder.items[0]?.href ?? "");
        }
        if (next.ask) ask(next.ask);
      }).catch(() => undefined);
    } else {
      const plan = openingPlan(await syncRead, null);
      if (plan.start) void keepValue(`place:${id}`, plan.start);
      const saved = plan.start ? Locator.deserialize(plan.start.locator) ?? null : null;
      if (!(await mount(saved))) tell("Couldn't find your place in this book.");
      if (plan.ask) ask(plan.ask);
    }
  } catch (e) {
    status.textContent = e instanceof Error ? e.message : String(e);
  }

  return close;
}

/** "1.0", "1.25", "0.5": at least one decimal, no trailing zeros (the app's labels). */
function fixed(value: number): string {
  const text = value.toFixed(2).replace(/0+$/, "");
  return text.endsWith(".") ? text + "0" : text;
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

/** A book's file: kept in this browser by its id (Dropbox's content hash), else downloaded and kept. */
async function bookFile(dropbox: Dropbox, id: string, path: string): Promise<Uint8Array> {
  const kept = await keptBook(id);
  if (kept) return kept;
  const file = await dropbox.download(path);
  if (!file) throw new Error("This book is no longer in Dropbox.");
  void keepBook(id, file.bytes);
  return file.bytes;
}
