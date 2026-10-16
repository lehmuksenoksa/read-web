// An EPUB in the page's memory, handed to Readium as a publication: the OPF becomes Readium's
// manifest, and the book's files come from the zip. Places are Readium locators, as in the app.

import { Fetcher, Link, Locator, Manifest, Publication, Resource } from "@readium/shared";
import { Zip } from "./zip";
import { blankPage } from "./quietBook";

/** A made-up address the book's paths are resolved against; nothing is ever fetched from it. */
const BOOK_ROOT = "https://book.invalid/";

/** [href] (as written in [from], e.g. the OPF) as a path in the zip, kept URL-encoded like the app's hrefs. */
export function resolveHref(from: string, href: string): string {
  const url = new URL(href, BOOK_ROOT + from);
  return url.pathname.slice(1);
}

/** A zip entry's name for an href (hrefs are URL-encoded; names aren't). */
export function entryName(href: string): string {
  const path = href.split("#")[0].split("?")[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Readium's positions, counted the way the app's Readium (Kotlin) counts them: one per 1024 bytes of the zip entry. */
export const PAGE_LENGTH = 1024;

export interface PositionItem {
  href: string;
  type: string;
  title?: string;
}

export function positionsOf(readingOrder: PositionItem[], entryLength: (href: string) => number): Record<string, unknown>[] {
  const counts = readingOrder.map(item => Math.max(1, Math.ceil(entryLength(item.href) / PAGE_LENGTH)));
  const total = counts.reduce((a, b) => a + b, 0);
  const positions: Record<string, unknown>[] = [];
  let position = 1;
  readingOrder.forEach((item, i) => {
    for (let n = 0; n < counts[i]; n++) {
      positions.push({
        href: item.href,
        type: item.type,
        ...(item.title ? { title: item.title } : {}),
        locations: { progression: n / counts[i], position, totalProgression: (position - 1) / total },
      });
      position++;
    }
  });
  return positions;
}

/** A place in the book's page list (Readium's positions): its chapter and the progress within it. */
export interface PositionLike {
  href: string;
  locations: { progression?: number };
}

function sameHref(a: string, b: string): boolean {
  return a.split("#")[0] === b.split("#")[0] || entryName(a) === entryName(b);
}

/**
 * The entry of Readium's page list to open [place] at: its chapter's last page starting at or
 * before the place's progress. Places from the phones may carry no page number (a place saved by
 * listening has none), and Readium opens only at an entry of its list. Null when the chapter
 * isn't in this book.
 */
export function startPosition<T extends PositionLike>(positions: T[], place: PositionLike): T | null {
  const chapter = positions.filter(p => sameHref(p.href, place.href));
  if (!chapter.length) return null;
  const progression = place.locations.progression ?? 0;
  return [...chapter].reverse().find(p => (p.locations.progression ?? 0) <= progression + 1e-9) ?? chapter[0];
}

export interface Book {
  publication: Publication;
  positions: Locator[];
  /** Chapter titles by href, from the table of contents (for the prompt). */
  titles: Map<string, string>;
  /** The book's contents. */
  toc: TocEntry[];
  /** The chapters' hrefs, in reading order. */
  readingOrder: string[];
  /** The chapter has nothing to read once images are hidden (Office turns past it); not for serials. */
  blank?(href: string): Promise<boolean>;
  close(): void;
}

const XHTML = "application/xhtml+xml";

/** Opens an EPUB's bytes as a Readium publication. */
export async function openBook(bytes: Uint8Array): Promise<Book> {
  const zip = new Zip(bytes);
  const container = parseXml(await zip.text("META-INF/container.xml"));
  const opfPath = container.getElementsByTagNameNS("*", "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("No package document in this EPUB");
  const opf = parseXml(await zip.text(opfPath));

  const items = new Map<string, { href: string; type: string; properties: string }>();
  for (const item of Array.from(opf.getElementsByTagNameNS("*", "item"))) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;
    items.set(id, { href: resolveHref(opfPath, href), type: item.getAttribute("media-type") ?? "", properties: item.getAttribute("properties") ?? "" });
  }
  const spine = opf.getElementsByTagNameNS("*", "spine")[0];
  const readingOrder: PositionItem[] = [];
  for (const ref of Array.from(spine?.getElementsByTagNameNS("*", "itemref") ?? [])) {
    const item = items.get(ref.getAttribute("idref") ?? "");
    if (item) readingOrder.push({ href: item.href, type: item.type || XHTML });
  }
  if (!readingOrder.length) throw new Error("This EPUB has no chapters");
  const inOrder = new Set(readingOrder.map(r => r.href));
  const resources = [...items.values()].filter(i => !inOrder.has(i.href)).map(i => ({ href: i.href, type: i.type }));

  const meta = (name: string) => opf.getElementsByTagNameNS("*", name)[0]?.textContent?.trim();
  const direction = spine?.getAttribute("page-progression-direction");
  const layout = Array.from(opf.getElementsByTagNameNS("*", "meta")).find(m => m.getAttribute("property") === "rendition:layout")?.textContent?.trim();
  const { toc, titles } = await tableOfContents(zip, items, spine?.getAttribute("toc") ?? null);

  const manifestJson = {
    metadata: {
      // An EPUB: Readium then knows its layout (reflowable unless pre-paginated), which scrolling needs.
      conformsTo: ["https://readium.org/webpub-manifest/profiles/epub"],
      title: meta("title") ?? "Book",
      identifier: meta("identifier"),
      language: meta("language") ?? "en",
      ...(direction === "rtl" || direction === "ltr" ? { readingProgression: direction } : {}),
      ...(layout === "pre-paginated" ? { layout: "fixed" } : {}),
    },
    // The page's own address: the chapters' base address stays inside the page's Content Security Policy.
    links: [{ rel: "self", href: `${location.origin}${import.meta.env.BASE_URL}book/manifest.json`, type: "application/webpub+json" }],
    readingOrder,
    resources,
  };
  const manifest = Manifest.deserialize(manifestJson);
  if (!manifest) throw new Error("Couldn't read this EPUB");
  const fetcher = new ZipFetcher(zip);
  const publication = new Publication({ manifest, fetcher });
  const lengths = (href: string) => zip.entries.get(entryName(href))?.compressedSize ?? 0;
  const positions = positionsOf(readingOrder.map(r => ({ ...r, title: titles.get(r.href) })), lengths)
    .map(p => Locator.deserialize(p)!)
    .filter(Boolean);
  const blank = async (href: string) => blankPage(await zip.text(entryName(href)));
  return { publication, positions, titles, toc, readingOrder: readingOrder.map(r => r.href), blank, close: () => fetcher.close() };
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("This EPUB's files can't be read");
  return doc;
}

/** One line of the book's contents: its title, where it goes (href, maybe with a fragment) and its sections. */
export interface TocEntry {
  title: string;
  href: string;
  children: TocEntry[];
}

const OPS = "http://www.idpf.org/2007/ops";

/** The book's contents from the EPUB 3 nav or the EPUB 2 NCX, and chapter titles by href (without fragments). */
async function tableOfContents(zip: Zip, items: Map<string, { href: string; type: string; properties: string }>, ncxId: string | null): Promise<{ toc: TocEntry[]; titles: Map<string, string> }> {
  const clean = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
  let toc: TocEntry[] = [];
  try {
    const nav = [...items.values()].find(i => i.properties.split(/\s+/).includes("nav"));
    if (nav) {
      const doc = new DOMParser().parseFromString(await zip.text(entryName(nav.href)), XHTML);
      const navs = Array.from(doc.getElementsByTagName("nav"));
      const tocNav = navs.find(n => (n.getAttributeNS(OPS, "type") ?? n.getAttribute("epub:type") ?? "").split(/\s+/).includes("toc")) ?? navs[0];
      const list = (ol: Element | null): TocEntry[] => Array.from(ol?.children ?? []).filter(li => li.localName === "li").flatMap(li => {
        const label = Array.from(li.children).find(c => c.localName === "a" || c.localName === "span");
        const sub = Array.from(li.children).find(c => c.localName === "ol") ?? null;
        const ref = label?.getAttribute("href");
        const children = list(sub);
        if (!ref) return children.length ? [{ title: clean(label?.textContent), href: children[0].href, children }] : [];
        return [{ title: clean(label?.textContent), href: resolveHrefKeepingFragment(nav.href, ref), children }];
      });
      toc = list(Array.from(tocNav?.children ?? []).find(c => c.localName === "ol") ?? null);
    }
    const ncx = (ncxId && items.get(ncxId)) || [...items.values()].find(i => i.type === "application/x-dtbncx+xml");
    if (!toc.length && ncx) {
      const doc = parseXml(await zip.text(entryName(ncx.href)));
      const points = (parent: Element): TocEntry[] => Array.from(parent.children).filter(c => c.localName === "navPoint").flatMap(point => {
        const src = Array.from(point.children).find(c => c.localName === "content")?.getAttribute("src");
        const label = Array.from(point.children).find(c => c.localName === "navLabel");
        if (!src) return points(point);
        return [{ title: clean(label?.textContent), href: resolveHrefKeepingFragment(ncx.href, src), children: points(point) }];
      });
      const map = doc.getElementsByTagNameNS("*", "navMap")[0];
      if (map) toc = points(map);
    }
  } catch {
    // No contents: the prompt shows the percentage only, Contents lists the chapters by name.
  }
  const titles = new Map<string, string>();
  const walk = (entries: TocEntry[]) => entries.forEach(e => {
    const key = e.href.split("#")[0];
    if (e.title && !titles.has(key)) titles.set(key, e.title);
    walk(e.children);
  });
  walk(toc);
  return { toc, titles };
}

/** [resolveHref], keeping a `#fragment` (a section inside a chapter). */
function resolveHrefKeepingFragment(from: string, href: string): string {
  const hash = href.indexOf("#");
  return resolveHref(from, href) + (hash >= 0 ? href.slice(hash) : "");
}

/** The entries in reading order, flattened. */
export function flatToc(toc: TocEntry[], depth = 0): { entry: TocEntry; depth: number }[] {
  return toc.flatMap(entry => [{ entry, depth }, ...flatToc(entry.children, depth + 1)]);
}

/**
 * Which entry of the contents the reader is in: the first one for [href]'s chapter, else the
 * last one before it in reading order. -1 before the first.
 */
export function currentEntry(flat: { entry: TocEntry }[], readingOrder: string[], href: string): number {
  const base = (h: string) => entryName(h.split("#")[0]);
  const here = base(href);
  const exact = flat.findIndex(f => base(f.entry.href) === here);
  if (exact >= 0) return exact;
  const index = readingOrder.findIndex(h => base(h) === here);
  let found = -1;
  flat.forEach((f, i) => {
    const at = readingOrder.findIndex(h => base(h) === base(f.entry.href));
    if (at >= 0 && at <= index) found = i;
  });
  return found;
}

/** Elements that hold a paragraph's text: the app's PageDress.TEXT_BLOCKS. */
const TEXT_BLOCKS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dd", "dt", "td", "th", "caption",
  "blockquote", "pre", "figcaption", "section", "article", "aside", "header", "footer", "address", "center",
]);

