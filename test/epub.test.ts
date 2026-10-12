import { describe, expect, it } from "vitest";
import { currentEntry, entryName, flatToc, mediaTypeOf, nameBlocks, PAGE_LENGTH, positionsOf, resolveHref, startPosition } from "../src/epub";

describe("paths in the book", () => {
  it("resolve like the app's hrefs, staying URL-encoded", () => {
    expect(resolveHref("OEBPS/content.opf", "Text/ch1.xhtml")).toBe("OEBPS/Text/ch1.xhtml");
    expect(resolveHref("OEBPS/Text/ch1.xhtml", "../Images/a%20b.jpg")).toBe("OEBPS/Images/a%20b.jpg");
    expect(resolveHref("content.opf", "ch1.xhtml#x")).toBe("ch1.xhtml");
    expect(entryName("OEBPS/Images/a%20b.jpg#x")).toBe("OEBPS/Images/a b.jpg");
    expect(mediaTypeOf("OEBPS/style.CSS")).toBe("text/css");
  });
});

describe("positions", () => {
  it("are counted as the app's Readium counts them: one per 1024 bytes of the zip entry", () => {
    const sizes: Record<string, number> = { "a.xhtml": PAGE_LENGTH, "b.xhtml": PAGE_LENGTH + 1, "c.xhtml": 0 };
    const order = Object.keys(sizes).map(href => ({ href, type: "application/xhtml+xml" }));
    const positions = positionsOf(order, href => sizes[href]);
    expect(positions.map(p => p.href)).toEqual(["a.xhtml", "b.xhtml", "b.xhtml", "c.xhtml"]);
    expect(positions.map(p => (p.locations as Record<string, number>).position)).toEqual([1, 2, 3, 4]);
    expect(positions.map(p => (p.locations as Record<string, number>).progression)).toEqual([0, 0, 0.5, 0]);
    expect(positions.map(p => (p.locations as Record<string, number>).totalProgression)).toEqual([0, 0.25, 0.5, 0.75]);
  });
});

describe("paragraph names", () => {
  type Node = { localName: string; id: string; children: Node[] };
  const el = (name: string, ...children: Node[]): Node => ({ localName: name, id: "", children });
  const withId = (node: Node, id: string) => ({ ...node, id });
  const all = (node: Node): Node[] => [node, ...node.children.flatMap(all)];

  it("are the app's, so a place from the phones finds the same paragraph", () => {
    // The page of the app's PageDressTest.paragraphNamesNeverChange, with the same expected names.
    const body = el("body",
      el("h1"), el("p"), el("div", el("p"), el("blockquote", el("p"))),
      el("ul", el("li")), el("table", el("tr", el("th"), el("td"))), withId(el("p"), "own"), el("section", el("h2"), el("pre")),
      el("dl", el("dt"), el("dd")), el("figure", el("img"), el("figcaption")), el("p", el("span")));
    nameBlocks(body, new Set(["own"]));
    expect(all(body).filter(n => n.id).map(n => `${n.localName}#${n.id}`)).toEqual([
      "h1#read-b1", "p#read-b2", "div#read-b3", "p#read-b4", "blockquote#read-b5", "p#read-b6",
      "li#read-b7", "th#read-b8", "td#read-b9", "p#own", "section#read-b10", "h2#read-b11", "pre#read-b12",
      "dt#read-b13", "dd#read-b14", "figcaption#read-b15", "p#read-b16",
    ]);
  });

  it("skip names the page already uses", () => {
    const body = el("body", el("h1"), withId(el("p"), "keep"), el("p", el("span")), el("div", el("p")), withId(el("p"), "read-b3"));
    nameBlocks(body, new Set(["keep", "read-b3"]));
    expect(all(body).map(n => n.id)).toEqual(["", "read-b1", "keep", "read-b2", "", "read-b4", "read-b5", "read-b3"]);
  });
});

describe("opening at a place from the phones", () => {
  const positions = positionsOf(
    [{ href: "OEBPS/Text/ch%201.xhtml", type: "application/xhtml+xml" }, { href: "OEBPS/Text/ch2.xhtml", type: "application/xhtml+xml" }],
    href => (href.includes("ch%201") ? 4 * PAGE_LENGTH : 2 * PAGE_LENGTH),
  ) as unknown as { href: string; locations: { progression: number; position: number } }[];

  it("finds the page list's entry even when the place has no page number (a place saved by listening)", () => {
    const place = { href: "OEBPS/Text/ch%201.xhtml", locations: { progression: 0.6 } };
    expect(startPosition(positions, place)).toMatchObject({ href: "OEBPS/Text/ch%201.xhtml", locations: { progression: 0.5, position: 3 } });
    expect(startPosition(positions, { href: "OEBPS/Text/ch2.xhtml", locations: {} })!.locations.position).toBe(5);
    expect(startPosition(positions, { href: "OEBPS/Text/ch2.xhtml", locations: { progression: 1 } })!.locations.position).toBe(6);
  });

  it("matches a chapter written with or without URL encoding, and with a fragment", () => {
    expect(startPosition(positions, { href: "OEBPS/Text/ch 1.xhtml#p3", locations: { progression: 0 } })!.locations.position).toBe(1);
  });

  it("is nothing for a chapter this book doesn't have", () => {
    expect(startPosition(positions, { href: "OEBPS/Text/missing.xhtml", locations: { progression: 0.2 } })).toBeNull();
  });
});

describe("Contents", () => {
  const toc = [
    { title: "Cover", href: "OEBPS/cover.xhtml", children: [] },
    { title: "Chapter 1", href: "OEBPS/ch1.xhtml", children: [] },
    { title: "Interlude", href: "OEBPS/ch2.xhtml", children: [
      { title: "Nokomi", href: "OEBPS/ch2.xhtml#nokomi", children: [] },
      { title: "Gith", href: "OEBPS/ch3.xhtml", children: [] },
    ] },
    { title: "Chapter 4", href: "OEBPS/ch5.xhtml", children: [] },
  ];
  const order = ["OEBPS/cover.xhtml", "OEBPS/ch1.xhtml", "OEBPS/ch2.xhtml", "OEBPS/ch3.xhtml", "OEBPS/ch4.xhtml", "OEBPS/ch5.xhtml"];
  const flat = flatToc(toc);

  it("lists sections under their chapter", () => {
    expect(flat.map(f => `${"  ".repeat(f.depth)}${f.entry.title}`)).toEqual(["Cover", "Chapter 1", "Interlude", "  Nokomi", "  Gith", "Chapter 4"]);
  });

  it("marks the chapter being read, or the last one before it", () => {
    expect(currentEntry(flat, order, "OEBPS/ch2.xhtml")).toBe(2);
    expect(currentEntry(flat, order, "OEBPS/ch3.xhtml")).toBe(4);
    expect(currentEntry(flat, order, "OEBPS/ch4.xhtml")).toBe(4);
    expect(currentEntry(flat, order, "OEBPS/ch5.xhtml")).toBe(5);
  });
});
