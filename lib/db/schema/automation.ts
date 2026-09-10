import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenant";
import { users } from "./user";

// Declarative automation: trigger type + JSON conditions + a fixed enum of
// action handlers (CLAUDE.md §10). Not a DSL, not a visual builder, not a
// Turing-complete engine. Consequential actions go through a Suggestion.

export const automationTriggerEnum = pgEnum("automation_trigger", [
  "opportunity_stage_changed", // event
  "opportunity_created", // event
  "opportunity_idle", // scheduled: no activity in N days
]);

export const automationActionEnum = pgEnum("automation_action", [
  "create_task", // low-risk, reversible → applied directly
  "propose_opportunity_stage_change", // consequential → creates a Suggestion
  "draft_follow_up_email", // draft-only, never auto-sends
]);

export const automationRunStatusEnum = pgEnum("automation_run_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  trigger: automationTriggerEnum("trigger").notNull(),
  conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  action: automationActionEnum("action").notNull(),
  actionConfig: jsonb("action_config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  enabled: boolean("enabled").notNull().default(true),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Doubles as the job queue and the audit trail.
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    status: automationRunStatusEnum("status").notNull().default("pending"),
    triggerContext: jsonb("trigger_context").$type<Record<string, unknown>>().notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    resultSuggestionId: uuid("result_suggestion_id"),
    resultDraftId: uuid("result_draft_id"),
    error: text("error"),
    // Blocks a duplicate run for the same (rule, entity, occurrence).
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("automation_runs_status_scheduled_idx").on(table.status, table.scheduledFor),
    uniqueIndex("automation_runs_tenant_dedupe_unique").on(table.tenantId, table.dedupeKey),
  ],
);

export type AutomationRule = typeof automationRules.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type AutomationTrigger = (typeof automationTriggerEnum.enumValues)[number];
export type AutomationAction = (typeof automationActionEnum.enumValues)[number];
