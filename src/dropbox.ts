// Dropbox through its plain HTTP API (no Dropbox library). Nothing it fetches is cached by the
// browser (no-store), and it can only write the paths [isWritablePath] allows.

import { isAddablePath, isNewBookPath, isWritablePath } from "./paths";

const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";

export class SignedOut extends Error {}
export class RevConflict extends Error {}

export interface FileEntry {
  path: string;
  pathLower: string;
  name: string;
  contentHash: string;
  size: number;
  modified: string;
}

/** JSON for Dropbox's `Dropbox-API-Arg` header, which takes ASCII only: other characters as \u escapes. */
export function headerJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export class Dropbox {
  constructor(private readonly token: string, private readonly onSignedOut: () => void) {}

  private async call(url: string, init: RequestInit): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
    });
    if (response.status === 401) {
      this.onSignedOut();
      throw new SignedOut("Signed out of Dropbox");
    }
    return response;
  }

  private async rpc<T>(endpoint: string, body: unknown): Promise<T> {
    const response = await this.call(`${API}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Dropbox ${endpoint}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  /** The files in [path] (and its subfolders when [recursive]). A missing folder is empty. */
  async listFolder(path: string, recursive: boolean): Promise<FileEntry[]> {
    type Page = { entries: Record<string, unknown>[]; cursor: string; has_more: boolean };
    let page: Page;
    try {
      page = await this.rpc<Page>("files/list_folder", { path, recursive, include_deleted: false, limit: 2000 });
    } catch (e) {
      if (String(e).includes("not_found")) return [];
      throw e;
    }
    const files: FileEntry[] = [];
    for (;;) {
      for (const e of page.entries) {
        if (e[".tag"] !== "file") continue;
        files.push({
          path: String(e.path_display), pathLower: String(e.path_lower), name: String(e.name),
          contentHash: String(e.content_hash ?? ""), size: Number(e.size ?? 0), modified: String(e.server_modified ?? ""),
        });
      }
      if (!page.has_more) return files;
      page = await this.rpc<Page>("files/list_folder/continue", { cursor: page.cursor });
    }
  }

  /** A file's bytes and revision; null when there's no such file. */
  async download(path: string): Promise<{ bytes: Uint8Array; rev: string } | null> {
    const response = await this.call(`${CONTENT}/files/download`, {
      method: "POST",
      headers: { "Dropbox-API-Arg": headerJson({ path }) },
    });
    if (response.status === 409) {
      const text = await response.text();
      if (text.includes("not_found")) return null;
      throw new Error(`Dropbox download: ${text}`);
    }
    if (!response.ok) throw new Error(`Dropbox download: ${response.status}`);
    const result = JSON.parse(response.headers.get("Dropbox-API-Result") ?? "{}") as { rev?: string };
    return { bytes: new Uint8Array(await response.arrayBuffer()), rev: result.rev ?? "" };
  }

  async readText(path: string): Promise<{ text: string; rev: string } | null> {
    const file = await this.download(path);
    return file && { text: new TextDecoder().decode(file.bytes), rev: file.rev };
  }

  /**
   * Writes a small file of Read's own: only a book's sync file (see [isWritablePath]). With
   * [rev], only if the file is still at that revision; without, only if there's none yet.
   */
  async writeText(path: string, text: string, rev: string | null): Promise<string> {
    if (!isWritablePath(path)) throw new Error(`Read on the web doesn't write ${path}`);
    return this.upload(path, new TextEncoder().encode(text), rev ? { ".tag": "update", update: rev } : "add");
  }

  /**
   * Adds a new file of Read's own (a downloaded font: see [isAddablePath]); never overwrites. A file
   * already there is left as it is.
   */
  async addFile(path: string, bytes: Uint8Array): Promise<void> {
    if (!isAddablePath(path)) throw new Error(`Read on the web doesn't add ${path}`);
    try {
      await this.upload(path, bytes, "add");
    } catch (e) {
      if (!(e instanceof RevConflict)) throw e;
    }
  }

  /**
   * Adds a book to /Books/ (Home's Add books): never over a file that's there. Its content hash, the
   * book's id; null when a file of that name is there already.
   */
  async addBook(path: string, bytes: Uint8Array): Promise<string | null> {
    if (!isNewBookPath(path)) throw new Error(`Read on the web doesn't add ${path}`);
    try {
      return (await this.uploadFile(path, bytes, "add")).content_hash ?? null;
    } catch (e) {
      if (e instanceof RevConflict) return null;
      throw e;
    }
  }

  private async upload(path: string, body: Uint8Array, mode: unknown): Promise<string> {
    return (await this.uploadFile(path, body, mode)).rev;
  }

  private async uploadFile(path: string, body: Uint8Array, mode: unknown): Promise<{ rev: string; content_hash?: string }> {
    const response = await this.call(`${CONTENT}/files/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": headerJson({ path, mode, autorename: false, mute: true }),
      },
      body: body as BodyInit,
    });
    if (response.status === 409) {
      const body = await response.text();
      if (body.includes("conflict")) throw new RevConflict(path);
      throw new Error(`Dropbox upload: ${body}`);
    }
    if (!response.ok) throw new Error(`Dropbox upload: ${response.status}`);
    return (await response.json()) as { rev: string; content_hash?: string };
  }

  /** Signing out: the sign-in stops working at Dropbox at once. */
  async revoke(): Promise<void> {
    await fetch(`${API}/auth/token/revoke`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }
}
