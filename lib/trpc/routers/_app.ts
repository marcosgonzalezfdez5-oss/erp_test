import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { publicProcedure, router } from "../init";

export const appRouter = router({
  health: publicProcedure.query(async () => {
    await db.execute(sql`select 1`);
    return { ok: true as const };
  }),
});

export type AppRouter = typeof appRouter;
