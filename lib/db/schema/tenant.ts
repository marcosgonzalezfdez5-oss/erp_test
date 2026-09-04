import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Not a "tenant-owned" table (it IS the tenant), so no tenant_id/RLS here —
// see CLAUDE.md §7. Scoped lookup is by clerkOrgId during session sync.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
