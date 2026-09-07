import { boolean, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";

// Deliberately a small fixed set — not full EAV. See CLAUDE.md §6/§17.
export const customFieldEntityTypeEnum = pgEnum("custom_field_entity_type", ["account", "opportunity"]);
export const customFieldTypeEnum = pgEnum("custom_field_type", ["text", "number", "date", "select", "boolean"]);

export const customFieldDefinitions = pgTable("custom_field_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  entityType: customFieldEntityTypeEnum("entity_type").notNull(),
  name: text("name").notNull(),
  fieldType: customFieldTypeEnum("field_type").notNull(),
  // Only meaningful (and populated) when fieldType === "select".
  options: jsonb("options").$type<string[] | null>(),
  required: boolean("required").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;

// entityId is polymorphic (an accounts.id or opportunities.id depending on
// the definition's entityType) so it can't carry a single FK — the
// definition's entityType is the source of truth for which table it targets,
// and services must check entityId belongs to the tenant themselves.
export const customFieldValues = pgTable(
  "custom_field_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id").notNull(),
    value: jsonb("value").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("custom_field_values_definition_entity_unique").on(table.definitionId, table.entityId)],
);

export type CustomFieldValue = typeof customFieldValues.$inferSelect;
