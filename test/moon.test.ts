import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chapters, imageOnly, isMoonPlacePath, moonBookName, parseMoonPlace, parts, target } from "../src/moon";

const page = (...body: string[]) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body>${body.join("\n")}</body></html>`;

describe("Moon+'s sync files", () => {
  it("are read for their place", () => {
    expect(parseMoonPlace("1697567716184*33@0#10749:37.4%")).toEqual({ chapter: 33, part: 0, offset: 10749, percent: 37.4 });
    expect(parseMoonPlace("1697567716184*6@1#45722:48.8%\n")).toEqual({ chapter: 6, part: 1, offset: 45722, percent: 48.8 });
    expect(parseMoonPlace("not a place")).toBeNull();
    expect(parseMoonPlace("1697567716184*28@0#17367")).toBeNull();
  });

  it("go with their book by its file name", () => {
    expect(isMoonPlacePath("/Books/.Moon+/Cache/cornman - mage tank 5.epub.po")).toBe(true);
    expect(isMoonPlacePath("/Books/.Moon+/books.sync")).toBe(false);
    expect(isMoonPlacePath("/Books/.Moon+/Cache/sub/x.epub.po")).toBe(false);
    expect(moonBookName("/Books/.Moon+/Cache/cornman - mage tank 5.epub.po")).toBe("cornman - mage tank 5.epub");
  });
});

// The same small books as the app's MoonTextTest: the counting must agree to the character.
describe("Moon+'s counting", () => {
  it("has a blank line between paragraphs and a drop cap joined", () => {
    const markup = page(
      "<div><h1>Chapter 26</h1></div>",
      "<p><span class=\"drop\">I</span>sniffed, noticing   the smell of smoke.</p>",
      "<p>Having those theories debunked by a secret society of black market vendors must have ended any fantasies.</p>",
    );
    const text = "Chapter 26\n\nIsniffed, noticing the smell of smoke.\n\nHaving those theories debunked by a secret society of ";
    const t = target(markup, 0, text.length)!;
    expect(t.highlight.startsWith("black market vendors must have ended")).toBe(true);
    expect(t.before.endsWith("debunked by a secret society of ")).toBe(true);
    expect(t.paragraph.startsWith("Having those theories")).toBe(true);
  });

  it("counts a lone image as one character and snaps to the word", () => {
    const markup = page(
      "<div><h1>Epilogue</h1></div>",
      "<div><div><img src=\"rule.jpg\" alt=\"\"/></div></div>",
      "<p>ADDENDUM NOTE: a week before.</p>",
      "<div><div><img src=\"rule.jpg\" alt=\"\"/></div></div>",
      "<p>“All right, Unifier,” said the stranger. “Let us Consume.”</p>",
    );
    const before = "Epilogue\n\n￼\n\nADDENDUM NOTE: a week before.\n\n￼\n\n“All right, Unifier,” said the";
    expect(target(markup, 0, before.length)!.highlight.startsWith("stranger. “Let us Consume")).toBe(true);
  });

  it("puts an image-only page with the unlisted file after it", () => {
    expect(imageOnly(page("<div><img src=\"part.jpg\" alt=\"The Second Day\"/></div>"))).toBe(true);
    expect(imageOnly(page("<p>Contents</p>"))).toBe(false);
    const lonely = new Set([0, 1, 3, 5]);
    const listed = new Set([0, 1, 2, 3, 5]);
    expect(chapters(7, i => lonely.has(i), i => listed.has(i))).toEqual([[0], [1], [2], [3, 4], [5, 6]]);
    expect(chapters(3, () => false, i => i !== 1)).toEqual([[0], [1], [2]]);
  });

  it("splits a long file at the first paragraph after every 100,000 characters", () => {
    const paragraph = `<p class="para">${"word ".repeat(200).trim()}</p>`;
    const markup = page(Array.from({ length: 150 }, (_, i) => paragraph.replace("word word", `p${i + 1} word`)).join("\n"));
    const split = parts(markup);
    expect(split.length).toBeGreaterThanOrEqual(2);
    const starts = [...markup.matchAll(/<p class=/g)].map(m => m.index!);
    const first = starts.findIndex(at => at >= 100_000);
    expect(split[1][0].startsWith(`p${first + 1} word`)).toBe(true);
    expect(target(markup, 1, 0)!.highlight.startsWith(`p${first + 1} word`)).toBe(true);
    expect(target(markup, 9, 0)).toBeNull();
  });
});

// The user's own books, unpacked into folders under MOON_BOOKS (a scratch folder, never in the repository).
const books = process.env.MOON_BOOKS;
describe.skipIf(!books)("Moon+'s counting on real books", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const check = (folder: string, line: string, words: string) => {
    const dir = join(books!, folder);
    if (!existsSync(dir)) return;
    const all = walk(dir);
    const opf = all.find(f => f.endsWith(".opf"))!;
    const opfText = readFileSync(opf, "utf8");
    const items = new Map([...opfText.matchAll(/<(?:\w+:)?item\b[^>]*>/g)].map(m => [/\bid="([^"]+)"/.exec(m[0])![1], /\bhref="([^"]+)"/.exec(m[0])![1]]));
    const spine = [...opfText.matchAll(/<(?:\w+:)?itemref\b[^>]*idref="([^"]+)"/g)].map(m => normalize(resolve(dirname(opf), items.get(m[1])!)));
    const ncx = all.find(f => f.endsWith(".ncx"));
    let listed: Set<string>;
    if (ncx) {
      listed = new Set([...readFileSync(ncx, "utf8").matchAll(/<content src="([^"]+)"/g)].map(m => normalize(resolve(dirname(ncx), m[1].split("#")[0]))));
    } else {
      const navHref = /<item\b[^>]*properties="[^"]*\bnav\b[^"]*"[^>]*>/.exec(opfText)![0].match(/\bhref="([^"]+)"/)![1];
      const nav = resolve(dirname(opf), navHref);
      const toc = /<nav[^>]*epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/.exec(readFileSync(nav, "utf8"))![1];
      listed = new Set([...toc.matchAll(/href="([^"]+)"/g)].map(m => normalize(resolve(dirname(nav), m[1].split("#")[0]))));
    }
    const place = parseMoonPlace(line)!;
    const text = (i: number) => readFileSync(spine[i], "utf8");
    const group = chapters(spine.length, i => imageOnly(text(i)), i => listed.has(spine[i]))[place.chapter];
    expect(target(text(group[group.length - 1]), place.part, place.offset)!.highlight.startsWith(words)).toBe(true);
  };
  it("Mage Tank 5", () => check("mt5", "1697567716184*33@0#10749:37.4%", "black market vendors must have ended"));
  it("Mage Tank 4", () => check("mt4", "1697567716184*82@0#30014:98.8%", "stranger. “Let us Consume"));
  it("Mage Tank 3", () => check("mt3", "1697567716184*86@0#5345:98.8%", "eliminate any Delver who would"));
  it("Department Q 4", () => check("dq4", "1697567716184*36@0#577:65.6%", "people consumed, which was a good thing"));
  it("The Spear Cuts Through Water", () => check("spear", "1697567716184*6@1#45722:48.8%", "fiery news destabilizing"));
  it("There Is No Antimemetics Division", () => check("qntm", "1697567716184*19@0#1779:62.0%", "He reacts as he must react."));
});
