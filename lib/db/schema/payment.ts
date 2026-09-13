import { index, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { users } from "./user";
import { accounts } from "./account";
import { invoices } from "./invoice";

/**
 * Customer receipts (CLAUDE.md ERP plan, Milestone 4). A payment is recorded
 * against an **account**, not a single invoice: `payment_allocations` spread it
 * across one or more open invoices and any unallocated remainder is held as
 * account credit (`getAccountBalance`). An invoice's `amount_paid` is always the
 * sum of its allocations, recomputed on every allocation change.
 */
export const paymentMethodEnum = pgEnum("payment_method", [
  "bank_transfer",
  "card",
  "cash",
  "direct_debit",
  "cheque",
  "other",
]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    method: paymentMethodEnum("method").notNull().default("bank_transfer"),
    reference: text("reference"),
    receivedDate: timestamp("received_date", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payments_tenant_account_idx").on(table.tenantId, table.accountId)],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payment_allocations_tenant_invoice_idx").on(table.tenantId, table.invoiceId),
    index("payment_allocations_tenant_payment_idx").on(table.tenantId, table.paymentId),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
