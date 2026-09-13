import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { isSystemActor } from "@/lib/auth/actor";
import { requireRole } from "@/lib/auth/authorize";
import { accounts } from "@/lib/db/schema/account";
import {
  invoiceDocumentTypeEnum,
  invoiceLineItems,
  invoiceStatusEnum,
  invoices,
  rectificationReasonEnum,
  type Invoice,
  type InvoiceLineItem,
  type InvoiceLineSource,
  type PartySnapshot,
  type RectificationReason,
} from "@/lib/db/schema/invoice";
import { orders, orderLineItems, type OrderInvoiceStatus } from "@/lib/db/schema/order";
import { products } from "@/lib/db/schema/product";
import { shipmentLineItems, shipments } from "@/lib/db/schema/shipment";
import { paymentAllocations, payments } from "@/lib/db/schema/payment";
import { withTenantContext, type Tx } from "@/lib/db/tenant-context";
import {
  computeDocumentTotals,
  fromMilliUnits,
  toMilliUnits,
  type DocumentLineInput,
  type TaxTreatment,
} from "@/lib/money";
import { recordAudit } from "./audit";
import { allocate as allocateSequence, formatDocumentNumber } from "./sequence";
import { readSettings } from "./tenant-settings";

const MANAGER_ROLES: ActorContext["role"][] = ["admin", "sales_manager"];
export const INVOICE_PAGE_SIZE = 20;

const quantity = z.number().positive().multipleOf(0.001).max(1_000_000);
const discountPercent = z.number().min(0).max(100).multipleOf(0.01);

// ---------------------------------------------------------------------------
// line snapshot helpers

interface LineSnapshot {
  sourceType: InvoiceLineSource;
  sourceId: string | null;
  productId: string | null;
  description: string;
  quantity: string;
  unitOfMeasure: string;
  listUnitPrice: string;
  discountPercent: string;
  discountAmount: string | null;
  taxRatePercent: string;
  taxTreatment: TaxTreatment;
  subjectToWithholding: boolean;
  unitCost: string | null;
}

function toDocumentLine(line: {
  listUnitPrice: string;
  quantity: string;
  discountPercent: string;
  discountAmount: string | null;
  taxRatePercent: string;
  taxTreatment: TaxTreatment;
  subjectToWithholding: boolean;
}): DocumentLineInput {
  return {
    listUnitPrice: line.listUnitPrice,
    quantity: line.quantity,
    discountPercent: line.discountPercent,
    discountAmount: line.discountAmount ?? undefined,
    taxRatePercent: line.taxRatePercent,
    taxTreatment: line.taxTreatment,
    subjectToWithholding: line.subjectToWithholding,
  };
}

function lineAmounts(line: LineSnapshot): { netUnitPrice: string; lineBaseAmount: string } {
  const [computed] = computeDocumentTotals([toDocumentLine(line)]).lines;
  return { netUnitPrice: computed.netUnitPrice, lineBaseAmount: computed.lineBase };
}

async function insertLine(tx: Tx, tenantId: string, invoiceId: string, line: LineSnapshot): Promise<InvoiceLineItem> {
  const { netUnitPrice, lineBaseAmount } = lineAmounts(line);
  const [row] = await tx
    .insert(invoiceLineItems)
    .values({ tenantId, invoiceId, ...line, netUnitPrice, lineBaseAmount })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// lookups

async function requireInvoice(tx: Tx, tenantId: string, id: string, forUpdate = false): Promise<Invoice> {
  const base = tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)));
  const [row] = await (forUpdate ? base.for("update") : base);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
  return row;
}

async function requireDraftInvoice(tx: Tx, tenantId: string, id: string): Promise<Invoice> {
  const invoice = await requireInvoice(tx, tenantId, id);
  if (invoice.status !== "draft") {
    throw new TRPCError({ code: "CONFLICT", message: `Only a draft invoice can be edited (this one is ${invoice.status}).` });
  }
  return invoice;
}

async function requireProduct(tx: Tx, tenantId: string, productId: string): Promise<typeof products.$inferSelect> {
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId), isNull(products.deletedAt)));
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
  return product;
}

async function requireAccount(tx: Tx, tenantId: string, accountId: string): Promise<typeof accounts.$inferSelect> {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, accountId), isNull(accounts.deletedAt)));
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
  return account;
}

