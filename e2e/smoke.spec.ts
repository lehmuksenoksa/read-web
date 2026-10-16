// The smoke test (2026-10-16): the built page in Chromium with a stand-in Dropbox. It catches what
// the unit tests can't: the Library drawn, a book and a serial opened and read, the place saved.
import { expect, test } from "@playwright/test";
import { EMMA, KATABASIS, pageText, SERIAL, standIn } from "./standin";

test("Office: the Library, a book, Contents, the place saved", async ({ page }) => {
  const dropbox = await standIn(page, false);
  await page.goto("./");
  await expect(page.locator(".hmark")).toHaveText(/Library\s*&\s*Serials/);
  await expect(page.locator(".home .tbl .tr[data-id]")).toHaveCount(2);
  await expect(page.locator(".hhead > .hcont")).toContainText("Continue");
  // The book's panel, as a list of facts, then the book (the row's title cell: the first cell is its select box).
  await page.click(`.home .tr[data-id="${EMMA}"] .td:nth-child(2)`);
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
  // Continue opens the book; the name goes back.
  await page.click(".cur-go");
  await expect.poll(() => pageText(page), { timeout: 30_000 }).toContain("truth universally acknowledged");
  await page.click(".hmark .lib");
  await expect(page.locator(".cur-now")).toBeVisible();
  await page.click(".hmark .ser");
  await expect(page.locator(".scard")).toHaveCount(1);
  await page.click(`.scard[data-sid="${SERIAL}"]`);
  // The serial's panel: the button names the chapter it opens; the counts over the chapters.
  await expect(page.locator(".hpanel .bp-go")).toHaveText("Continue Chapter 212");
  await expect(page.locator(".hpanel .bp-head")).toContainText("3 unread · 1 new");
  await expect(page.locator(".hpanel .bp-sitelink")).toHaveAttribute("href", /royalroad\.com/);
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

test("Office: two rows ticked, Set details… puts the series on both in one write", async ({ page }) => {
  const dropbox = await standIn(page, false);
  await page.goto("./");
  await expect(page.locator(".home .tbl .tr[data-id]")).toHaveCount(2);
  // Clicks in the box's cell, beside the box, as a mouse does: the first one anchors a text selection in the browser.
  // The table is drawn again when Emma's progress comes in: wait for it, then measure until the cell is there.
  await expect(page.locator(`.home .tr[data-id="${EMMA}"]`)).toContainText("43%");
  const boxCell = async (id: string) => {
    let b: { x: number; y: number; height: number } | null = null;
    await expect.poll(async () => (b = await page.locator(`.home .tr[data-id="${id}"] .td.chk`).boundingBox())).not.toBeNull();
    return [b!.x + 3, b!.y + b!.height / 2] as const;
  };
  const [x1, y1] = await boxCell(KATABASIS);
  await page.mouse.click(x1, y1);
  const [x2, y2] = await boxCell(EMMA);
  await page.keyboard.down("Shift");
  await page.mouse.click(x2, y2);
  await page.keyboard.up("Shift");
  await expect(page.locator(".hsel b")).toHaveText("2 selected");
  // A shift-click ticks the range without selecting the rows' text.
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  // The plain click still opens the panel, with the selection kept.
  await page.click(`.home .tr[data-id="${EMMA}"] .td:nth-child(2)`);
  await expect(page.locator(".hpanel .bp-title")).toHaveText("Emma");
  await expect(page.locator(".home .tr.sel")).toHaveCount(2);
  await page.click(".hsel button:text('Set details…')");
  const series = page.locator('.dialog input[aria-label="Series"]');
  await expect(series).toHaveValue("Test Series");
  await series.fill("Shared Shelf");
  await expect(page.locator(".dialog .preview li")).toHaveCount(2);
  await page.click(".dialog .btn.primary");
  await expect.poll(() => dropbox.uploads.find(u => u.path === "/Apps/Read/Sync/details.json")?.text ?? "", { timeout: 10_000 }).toContain("Shared Shelf");
  const file = JSON.parse(dropbox.uploads.filter(u => u.path === "/Apps/Read/Sync/details.json").pop()!.text) as { books: Record<string, { series: string; title: string; number: number }> };
  expect(file.books[KATABASIS]).toMatchObject({ title: "Katabasis", series: "Shared Shelf", number: 1 });
  expect(file.books[EMMA]).toMatchObject({ title: "Emma", series: "Shared Shelf", number: 2 });
  await expect(page.locator(`.home .tr[data-id="${EMMA}"]`)).toContainText("Shared Shelf");
  // Esc clears the selection.
  await page.keyboard.press("Escape");
  await expect(page.locator(".hsel")).toBeHidden();
  expect(dropbox.errors).toEqual([]);
});

test("Office: the book's panel: the title edited in place, the devices, Mark as read", async ({ page }) => {
  const dropbox = await standIn(page, false);
  await page.goto("./");
  await expect(page.locator(`.home .tr[data-id="${EMMA}"]`)).toContainText("43%");
  await page.click(`.home .tr[data-id="${EMMA}"] .td:nth-child(2)`);
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
  expect(dropbox.errors).toEqual([]);
});
