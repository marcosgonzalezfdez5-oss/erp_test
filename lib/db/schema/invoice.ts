import { boolean, index, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenant";
import { users } from "./user";
import { accounts } from "./account";
import { orders } from "./order";
import { products } from "./product";
import { taxTreatmentEnum } from "./tax";
import type { PostalAddress } from "./address";
import type { TaxGroup } from "@/lib/money";

/**
 * Invoicing (CLAUDE.md ERP plan, Milestone 4). One table carries both an
 * ordinary invoice (`INV-` series) and a rectifying credit note (`REC-` series),
 * discriminated by `document_type`. A `draft` may be hard-deleted; once
 * `issued` the number, both parties' legal identity and the line snapshots are
 * frozen and the only correction is a credit note (Spanish law — gapless,
 * immutable, per-VAT-rate + IRPF).
 */
export const invoiceDocumentTypeEnum = pgEnum("invoice_document_type", ["invoice", "credit_note"]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "void",
  "uncollectible",
]);

/** AEAT rectification reason codes (factura rectificativa). */
export const rectificationReasonEnum = pgEnum("rectification_reason", ["R1", "R2", "R3", "R4", "R5"]);

/** How a line entered the invoice — feeds the "don't over-invoice an order line" guard. */
export const invoiceLineSourceEnum = pgEnum("invoice_line_source", ["order_line", "shipment_line", "manual"]);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentType: invoiceDocumentTypeEnum("document_type").notNull().default("invoice"),
    number: text("number"), // null until issued, then INV-/REC- from the sequence
    status: invoiceStatusEnum("status").notNull().default("draft"),
    // Credit-note linkage (null on an ordinary invoice).
    rectifiesInvoiceId: uuid("rectifies_invoice_id"),
    rectificationReason: rectificationReasonEnum("rectification_reason"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    currency: text("currency").notNull().default("EUR"),
    issueDate: timestamp("issue_date", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    // Editable on a draft; frozen into billToSnapshot at issue.
    customerName: text("customer_name").notNull(),
    customerTaxId: text("customer_tax_id"),
    billingAddress: jsonb("billing_address").$type<PostalAddress>(),
    // Both parties' legal identity, frozen at issue.
    sellerSnapshot: jsonb("seller_snapshot").$type<PartySnapshot>(),
    billToSnapshot: jsonb("bill_to_snapshot").$type<PartySnapshot>(),
    subtotalAmount: numeric("subtotal_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    withholdingAmount: numeric("withholding_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).notNull().default("0.00"),
    taxSummary: jsonb("tax_summary").$type<TaxGroup[]>(),
    notes: text("notes"),
    terms: text("terms"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invoices_tenant_account_idx").on(table.tenantId, table.accountId),
    index("invoices_tenant_order_idx").on(table.tenantId, table.orderId),
    // Issued numbers are unique per tenant; drafts (null number) are exempt.
    uniqueIndex("invoices_tenant_number_unique")
      .on(table.tenantId, table.number)
      .where(sql`${table.number} is not null`),
  ],
);

export interface PartySnapshot {
  name: string;
  taxId: string | null;
  address: PostalAddress | null;
}

/**
 * A snapshotted invoice line — every price/tax field is frozen when the line is
 * created and immutable once the parent is `issued` (CLAUDE.md §12).
 */
export const invoiceLineItems = pgTable("invoice_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  sourceType: invoiceLineSourceEnum("source_type").notNull().default("manual"),
  sourceId: uuid("source_id"), // order_line_items.id or shipment_line_items.id; null for manual
  productId: uuid("product_id").references(() => products.id, { onDelete: "restrict" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitOfMeasure: text("unit_of_measure").notNull().default("unit"),
  listUnitPrice: numeric("list_unit_price", { precision: 12, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }),
  netUnitPrice: numeric("net_unit_price", { precision: 12, scale: 2 }).notNull(),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull(),
  taxTreatment: taxTreatmentEnum("tax_treatment").notNull().default("standard"),
  subjectToWithholding: boolean("subject_to_withholding").notNull().default(false),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }), // snapshot, for margin reporting
  lineBaseAmount: numeric("line_base_amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type InvoiceDocumentType = (typeof invoiceDocumentTypeEnum.enumValues)[number];
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];
export type RectificationReason = (typeof rectificationReasonEnum.enumValues)[number];
export type InvoiceLineSource = (typeof invoiceLineSourceEnum.enumValues)[number];