// ---------------------------------------------------------------------------
// order-line coverage — the "don't over-invoice a line" bookkeeping

/** Resolves the order line an invoice line ultimately draws from, if any. */
async function orderLineIdFor(tx: Tx, tenantId: string, line: InvoiceLineItem): Promise<string | null> {
  if (line.sourceType === "order_line") return line.sourceId;
  if (line.sourceType === "shipment_line" && line.sourceId) {
    const [sli] = await tx
      .select({ orderLineItemId: shipmentLineItems.orderLineItemId })
      .from(shipmentLineItems)
      .where(and(eq(shipmentLineItems.tenantId, tenantId), eq(shipmentLineItems.id, line.sourceId)));
    return sli?.orderLineItemId ?? null;
  }
  return null;
}

/**
 * Adds (`sign` +1, on issue) or removes (`sign` -1, on a credit note) each
 * covered order line's invoiced quantity. On issue it also refuses to let an
 * order line be invoiced beyond what was ordered — across the order and the
 * shipment paths both.
 */
async function applyInvoicedQuantities(
  tx: Tx,
  tenantId: string,
  lines: InvoiceLineItem[],
  sign: 1 | -1,
): Promise<Set<string>> {
  const perOrderLine = new Map<string, bigint>();
  for (const line of lines) {
    const orderLineId = await orderLineIdFor(tx, tenantId, line);
    if (!orderLineId) continue;
    perOrderLine.set(orderLineId, (perOrderLine.get(orderLineId) ?? 0n) + toMilliUnits(line.quantity));
  }

  const touchedOrders = new Set<string>();
  for (const [orderLineId, deltaMilli] of perOrderLine) {
    const [orderLine] = await tx
      .select()
      .from(orderLineItems)
      .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.id, orderLineId)))
      .for("update");
    if (!orderLine) continue;

    const next = toMilliUnits(orderLine.quantityInvoiced) + BigInt(sign) * deltaMilli;
    if (sign === 1 && next > toMilliUnits(orderLine.quantity)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `"${orderLine.description}" would be invoiced for more than was ordered.`,
      });
    }
    await tx
      .update(orderLineItems)
      .set({ quantityInvoiced: fromMilliUnits(next < 0n ? 0n : next) })
      .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.id, orderLineId)));
    touchedOrders.add(orderLine.orderId);
  }
  return touchedOrders;
}

async function recomputeOrderInvoiceStatus(tx: Tx, tenantId: string, orderId: string): Promise<void> {
  const lines = await tx
    .select({ quantity: orderLineItems.quantity, quantityInvoiced: orderLineItems.quantityInvoiced })
    .from(orderLineItems)
    .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.orderId, orderId)));

  let anyInvoiced = false;
  let allInvoiced = lines.length > 0;
  for (const line of lines) {
    const invoiced = toMilliUnits(line.quantityInvoiced);
    if (invoiced > 0n) anyInvoiced = true;
    if (invoiced < toMilliUnits(line.quantity)) allInvoiced = false;
  }
  const status: OrderInvoiceStatus = allInvoiced ? "invoiced" : anyInvoiced ? "partially_invoiced" : "uninvoiced";
  await tx
    .update(orders)
    .set({ invoiceStatus: status, updatedAt: new Date() })
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
}

// ---------------------------------------------------------------------------
// totals + payment status

