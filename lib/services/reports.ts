import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts } from "@/lib/db/schema/account";
import { invoiceLineItems, invoices } from "@/lib/db/schema/invoice";
import { stockLevels } from "@/lib/db/schema/inventory";
import { products } from "@/lib/db/schema/product";
import { warehouses } from "@/lib/db/schema/warehouse";
import { withTenantContext } from "@/lib/db/tenant-context";
import { divRound, fromCents, toCents, toMilliUnits, type TaxTreatment } from "@/lib/money";

/**
 * Reporting (CLAUDE.md ERP plan, Milestone 5). Deterministic SQL + BigInt money
 * math over the existing tables — explicitly **not** the NL analytics agent
 * (§17, V4). Every function is read-only and tenant-scoped; the router gates
 * them to `manager+`.
 */

const dateRange = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

/** `quantity(milli) × unitPrice(cents) → amount(cents)`, half-away-from-zero. */
function extendCents(quantityMilli: bigint, unitCents: bigint): bigint {
  return divRound(quantityMilli * unitCents, 1_000n);
}

const PAID_STATUSES = ["issued", "partially_paid", "paid"] as const;

// ---------------------------------------------------------------------------
// AR aging

export const arAgingInput = z.object({ asOf: z.coerce.date().optional() }).optional();

export interface ArAgingRow {
  accountId: string | null;
  accountName: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  total: string;
}

/** Open invoice balances bucketed by days past the due date, per account. */
export async function arAging(tenantId: string, rawInput?: z.input<typeof arAgingInput>) {
  const input = arAgingInput.parse(rawInput);
  const asOf = input?.asOf ?? new Date();
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx
      .select({
        accountId: invoices.accountId,
        accountName: sql<string>`coalesce(${accounts.name}, ${invoices.customerName})`,
        total: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
        dueDate: invoices.dueDate,
        issueDate: invoices.issueDate,
      })
      .from(invoices)
      .leftJoin(accounts, eq(invoices.accountId, accounts.id))
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.documentType, "invoice"),
          inArray(invoices.status, ["issued", "partially_paid"]),
        ),
      );

    const byAccount = new Map<string, { name: string; buckets: bigint[] }>();
    for (const row of rows) {
      const outstanding = toCents(row.total) - toCents(row.amountPaid);
      if (outstanding <= 0n) continue;

      const ref = row.dueDate ?? row.issueDate ?? asOf;
      const daysPastDue = Math.floor((asOf.getTime() - ref.getTime()) / 86_400_000);
      const idx = daysPastDue <= 0 ? 0 : daysPastDue <= 30 ? 1 : daysPastDue <= 60 ? 2 : daysPastDue <= 90 ? 3 : 4;

      const key = row.accountId ?? `__${row.accountName}`;
      const entry = byAccount.get(key) ?? { name: row.accountName, buckets: [0n, 0n, 0n, 0n, 0n] };
      entry.buckets[idx] += outstanding;
      byAccount.set(key, entry);
    }

    const data: ArAgingRow[] = [...byAccount.entries()]
      .map(([key, { name, buckets }]) => ({
        accountId: key.startsWith("__") ? null : key,
        accountName: name,
        current: fromCents(buckets[0]),
        d1_30: fromCents(buckets[1]),
        d31_60: fromCents(buckets[2]),
        d61_90: fromCents(buckets[3]),
        d90_plus: fromCents(buckets[4]),
        total: fromCents(buckets.reduce((a, b) => a + b, 0n)),
      }))
      .sort((a, b) => a.accountName.localeCompare(b.accountName));

    const totals = sumRows(data, ["current", "d1_30", "d31_60", "d61_90", "d90_plus", "total"]);
    return { asOf, rows: data, totals };
  });
}

// ---------------------------------------------------------------------------
// stock valuation

export interface StockValuationRow {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  sku: string | null;
  quantityOnHand: string;
  unitCost: string;
  value: string;
}

