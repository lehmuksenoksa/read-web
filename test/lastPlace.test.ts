import { describe, expect, it } from "vitest";
import { contentsRemembered, lastPlaceText, parseLastPlace } from "../src/lastPlace";
import { viewFor } from "../src/home";

describe("the place this browser opens at", () => {
  it("is a book or serial kept here, read back as kept", () => {
    expect(parseLastPlace(lastPlaceText({ kind: "book", id: "abc" }))).toEqual({ kind: "book", id: "abc" });
    expect(parseLastPlace(lastPlaceText({ kind: "serial", id: "s-1" }))).toEqual({ kind: "serial", id: "s-1" });
    expect(parseLastPlace(lastPlaceText({ kind: "library" }))).toEqual({ kind: "library" });
  });

  it("is the Library when nothing, or nothing it understands, is kept", () => {
    expect(parseLastPlace(null)).toEqual({ kind: "library" });
    expect(parseLastPlace("")).toEqual({ kind: "library" });
    expect(parseLastPlace("not json")).toEqual({ kind: "library" });
    expect(parseLastPlace('{"kind":"book"}')).toEqual({ kind: "library" });
    expect(parseLastPlace('{"kind":"book","id":""}')).toEqual({ kind: "library" });
    expect(parseLastPlace('{"kind":"shelf","id":"x"}')).toEqual({ kind: "library" });
  });
});

describe("Contents remembered open", () => {
  it("follows Contents beside the page", () => {
    expect(contentsRemembered(false, "contents", false)).toBe(true);
    expect(contentsRemembered(true, null, false)).toBe(false);
  });

  it("is forgotten when Aa takes its place", () => {
    expect(contentsRemembered(true, "aa", false)).toBe(false);
  });

  it("doesn't change over the page in a narrow window", () => {
    expect(contentsRemembered(true, null, true)).toBe(true);
    expect(contentsRemembered(false, "contents", true)).toBe(false);
  });
});

describe("Office shows Details only", () => {
  it("for books and serials; Home keeps its view", () => {
    expect(viewFor("grid", false)).toBe("details");
    expect(viewFor("cards", false)).toBe("details");
    expect(viewFor("list", false)).toBe("details");
    expect(viewFor("grid", true)).toBe("grid");
    expect(viewFor("list", true)).toBe("list");
  });
});
