import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { users } from "./user";

// Every AI tool call is logged for audit — CLAUDE.md §8/§16. This is the
// first real AI integration in the app (lib/ai/csv-mapping.ts); extend this
// table rather than inventing a second logging mechanism for later AI tools.
export const aiToolInvocations = pgTable("ai_tool_invocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  arguments: jsonb("arguments").notNull(),
  result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiToolInvocation = typeof aiToolInvocations.$inferSelect;
