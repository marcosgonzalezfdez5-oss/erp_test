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
import { suggestionRouter } from "./suggestion";
import { setupWizardRouter } from "./setup-wizard";
import { draftRouter } from "./draft";
import { emailRouter } from "./email";
import { automationRouter } from "./automation";
import { tenantSettingsRouter } from "./tenant-settings";
import { warehouseRouter } from "./warehouse";
import { auditRouter } from "./audit";
import { inventoryRouter } from "./inventory";
import { shipmentRouter } from "./shipment";
import { invoiceRouter } from "./invoice";
import { paymentRouter } from "./payment";
import { returnRouter } from "./return";
import { reportRouter } from "./report";

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
  suggestion: suggestionRouter,
  setupWizard: setupWizardRouter,
  draft: draftRouter,
  email: emailRouter,
  automation: automationRouter,
  tenantSettings: tenantSettingsRouter,
  warehouse: warehouseRouter,
  audit: auditRouter,
  inventory: inventoryRouter,
  shipment: shipmentRouter,
  invoice: invoiceRouter,
  payment: paymentRouter,
  return: returnRouter,
  report: reportRouter,
});

export type AppRouter = typeof appRouter;
