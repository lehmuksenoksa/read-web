import { describe, expect, it } from "vitest";
import { addSummary, beforeUpload, bookInfo, bookPath, contentHash, MAX_BOOK_BYTES, outcomeText } from "../src/addBooks";

/** A zip of stored (uncompressed) files, enough for the reader. */
function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 0, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const c = new Uint8Array(46 + n.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(8, 0x800, true); cv.setUint16(10, 0, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true);
    c.set(n, 46);
    parts.push(local, data);
    central.push(c);
    offset += local.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

const container = (opf: string) => `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opf}" media-type="application/oebps-package+xml"/></rootfiles></container>`;

describe("Dropbox's content hash (the book id)", () => {
  // The app's DropboxContentHashTest vectors, computed outside the code with Python's hashlib.
  it("matches the app's known values", async () => {
    expect(await contentHash(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await contentHash(new TextEncoder().encode("hello"))).toBe("9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50");
    expect(await contentHash(Uint8Array.from({ length: 4096 }, (_, i) => i % 256))).toBe("1d4b24c7dfcdf747d0fc4c677ef51327b338c6aed9dc6ec3e2ad9d8f8382ff79");
    const block = 4 * 1024 * 1024;
    expect(await contentHash(Uint8Array.from({ length: block + 100 }, (_, i) => (i * 7 + 3) & 0xff))).toBe("04aad634d84bdba62bb843dabee178f874c692c895cb9c49f070bca1747d2687");
  });
});

describe("what an EPUB says about itself", () => {
  it("title, author, calibre's series and the cover (EPUB 3's cover-image)", async () => {
    const cover = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const book = zip({
      "mimetype": "application/epub+zip",
      "META-INF/container.xml": container("OEBPS/content.opf"),
      "OEBPS/content.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title id="t">Piranesi &amp; the House</dc:title><dc:creator>Susanna  Clarke</dc:creator><dc:creator>Someone Else</dc:creator>
        <meta name="calibre:series" content="House"/><meta name="calibre:series_index" content="2"/></metadata>
        <manifest><item id="c" href="Images/cover%20art.jpg" media-type="image/jpeg" properties="cover-image"/><item id="x" href="x.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="x"/></spine></package>`,
      "OEBPS/Images/cover art.jpg": cover,
      "OEBPS/x.xhtml": "<html/>",
    });
    const info = await bookInfo(book);
    expect(info).toMatchObject({ title: "Piranesi & the House", author: "Susanna Clarke", series: "House", seriesIndex: 2 });
    expect(info.cover?.type).toBe("image/jpeg");
    expect([...info.cover!.bytes]).toEqual([...cover]);
  });

  it("EPUB 2's cover meta; nothing missing is made up", async () => {
    const book = zip({
      "META-INF/container.xml": container("content.opf"),
      "content.opf": `<package><metadata><dc:title>Emma</dc:title><meta name="cover" content="img"/></metadata><manifest><item id="img" href="cover.png" media-type="image/png"/></manifest></package>`,
      "cover.png": new Uint8Array([1]),
    });
    expect(await bookInfo(book)).toMatchObject({ title: "Emma", author: null, series: null, seriesIndex: null, cover: { type: "image/png" } });
  });

  it("isn't an EPUB without a package document, or when it isn't a zip at all", async () => {
    await expect(bookInfo(zip({ "a.txt": "x" }))).rejects.toThrow();
    await expect(bookInfo(new TextEncoder().encode("%PDF-1.4"))).rejects.toThrow();
  });
});

describe("before uploading", () => {
  const library = [
    { id: "a".repeat(64), title: "The Hobbit", path: "/Books/The Hobbit.epub" },
    { id: "b".repeat(64), title: "Emma", path: "/Books/Emma.epub" },
    { id: "c".repeat(64), title: "Mage Tank 5", path: "/Books/Mage Tank 5.epub" },
    { id: "d".repeat(64), title: "Twig", path: "/Books/Wildbow/Twig.epub" },
  ];
  const file = (name: string, id: string | null, title: string | null = null, size = 1000) => ({ name, size, id, title });

  it("a new EPUB goes up straight into /Books/ under its own name", () => {
    expect(beforeUpload(file("Piranesi.epub", "e".repeat(64)), library)).toBeNull();
    expect(bookPath("Piranesi.epub")).toBe("/Books/Piranesi.epub");
    expect(bookPath("a/b\\c.epub")).toBe("/Books/a_b_c.epub");
    // A folder in /Books/ doesn't take the name in /Books/ itself.
    expect(beforeUpload(file("Twig.epub", "f".repeat(64)), library)).toBeNull();
  });

  it("the same content is already there, whatever its name; said with its title when that differs", () => {
    expect(beforeUpload(file("Hobbit copy.epub", "a".repeat(64), "The Hobbit"), library)).toEqual({ kind: "already", title: "The Hobbit", sameTitle: true });
    const emma = beforeUpload(file("Emma (2015 ed).epub", "b".repeat(64), "Emma: A Novel"), library);
    expect(outcomeText(emma)).toBe("Already in the library as “Emma”");
  });

  it("another book with the same file name isn't added, nor anything that isn't an EPUB or is too big", () => {
    expect(outcomeText(beforeUpload(file("mage tank 5.EPUB", "g".repeat(64)), library))).toBe("Another file is called “mage tank 5.EPUB”");
    expect(beforeUpload(file("notes.pdf", "h".repeat(64)), library)).toEqual({ kind: "not-epub" });
    expect(beforeUpload(file("broken.epub", null), library)).toEqual({ kind: "not-epub" });
    expect(beforeUpload(file("huge.epub", "i".repeat(64), null, MAX_BOOK_BYTES + 1), library)).toEqual({ kind: "too-big" });
  });

  it("sums up", () => {
    expect(addSummary([{ kind: "added", id: "x" }, { kind: "already", title: "E", sameTitle: true }, { kind: "already", title: "H", sameTitle: false }, { kind: "not-epub" }, { kind: "name-taken", name: "x" }]))
      .toBe("1 added · 2 already there · 2 not added");
    expect(addSummary([{ kind: "added", id: "x" }])).toBe("1 added");
    expect(outcomeText(null)).toBe("Adding…");
  });
});