/** On-hand quantity × the product's current unit cost, by warehouse and product. */
export async function stockValuation(tenantId: string) {
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx
      .select({
        warehouseId: stockLevels.warehouseId,
        warehouseName: warehouses.name,
        productId: stockLevels.productId,
        productName: products.name,
        sku: products.sku,
        quantityOnHand: stockLevels.quantityOnHand,
        costPrice: products.costPrice,
      })
      .from(stockLevels)
      .innerJoin(products, eq(stockLevels.productId, products.id))
      .innerJoin(warehouses, eq(stockLevels.warehouseId, warehouses.id))
      .where(and(eq(stockLevels.tenantId, tenantId), isNull(warehouses.deletedAt)))
      .orderBy(warehouses.name, products.name);

    const data: StockValuationRow[] = [];
    for (const row of rows) {
      const qtyMilli = toMilliUnits(row.quantityOnHand);
      if (qtyMilli === 0n) continue;
      const unitCents = toCents(row.costPrice ?? "0");
      data.push({
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        productId: row.productId,
        productName: row.productName,
        sku: row.sku,
        quantityOnHand: row.quantityOnHand,
        unitCost: fromCents(unitCents),
        value: fromCents(extendCents(qtyMilli, unitCents)),
      });
    }

    const byWarehouse = new Map<string, bigint>();
    for (const row of data) {
      byWarehouse.set(row.warehouseName, (byWarehouse.get(row.warehouseName) ?? 0n) + toCents(row.value));
    }
    const warehouseTotals = [...byWarehouse.entries()].map(([warehouseName, cents]) => ({
      warehouseName,
      value: fromCents(cents),
    }));

    return {
      rows: data,
      warehouseTotals,
      grandTotal: fromCents([...byWarehouse.values()].reduce((a, b) => a + b, 0n)),
    };
  });
}

// ---------------------------------------------------------------------------
// margin

export const marginInput = dateRange.partial().optional();

export interface MarginRow {
  productId: string | null;
  productName: string;
  revenue: string;
  cost: string;
  margin: string;
  marginPercent: string;
}

/**
 * Revenue (ex-tax, net of discount) vs snapshotted cost per product, over
 * issued invoices — credit notes counted as negatives. This is what Milestone
 * 0's cost capture pays for.
 */
export async function margin(tenantId: string, rawInput?: z.input<typeof marginInput>) {
  const input = marginInput.parse(rawInput);
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx
      .select({
        productId: invoiceLineItems.productId,
        productName: sql<string>`coalesce(${products.name}, ${invoiceLineItems.description})`,
        documentType: invoices.documentType,
        quantity: invoiceLineItems.quantity,
        lineBaseAmount: invoiceLineItems.lineBaseAmount,
        unitCost: invoiceLineItems.unitCost,
      })
      .from(invoiceLineItems)
      .innerJoin(invoices, eq(invoiceLineItems.invoiceId, invoices.id))
      .leftJoin(products, eq(invoiceLineItems.productId, products.id))
      .where(
        and(
          eq(invoiceLineItems.tenantId, tenantId),
          inArray(invoices.status, [...PAID_STATUSES]),
          issueDateBetween(input),
        ),
      );

    const byProduct = new Map<string, { name: string; revenue: bigint; cost: bigint }>();
    for (const row of rows) {
      const sign = row.documentType === "credit_note" ? -1n : 1n;
      const revenue = sign * toCents(row.lineBaseAmount);
      const cost = sign * extendCents(toMilliUnits(row.quantity), toCents(row.unitCost ?? "0"));
      const key = row.productId ?? `__${row.productName}`;
      const entry = byProduct.get(key) ?? { name: row.productName, revenue: 0n, cost: 0n };
      entry.revenue += revenue;
      entry.cost += cost;
      byProduct.set(key, entry);
    }

    const data: MarginRow[] = [...byProduct.entries()]
      .map(([key, { name, revenue, cost }]) => {
        const m = revenue - cost;
        return {
          productId: key.startsWith("__") ? null : key,
          productName: name,
          revenue: fromCents(revenue),
          cost: fromCents(cost),
          margin: fromCents(m),
          marginPercent: revenue === 0n ? "0.00" : fromCents(divRound(m * 10_000n, revenue)),
        };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));

    const totals = sumRows(data, ["revenue", "cost", "margin"]);
    const totalRevenue = toCents(totals.revenue);
    return {
      rows: data,
      totals: {
        ...totals,
        marginPercent: totalRevenue === 0n ? "0.00" : fromCents(divRound(toCents(totals.margin) * 10_000n, totalRevenue)),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// sales by VAT rate

export const salesByTaxRateInput = dateRange.partial().optional();

export interface SalesByTaxRateRow {
  taxRatePercent: string;
  taxTreatment: TaxTreatment;
  base: string;
  tax: string;
}

/** Taxable base + output VAT grouped by rate, over issued invoices — VAT-return input. */
export async function salesByTaxRate(tenantId: string, rawInput?: z.input<typeof salesByTaxRateInput>) {
  const input = salesByTaxRateInput.parse(rawInput);
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx
      .select({ documentType: invoices.documentType, taxSummary: invoices.taxSummary })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          inArray(invoices.status, [...PAID_STATUSES]),
          issueDateBetween(input),
        ),
      );

    const groups = new Map<string, { rate: string; treatment: TaxTreatment; base: bigint; tax: bigint }>();
    for (const row of rows) {
      const sign = row.documentType === "credit_note" ? -1n : 1n;
      for (const g of row.taxSummary ?? []) {
        const key = `${g.taxRatePercent}|${g.taxTreatment}`;
        const entry = groups.get(key) ?? { rate: g.taxRatePercent, treatment: g.taxTreatment, base: 0n, tax: 0n };
        entry.base += sign * toCents(g.base);
        entry.tax += sign * toCents(g.tax);
        groups.set(key, entry);
      }
    }

    const data: SalesByTaxRateRow[] = [...groups.values()]
      .map((g) => ({
        taxRatePercent: g.rate,
        taxTreatment: g.treatment,
        base: fromCents(g.base),
        tax: fromCents(g.tax),
      }))
      .sort((a, b) => Number(b.taxRatePercent) - Number(a.taxRatePercent));

    return { rows: data, totals: sumRows(data, ["base", "tax"]) };
  });
}

