import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Zip } from "../src/zip";

/** A zip file: [deflate]d entries or stored ones. */
export function makeZip(files: Record<string, string | Uint8Array>, deflate = true): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const stored = !deflate || name === "mimetype";
    const body = stored ? data : new Uint8Array(deflateRawSync(data));
    const nameBytes = new TextEncoder().encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, 0x800, true);
    local.setUint16(8, stored ? 0 : 8, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(8, 0x800, true);
    entry.setUint16(10, stored ? 0 : 8, true);
    entry.setUint32(20, body.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, body);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

describe("reading an EPUB's zip in memory", () => {
  it("reads stored and compressed files", async () => {
    const text = "Chapter one. ".repeat(500);
    const zip = new Zip(makeZip({ mimetype: "application/epub+zip", "OEBPS/Text/Kapitel ä.xhtml": text, "META-INF/container.xml": "<container/>" }));
    expect(await zip.text("mimetype")).toBe("application/epub+zip");
    expect(await zip.text("OEBPS/Text/Kapitel ä.xhtml")).toBe(text);
    expect(zip.entries.get("OEBPS/Text/Kapitel ä.xhtml")!.compressedSize).toBeLessThan(text.length);
    await expect(zip.read("missing.xhtml")).rejects.toThrow();
  });

  it("refuses what isn't a zip", () => {
    expect(() => new Zip(new TextEncoder().encode("not a zip at all, just some text here"))).toThrow();
  });
});