export interface NamedNode {
  localName: string;
  id: string;
  readonly children: ArrayLike<NamedNode>;
}

/**
 * Names every text block without an id `read-b1`, `read-b2`… in page order, skipping ids the
 * page has: exactly as the app does (PageDress.nameBlocks), so a place saved on the S23 or the
 * Boox names the same paragraph here (its selector is `#read-bN`). [taken]: every id in the page.
 */
export function nameBlocks(body: NamedNode, taken: Set<string>): void {
  let n = 0;
  const visit = (el: NamedNode) => {
    for (const child of Array.from(el.children)) {
      if (TEXT_BLOCKS.has(child.localName.toLowerCase()) && !child.id) {
        let id: string;
        do id = `read-b${++n}`; while (taken.has(id));
        child.id = id;
      }
      visit(child);
    }
  };
  visit(body);
}

/**
 * The book's files for Readium, from the zip. Chapters are cleaned before Readium shows them:
 * no scripts or script attributes (WEB.md: book pages can't run scripts), and their images,
 * stylesheets and fonts point to in-memory copies (blob: addresses), never to a server.
 */
/** Where a book's files come from: an EPUB's zip, or a serial's chapters in Dropbox. */
export interface BookFiles {
  has(name: string): boolean;
  read(name: string): Promise<Uint8Array>;
}

