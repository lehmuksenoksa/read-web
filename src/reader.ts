// The reader: a book from Dropbox, shown by Readium in Web's look, opened at Web's place, its
// place saved to the book's sync file a few seconds after the last page turn. Quiet for an office
// (WEB.md): no title on the page, only the percentage; the browser tab says "Read: <title>".

import { EpubNavigator, EpubPreferences, type EpubNavigatorListeners } from "@readium/navigator";
import { Locator, LocatorLocations } from "@readium/shared";
import { ChapterEdge, touchOnward, type Ends } from "./chapterEdge";
import { applyLook, type Appearance, type PageFont } from "./appearance";
import { RevConflict, type Dropbox } from "./dropbox";
import { currentEntry, flatToc, openBook, startPosition, type Book } from "./epub";
import { CATALOGUE } from "./fonts";
import {
  argb, BASE_FONT_PX, BUILT_IN_FONTS, canRename, charWidth, canSaveAs, cantRemove, CUSTOM_ID, CUSTOM_NAME, edit, hex, lookNamed, pageBackground, pageLayout, pageText,
  preferences, removeCustom, removeFont, removeLook, renameLook, replaceWithCustom, restoreCustom, restoreFont, restoreLook, SANS_FONTS,
  saveCustomAs, shown, step, stepOptional, STEPS, stepWeight, suggestedName, useLook, weightName, type Look, type Setup, type TextPosition, type Steps,
} from "./looks";
import { pageTop, withPageTop, type PageTop } from "./pagetop";
import { syncFilePath } from "./paths";
import { chapterHref, chapterIdOf, nextAfterCaughtUp } from "./serials";
import { keepBook, keptBook, keepValue, keptValue } from "./store";
import { afterKeptOpening, openingPlan, positionFromLocator, withWebPlace, WEB_DEVICE_ID, type Position, type SyncFile } from "./sync";
import { h, icon, ICONS } from "./ui";

/** Uploads wait this long after the last page turn (the phones wait 5 s). */
export const UPLOAD_DELAY_MS = 4000;
/** How long opening waits for Readium to find the place before showing the chapter as it is. */
const GO_TIMEOUT_MS = 8000;
/** The pages laid out again are shown this long after the last change: a window being resized, or a change in Aa. */
const SETTLE_MS = { resize: 120, aa: 20 };

type AaTab = "Text" | "Layout" | "Colour" | "Looks";

export interface ReaderProps {
  dropbox: Dropbox;
  appearance: Appearance;
  id: string;
  path: string;
  /** The book's title (the page and the browser tab show none: the tab says "Read.web"). */
  title: string;
  /** Where Contents and Aa go: the sidebar's top row, or over the page's top left (WEB.md, 2026-10-14). */
  tools: HTMLElement;
  /** The book's sync file as just uploaded with Web's place: the Library's progress follows. */
  onSaved?: (syncText: string) => void;
  /** A serial (WEB.md → Home, step 3b) instead of an EPUB from /Books/. */
  serial?: SerialReading;
}

/** What the reader needs of a serial. */
export interface SerialReading {
  open(): Book;
  syncPath: string;
  /** The chapter read to its end (CAUGHT UP): a place still in it opens at the next chapter. */
  endChapterId: string | null;
  /** A page turned past the end of the newest chapter (the href of the chapter that ended). */
  onPastEnd(href: string): void;
  /** The reader is in this chapter now (the next ones are fetched ahead). */
  onChapter(href: string): void;
}

