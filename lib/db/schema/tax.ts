import { pgEnum } from "drizzle-orm/pg-core";
import { TAX_TREATMENTS } from "@/lib/money";

/**
 * The VAT treatment of a supply line. Values are the single source of truth in
 * `lib/money.ts` (`computeDocumentTotals` only charges output VAT on `standard`);
 * this enum just makes them a Postgres type for the product / order / invoice
 * line columns.
 */
export const taxTreatmentEnum = pgEnum("tax_treatment", TAX_TREATMENTS);

export type { TaxTreatment } from "@/lib/money";