/** Recomputes the money/tax totals from the current lines (never touches amountPaid). */
async function recalculateTotals(tx: Tx, tenantId: string, invoiceId: string): Promise<void> {
  const [lines, settings] = await Promise.all([
    tx
      .select()
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.tenantId, tenantId), eq(invoiceLineItems.invoiceId, invoiceId)))
      .orderBy(asc(invoiceLineItems.createdAt)),
    readSettings(tx, tenantId),
  ]);

  const totals = computeDocumentTotals(lines.map(toDocumentLine), {
    withholdingRatePercent: settings.irpfEnabled ? settings.irpfRatePercent : undefined,
  });

  await tx
    .update(invoices)
    .set({
      subtotalAmount: totals.subtotal,
      taxAmount: totals.taxTotal,
      withholdingAmount: totals.withholding,
      totalAmount: totals.total,
      taxSummary: totals.taxGroups,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
}

/**
 * Re-derives `amount_paid` (= Σ allocations) and the payment status for one
 * invoice. Called by the payment service on every allocation change and here
 * after issue. A draft/void invoice keeps its status.
 */
export async function recomputeInvoicePaymentStatus(tx: Tx, tenantId: string, invoiceId: string): Promise<void> {
  const invoice = await requireInvoice(tx, tenantId, invoiceId);
  if (invoice.status === "draft" || invoice.status === "void") return;

  const [{ paid }] = await tx
    .select({ paid: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)` })
    .from(paymentAllocations)
    .where(and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.invoiceId, invoiceId)));

  const paidMilli = toMilliUnits(paid);
  const totalMilli = toMilliUnits(invoice.totalAmount);
  const status =
    paidMilli <= 0n ? "issued" : paidMilli >= totalMilli ? "paid" : "partially_paid";

  await tx
    .update(invoices)
    .set({ amountPaid: paid, status, updatedAt: new Date() })
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
}

// ---------------------------------------------------------------------------
// creation

export const createInvoiceFromOrderInput = z.object({
  orderId: z.string().uuid(),
  /** Restrict to these order lines; default is every line with a remaining quantity. */
  orderLineItemIds: z.array(z.string().uuid()).optional(),
});

export async function createInvoiceFromOrder(
  actor: ActorContext,
  rawInput: z.input<typeof createInvoiceFromOrderInput>,
): Promise<Invoice> {
  const input = createInvoiceFromOrderInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId), isNull(orders.deletedAt)));
    if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    if (order.status === "draft" || order.status === "cancelled") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `A ${order.status} order can't be invoiced.` });
    }

    const lineRows = await tx
      .select()
      .from(orderLineItems)
      .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.orderId, input.orderId)))
      .orderBy(asc(orderLineItems.createdAt));

    const wanted = input.orderLineItemIds ? new Set(input.orderLineItemIds) : null;
    const snapshots: LineSnapshot[] = [];
    for (const line of lineRows) {
      if (wanted && !wanted.has(line.id)) continue;
      const remaining = toMilliUnits(line.quantity) - toMilliUnits(line.quantityInvoiced);
      if (remaining <= 0n) continue;
      snapshots.push({
        sourceType: "order_line",
        sourceId: line.id,
        productId: line.productId,
        description: line.description,
        quantity: fromMilliUnits(remaining),
        unitOfMeasure: line.unitOfMeasure,
        listUnitPrice: line.listUnitPrice,
        discountPercent: line.discountPercent,
        discountAmount: line.discountAmount,
        taxRatePercent: line.taxRatePercent,
        taxTreatment: line.taxTreatment,
        subjectToWithholding: line.subjectToWithholding,
        unitCost: line.unitCost,
      });
    }
    if (snapshots.length === 0) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Nothing left to invoice on this order." });
    }

    const account = order.accountId ? await requireAccount(tx, tenantId, order.accountId) : null;
    const invoice = await insertInvoice(tx, tenantId, actor, {
      accountId: order.accountId,
      orderId: order.id,
      currency: order.currency,
      customerName: account?.name ?? "—",
      billingAddress: order.billingAddress ?? null,
    });
    for (const snap of snapshots) await insertLine(tx, tenantId, invoice.id, snap);
    await recalculateTotals(tx, tenantId, invoice.id);
    return requireInvoice(tx, tenantId, invoice.id);
  });
}

export const createInvoiceFromShipmentsInput = z.object({
  orderId: z.string().uuid(),
  shipmentIds: z.array(z.string().uuid()).min(1),
});

