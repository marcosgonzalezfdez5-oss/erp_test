import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";

// Business logic should only ever branch on `kind`, never on `name` — stage
// names are pure tenant configuration (CLAUDE.md §5/§7). "First stage" is
// the row with the lowest `order`, by convention seeded as `kind: "open"`.
export const pipelineStageKindEnum = pgEnum("pipeline_stage_kind", ["open", "won", "lost"]);

export const pipelineStages = pgTable("pipeline_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  kind: pipelineStageKindEnum("kind").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PipelineStage = typeof pipelineStages.$inferSelect;
