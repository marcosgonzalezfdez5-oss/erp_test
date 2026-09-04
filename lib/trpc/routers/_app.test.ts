import { describe, expect, it } from "vitest";
import { appRouter } from "./_app";

describe("health procedure", () => {
  it("reports ok once the DB connection succeeds", async () => {
    const caller = appRouter.createCaller({ session: null });
    await expect(caller.health()).resolves.toEqual({ ok: true });
  });
});