export async function createInvoiceFromShipments(
  actor: ActorContext,
  rawInput: z.input<typeof createInvoiceFromShipmentsInput>,
): Promise<Invoice> {
  const input = createInvoiceFromShipmentsInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId), isNull(orders.deletedAt)));
    if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });

    const shipmentRows = await tx
      .select({ id: shipments.id, status: shipments.status })
      .from(shipments)
      .where(
        and(
          eq(shipments.tenantId, tenantId),
          eq(shipments.orderId, input.orderId),
          inArray(shipments.id, input.shipmentIds),
          isNull(shipments.deletedAt),
        ),
      );
    if (shipmentRows.length !== input.shipmentIds.length) {
      throw new TRPCError({ code: "NOT_FOUND", message: "One or more shipments not found on this order" });
    }
    if (shipmentRows.some((s) => s.status === "cancelled")) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A cancelled shipment can't be invoiced." });
    }

    // shipment line + its order line, summed per shipment line
    const rows = await tx
      .select({ sli: shipmentLineItems, orderLine: orderLineItems })
      .from(shipmentLineItems)
      .innerJoin(orderLineItems, eq(shipmentLineItems.orderLineItemId, orderLineItems.id))
      .where(
        and(
          eq(shipmentLineItems.tenantId, tenantId),
          inArray(shipmentLineItems.shipmentId, input.shipmentIds),
        ),
      )
      .orderBy(asc(orderLineItems.createdAt));

    const snapshots: LineSnapshot[] = rows.map(({ sli, orderLine }) => ({
      sourceType: "shipment_line",
      sourceId: sli.id,
      productId: sli.productId,
      description: sli.description,
      quantity: sli.quantity,
      unitOfMeasure: orderLine.unitOfMeasure,
      listUnitPrice: orderLine.listUnitPrice,
      discountPercent: orderLine.discountPercent,
      discountAmount: orderLine.discountAmount,
      taxRatePercent: orderLine.taxRatePercent,
      taxTreatment: orderLine.taxTreatment,
      subjectToWithholding: orderLine.subjectToWithholding,
      unitCost: sli.unitCost ?? orderLine.unitCost,
    }));
    if (snapshots.length === 0) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The selected shipments have no lines to invoice." });
    }

    const account = order.accountId ? await requireAccount(tx, tenantId, order.accountId) : null;
    const invoice = await insertInvoice(tx, tenantId, actor, {
      accountId: order.accountId,
      orderId: order.id,
      currency: order.currency,
      customerName: account?.name ?? "—",
      billingAddress: order.billingAddress ?? null,
    });
    for (const snap of snapshots) await insertLine(tx, tenantId, invoice.id, snap);
    await recalculateTotals(tx, tenantId, invoice.id);
    return requireInvoice(tx, tenantId, invoice.id);
  });
}

export const createBlankInvoiceInput = z.object({
  accountId: z.string().uuid(),
  customerTaxId: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
  terms: z.string().trim().max(2000).optional(),
});

export async function createBlankInvoice(
  actor: ActorContext,
  rawInput: z.input<typeof createBlankInvoiceInput>,
): Promise<Invoice> {
  const input = createBlankInvoiceInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const account = await requireAccount(tx, tenantId, input.accountId);
    const settings = await readSettings(tx, tenantId);
    return insertInvoice(tx, tenantId, actor, {
      accountId: account.id,
      orderId: null,
      currency: settings.defaultCurrency,
      customerName: account.name,
      customerTaxId: input.customerTaxId ?? null,
      billingAddress: null,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
    });
  });
}

async function insertInvoice(
  tx: Tx,
  tenantId: string,
  actor: ActorContext,
  values: Partial<typeof invoices.$inferInsert> & { customerName: string },
): Promise<Invoice> {
  const [row] = await tx
    .insert(invoices)
    .values({
      tenantId,
      documentType: "invoice",
      status: "draft",
      createdByUserId: isSystemActor(actor) ? null : actor.userId,
      ...values,
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// draft line editing

export const addInvoiceLineInput = z.object({
  invoiceId: z.string().uuid(),
  productId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(500).optional(),
  quantity,
  discountPercent: discountPercent.default(0),
  taxRatePercent: z.number().min(0).max(100).multipleOf(0.01).optional(),
});

export async function addInvoiceLine(
  actor: ActorContext,
  rawInput: z.input<typeof addInvoiceLineInput>,
): Promise<InvoiceLineItem> {
  const input = addInvoiceLineInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    await requireDraftInvoice(tx, tenantId, input.invoiceId);
    const settings = await readSettings(tx, tenantId);
    const product = input.productId ? await requireProduct(tx, tenantId, input.productId) : null;
    if (!product && !input.description) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "A line needs a product or a description." });
    }

    const line = await insertLine(tx, tenantId, input.invoiceId, {
      sourceType: "manual",
      sourceId: null,
      productId: product?.id ?? null,
      description: input.description ?? product!.name,
      quantity: input.quantity.toFixed(3),
      unitOfMeasure: product?.unitOfMeasure ?? "unit",
      listUnitPrice: product?.unitPrice ?? "0.00",
      discountPercent: input.discountPercent.toFixed(2),
      discountAmount: null,
      taxRatePercent:
        input.taxRatePercent !== undefined
          ? input.taxRatePercent.toFixed(2)
          : product?.taxRatePercent ?? settings.defaultTaxRatePercent,
      taxTreatment: product?.taxTreatment ?? "standard",
      subjectToWithholding: product?.subjectToWithholding ?? false,
      unitCost: product?.costPrice ?? null,
    });
    await recalculateTotals(tx, tenantId, input.invoiceId);
    return line;
  });
}

