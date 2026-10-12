// Reads an EPUB (a zip file) in the page's memory. Nothing is written anywhere.

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export class Zip {
  readonly entries = new Map<string, ZipEntry>();

  constructor(private readonly bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (view.getUint32(i, true) === EOCD) { end = i; break; }
    }
    if (end < 0) throw new Error("Not a zip file");
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const utf8 = new TextDecoder("utf-8");
    const latin1 = new TextDecoder("latin1");
    for (let n = 0; n < count; n++) {
      if (view.getUint32(at, true) !== CENTRAL) throw new Error("Broken zip directory");
      const flags = view.getUint16(at + 8, true);
      const method = view.getUint16(at + 10, true);
      const compressedSize = view.getUint32(at + 20, true);
      const size = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const offset = view.getUint32(at + 42, true);
      const raw = bytes.subarray(at + 46, at + 46 + nameLength);
      const name = (flags & 0x800 ? utf8 : latin1).decode(raw);
      if (!name.endsWith("/")) this.entries.set(name, { name, method, compressedSize, size, offset });
      at += 46 + nameLength + extraLength + commentLength;
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  async read(name: string): Promise<Uint8Array> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Not in the book: ${name}`);
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    if (view.getUint32(entry.offset, true) !== LOCAL) throw new Error(`Broken zip entry: ${name}`);
    const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
    const data = this.bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method !== 8) throw new Error(`Unsupported compression in ${name}`);
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async text(name: string): Promise<string> {
    return new TextDecoder().decode(await this.read(name));
  }
}
