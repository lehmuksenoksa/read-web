import { describe, expect, it } from "vitest";
import { quoteAt, withPageTop } from "../src/pagetop";

const text = "Nokomi pointed to the Hyrachon. “Mr. Gith’meltora.” The rumble of the man’s feet was enough for Nokomi’s sensitive ears to pick out every person and object in the room as he stood from his seat.";

describe("the words at the top of the web's page", () => {
  it("start at the word the page starts in, whole words, with the words before", () => {
    const at = text.indexOf("rumble") + 3; // the page starts mid-word
    const quote = quoteAt(text, at, 40, 20)!;
    expect(quote.highlight).toBe("rumble of the man’s feet was enough for");
    expect(quote.before).toBe("Gith’meltora.” The ");
  });

  it("skip spaces at the top of the page and keep apostrophes inside words", () => {
    expect(quoteAt(text, text.indexOf(" Gith"), 20)!.highlight).toBe("Gith’meltora.” The");
  });

  it("take the start of a paragraph whole, with nothing before", () => {
    expect(quoteAt(text, 0, 31)).toEqual({ highlight: "Nokomi pointed to the Hyrachon.", before: "" });
  });

  it("are nothing past the end", () => {
    expect(quoteAt(text, text.length)).toBeNull();
    expect(quoteAt("   ", 0)).toBeNull();
  });

  it("go into the place's locator as the phones read it", () => {
    const locator = { href: "OEBPS/ch3.xhtml", type: "application/xhtml+xml", locations: { progression: 0.4, position: 12 } };
    expect(withPageTop(locator, { cssSelector: "#read-b12", highlight: "rumble of the", before: "The " })).toEqual({
      href: "OEBPS/ch3.xhtml", type: "application/xhtml+xml",
      locations: { progression: 0.4, position: 12, cssSelector: "#read-b12" },
      text: { highlight: "rumble of the", before: "The " },
    });
    expect(withPageTop(locator, null)).toBe(locator);
  });
});
