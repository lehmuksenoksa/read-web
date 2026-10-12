import { afterEach, describe, expect, it, vi } from "vitest";
import { Dropbox, headerJson, RevConflict } from "../src/dropbox";
import { codeChallenge } from "../src/auth";

afterEach(() => vi.unstubAllGlobals());

describe("Dropbox", () => {
  it("gets ASCII-only arguments in its header", () => {
    expect(headerJson({ path: "/Books/Mörkö.epub" })).toBe('{"path":"/Books/Mörkö.epub"}'.replace("ö", "\\u00f6").replace("ö", "\\u00f6"));
  });

  it("is never asked to cache, and a conflicting write is a conflict", async () => {
    const fetch = vi.fn(async () => new Response('{"error_summary":"path/conflict/file/..","error":{}}', { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    const api = new Dropbox("token", () => undefined);
    const path = `/Apps/Read/Sync/${"f".repeat(64)}.json`;
    await expect(api.writeText(path, "{}", "old-rev")).rejects.toBeInstanceOf(RevConflict);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://content.dropboxapi.com/2/files/upload");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse((init.headers as Record<string, string>)["Dropbox-API-Arg"])).toEqual({ path, mode: { ".tag": "update", update: "old-rev" }, autorename: false, mute: true });
  });

  it("signs out when Dropbox says the sign-in is over", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const signedOut = vi.fn();
    await expect(new Dropbox("token", signedOut).readText("/Apps/Read/Sync/library.json")).rejects.toThrow();
    expect(signedOut).toHaveBeenCalled();
  });
});

describe("the sign-in", () => {
  it("uses the PKCE challenge of RFC 7636's example", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
