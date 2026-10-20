// The smoke test (2026-10-16): the built page in Chromium with a stand-in Dropbox. It catches what
// the unit tests can't: the Library drawn, a book and a serial opened and read, the place saved.
import { expect, test } from "@playwright/test";
import { DONE, EMMA, pageText, SERIAL, standIn } from "./standin";

/** Longer than the reader waits before it saves a place (UPLOAD_DELAY_MS). */
const UPLOAD_WAIT_MS = 4500;

test("Office: the Library, a book, Contents, the place saved", async ({ page }) => {
  const dropbox = await standIn(page, false);
  await page.goto("./");
  await expect(page.locator(".hmark")).toHaveText(/Library\s*&\s*Serials/);
  await expect(page.locator(".home .tbl .tr[data-id]")).toHaveCount(2);
  await expect(page.locator(".hhead > .hcont")).toContainText("Continue");
  // The book's panel, as a list of facts, then the book (the row's title cell).
  await page.click(`.home .tr[data-id="${EMMA}"] .td:nth-child(1)`);
  await expect(page.locator(".hpanel .bp-title")).toHaveText("Emma");
  await page.click(".hpanel .bp-go");
  await expect.poll(() => pageText(page), { timeout: 30_000 }).toContain("truth universally acknowledged");
  await expect(page.locator(".httl .bt")).toHaveText("Emma");
  // Contents beside ⚙, its panel at the right.
  await page.click('.htools button[aria-label="Contents"]');
  await expect(page.locator(".rpanel .toc .item")).toHaveCount(5);
  await page.click('.htools button[aria-label="Contents"]');
  // Page turns save Web's place to the book's sync file.
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(() => dropbox.uploads.some(u => u.path === `/Apps/Read/Sync/${EMMA}.json` && u.text.includes('"web"')), { timeout: 20_000 }).toBe(true);
  // The name goes back to the Library.
  await page.click(".hmark .lib");
  await expect(page.locator(".home .tbl")).toBeVisible();
  expect(dropbox.errors).toEqual([]);
});

