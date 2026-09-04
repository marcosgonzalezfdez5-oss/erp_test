import { relations } from "drizzle-orm";
import { pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { users } from "./user";

// Fixed V1 role set — see CLAUDE.md §7/§17. Do not generalize into a
// custom-roles engine before a real customer needs more than this.
export const membershipRoleEnum = pgEnum("membership_role", [
  "admin",
  "sales_manager",
  "sales_rep",
]);

// Tenant-owned: carries tenant_id + an RLS policy (see migration 0001).
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("memberships_tenant_user_unique").on(table.tenantId, table.userId)],
);

export const membershipsRelations = relations(memberships, ({ one }) => ({
  tenant: one(tenants, { fields: [memberships.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = (typeof membershipRoleEnum.enumValues)[number];