export const updateInvoiceLineInput = z.object({
  id: z.string().uuid(),
  quantity: quantity.optional(),
  discountPercent: discountPercent.optional(),
});

export async function updateInvoiceLine(
  actor: ActorContext,
  rawInput: z.input<typeof updateInvoiceLineInput>,
): Promise<InvoiceLineItem> {
  const input = updateInvoiceLineInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.tenantId, tenantId), eq(invoiceLineItems.id, input.id)));
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Line item not found" });
    await requireDraftInvoice(tx, tenantId, existing.invoiceId);

    const next: LineSnapshot = {
      sourceType: existing.sourceType,
      sourceId: existing.sourceId,
      productId: existing.productId,
      description: existing.description,
      quantity: input.quantity !== undefined ? input.quantity.toFixed(3) : existing.quantity,
      unitOfMeasure: existing.unitOfMeasure,
      listUnitPrice: existing.listUnitPrice,
      discountPercent: input.discountPercent !== undefined ? input.discountPercent.toFixed(2) : existing.discountPercent,
      discountAmount: existing.discountAmount,
      taxRatePercent: existing.taxRatePercent,
      taxTreatment: existing.taxTreatment,
      subjectToWithholding: existing.subjectToWithholding,
      unitCost: existing.unitCost,
    };
    const { netUnitPrice, lineBaseAmount } = lineAmounts(next);
    const [row] = await tx
      .update(invoiceLineItems)
      .set({ quantity: next.quantity, discountPercent: next.discountPercent, netUnitPrice, lineBaseAmount })
      .where(and(eq(invoiceLineItems.tenantId, tenantId), eq(invoiceLineItems.id, input.id)))
      .returning();
    await recalculateTotals(tx, tenantId, existing.invoiceId);
    return row;
  });
}

export async function removeInvoiceLine(actor: ActorContext, id: string): Promise<void> {
  const { tenantId } = actor;
  await withTenantContext(tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.tenantId, tenantId), eq(invoiceLineItems.id, id)));
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Line item not found" });
    await requireDraftInvoice(tx, tenantId, existing.invoiceId);
    await tx.delete(invoiceLineItems).where(and(eq(invoiceLineItems.tenantId, tenantId), eq(invoiceLineItems.id, id)));
    await recalculateTotals(tx, tenantId, existing.invoiceId);
  });
}

export const updateInvoiceInput = z.object({
  id: z.string().uuid(),
  customerName: z.string().trim().min(1).max(200).optional(),
  customerTaxId: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  terms: z.string().trim().max(2000).nullish(),
});

export async function updateInvoice(actor: ActorContext, rawInput: z.input<typeof updateInvoiceInput>): Promise<Invoice> {
  const input = updateInvoiceInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    await requireDraftInvoice(tx, tenantId, input.id);
    const [row] = await tx
      .update(invoices)
      .set({
        ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
        ...(input.customerTaxId !== undefined ? { customerTaxId: input.customerTaxId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.terms !== undefined ? { terms: input.terms } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, input.id)))
      .returning();
    return row;
  });
}

export async function deleteInvoice(actor: ActorContext, id: string): Promise<void> {
  const { tenantId } = actor;
  await withTenantContext(tenantId, async (tx) => {
    await requireDraftInvoice(tx, tenantId, id);
    await tx.delete(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)));
  });
}

// ---------------------------------------------------------------------------
// issue

export const issueInvoiceInput = z.object({ id: z.string().uuid() });

/**
 * Draft → issued: allocates the gapless `INV-` number inside this transaction,
 * freezes both parties' legal identity, sets the issue + due dates, and commits
 * the invoiced quantity onto every covered order line (refusing to over-invoice
 * one). Blocked with a typed `PRECONDITION_FAILED` until the tenant's own legal
 * identity is configured.
 */
