import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import type { PostalAddress } from "./address";

/**
 * One row per tenant — the fiscal identity and the defaults every later
 * document (orders, delivery notes, invoices, credit notes) reads. A normal
 * tenant-owned table with its own RLS policy, distinct from `tenants` itself
 * (CLAUDE.md §7). The service returns synthesized defaults when no row exists,
 * so reads never need the row to be pre-created.
 */
export const tenantSettings = pgTable(
  "tenant_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Seller identity — legally required on every invoice. Nullable until set;
    // issuing an invoice with these unset raises a typed PRECONDITION_FAILED.
    legalName: text("legal_name"),
    taxId: text("tax_id"), // NIF / CIF
    legalAddress: jsonb("legal_address").$type<PostalAddress>(),
    defaultCurrency: text("default_currency").notNull().default("EUR"),
    defaultTaxRatePercent: numeric("default_tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("21.00"),
    // Professional-services withholding (retención IRPF).
    irpfEnabled: boolean("irpf_enabled").notNull().default(false),
    irpfRatePercent: numeric("irpf_rate_percent", { precision: 5, scale: 2 }).notNull().default("15.00"),
    // Human-readable number templates: {YYYY}/{YY} = period, {SEQ:n} = zero-padded counter.
    orderNumberFormat: text("order_number_format").notNull().default("SO-{YYYY}-{SEQ:4}"),
    deliveryNoteNumberFormat: text("delivery_note_number_format").notNull().default("DN-{YYYY}-{SEQ:4}"),
    invoiceNumberFormat: text("invoice_number_format").notNull().default("INV-{YYYY}-{SEQ:4}"),
    creditNoteNumberFormat: text("credit_note_number_format").notNull().default("REC-{YYYY}-{SEQ:4}"),
    defaultPaymentTermsDays: integer("default_payment_terms_days").notNull().default(30),
    // false → confirming an order short on stock is blocked; true → allowed and the line is flagged.
    allowNegativeStock: boolean("allow_negative_stock").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("tenant_settings_tenant_unique").on(table.tenantId)],
);

export type TenantSettings = typeof tenantSettings.$inferSelect;
