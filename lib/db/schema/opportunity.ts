import { numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { pipelineStages } from "./pipeline-stage";
import { accounts } from "./account";
import { contacts } from "./contact";

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  pipelineStageId: uuid("pipeline_stage_id")
    .notNull()
    .references(() => pipelineStages.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Opportunity = typeof opportunities.$inferSelect;