export class ZipFetcher implements Fetcher {
  private readonly blobs = new Map<string, Promise<string>>();
  private readonly urls: string[] = [];

  constructor(private readonly zip: BookFiles) {}

  links(): Link[] {
    return [];
  }

  get(link: Link): Resource {
    return new ZipResource(this, link);
  }

  close(): void {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.length = 0;
    this.blobs.clear();
  }

  async bytes(href: string): Promise<Uint8Array> {
    return this.zip.read(entryName(href));
  }

  has(href: string): boolean {
    return this.zip.has(entryName(href));
  }

  /** An in-memory address for the file at [href]; stylesheets have their own references rewritten too. */
  blobUrl(href: string): Promise<string> {
    const key = href.split("#")[0];
    let url = this.blobs.get(key);
    if (!url) {
      url = (async () => {
        let data: BlobPart = (await this.bytes(key)) as BlobPart;
        const type = mediaTypeOf(key);
        if (type === "text/css") data = await this.rewriteCss(new TextDecoder().decode(data as Uint8Array), key);
        const made = URL.createObjectURL(new Blob([data], { type }));
        this.urls.push(made);
        return made;
      })();
      this.blobs.set(key, url);
    }
    return url;
  }

  /** `url(...)` and `@import` in a stylesheet at [base], pointed to in-memory copies. */
  async rewriteCss(css: string, base: string): Promise<string> {
    const refs = new Set<string>();
    css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m, _q, ref: string) => { refs.add(ref); return ""; });
    css.replace(/@import\s+(['"])([^'"]+)\1/g, (_m, _q, ref: string) => { refs.add(ref); return ""; });
    const map = new Map<string, string>();
    for (const ref of refs) {
      const target = this.local(base, ref);
      if (target) map.set(ref, await this.blobUrl(target));
      else if (!ref.startsWith("data:") && !ref.startsWith("#")) map.set(ref, "about:invalid");
    }
    return css
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref: string) => (map.has(ref) ? `url(${q}${map.get(ref)}${q})` : m))
      .replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, ref: string) => (map.has(ref) ? `@import ${q}${map.get(ref)}${q}` : m));
  }

  /** [ref] in the file at [base] as a path in the book, or null when it isn't one (another site, data:). */
  local(base: string, ref: string): string | null {
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//") || ref.startsWith("#")) return null;
    const href = resolveHref(base, ref);
    return this.has(href) ? href : null;
  }

  /** A chapter as Readium will show it: cleaned, with its files in memory. */
  async chapter(href: string, type: string): Promise<Uint8Array> {
    const text = new TextDecoder().decode(await this.bytes(href));
    const html = type.includes("html") && !type.includes("xhtml");
    let doc = new DOMParser().parseFromString(text, html ? "text/html" : XHTML);
    if (doc.getElementsByTagName("parsererror").length) doc = new DOMParser().parseFromString(text, "text/html");
    const body = doc.querySelector("body");
    if (body) nameBlocks(body, new Set(Array.from(doc.querySelectorAll("[id]")).map(el => el.id)));
    for (const el of Array.from(doc.querySelectorAll("script, noscript, iframe, object, embed, frame, frameset, base, meta[http-equiv]"))) el.remove();
    for (const el of Array.from(doc.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith("on") || value.startsWith("javascript:") || (value.startsWith("data:") && value.includes("html"))) el.removeAttribute(attr.name);
      }
    }
    const point = async (el: Element, attr: string) => {
      const ref = el.getAttribute(attr);
      if (!ref) return;
      const target = this.local(href, ref);
      if (target) el.setAttribute(attr, await this.blobUrl(target));
      else if (!ref.startsWith("data:") && !ref.startsWith("#")) el.removeAttribute(attr);
    };
    for (const el of Array.from(doc.querySelectorAll("img[src], image, audio[src], video[src], source[src], track[src], input[src]"))) {
      await point(el, "src");
      if (el.hasAttribute("srcset")) el.removeAttribute("srcset");
      if (el.localName === "image") {
        await point(el, "href");
        if (el.hasAttributeNS("http://www.w3.org/1999/xlink", "href")) {
          const ref = el.getAttributeNS("http://www.w3.org/1999/xlink", "href")!;
          const target = this.local(href, ref);
          if (target) el.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", await this.blobUrl(target));
          else el.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
        }
      }
    }
    for (const el of Array.from(doc.querySelectorAll("video[poster]"))) await point(el, "poster");
    for (const el of Array.from(doc.querySelectorAll("link[href]"))) {
      const rel = (el.getAttribute("rel") ?? "").toLowerCase();
      if (rel.includes("stylesheet")) await point(el, "href");
      else el.remove();
    }
    for (const el of Array.from(doc.querySelectorAll("style"))) el.textContent = await this.rewriteCss(el.textContent ?? "", href);
    for (const el of Array.from(doc.querySelectorAll("[style]"))) el.setAttribute("style", await this.rewriteCss(el.getAttribute("style")!, href));
    const out = html && doc.documentElement.namespaceURI !== "http://www.w3.org/1999/xhtml"
      ? "<!DOCTYPE html>" + doc.documentElement.outerHTML
      : new XMLSerializer().serializeToString(doc);
    return new TextEncoder().encode(out);
  }
}

class ZipResource extends Resource {
  constructor(private readonly fetcher: ZipFetcher, private readonly _link: Link) {
    super();
  }

  async link(): Promise<Link> {
    return this._link;
  }

  async length(): Promise<number | undefined> {
    return (await this.read())?.length;
  }

  async read(): Promise<Uint8Array | undefined> {
    const href = this._link.href.split("#")[0];
    const type = this._link.type ?? mediaTypeOf(href);
    if (type.includes("html")) return this.fetcher.chapter(href, type);
    return this.fetcher.bytes(href);
  }

  close(): void {}
}

const TYPES: Record<string, string> = {
  css: "text/css", xhtml: XHTML, html: "text/html", htm: "text/html", jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", ttf: "font/ttf", otf: "font/otf",
  woff: "font/woff", woff2: "font/woff2", mp3: "audio/mpeg", mp4: "video/mp4",
};

export function mediaTypeOf(href: string): string {
  const ext = entryName(href).split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}
