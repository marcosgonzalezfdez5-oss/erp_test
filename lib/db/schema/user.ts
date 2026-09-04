import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// A user can belong to multiple tenants (via membership), so this table is
// not tenant-scoped either — see CLAUDE.md §7.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
