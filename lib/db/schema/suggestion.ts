import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { users } from "./user";

// The generic "AI or an automation proposes a change, a human approves it,
// it's applied via the same service the UI uses" primitive — CLAUDE.md §9.
// One mechanism, reused by the setup wizard, automation actions, and future
// agents. Do not add a second approval mechanism.

export const suggestionStatusEnum = pgEnum("suggestion_status", [
  "pending",
  "approved", // apply() ran successfully
  "rejected",
  "superseded",
]);

export const suggestionSourceEnum = pgEnum("suggestion_source", [
  "setup_wizard",
  "automation",
  "ai_assist",
  "manual",
]);

// Each value maps to exactly one entry in KIND_REGISTRY (lib/services/suggestion.ts)
// with a Zod payload schema + an apply() that calls one existing service.
export const suggestionKindEnum = pgEnum("suggestion_kind", [
  "create_pipeline_stage",
  "create_custom_field_definition",
  "move_opportunity_stage",
  "create_task",
  "send_follow_up_email",
]);

export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source: suggestionSourceEnum("source").notNull(),
    kind: suggestionKindEnum("kind").notNull(),
    status: suggestionStatusEnum("status").notNull().default("pending"),
    // Validated against the kind's Zod schema at create time; typed as unknown
    // here and narrowed via the registry on read (CLAUDE.md §11).
    payload: jsonb("payload").$type<unknown>().notNull(),
    rationale: text("rationale"),
    // Polymorphic, like custom_field_values.entity_id — no FK; the creating
    // service is responsible for tenant-scoping the referenced entity.
    targetEntityType: text("target_entity_type"),
    targetEntityId: uuid("target_entity_id"),
    // Batches related proposals (e.g. one setup-wizard run) for "approve all".
    groupKey: text("group_key"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("suggestions_tenant_status_idx").on(table.tenantId, table.status)],
);

export type Suggestion = typeof suggestions.$inferSelect;
export type SuggestionStatus = (typeof suggestionStatusEnum.enumValues)[number];
export type SuggestionSource = (typeof suggestionSourceEnum.enumValues)[number];
export type SuggestionKind = (typeof suggestionKindEnum.enumValues)[number];
