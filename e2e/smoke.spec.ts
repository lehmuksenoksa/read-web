// The smoke test (2026-10-16): the built page in Chromium with a stand-in Dropbox. It catches what
// the unit tests can't: the Library drawn, a book and a serial opened and read, the place saved.
import { expect, test } from "@playwright/test";
import { EMMA, pageText, SERIAL, standIn } from "./standin";

test("Office: the Library, a book, Contents, the place saved", async ({ page }) => {
  const dropbox = await standIn(page, false);
  await page.goto("./");
  await expect(page.locator(".hmark")).toHaveText(/Library\s*&\s*Serials/);
  await expect(page.locator(".home .tbl .tr[data-id]")).toHaveCount(2);
  await expect(page.locator(".hhead > .hcont")).toContainText("Continue");
  // The book's panel, as a list of facts, then the book.
  await page.click(`.home .tr[data-id="${EMMA}"]`);
  await expect(page.locator(".hpanel .opt")).toHaveText("Emma");
  await page.click(".hpanel .opbtn");
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

test("Home: Grid, Serials, a serial read, the place saved", async ({ page }) => {
  const dropbox = await standIn(page, true);
  await page.goto("./");
  await expect(page.locator(".home .cell")).toHaveCount(1);
  await page.click(".hmark .ser");
  await expect(page.locator(".scard")).toHaveCount(1);
  await page.click(`.scard[data-sid="${SERIAL}"]`);
  await page.click(".hpanel .acts .seal");
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
  const table = await page.locator(".home .tbl").boundingBox();
  expect(table!.x + table!.width).toBeLessThanOrEqual(820);
  const pill = await page.locator(".hhead > .hcont").boundingBox();
  expect(pill!.y).toBeGreaterThan(700);
  expect(dropbox.errors).toEqual([]);
});