/** The book in [root] (the pane beside the Library); returns how to close it, its place saved first. */
export async function showReader(root: HTMLElement, props: ReaderProps): Promise<() => Promise<void>> {
  const { dropbox, id, appearance } = props;
  const syncPath = props.serial?.syncPath ?? syncFilePath(id);
  const status = h("div", { class: "foot" }, "Opening…");
  const prompt = h("div", { class: "msg", hidden: true });
  const page = h("div", { class: "page", id: "page" });
  const left = h("button", { class: "side left", "aria-label": "Previous page" }, "‹");
  const right = h("button", { class: "side right", "aria-label": "Next page" }, "›");
  // Android's Contents icon and its "Aa" (Literata).
  const contentsButton = h("button", { class: "icon tool", title: "Contents", "aria-label": "Contents", "aria-expanded": "false" }, icon(ICONS.contents));
  const aaButton = h("button", { class: "icon tool aa", title: "Aa", "aria-label": "Aa", "aria-expanded": "false" }, "Aa");
  props.tools.replaceChildren(contentsButton, aaButton);
  const contents = h("div", { class: "toc", hidden: true });
  const aa = h("div", { class: "panel aapanel", hidden: true });
  const lookMenu = h("div", { class: "panel menu lookmenu", hidden: true });
  root.replaceChildren(
    h("div", { class: "rbar" }),
    h("div", { class: "stage" }, left, h("div", { class: "pagebox" }, page), right),
    contents,
    aa,
    lookMenu,
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
  /** What of the look lays out the pages, as last set up. */
  let mountedLayout = "";
  let aaTab: AaTab = "Text";
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
      const remote = await dropbox.readText(syncPath);
      try {
        const text = withWebPlace(remote?.text ?? null, id, place);
        await dropbox.writeText(syncPath, text, remote?.rev ?? null);
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
    props.tools.replaceChildren();
    rulerFont.remove();
    window.clearTimeout(settleTimer);
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
    if (forward) nav.goForward(false, ok => {
      // A serial read past the end of its newest chapter: CAUGHT UP.
      if (!ok && props.serial && current && book && current.href.split("#")[0] === book.readingOrder[book.readingOrder.length - 1]) props.serial.onPastEnd(current.href);
    });
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
    if (e.key === "Escape") return lookMenu.hidden ? closePanels() : void (lookMenu.hidden = true);
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
    // No percentage at the foot: the sidebar shows it (2026-10-14).
    status.textContent = "";
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
    const remote = await dropbox.readText(syncPath);
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
    lookMenu.hidden = true;
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
    if (!path.includes(lookMenu)) lookMenu.hidden = true;
    if ([lookMenu, contents, aa, contentsButton, aaButton, prompt].some(el => path.includes(el))) return;
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

  const lab = (text: string) => h("div", { class: "lab" }, text);
  const stepper = (label: string, value: string, down: (() => void) | null, up: (() => void) | null) =>
    h("div", { class: "r" }, label, h("span", { class: "st" },
      h("button", { "aria-label": `${label} down`, disabled: !down, onclick: () => down?.() }, icon(ICONS.minus)),
      h("i", {}, value),
      h("button", { "aria-label": `${label} up`, disabled: !up, onclick: () => up?.() }, icon(ICONS.plus))));
  const icons = (label: string, options: { name: string; icon: string; on: boolean; pick: () => void }[]) =>
    h("div", { class: "r" }, label, h("span", { class: "seg", role: "group", "aria-label": label },
      ...options.map(o => h("button", { class: o.on ? "on" : "", title: o.name, "aria-label": o.name, "aria-pressed": String(o.on), onclick: o.pick }, icon(o.icon)))));
  const switchRow = (label: string, on: boolean, set: (on: boolean) => void) =>
    h("div", { class: "r" }, label, h("button", { class: `switch${on ? " on" : ""}`, role: "switch", "aria-checked": String(on), "aria-label": label, onclick: () => set(!on) }));
  const stepped = (label: string, key: "fontSize" | "textWidth" | "lineHeight" | "letterSpacing" | "wordSpacing", format: (v: number) => string) => {
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
  const colourRow = (key: string, label: string, value: number, set: (color: number) => void) => {
    const input = h("input", { type: "color", value: hex(value), "aria-label": label });
    input.addEventListener("input", () => set(argb(input.value)));
    return h("div", { class: "r" }, label,
      h("label", { class: "colour", "data-colour": key }, h("span", { class: "hex" }, hex(value).toUpperCase()), h("span", { class: "dot", style: `background:${hex(value)}` }, input)));
  };
  const colours = (look: Look) => ({ background: pageBackground(look), text: pageText(look) });

  const fontRow = (family: string, look: Look, ready: string[], toDownload: string[]) => {
    if (ready.includes(family)) {
      const inUse = family === look.font;
      const removable = !inUse && !BUILT_IN_FONTS.includes(family);
      return h("div", {
        class: `r font${inUse ? " inuse" : ""}`, role: "button", tabindex: "0", "aria-pressed": String(inUse),
        onclick: () => change({ font: family }),
        onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") change({ font: family }); },
      }, h("span", { class: "nm" }, family),
      inUse ? h("span", { class: "ck" }, icon(ICONS.check))
        : removable ? h("button", { class: "rm", onclick: (e: Event) => { e.stopPropagation(); removeFontNow(family); } }, "Remove") : null);
    }
    if (!toDownload.includes(family)) return null;
    return h("div", { class: "r font off" }, h("span", { class: "nm" }, family), downloading.has(family)
      ? h("span", { class: "dl busy" }, "Downloading…")
      : h("button", { class: "dl", onclick: () => void download(family) }, "Download"));
  };

  const fillAa = async () => {
    const look = shown(setup);
    // Colour: changed where it is, so a colour picker being dragged stays open.
    const colourShown = aaTab === "Colour" ? aa.querySelectorAll<HTMLElement>("[data-colour]") : null;
    if (colourShown?.length) {
      const now = colours(look);
      for (const el of colourShown) {
        const value = hex(now[el.dataset.colour as "background" | "text"]);
        el.querySelector(".hex")!.textContent = value.toUpperCase();
        (el.querySelector(".dot") as HTMLElement).style.background = value;
        const input = el.querySelector("input")!;
        if (document.activeElement !== input) input.value = value;
      }
      return;
    }
    const tabs = h("div", { class: "tabs" }, ...(["Text", "Layout", "Colour", "Looks"] as AaTab[]).map(tab =>
      h("button", { class: tab === aaTab ? "cur" : "", onclick: () => { aaTab = tab; aa.replaceChildren(); void fillAa(); } }, tab)));
    let body: HTMLElement;
    switch (aaTab) {
      case "Text": {
        const [{ ready, toDownload }, font] = await Promise.all([appearance.fontChoices(setup.removedFonts), appearance.font(look.font)]);
        const listed = [...BUILT_IN_FONTS, ...CATALOGUE, ...ready.filter(f => !BUILT_IN_FONTS.includes(f) && !CATALOGUE.includes(f))];
        const rows = (sans: boolean) => listed.filter(f => SANS_FONTS.has(f) === sans).map(f => fontRow(f, look, ready, toDownload));
        body = h("div", { class: "sec" },
          lab("Serif"), ...rows(false),
          lab("Sans"), ...rows(true),
          lab("Size and weight"),
          stepped("Size", "fontSize", v => `${Math.round(v * 100)}%`),
          stepper("Weight", weightName(look.fontWeight),
            stepWeight(font.weights, look.fontWeight, false) !== look.fontWeight ? () => change({ fontWeight: stepWeight(font.weights, look.fontWeight, false) }) : null,
            stepWeight(font.weights, look.fontWeight, true) !== look.fontWeight ? () => change({ fontWeight: stepWeight(font.weights, look.fontWeight, true) }) : null));
        break;
      }
      case "Layout":
        body = h("div", { class: "sec" },
          lab("Page"),
          icons("Columns", [
            { name: "1 column", icon: ICONS.columns1, on: !look.scroll && look.columns === 1, pick: () => change({ columns: 1, scroll: false }) },
            { name: "2 columns", icon: ICONS.columns2, on: !look.scroll && look.columns === 2, pick: () => change({ columns: 2, scroll: false }) },
            { name: "Scroll", icon: ICONS.scroll, on: look.scroll, pick: () => change({ scroll: true }) },
          ]),
          icons("Position", ([["left", "Left", ICONS.posLeft], ["centre", "Centre", ICONS.posCentre], ["right", "Right", ICONS.posRight]] as [TextPosition, string, string][])
            .map(([p, name, glyph]) => ({ name, icon: glyph, on: look.position === p, pick: () => change({ position: p }) }))),
          stepped("Line spacing", "lineHeight", v => v.toFixed(1)),
          stepped("Text width", "textWidth", v => String(v)),
          lab("Paragraphs"),
          switchRow("Justify", look.justify, on => change({ justify: on })),
          switchRow("Hyphenation", look.hyphens, on => change({ hyphens: on })),
          optional("Paragraph spacing", "paragraphSpacing"),
          optional("First-line indent", "paragraphIndent"),
          lab("Spacing"),
          stepped("Letter spacing", "letterSpacing", v => v.toFixed(2)),
          stepped("Word spacing", "wordSpacing", v => v.toFixed(2)));
        break;
      case "Colour": {
        const now = colours(look);
        body = h("div", { class: "sec" },
          lab("Page"),
          colourRow("background", "Background", now.background, color => change({ background: "Custom", backgroundColor: color })),
          colourRow("text", "Text", now.text, color => change({ textColor: color })));
        break;
      }
      case "Looks": {
        const cards = [...setup.looks, ...(setup.custom ? [setup.custom] : [])];
        body = h("div", { class: "sec" },
          h("div", { class: "lookhead" }, h("span", {}, "Click to use · right-click for options"),
            setup.custom ? h("button", { class: "link strong", onclick: (e: Event) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); customMenu(r.right, r.bottom + 4, true); } }, "Save") : null),
          h("div", { class: "cards" }, ...cards.map(l => h("button", {
            class: `card${l.id === setup.lookId ? " inuse" : ""}`,
            style: `background:${hex(pageBackground(l))};color:${hex(pageText(l))}`,
            "aria-pressed": String(l.id === setup.lookId),
            onclick: () => { hideMenu(); appearance.update(useLook(setup, l.id)); },
            oncontextmenu: (e: Event) => {
              e.preventDefault();
              const at = e as MouseEvent;
              if (l.id === CUSTOM_ID) customMenu(at.clientX, at.clientY);
              else lookOptions(l.id, at.clientX, at.clientY);
            },
          }, h("span", { class: "s" }, "Aa"), h("span", { class: "n" }, l.name)))));
        break;
      }
    }
    aa.replaceChildren(tabs, body);
  };

  /** Download: the font goes to Dropbox (a removed one is still there), then it's used. */
  const download = async (family: string) => {
    downloading.add(family);
    void fillAa();
    try {
      await appearance.download(family);
      if (setup.removedFonts.includes(family)) appearance.update(restoreFont(setup, family));
      change({ font: family });
    } catch {
      tell(`Couldn't download ${family}. Try again later.`);
    } finally {
      downloading.delete(family);
      void fillAa();
    }
  };

  /** Remove: the font leaves the list and this browser; the looks using it use Bookerly. */
  const removeFontNow = (family: string) => {
    const done = removeFont(setup, family);
    if (!done) return;
    appearance.update(done.setup);
    void appearance.forget(family);
    tell(`Removed ${family}`, { label: "Undo", run: () => appearance.update(restoreFont(setup, family, done.switched)) });
  };

  // A look's options (right-click), and Custom's (right-click or Save): a small menu by the pointer.

  const hideMenu = () => { lookMenu.hidden = true; };
  const showMenu = (x: number, y: number, alignRight: boolean, ...children: (HTMLElement | null)[]) => {
    lookMenu.replaceChildren(...children.filter((c): c is HTMLElement => c != null));
    lookMenu.hidden = false;
    const box = lookMenu.getBoundingClientRect();
    const left = alignRight ? x - box.width : x;
    lookMenu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - box.width - 8))}px`;
    lookMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
  };
  const item = (label: string, run: () => void) => h("button", { class: "r", onclick: run }, label);
  /** A name to type: [label] on the button, or what [buttonLabel] says for the name typed; null when it can't be used. */
  const nameForm = (title: string, name: string, buttonLabel: (name: string) => string | null, done: (name: string) => void, x: number, y: number) => {
    const input = h("input", { value: name, "aria-label": title, spellcheck: "false" });
    const button = h("button", { class: "btn primary" }, "");
    const check = () => {
      const label = buttonLabel(input.value);
      button.textContent = label ?? buttonLabel(name) ?? "Save";
      button.disabled = label == null;
    };
    const submit = () => { if (!button.disabled) { hideMenu(); done(input.value.trim()); } };
    input.addEventListener("input", check);
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); if (e.key === "Escape") { e.stopPropagation(); hideMenu(); } });
    button.addEventListener("click", submit);
    check();
    showMenu(x, y, false, lab(title), input, h("div", { class: "btns" }, button));
    input.focus();
    input.select();
  };
  const lookOptions = (id: string, x: number, y: number) => {
    const look = setup.looks.find(l => l.id === id);
    if (!look) return;
    showMenu(x, y, false,
      lab(look.name),
      setup.custom ? item("Replace with Custom", () => { hideMenu(); appearance.update(replaceWithCustom(setup, id)); }) : null,
      item("Rename", () => {
        const at = lookMenu.getBoundingClientRect();
        nameForm("Rename", look.name, name => canRename(setup, id, name) ? "Rename" : null, name => appearance.update(renameLook(setup, id, name)), at.left, at.top);
      }),
      cantRemove(setup, id) ? null : item("Remove", () => { hideMenu(); remove(id); }));
  };
  const customMenu = (x: number, y: number, alignRight = false) => {
    if (!setup.custom) return;
    showMenu(x, y, alignRight,
      lab(CUSTOM_NAME),
      item("Save as…", () => {
        const at = lookMenu.getBoundingClientRect();
        nameForm("Save as", suggestedName(setup), name => !canSaveAs(name) ? null : lookNamed(setup, name) ? "Replace" : "Save", name => appearance.update(saveCustomAs(setup, name)), at.left, at.top);
      }),
      item("Remove", () => {
        hideMenu();
        const done = removeCustom(setup);
        if (!done) return;
        appearance.update(done.setup);
        tell("Removed Custom", { label: "Undo", run: () => appearance.update(restoreCustom(setup, done.removed)) });
      }));
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
      props.serial?.onChapter(locator.href);
      showPlace();
      if (moved) scheduleUpload();
    },
    tap: () => pageClicked(),
    click: () => pageClicked(),
    // Links to other sites aren't followed from a book; a serial's link to its site opens in a new tab.
    handleLocator: (locator: Locator) => {
      const href = locator.href;
      if (props.serial && /^https:\/\/(www\.)?(royalroad\.com|patreon\.com)\//.test(href)) window.open(href, "_blank", "noopener,noreferrer");
      return true;
    },
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

  // --- The page's width: the look's characters per line, measured in its font (2026-10-14) ---

  /** English prose: its average character, as a line of a book has it. */
  const SAMPLE = "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.";
  /** The look's font in this page too, under its own name, only to measure it. */
  const rulerFont = h("style", {});
  document.head.append(rulerFont);
  const ruler = document.createElement("canvas").getContext("2d");
  let charPx = 0;
  let measured = "";
  const measure = async (look: Look, font: PageFont) => {
    const key = [font.family, look.fontWeight, look.fontSize, look.letterSpacing, look.wordSpacing].join("|");
    if (key === measured) return;
    const css = font.css.replaceAll(`font-family: "${font.family}"`, 'font-family: "read-ruler"');
    if (rulerFont.textContent !== css) rulerFont.textContent = css;
    const spec = `${look.fontWeight} ${BASE_FONT_PX * look.fontSize}px "read-ruler"`;
    await document.fonts.load(spec, SAMPLE).catch(() => undefined);
    const width = ruler ? ((ruler.font = `${spec}, serif`), ruler.measureText(SAMPLE).width) : SAMPLE.length * BASE_FONT_PX * look.fontSize * 0.5;
    charPx = charWidth(width, SAMPLE, look);
    measured = key;
  };

  /**
   * The page as wide as the look's text and placed by its position, the ‹ › beside it, the look's
   * colours around it. A new width lays the pages out again: the place is held (keepPlace).
   */
  let pageWidth = 0;
  const fitPage = (look: Look, settleMs = SETTLE_MS.resize) => {
    const at = pageLayout(stage.clientWidth, look, charPx || BASE_FONT_PX * look.fontSize * 0.5);
    if (pageWidth && at.page !== pageWidth && !mounting) keepPlace(settleMs);
    pageWidth = at.page;
    (page.parentElement as HTMLElement).style.width = `${at.page}px`;
    for (const [arrow, width] of [[left, at.left], [right, at.right]] as const) {
      arrow.style.flex = `0 0 ${width}px`;
      arrow.style.minWidth = "0";
      // Scrolling, ‹ › aren't there (they'd jump a whole chapter); their space stays, so the text doesn't move.
      arrow.style.visibility = look.scroll ? "hidden" : "";
      arrow.disabled = look.scroll;
    }
    applyLook(look);
  };

  /**
   * The pages laid out again (a new width, text size or spacing): the page is hidden meanwhile and
   * comes back at the words that were at its top, not where Readium's share of the chapter lands
   * (2026-10-14: hiding the sidebar or a change in Aa went back a page, with a flash of the
   * chapter's start). The place is held until a page is turned, so changes never creep.
   */
  let settleTimer: number | undefined;
  const heldPlace = (): Locator | null => {
    if (!current) return null;
    return anchor ??= Locator.deserialize(withPageTop(current.serialize() as Record<string, unknown>, currentTop)) ?? current;
  };
  const keepPlace = (settleMs: number) => {
    if (!nav || !heldPlace()) return;
    page.style.visibility = "hidden";
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => void settle(), settleMs);
  };
  const settle = async () => {
    const at = anchor;
    const entry = at && book ? startPosition(book.positions, at) : null;
    if (at && entry && nav) {
      const there = new Locator({ href: entry.href, type: at.type, title: at.title, locations: at.locations, text: at.text });
      await Promise.race([
        new Promise<void>(done => nav!.go(there, false, () => done())),
        new Promise<void>(done => window.setTimeout(done, GO_TIMEOUT_MS)),
      ]);
    }
    page.style.visibility = "";
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
    await measure(look, font);
    if (nav) {
      await nav.destroy();
      page.replaceChildren();
    }
    fitPage(look);
    mountedFont = look.font;
    mountedColumns = look.columns;
    mountedScroll = look.scroll;
    mountedLayout = textLayout(look);
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
        await mount(heldPlace());
      } else {
        const font = await appearance.font(look.font);
        await measure(look, font);
        // Anything but colours and position lays the pages out again.
        const layout = textLayout(look);
        if (layout !== mountedLayout) keepPlace(SETTLE_MS.aa);
        mountedLayout = layout;
        fitPage(look, SETTLE_MS.aa);
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
    const [opened, kept] = await Promise.all([
      props.serial ? props.serial.open() : bookFile(dropbox, id, props.path).then(openBook),
      keptValue<Position>(`place:${id}`),
    ]);
    book = opened;
    /** A CAUGHT UP serial whose newer chapters have come opens at the first of them, which becomes the place. */
    const pastCaughtUp = (at: Locator | null): Locator | null => {
      const next = props.serial && book && at ? nextAfterCaughtUp(book.readingOrder.map(h => chapterIdOf(h) ?? ""), chapterIdOf(at.href), props.serial.endChapterId) : null;
      if (!next || !at) return at;
      moved = true;
      return new Locator({ href: chapterHref(next), type: at.type, locations: new LocatorLocations({ progression: 0 }) });
    };
    if (kept) {
      if (!(await mount(pastCaughtUp(Locator.deserialize(kept.locator) ?? null)))) tell("Couldn't find your place in this book.");
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
      const saved = pastCaughtUp(plan.start ? Locator.deserialize(plan.start.locator) ?? null : null);
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

/** The look's settings that lay out the pages (not its colours, name or position). */
function textLayout(look: Look): string {
  const { id, name, background, backgroundColor, textColor, position, ...layout } = look;
  void id; void name; void background; void backgroundColor; void textColor; void position;
  return JSON.stringify(layout);
}
