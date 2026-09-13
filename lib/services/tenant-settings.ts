import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorize";
import type { ActorContext } from "@/lib/auth/actor";
import type { PostalAddress } from "@/lib/db/schema/address";
import { tenantSettings } from "@/lib/db/schema/tenant-settings";
import { withTenantContext, type Tx } from "@/lib/db/tenant-context";

const MANAGER_ROLES: ActorContext["role"][] = ["admin", "sales_manager"];

/** The effective settings for a tenant — never null, defaults fill the gaps. */
export interface ResolvedTenantSettings {
  tenantId: string;
  legalName: string | null;
  taxId: string | null;
  legalAddress: PostalAddress | null;
  defaultCurrency: string;
  defaultTaxRatePercent: string;
  irpfEnabled: boolean;
  irpfRatePercent: string;
  orderNumberFormat: string;
  deliveryNoteNumberFormat: string;
  invoiceNumberFormat: string;
  creditNoteNumberFormat: string;
  defaultPaymentTermsDays: number;
  allowNegativeStock: boolean;
}

/** Must mirror the column defaults in lib/db/schema/tenant-settings.ts. */
export const TENANT_SETTINGS_DEFAULTS: Omit<ResolvedTenantSettings, "tenantId"> = {
  legalName: null,
  taxId: null,
  legalAddress: null,
  defaultCurrency: "EUR",
  defaultTaxRatePercent: "21.00",
  irpfEnabled: false,
  irpfRatePercent: "15.00",
  orderNumberFormat: "SO-{YYYY}-{SEQ:4}",
  deliveryNoteNumberFormat: "DN-{YYYY}-{SEQ:4}",
  invoiceNumberFormat: "INV-{YYYY}-{SEQ:4}",
  creditNoteNumberFormat: "REC-{YYYY}-{SEQ:4}",
  defaultPaymentTermsDays: 30,
  allowNegativeStock: true,
};

const postalAddress: z.ZodType<PostalAddress> = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().min(1).max(20),
  province: z.string().trim().max(120).optional(),
  country: z.string().trim().length(2).toUpperCase(),
});

const percent = z.number().min(0).max(100).multipleOf(0.01);
const numberFormat = z.string().trim().min(1).max(60);

export const updateTenantSettingsInput = z.object({
  legalName: z.string().trim().max(200).nullish(),
  taxId: z.string().trim().max(40).nullish(),
  legalAddress: postalAddress.nullish(),
  defaultCurrency: z.string().trim().length(3).toUpperCase().optional(),
  defaultTaxRatePercent: percent.optional(),
  irpfEnabled: z.boolean().optional(),
  irpfRatePercent: percent.optional(),
  orderNumberFormat: numberFormat.optional(),
  deliveryNoteNumberFormat: numberFormat.optional(),
  invoiceNumberFormat: numberFormat.optional(),
  creditNoteNumberFormat: numberFormat.optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
  allowNegativeStock: z.boolean().optional(),
});

function resolve(tenantId: string, row: typeof tenantSettings.$inferSelect | undefined): ResolvedTenantSettings {
  if (!row) return { tenantId, ...TENANT_SETTINGS_DEFAULTS };
  return {
    tenantId,
    legalName: row.legalName,
    taxId: row.taxId,
    legalAddress: row.legalAddress ?? null,
    defaultCurrency: row.defaultCurrency,
    defaultTaxRatePercent: row.defaultTaxRatePercent,
    irpfEnabled: row.irpfEnabled,
    irpfRatePercent: row.irpfRatePercent,
    orderNumberFormat: row.orderNumberFormat,
    deliveryNoteNumberFormat: row.deliveryNoteNumberFormat,
    invoiceNumberFormat: row.invoiceNumberFormat,
    creditNoteNumberFormat: row.creditNoteNumberFormat,
    defaultPaymentTermsDays: row.defaultPaymentTermsDays,
    allowNegativeStock: row.allowNegativeStock,
  };
}

/** Reads (or synthesizes) settings on a caller-supplied transaction. */
export async function readSettings(tx: Tx, tenantId: string): Promise<ResolvedTenantSettings> {
  const [row] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
  return resolve(tenantId, row);
}

export function getSettings(tenantId: string): Promise<ResolvedTenantSettings> {
  return withTenantContext(tenantId, (tx) => readSettings(tx, tenantId));
}

/** Numeric money-style fields cross the wire as numbers; persist as fixed strings. */
function toColumnValues(input: z.infer<typeof updateTenantSettingsInput>) {
  const values: Partial<typeof tenantSettings.$inferInsert> = {};
  if (input.legalName !== undefined) values.legalName = input.legalName ?? null;
  if (input.taxId !== undefined) values.taxId = input.taxId ?? null;
  if (input.legalAddress !== undefined) values.legalAddress = input.legalAddress ?? null;
  if (input.defaultCurrency !== undefined) values.defaultCurrency = input.defaultCurrency;
  if (input.defaultTaxRatePercent !== undefined) values.defaultTaxRatePercent = input.defaultTaxRatePercent.toFixed(2);
  if (input.irpfEnabled !== undefined) values.irpfEnabled = input.irpfEnabled;
  if (input.irpfRatePercent !== undefined) values.irpfRatePercent = input.irpfRatePercent.toFixed(2);
  if (input.orderNumberFormat !== undefined) values.orderNumberFormat = input.orderNumberFormat;
  if (input.deliveryNoteNumberFormat !== undefined) values.deliveryNoteNumberFormat = input.deliveryNoteNumberFormat;
  if (input.invoiceNumberFormat !== undefined) values.invoiceNumberFormat = input.invoiceNumberFormat;
  if (input.creditNoteNumberFormat !== undefined) values.creditNoteNumberFormat = input.creditNoteNumberFormat;
  if (input.defaultPaymentTermsDays !== undefined) values.defaultPaymentTermsDays = input.defaultPaymentTermsDays;
  if (input.allowNegativeStock !== undefined) values.allowNegativeStock = input.allowNegativeStock;
  return values;
}

export async function updateSettings(
  actor: ActorContext,
  rawInput: z.input<typeof updateTenantSettingsInput>,
): Promise<ResolvedTenantSettings> {
  requireRole(actor.role, MANAGER_ROLES);
  // Re-validate here so normalization (upper-casing country/currency codes,
  // fixed-scale rates) is guaranteed even for a direct service/tool caller.
  const values = toColumnValues(updateTenantSettingsInput.parse(rawInput));

  const [row] = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .insert(tenantSettings)
      .values({ tenantId: actor.tenantId, ...values })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      })
      .returning(),
  );
  return resolve(actor.tenantId, row);
}