export async function issueInvoice(actor: ActorContext, rawInput: z.input<typeof issueInvoiceInput>): Promise<Invoice> {
  const input = issueInvoiceInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const invoice = await requireInvoice(tx, tenantId, input.id, true);
    if (invoice.status !== "draft") {
      throw new TRPCError({ code: "CONFLICT", message: `Invoice is already ${invoice.status}.` });
    }
    if (invoice.documentType !== "invoice") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Use rectifyInvoice to issue a credit note." });
    }

    const settings = await readSettings(tx, tenantId);
    if (!settings.legalName || !settings.taxId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Set your company legal name and tax ID in settings before issuing invoices.",
      });
    }

    const lines = await tx
      .select()
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.tenantId, tenantId), eq(invoiceLineItems.invoiceId, invoice.id)));
    if (lines.length === 0) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "An invoice needs at least one line." });
    }

    await recalculateTotals(tx, tenantId, invoice.id);
    const touchedOrders = await applyInvoicedQuantities(tx, tenantId, lines, 1);

    const now = new Date();
    const period = now.getUTCFullYear();
    const seq = await allocateSequence(tx, tenantId, "invoice", period);
    const dueDate = new Date(now.getTime() + settings.defaultPaymentTermsDays * 86_400_000);

    const sellerSnapshot: PartySnapshot = {
      name: settings.legalName,
      taxId: settings.taxId,
      address: settings.legalAddress,
    };
    const billToSnapshot: PartySnapshot = {
      name: invoice.customerName,
      taxId: invoice.customerTaxId,
      address: invoice.billingAddress ?? null,
    };

    const [issued] = await tx
      .update(invoices)
      .set({
        status: "issued",
        number: formatDocumentNumber(settings.invoiceNumberFormat, period, seq),
        issueDate: now,
        dueDate,
        sellerSnapshot,
        billToSnapshot,
        updatedAt: now,
      })
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoice.id)))
      .returning();

    for (const orderId of touchedOrders) await recomputeOrderInvoiceStatus(tx, tenantId, orderId);

    await recordAudit(tx, tenantId, actor, {
      entityType: "invoice",
      entityId: invoice.id,
      action: "invoice.issue",
      summary: `Issued invoice ${issued.number} for ${issued.totalAmount} ${issued.currency}`,
    });
    return issued;
  });
}

// ---------------------------------------------------------------------------
// rectify → credit note

export const rectifyInvoiceInput = z.object({
  id: z.string().uuid(),
  reason: z.enum(rectificationReasonEnum.enumValues),
  /** Credit only these lines (optionally a reduced quantity); default is the whole invoice. */
  lines: z
    .array(z.object({ invoiceLineItemId: z.string().uuid(), quantity: quantity.optional() }))
    .optional(),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Manager+. Raises a `REC-` credit note referencing the original invoice,
 * copying (a subset of) its lines, reversing the invoiced quantity on the
 * covered order lines and keeping the original invoice's number intact.
 */
export async function rectifyInvoice(
  actor: ActorContext,
  rawInput: z.input<typeof rectifyInvoiceInput>,
): Promise<Invoice> {
  requireRole(actor.role, MANAGER_ROLES);
  const input = rectifyInvoiceInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const original = await requireInvoice(tx, tenantId, input.id, true);
    if (original.documentType !== "invoice") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only an invoice can be rectified." });
    }
    if (!["issued", "partially_paid", "paid"].includes(original.status)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `A ${original.status} invoice can't be rectified.` });
    }

    const originalLines = await tx
      .select()
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.tenantId, tenantId), eq(invoiceLineItems.invoiceId, original.id)))
      .orderBy(asc(invoiceLineItems.createdAt));

    const pick = input.lines ? new Map(input.lines.map((l) => [l.invoiceLineItemId, l.quantity])) : null;
    const toCredit = originalLines
      .filter((l) => !pick || pick.has(l.id))
      .map((l) => {
        const requested = pick?.get(l.id);
        const qtyMilli =
          requested !== undefined ? toMilliUnits(requested.toFixed(3)) : toMilliUnits(l.quantity);
        if (qtyMilli > toMilliUnits(l.quantity)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Can't credit more of "${l.description}" than the invoice billed.`,
          });
        }
        return { line: l, quantity: fromMilliUnits(qtyMilli) };
      });
    if (toCredit.length === 0) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No lines selected to rectify." });
    }

    const now = new Date();
    const period = now.getUTCFullYear();
    const seq = await allocateSequence(tx, tenantId, "credit_note", period);
    const settings = await readSettings(tx, tenantId);

    const [creditNote] = await tx
      .insert(invoices)
      .values({
        tenantId,
        documentType: "credit_note",
        status: "issued",
        number: formatDocumentNumber(settings.creditNoteNumberFormat, period, seq),
        rectifiesInvoiceId: original.id,
        rectificationReason: input.reason,
        accountId: original.accountId,
        orderId: original.orderId,
        currency: original.currency,
        issueDate: now,
        dueDate: now,
        customerName: original.customerName,
        customerTaxId: original.customerTaxId,
        billingAddress: original.billingAddress ?? null,
        sellerSnapshot: original.sellerSnapshot,
        billToSnapshot: original.billToSnapshot,
        notes: input.note ?? null,
        createdByUserId: isSystemActor(actor) ? null : actor.userId,
      })
      .returning();

    const creditLines: InvoiceLineItem[] = [];
    for (const { line, quantity: qty } of toCredit) {
      creditLines.push(
        await insertLine(tx, tenantId, creditNote.id, {
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          productId: line.productId,
          description: line.description,
          quantity: qty,
          unitOfMeasure: line.unitOfMeasure,
          listUnitPrice: line.listUnitPrice,
          discountPercent: line.discountPercent,
          discountAmount: line.discountAmount,
          taxRatePercent: line.taxRatePercent,
          taxTreatment: line.taxTreatment,
          subjectToWithholding: line.subjectToWithholding,
          unitCost: line.unitCost,
        }),
      );
    }
    await recalculateTotals(tx, tenantId, creditNote.id);

    const touchedOrders = await applyInvoicedQuantities(tx, tenantId, creditLines, -1);
    for (const orderId of touchedOrders) await recomputeOrderInvoiceStatus(tx, tenantId, orderId);

    await recordAudit(tx, tenantId, actor, {
      entityType: "invoice",
      entityId: original.id,
      action: "invoice.rectify",
      summary: `Credit note ${creditNote.number} (${input.reason}) against ${original.number}`,
    });
    return requireInvoice(tx, tenantId, creditNote.id);
  });
}

