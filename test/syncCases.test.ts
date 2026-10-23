import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOOK_ORDER, furthestOf, openingPlan, serialOrder, sinceSubscribed, type SyncFile } from "../src/sync";

// The sync cases shared with the phones (2026-10-23): the same file runs in the app's tests
// (app/src/test/resources/sync-cases.json), so the two can't drift apart on the furthest read and
// the "further on" question. Each case: a sync file, the furthest read to find, what opening on Web does.
interface Case {
  name: string;
  chapters: string[] | null;
  subscribedAt: number | null;
  file: SyncFile;
  furthest: { href: string; progression: number; set: boolean } | null;
  opening?: { expect: "stay" | "ask" | "jump"; device?: string; href?: string; dismissedAt: number | null; readHereBefore: boolean };
}

const { cases } = JSON.parse(readFileSync(new URL("./sync-cases.json", import.meta.url), "utf8")) as { cases: Case[] };

describe("the sync cases shared with the phones", () => {
  for (const c of cases) {
    it(c.name, () => {
      const order = c.chapters ? serialOrder(c.chapters) : BOOK_ORDER;
      const file = sinceSubscribed(c.file, c.subscribedAt);
      const far = furthestOf(file, order);
      if (!c.furthest) expect(far).toBeNull();
      else {
        expect(far?.href).toBe(c.furthest.href);
        expect(far?.progression).toBeCloseTo(c.furthest.progression, 9);
        expect(far?.set === true).toBe(c.furthest.set);
      }
      if (!c.opening) return;
      const plan = openingPlan(file, c.opening.dismissedAt, order, c.opening.readHereBefore);
      const jumped = !plan.ask && plan.start && plan.start !== file?.positions?.web ? plan.start : null;
      const kind = plan.ask ? "ask" : jumped ? "jump" : "stay";
      expect(kind).toBe(c.opening.expect);
      const where = plan.ask ?? jumped;
      if (where) {
        expect(where.deviceName).toBe(c.opening.device);
        expect(where.href).toBe(c.opening.href);
      }
    });
  }
});
