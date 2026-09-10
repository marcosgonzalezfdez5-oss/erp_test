import { boolean, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { users } from "./user";

// AI-drafted text a human reviews before it's used — activity summaries and
// follow-up emails (CLAUDE.md §9 "Summarization" / "Free-text drafting").
// Persisted so an automation (Step 5) can generate one with no user in the
// request, and so an edit survives a page reload.

export const draftKindEnum = pgEnum("draft_kind", [
  "opportunity_summary",
  "account_summary",
  "follow_up_email",
]);

export const draftStatusEnum = pgEnum("draft_status", ["active", "dismissed", "sent"]);

export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: draftKindEnum("kind").notNull(),
    // Polymorphic (opportunity | account), no FK — the service tenant-scopes
    // the target via the existing get* services.
    targetEntityType: text("target_entity_type").notNull(),
    targetEntityId: uuid("target_entity_id").notNull(),
    status: draftStatusEnum("status").notNull().default("active"),
    subject: text("subject"), // follow_up_email only
    body: text("body").notNull(),
    model: text("model"), // null = deterministic fallback (no live model call)
    aiGenerated: boolean("ai_generated").notNull().default(true),
    editedByUserId: uuid("edited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    sourceAutomationRunId: uuid("source_automation_run_id"), // set in Step 5; nullable, no FK
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("drafts_tenant_target_idx").on(table.tenantId, table.targetEntityId)],
);

export type Draft = typeof drafts.$inferSelect;
export type DraftKind = (typeof draftKindEnum.enumValues)[number];
export type DraftStatus = (typeof draftStatusEnum.enumValues)[number];