/**
 * Raises a `REC-` credit note straight from a set of order lines (used by the
 * return flow). Runs on the caller's transaction. Reverses the invoiced
 * quantity on those order lines and refreshes the order's invoice status.
 */
export async function creditNoteForOrderLines(
  tx: Tx,
  tenantId: string,
  actor: ActorContext,
  params: {
    orderId: string;
    lines: Array<{ orderLineItemId: string; quantity: string }>;
    reason: RectificationReason;
    rectifiesInvoiceId: string | null;
    note: string | null;
  },
): Promise<Invoice> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, params.orderId)));
  if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });

  const orderLineRows = await tx
    .select()
    .from(orderLineItems)
    .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.orderId, params.orderId)));
  const byId = new Map(orderLineRows.map((l) => [l.id, l]));

  const rectified = params.rectifiesInvoiceId
    ? await requireInvoice(tx, tenantId, params.rectifiesInvoiceId)
    : null;
  const account = order.accountId ? await requireAccount(tx, tenantId, order.accountId) : null;
  const settings = await readSettings(tx, tenantId);

  const now = new Date();
  const period = now.getUTCFullYear();
  const seq = await allocateSequence(tx, tenantId, "credit_note", period);

  const [creditNote] = await tx
    .insert(invoices)
    .values({
      tenantId,
      documentType: "credit_note",
      status: "issued",
      number: formatDocumentNumber(settings.creditNoteNumberFormat, period, seq),
      rectifiesInvoiceId: params.rectifiesInvoiceId,
      rectificationReason: params.reason,
      accountId: order.accountId,
      orderId: order.id,
      currency: order.currency,
      issueDate: now,
      dueDate: now,
      customerName: rectified?.customerName ?? account?.name ?? "—",
      customerTaxId: rectified?.customerTaxId ?? null,
      billingAddress: rectified?.billingAddress ?? order.billingAddress ?? null,
      sellerSnapshot:
        rectified?.sellerSnapshot ??
        (settings.legalName
          ? { name: settings.legalName, taxId: settings.taxId, address: settings.legalAddress }
          : null),
      billToSnapshot: rectified?.billToSnapshot ?? null,
      notes: params.note,
      createdByUserId: isSystemActor(actor) ? null : actor.userId,
    })
    .returning();

  const creditLines: InvoiceLineItem[] = [];
  for (const { orderLineItemId, quantity: qty } of params.lines) {
    const orderLine = byId.get(orderLineItemId);
    if (!orderLine) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found on this order" });
    creditLines.push(
      await insertLine(tx, tenantId, creditNote.id, {
        sourceType: "order_line",
        sourceId: orderLine.id,
        productId: orderLine.productId,
        description: orderLine.description,
        quantity: qty,
        unitOfMeasure: orderLine.unitOfMeasure,
        listUnitPrice: orderLine.listUnitPrice,
        discountPercent: orderLine.discountPercent,
        discountAmount: orderLine.discountAmount,
        taxRatePercent: orderLine.taxRatePercent,
        taxTreatment: orderLine.taxTreatment,
        subjectToWithholding: orderLine.subjectToWithholding,
        unitCost: orderLine.unitCost,
      }),
    );
  }
  await recalculateTotals(tx, tenantId, creditNote.id);

  const touched = await applyInvoicedQuantities(tx, tenantId, creditLines, -1);
  for (const orderId of touched) await recomputeOrderInvoiceStatus(tx, tenantId, orderId);

  await recordAudit(tx, tenantId, actor, {
    entityType: "invoice",
    entityId: creditNote.id,
    action: "invoice.rectify",
    summary: `Credit note ${creditNote.number} (${params.reason}) for returned goods`,
  });
  return requireInvoice(tx, tenantId, creditNote.id);
}

