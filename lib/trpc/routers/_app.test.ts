import { describe, expect, it } from "vitest";
import { appRouter } from "./_app";
import type { SessionContext } from "@/lib/auth/session";

describe("health procedure", () => {
  it("reports ok once the DB connection succeeds", async () => {
    const caller = appRouter.createCaller({ session: null });
    await expect(caller.health()).resolves.toEqual({ ok: true });
  });
});

describe("whoami procedure (tenantProcedure)", () => {
  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller({ session: null });
    await expect(caller.whoami()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns the session for authenticated callers", async () => {
    const session: SessionContext = {
      tenantId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      role: "sales_rep",
    };
    const caller = appRouter.createCaller({ session });
    await expect(caller.whoami()).resolves.toEqual(session);
  });
});
