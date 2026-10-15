// A serial as a book for the reader (WEB.md → Home, step 3b): its readable chapters in the site's
// order, at the phones' hrefs (`ch/<id>.xhtml`), each read from Dropbox when Readium wants it (or
// from this browser, once read); a chapter no phone has put there yet is a short page linking to
// the site. Page numbers are estimated from the chapters' sizes, as the phones do.

import { Locator, Manifest, Publication } from "@readium/shared";
import { positionsOf, ZipFetcher, type Book, type BookFiles, type TocEntry } from "./epub";
import { AUTHOR_NOTE_CLASS, chapterHref, estimatedLengths, missingChapterPage, readingOrderOf, type SharedChapter } from "./serials";

const XHTML = "application/xhtml+xml";

export interface SerialSource {
  id: string;
  title: string;
  author: string | null;
  site: string;
  chapters: SharedChapter[];
  /** Chapter ids in Dropbox now. */
  inDropbox: Set<string>;
  keepNotes: boolean;
  /** A chapter's text from Dropbox (or this browser); null when it isn't there. */
  text(chapterId: string): Promise<string | null>;
}

/** Opens [serial] as a book. */
export function openSerial(serial: SerialSource): Book {
  const order = readingOrderOf(serial.chapters);
  if (!order.length) throw new Error("No chapters from the phones yet.");
  const byHref = new Map(order.map(c => [chapterHref(c.id), c]));
  const files: BookFiles = {
    has: name => byHref.has(name),
    read: async name => {
      const chapter = byHref.get(name);
      if (!chapter) throw new Error(`Not in this serial: ${name}`);
      const text = serial.inDropbox.has(chapter.id) ? await serial.text(chapter.id).catch(() => null) : null;
      if (text == null) return new TextEncoder().encode(missingChapterPage(chapter.title, chapter.url, serial.site));
      return new TextEncoder().encode(serial.keepNotes ? text : withoutNotes(text));
    },
  };
  const readingOrder = order.map(c => ({ href: chapterHref(c.id), type: XHTML, title: c.title }));
  const manifest = Manifest.deserialize({
    metadata: {
      conformsTo: ["https://readium.org/webpub-manifest/profiles/epub"],
      title: serial.title,
      identifier: serial.id,
      language: "en",
      ...(serial.author ? { author: serial.author } : {}),
    },
    // The page's own address: the chapters' base address stays inside the page's Content Security Policy.
    links: [{ rel: "self", href: `${location.origin}${import.meta.env.BASE_URL}book/manifest.json`, type: "application/webpub+json" }],
    readingOrder,
    resources: [],
  });
  if (!manifest) throw new Error("Couldn't open this serial");
  const fetcher = new ZipFetcher(files);
  const publication = new Publication({ manifest, fetcher });
  const lengths = estimatedLengths(order);
  const lengthOf = new Map(readingOrder.map((r, i) => [r.href, lengths[i]]));
  const positions = positionsOf(readingOrder, href => lengthOf.get(href) ?? 0).map(p => Locator.deserialize(p)!).filter(Boolean);
  const toc: TocEntry[] = readingOrder.map(r => ({ title: r.title, href: r.href, children: [] }));
  return { publication, positions, titles: new Map(readingOrder.map(r => [r.href, r.title])), toc, readingOrder: readingOrder.map(r => r.href), close: () => fetcher.close() };
}

/** The chapter without authors' notes (the phones mark them with a class). */
function withoutNotes(xhtml: string): string {
  if (!xhtml.includes(AUTHOR_NOTE_CLASS)) return xhtml;
  const doc = new DOMParser().parseFromString(xhtml, XHTML);
  if (doc.getElementsByTagName("parsererror").length) return xhtml;
  for (const el of Array.from(doc.querySelectorAll(`div.${AUTHOR_NOTE_CLASS}`))) el.remove();
  return new XMLSerializer().serializeToString(doc);
}