// ---------------------------------------------------------------------------
// reads

export const listInvoicesInput = z.object({
  page: z.number().int().min(1).default(1),
  search: z.string().trim().max(200).default(""),
  documentType: z.enum(invoiceDocumentTypeEnum.enumValues).optional(),
  status: z.enum(invoiceStatusEnum.enumValues).optional(),
  accountId: z.string().uuid().optional(),
  overdueOnly: z.boolean().optional(),
});

export async function listInvoices(tenantId: string, rawInput?: z.input<typeof listInvoicesInput>) {
  const input = listInvoicesInput.parse(rawInput ?? {});
  const page = input.page;
  return withTenantContext(tenantId, async (tx) => {
    const conditions = [eq(invoices.tenantId, tenantId)];
    if (input.documentType) conditions.push(eq(invoices.documentType, input.documentType));
    if (input.status) conditions.push(eq(invoices.status, input.status));
    if (input.accountId) conditions.push(eq(invoices.accountId, input.accountId));
    if (input.search) {
      const term = `%${input.search}%`;
      conditions.push(or(ilike(invoices.number, term), ilike(invoices.customerName, term))!);
    }
    const where = and(...conditions);

    const rows = await tx
      .select({
        id: invoices.id,
        number: invoices.number,
        documentType: invoices.documentType,
        status: invoices.status,
        customerName: invoices.customerName,
        accountId: invoices.accountId,
        orderId: invoices.orderId,
        currency: invoices.currency,
        totalAmount: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .limit(INVOICE_PAGE_SIZE)
      .offset((page - 1) * INVOICE_PAGE_SIZE);

    const now = Date.now();
    const items = rows
      .map((r) => ({
        ...r,
        overdue:
          (r.status === "issued" || r.status === "partially_paid") &&
          r.dueDate !== null &&
          r.dueDate.getTime() < now,
      }))
      .filter((r) => !input.overdueOnly || r.overdue);

    return { items };
  });
}

export async function getInvoiceWithLineItems(tenantId: string, id: string) {
  return withTenantContext(tenantId, async (tx) => {
    const invoice = await requireInvoice(tx, tenantId, id);
    const lineItems = await tx
      .select()
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.tenantId, tenantId), eq(invoiceLineItems.invoiceId, id)))
      .orderBy(asc(invoiceLineItems.createdAt));
    const allocations = await tx
      .select({
        id: paymentAllocations.id,
        amount: paymentAllocations.amount,
        paymentId: payments.id,
        method: payments.method,
        reference: payments.reference,
        receivedDate: payments.receivedDate,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
      .where(and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.invoiceId, id)))
      .orderBy(desc(payments.receivedDate));
    return { invoice, lineItems, allocations };
  });
}

export async function getInvoice(tenantId: string, id: string): Promise<Invoice> {
  return withTenantContext(tenantId, (tx) => requireInvoice(tx, tenantId, id));
}
