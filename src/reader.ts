// The reader: a book from Dropbox, shown by Readium in Web's look, opened at Web's place, its
// place saved to the book's sync file a few seconds after the last page turn. Quiet for an office
// (WEB.md): no title on the page or in the browser tab, only the percentage.

import { EpubNavigator, EpubPreferences, type EpubNavigatorListeners } from "@readium/navigator";
import { Locator, LocatorLocations } from "@readium/shared";
import { applyLook, type Appearance, type FontChoice, type PageFont } from "./appearance";
import { RevConflict, type Dropbox } from "./dropbox";
import { currentEntry, flatToc, openBook, startPosition, type Book } from "./epub";
import {
  argb, cantRemove, edit, hex, isChanged, pageBackground, pageText, preferences, removeLook, restoreLook, saveAsNew,
  shown, step, stepOptional, STEPS, stepWeight, useLook, weightName, type Look, type Setup, type Steps,
} from "./looks";
import { syncFilePath } from "./paths";
import { openingPlan, positionFromLocator, withWebPlace, WEB_DEVICE_ID, type Position, type SyncFile } from "./sync";
import { h } from "./ui";

/** Uploads wait this long after the last page turn (the phones wait 5 s). */
export const UPLOAD_DELAY_MS = 4000;

type AaTab = "Text" | "Layout" | "Colour" | "Looks";

export interface ReaderProps {
  dropbox: Dropbox;
  appearance: Appearance;
  id: string;
  path: string;
  onClose: () => void;
}

export async function showReader(root: HTMLElement, props: ReaderProps): Promise<() => Promise<void>> {
  const { dropbox, id, appearance } = props;
  const status = h("div", { class: "foot" }, "Opening…");
  const prompt = h("div", { class: "msg", hidden: true });
  const page = h("div", { class: "page", id: "page" });
  const back = h("button", { class: "link back", onclick: () => close().then(props.onClose) }, "‹ Library");
  const left = h("button", { class: "side left", "aria-label": "Previous page" }, "‹");
  const right = h("button", { class: "side right", "aria-label": "Next page" }, "›");
  const contentsButton = h("button", { class: "link", "aria-expanded": "false" }, "Contents");
  const aaButton = h("button", { class: "link", "aria-expanded": "false" }, "Aa");
  const contents = h("div", { class: "toc", hidden: true });
  const aa = h("div", { class: "panel", hidden: true });
  root.replaceChildren(
    h("div", { class: "rbar" }, back, contentsButton, aaButton),
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
  let setup: Setup = await appearance.setup();
  let mountedFont: string | null = null;
  let mountedColumns = 1;
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
    stopListening();
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
  const goThere = (other: Position) => {
    const locator = Locator.deserialize(other.locator);
    const entry = locator && book ? startPosition(book.positions, locator) : null;
    if (!locator || !entry || !nav) return tell("Couldn't find that place in this book.");
    moved = true;
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
          choice("Columns", [1, 2].map(n => ({ name: String(n), on: look.columns === n, pick: () => change({ columns: n as 1 | 2 }) }))),
          stepped("Line spacing", "lineHeight", v => v.toFixed(1)),
          stepped("Margins", "margins", fixed),
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

  /** The page around the book takes the look's colours too. */
  const fitPage = (look: Look) => {
    page.classList.toggle("two", look.columns === 2);
    applyLook(look);
  };

  /**
   * Readium shown in the page, in what you see now, at [at]: it opens at an entry of its page
   * list (the chapter), and the exact spot follows, as Go there finds it. False when [at]'s
   * chapter isn't in the book.
   */
  const mount = async (at: Locator | null): Promise<boolean> => {
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
      await new Promise<void>(done => nav!.go(there, false, () => done()));
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
      if (look.font !== mountedFont || look.columns !== mountedColumns) {
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
    const [file, syncFile] = await Promise.all([dropbox.download(props.path), readSyncFile()]);
    if (!file) throw new Error("This book is no longer in Dropbox.");
    book = await openBook(file.bytes);
    const plan = openingPlan(syncFile, null);
    const saved = plan.start ? Locator.deserialize(plan.start.locator) ?? null : null;
    if (!(await mount(saved))) tell("Couldn't find your place in this book.");
    if (plan.ask) ask(plan.ask);
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
