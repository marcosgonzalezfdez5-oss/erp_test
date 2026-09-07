import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { publicProcedure, router } from "../init";
import { tenantProcedure } from "../procedures";
import { accountRouter } from "./account";
import { contactRouter } from "./contact";
import { pipelineRouter } from "./pipeline";
import { leadRouter } from "./lead";
import { opportunityRouter } from "./opportunity";
import { activityRouter } from "./activity";
import { taskRouter } from "./task";
import { productRouter } from "./product";
import { quoteRouter } from "./quote";
import { orderRouter } from "./order";
import { customFieldRouter } from "./custom-field";
import { csvImportRouter } from "./csv-import";
import { dashboardRouter } from "./dashboard";

export const appRouter = router({
  health: publicProcedure.query(async () => {
    await db.execute(sql`select 1`);
    return { ok: true as const };
  }),

  whoami: tenantProcedure.query(({ ctx }) => ctx.session),

  account: accountRouter,
  contact: contactRouter,
  pipeline: pipelineRouter,
  lead: leadRouter,
  opportunity: opportunityRouter,
  activity: activityRouter,
  task: taskRouter,
  product: productRouter,
  quote: quoteRouter,
  order: orderRouter,
  customField: customFieldRouter,
  csvImport: csvImportRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