test("Home: Covers, Serials, a serial read, the place saved", async ({ page }) => {
  const dropbox = await standIn(page, true);
  await page.goto("./");
  // The curated page (2026-10-16): Reading now is the book in progress; Katabasis, never opened, is
  // recently added; All has the series as one cover.
  await expect(page.locator(".cur-now .cur-title")).toHaveText("Emma");
  // Emma's sharp cover from the covers folder takes the place of the plain one (2026-10-16).
  await expect(page.locator(".cur-cover img")).toHaveAttribute("src", /^blob:/);
  // No other book in progress: Recently added sits beside Reading now, and has no row of its own.
  await expect(page.locator(".cur-also .cur-head h2")).toHaveText("Recently added");
  await expect(page.locator(".cur-also .cell")).toHaveCount(1);
  await expect(page.locator(".cur .grid.shelf")).toHaveCount(0);
  await expect(page.locator(".cur .grid:not(.shelf) .cell")).toHaveCount(1);
  await expect(page.locator(".hhead > .hcont")).toBeHidden();
  // A search shows the plain grid of matches.
  await page.fill(".hsearch input", "Kata");
  await expect(page.locator(".cur")).toHaveCount(0);
  await expect(page.locator(".home .grid .cell")).toHaveCount(1);
  await page.fill(".hsearch input", "");
  await expect(page.locator(".cur-now")).toBeVisible();
  // Everything in Reading now but Continue opens the book's panel (2026-10-19): the title, the place line.
  await page.click(".cur-now .cur-title");
  await expect(page.locator(".hpanel .bp-title")).toHaveText("Emma");
  // Open, not only filled: a click outside the panel closes it, and Reading now isn't outside (2026-10-19).
  await expect(page.locator(".hpanel")).toHaveClass(/\bopen\b/);
  await expect(page.locator("#app")).not.toHaveClass(/\breader\b/);
  await page.keyboard.press("Escape");
  await page.click(".cur-now .cur-place");
  await expect(page.locator(".hpanel")).toHaveClass(/\bopen\b/);
  await page.keyboard.press("Escape");
  // Continue opens the book; the name goes back.
  await page.click(".cur-go");
  await expect.poll(() => pageText(page), { timeout: 30_000 }).toContain("truth universally acknowledged");
  await page.click(".hmark .lib");
  await expect(page.locator(".cur-now")).toBeVisible();
  // The browser's Forward goes back into the book, and Back to the Library (2026-10-18).
  await page.goForward();
  await expect(page.locator("#app")).toHaveClass(/\breader\b/);
  await page.goBack();
  await expect(page.locator(".cur-now")).toBeVisible();
  await page.click(".hmark .ser");
  // From the curated Covers page, Serials' status line still shows (it stayed hidden until 2026-10-18).
  await expect(page.locator(".hstatus .hcount")).toBeVisible();
  await expect(page.locator(".hstatus .hcount")).toContainText("1 new chapter");
  // Serials' List (2026-10-17): the row with the serial's sharp cover from the covers folder; List · Details to choose from.
  await expect(page.locator(".scard")).toHaveCount(2);
  await expect(page.locator(`.scard[data-sid="${SERIAL}"] .cv img`)).toHaveAttribute("src", /^blob:/);
  await expect(page.locator(".hviews [role=tab]")).toHaveText(["List", "Details"]);
  // The tags are back on the List row (2026-10-17, evening): NEW, UNREAD, CAUGHT UP; no dot there. The new one's latest chapter title is marked; the caught-up one reads LATEST over & READ.
  // UNREAD counts every unread chapter, the NEW one too, as the panel and Details do (2026-10-18).
  await expect(page.locator(`.scard[data-sid="${SERIAL}"] .tag`)).toHaveText(["1 NEW", "3 UNREAD"]);
  await expect(page.locator(`.scard[data-sid="${DONE}"] .tag`)).toHaveText(["CAUGHT UP"]);
  await expect(page.locator(".scard .ndot")).toHaveCount(0);
  await expect(page.locator(`.scard[data-sid="${SERIAL}"] .lines .nwt`)).toHaveText("Chapter 215: Scale");
  await expect(page.locator(`.scard[data-sid="${DONE}"] .lines .k`)).toHaveText(["LATEST", "& READ"]);
  await page.click(".hviews [role=tab]:has-text('Details')");
  // Details (2026-10-17, evening): Serial · Author · Source · Chapters · Unread · Latest · Last read; the unread count is empty when caught up.
  await expect(page.locator(".home .tbl.ser .th")).toHaveText(["Serial", "Author", "Source", "Chapters", "Unread", "Latest ▾", "Last read"]);
  // A row by keyboard (2026-10-18): it takes focus, Enter opens its panel, focus goes into the panel and back on Esc.
  await page.locator(`.tr[data-sid="${SERIAL}"] > .td[tabindex]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".hpanel .bp-go")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(`.tr[data-sid="${SERIAL}"] > .td[tabindex]`)).toBeFocused();
  await expect(page.locator(`.tr[data-sid="${SERIAL}"] .td .ndot`)).toHaveCount(1);
  await expect(page.locator(`.tr[data-sid="${SERIAL}"] .td`).nth(2)).toHaveText("Royal Road");
  await expect(page.locator(`.tr[data-sid="${SERIAL}"] .td`).nth(4)).toHaveText("3");
  await expect(page.locator(`.tr[data-sid="${DONE}"] .td`).nth(4)).toHaveText("");
  await expect(page.locator(`.tr[data-sid="${DONE}"] .td`).nth(3)).toHaveText("3");
  await page.click(".hviews [role=tab]:has-text('List')");
  await page.click(`.scard[data-sid="${SERIAL}"]`);
  // The panel shows the cover too.
  await expect(page.locator(".hpanel .bp-hero .cv img")).toHaveAttribute("src", /^blob:/);
  // The serial's panel: the button names the chapter it opens; the counts over the chapters.
  await expect(page.locator(".hpanel .bp-go")).toHaveText("Continue Chapter 212");
  await expect(page.locator(".hpanel .bp-head")).toContainText("3 unread · 1 new");
  await expect(page.locator(".hpanel .bp-sitelink")).toHaveAttribute("href", /royalroad\.com/);
  // A chapter in Dropbox opens in the reader, at that chapter (2026-10-18), not on the site.
  await page.click(".hpanel .chap .chl:has-text('Chapter 214')");
  await expect.poll(() => pageText(page), { timeout: 30_000 }).toContain("Chapter 214: Contour Lines");
  // A jump doesn't move your place until you read on (2026-10-20): the way back is offered, and leaving saves nothing.
  await expect(page.locator(".msg .back")).toHaveText("‹ Back to Chapter 212");
  await page.goBack();
  await expect(page.locator(".scard").first()).toBeVisible();
  await page.waitForTimeout(UPLOAD_WAIT_MS);
  expect(dropbox.uploads.some(u => u.path === `/Apps/Read/Sync/${SERIAL}.json`)).toBe(false);
  await page.click(`.scard[data-sid="${SERIAL}"]`);
  // The chapters before the one before your place stand behind one last row (2026-10-20).
  await expect(page.locator(".hpanel .chapmore").last()).toHaveText("··· 210 earlier");
  await page.locator(".hpanel .chapmore").last().click();
  await expect(page.locator(".hpanel .chap .chl:has-text('Chapter 1: Ink and Stone')")).toBeVisible();
  await page.click(".hpanel .bp-go");
  await expect.poll(() => pageText(page), { timeout: 30_000 }).toContain("Paragraph 1.");
  await expect(page.locator(".httl .pl2")).toContainText("unread");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(() => dropbox.uploads.some(u => u.path === `/Apps/Read/Sync/${SERIAL}.json`), { timeout: 20_000 }).toBe(true);
  expect(dropbox.errors).toEqual([]);
});

test("a narrow window: Details fits, Continue at the foot", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  const dropbox = await standIn(page, false);
  await page.goto("./");
  await expect(page.locator(".home .tbl")).toBeVisible();
  // The table is drawn again as the sync files' progress comes in: measured until it's there and fits.
  await expect.poll(() => page.evaluate(() => { const r = document.querySelector(".home .tbl")?.getBoundingClientRect(); return r ? r.right : Infinity; })).toBeLessThanOrEqual(820);
  const pill = await page.locator(".hhead > .hcont").boundingBox();
  expect(pill!.y).toBeGreaterThan(700);
  expect(dropbox.errors).toEqual([]);
});

test("Office: the book's panel: the title edited in place, the devices, Mark as read", async ({ page }) => {
  const dropbox = await standIn(page, false);
  await page.goto("./");
  await expect(page.locator(`.home .tr[data-id="${EMMA}"]`)).toContainText("43%");
  await page.click(`.home .tr[data-id="${EMMA}"] .td:nth-child(1)`);
  // One line: the furthest place; a click shows the devices.
  await expect(page.locator(".hpanel .bp-line .bp-l")).toHaveText("43%");
  await page.click(".hpanel button.bp-line");
  await expect(page.locator(".hpanel .bp-dev")).toHaveCount(1);
  await expect(page.locator(".hpanel .bp-dev")).toContainText("S23");
  // The title edited in place: Enter saves it to the shared details file.
  await page.click(".hpanel .bp-title");
  await page.fill(".hpanel .bp-edit input", "Emma, Revised");
  await page.keyboard.press("Enter");
  await expect.poll(() => dropbox.uploads.find(u => u.path === "/Apps/Read/Sync/details.json")?.text ?? "").toContain("Emma, Revised");
  await expect(page.locator(".hpanel .bp-title")).toHaveText("Emma, Revised");
  // Esc puts a field back, saves nothing and leaves the panel open.
  await page.locator(".hpanel .bp-by").first().click();
  await page.fill(".hpanel .bp-edit input", "Nobody");
  await page.keyboard.press("Escape");
  await expect(page.locator(".hpanel .bp-by").first()).toHaveText("Jane Austen");
  await expect(page.locator(".hpanel")).toHaveClass(/open/);
  // The one status word: Mark as read. Continue offered this book; a book marked read isn't continued.
  await expect(page.locator(".hhead > .hcont")).toContainText("Emma, Revised");
  await page.click(".hpanel .bp-word");
  await expect(page.locator(".hhead > .hcont")).toBeHidden();
  await expect(page.locator(".hpanel .bp-line .bp-l")).toHaveText("Read");
  await expect(page.locator(".hpanel .bp-word")).toHaveText("Mark as unread");
  await expect.poll(() => dropbox.uploads.some(u => u.path === `/Apps/Read/Sync/${EMMA}.json` && u.text.includes('"read":true'))).toBe(true);
  expect(dropbox.uploads.filter(u => u.path === "/Apps/Read/Sync/details.json").some(u => u.text.includes("Nobody"))).toBe(false);
  // Mark as unread after Mark as read: back to the start at once, every device's place too (2026-10-19).
  await page.click(".hpanel .bp-word");
  await expect(page.locator(".hpanel .bp-line")).toContainText("Not started");
  expect(dropbox.errors).toEqual([]);
});

test("Serials kept in the browser: shown at once on the next visit, only changed files read again", async ({ page }) => {
  const dropbox = await standIn(page, true);
  await page.goto("./");
  await page.click(".hmark .ser");
  await expect(page.locator(`.scard[data-sid="${SERIAL}"] .lines .nwt`)).toHaveText("Chapter 215: Scale");
  await page.waitForTimeout(1500); // kept in the browser
  const before = dropbox.downloads.length;
  await page.reload();
  await page.click(".hmark .ser");
  await expect(page.locator(`.scard[data-sid="${SERIAL}"] .lines .nwt`)).toHaveText("Chapter 215: Scale");
  await page.waitForTimeout(1500);
  const again = dropbox.downloads.slice(before);
  // Nothing changed in Dropbox: no chapter list, sync file or subscriptions file read again.
  expect(again.filter(p => /\/chapters\/[^/]+\.json$|\/(rr-\d+|subscriptions)\.json$/.test(p))).toEqual([]);
  expect(dropbox.errors).toEqual([]);
});

test("a jump counts once you read on, and ‹ Back returns to your place", async ({ page }) => {
  const dropbox = await standIn(page, true);
  await page.goto("./");
  await page.click(".hmark .ser");
  await page.click(`.scard[data-sid="${SERIAL}"]`);
  await page.click(".hpanel .chap .chl:has-text('Chapter 214')");
  await expect.poll(() => pageText(page), { timeout: 30_000 }).toContain("Chapter 214: Contour Lines");
  await expect(page.locator(".msg .back")).toHaveText("‹ Back to Chapter 212");
  await page.waitForTimeout(UPLOAD_WAIT_MS);
  const synced = () => dropbox.uploads.filter(u => u.path === `/Apps/Read/Sync/${SERIAL}.json`);
  expect(synced()).toEqual([]);
  // A page turned in it: now it's your place.
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => synced().some(u => u.text.includes("ch/00214.xhtml")), { timeout: 20_000 }).toBe(true);
  // Back (one turn so far): to Chapter 212, saved again.
  await page.click(".msg .back");
  await expect(page.locator(".msg .back")).toBeHidden();
  await expect.poll(() => pageText(page), { timeout: 30_000 }).toContain("Chapter 212: North by Lantern");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => { const all = synced(); return all.length > 0 && all[all.length - 1].text.includes("ch/00212.xhtml"); }, { timeout: 20_000 }).toBe(true);
  expect(dropbox.errors).toEqual([]);
});

test("Furthest read: the bar's menu goes there or says you're there, and sets it with Undo (2026-10-20)", async ({ page }) => {
  test.setTimeout(90_000);
  const dropbox = await standIn(page, true);
  await page.goto("./");
  await page.click(".cur-go");
  await expect.poll(() => pageText(page), { timeout: 30_000 }).toContain("truth universally acknowledged");
  const prompt = page.locator(".msg:not(.toast)");
  const menu = page.locator(".bookmenu");
  // At the S23's place, which is the furthest read: already there.
  await page.click(".httl .fr");
  await expect(menu.locator("button")).toHaveText(["Go to furthest read", "Set as furthest read"]);
  await menu.getByText("Go to furthest read").click();
  await expect(prompt).toContainText("You're already at the furthest read.");
  // Back to the first chapter from Contents (not saved: a jump), then Go to furthest read asks as at an opening.
  await page.click('.htools button[aria-label="Contents"]');
  const at = () => page.locator(".foot").getAttribute("data-href");
  await page.locator(".rpanel .toc .item").first().click();
  await expect.poll(at, { timeout: 15_000 }).not.toMatch(/chapter%202|chapter 2/);
  await page.click(".httl .fr");
  await menu.getByText("Go to furthest read").click();
  await expect(prompt).toContainText("is further on");
  await prompt.getByText("Go there").click();
  await expect.poll(at, { timeout: 15_000 }).toMatch(/chapter%202|chapter 2/);
  // Set as furthest read: the message with Undo; Undo sends nothing.
  await page.click(".httl .fr");
  await menu.getByText("Set as furthest read").click();
  await expect(prompt).toContainText("Set as furthest read");
  await prompt.getByText("Undo").click();
  await page.waitForTimeout(9_000);
  expect(dropbox.uploads.some(u => u.path === `/Apps/Read/Sync/${EMMA}.json` && u.text.includes('"set":true'))).toBe(false);
  // Again, left to lapse: the furthest read goes to Dropbox, set by hand.
  await page.click(".httl .fr");
  await menu.getByText("Set as furthest read").click();
  await expect.poll(() => dropbox.uploads.some(u => u.path === `/Apps/Read/Sync/${EMMA}.json` && u.text.includes('"set":true')), { timeout: 15_000 }).toBe(true);
  expect(dropbox.errors).toEqual([]);
});

test("Choosing a cover: a link and a file in Home, the word in Office", async ({ page }) => {
  const dropbox = await standIn(page, true);
  await page.goto("./");
  await expect(page.locator(".cur-now .cur-title")).toHaveText("Emma");
  await page.click(".cur-now .cur-title");
  await expect(page.locator(".hpanel")).toHaveClass(/\bopen\b/);
  // Home: the panel's cover opens the menu; no "own" line while no cover was chosen.
  await page.click(".hpanel .cvpick");
  await expect(page.locator(".hmenu .r")).toHaveText(["From a file…", "From a link…"]);
  await page.click(".hmenu .r:has-text('From a link…')");
  await page.fill(".hpanel .cvlink", "http://example.com/cover.jpg");
  await page.click(".hpanel .bp-link .bp-go");
  await expect(page.locator(".hpanel .bp-link")).toHaveCount(0);
  await expect.poll(() => dropbox.uploads.some(u => u.path === "/Apps/Read/Sync/details.json" && u.text.includes('"coverUrl":"https://example.com/cover.jpg"'))).toBe(true);
  // The page shows only its own images: a link's cover comes once a phone has fetched it.
  await expect(page.locator(".toast")).toContainText("Cover link saved");
  // A file: scaled, uploaded to the chosen covers' folder, named in details.json as dropbox:.
  await page.click(".hpanel .cvpick");
  await expect(page.locator(".hmenu .r")).toHaveText(["From a file…", "From a link…", "Use the book's own"]);
  const chooser = page.waitForEvent("filechooser");
  await page.click(".hmenu .r:has-text('From a file…')");
  await (await chooser).setFiles({ name: "cover.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
  await expect.poll(() => dropbox.uploads.some(u => u.path === `/Apps/Read/Sync/covers/chosen/${EMMA}.jpg`)).toBe(true);
  await expect.poll(() => dropbox.uploads.some(u => u.path === "/Apps/Read/Sync/details.json" && u.text.includes(`"coverUrl":"dropbox:/Apps/Read/Sync/covers/chosen/${EMMA}.jpg"`))).toBe(true);
  await expect(page.locator(`.hpanel .cv[data-cover="${EMMA}"] img`)).toHaveAttribute("src", /^blob:/);
  // The book's own again.
  await page.click(".hpanel .cvpick");
  await page.click(".hmenu .r:has-text(\"Use the book's own\")");
  await expect.poll(() => dropbox.uploads.filter(u => u.path === "/Apps/Read/Sync/details.json").at(-1)?.text.includes('"coverUrl":null')).toBe(true);
  expect(dropbox.errors).toEqual([]);
});

test("Office: Change cover under the panel's lines", async ({ page }) => {
  await standIn(page, false);
  await page.goto("./");
  await page.click(`.home .tr[data-id="${EMMA}"] .td:nth-child(1)`);
  await expect(page.locator(".hpanel .bp-title")).toHaveText("Emma");
  await expect(page.locator(".hpanel .cvpick")).toHaveCount(0);
  await page.click(".hpanel .cvword");
  await expect(page.locator(".hmenu .r")).toHaveText(["From a file…", "From a link…"]);
});

/** A 2 × 3 PNG, red. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEElEQVR4nGM4Y2wMRAwoFABO+QctICjTzAAAAABJRU5ErkJggg==";