// ---------------------------------------------------------------------------
// shared

function issueDateBetween(input: { from?: Date; to?: Date } | undefined) {
  const clauses = [];
  if (input?.from) clauses.push(sql`${invoices.issueDate} >= ${input.from}`);
  if (input?.to) clauses.push(sql`${invoices.issueDate} <= ${input.to}`);
  return clauses.length ? and(...clauses) : undefined;
}

function sumRows<K extends string>(rows: Array<Record<K, string>>, keys: K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    out[key] = fromCents(rows.reduce((acc, r) => acc + toCents(r[key]), 0n));
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSV

/** RFC-4180 CSV: quote every field, double embedded quotes. */
export function toCsv(headers: string[], records: Array<Array<string | number | null>>): string {
  const cell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers, ...records].map((row) => row.map(cell).join(",")).join("\r\n");
}

export function arAgingCsv(data: Awaited<ReturnType<typeof arAging>>): string {
  return toCsv(
    ["Account", "Current", "1-30", "31-60", "61-90", "90+", "Total"],
    [
      ...data.rows.map((r) => [r.accountName, r.current, r.d1_30, r.d31_60, r.d61_90, r.d90_plus, r.total]),
      ["Total", data.totals.current, data.totals.d1_30, data.totals.d31_60, data.totals.d61_90, data.totals.d90_plus, data.totals.total],
    ],
  );
}

export function stockValuationCsv(data: Awaited<ReturnType<typeof stockValuation>>): string {
  return toCsv(
    ["Warehouse", "Product", "SKU", "On hand", "Unit cost", "Value"],
    [
      ...data.rows.map((r) => [r.warehouseName, r.productName, r.sku, r.quantityOnHand, r.unitCost, r.value]),
      ["Total", "", "", "", "", data.grandTotal],
    ],
  );
}

export function marginCsv(data: Awaited<ReturnType<typeof margin>>): string {
  return toCsv(
    ["Product", "Revenue", "Cost", "Margin", "Margin %"],
    [
      ...data.rows.map((r) => [r.productName, r.revenue, r.cost, r.margin, r.marginPercent]),
      ["Total", data.totals.revenue, data.totals.cost, data.totals.margin, data.totals.marginPercent],
    ],
  );
}

export function salesByTaxRateCsv(data: Awaited<ReturnType<typeof salesByTaxRate>>): string {
  return toCsv(
    ["Rate %", "Treatment", "Base", "VAT"],
    [
      ...data.rows.map((r) => [r.taxRatePercent, r.taxTreatment, r.base, r.tax]),
      ["Total", "", data.totals.base, data.totals.tax],
    ],
  );
}
