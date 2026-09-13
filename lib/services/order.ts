import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { requireRole } from "@/lib/auth/authorize";
import { accounts } from "@/lib/db/schema/account";
import { orders, orderLineItems, type Order, type OrderLineItem } from "@/lib/db/schema/order";
import { products } from "@/lib/db/schema/product";
import { quoteLineItems, quotes } from "@/lib/db/schema/quote";
import { warehouses } from "@/lib/db/schema/warehouse";
import { withTenantContext, type Tx } from "@/lib/db/tenant-context";
import { computeDocumentTotals, type DocumentLineInput, type TaxTreatment } from "@/lib/money";
import { releaseReservation, reserveForOrder } from "./inventory";
import { allocate as allocateSequence, formatDocumentNumber } from "./sequence";
import { readSettings, type ResolvedTenantSettings } from "./tenant-settings";

const MANAGER_ROLES: ActorContext["role"][] = ["admin", "sales_manager"];
export const ORDER_PAGE_SIZE = 20;

const quantity = z.number().positive().multipleOf(0.001).max(1_000_000);
const discountPercent = z.number().min(0).max(100).multipleOf(0.01);

// ---------------------------------------------------------------------------
// internal snapshot helpers

interface LineSnapshot {
  productId: string | null;
  description: string;
  quantity: string; // numeric(12,3) string
  unitOfMeasure: string;
  listUnitPrice: string;
  discountPercent: string;
  discountAmount: string | null;
  taxRatePercent: string;
  taxTreatment: TaxTreatment;
  subjectToWithholding: boolean;
  unitCost: string | null;
}

/** The single-line money math for a line's frozen `netUnitPrice` / `lineBaseAmount`. */
function lineAmounts(line: LineSnapshot): { netUnitPrice: string; lineBaseAmount: string } {
  const [computed] = computeDocumentTotals([toDocumentLine(line)]).lines;
  return { netUnitPrice: computed.netUnitPrice, lineBaseAmount: computed.lineBase };
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

async function insertLine(tx: Tx, tenantId: string, orderId: string, line: LineSnapshot): Promise<OrderLineItem> {
  const { netUnitPrice, lineBaseAmount } = lineAmounts(line);
  const [row] = await tx
    .insert(orderLineItems)
    .values({ tenantId, orderId, ...line, netUnitPrice, lineBaseAmount })
    .returning();
  return row;
}

/** Turns a catalogue product + a requested quantity/discount into a frozen line snapshot. */
function snapshotFromProduct(
  product: typeof products.$inferSelect,
  settings: ResolvedTenantSettings,
  qty: string,
  discPercent: string,
): LineSnapshot {
  return {
    productId: product.id,
    description: product.name,
    quantity: qty,
    unitOfMeasure: product.unitOfMeasure,
    listUnitPrice: product.unitPrice,
    discountPercent: discPercent,
    discountAmount: null,
    taxRatePercent: product.taxRatePercent ?? settings.defaultTaxRatePercent,
    taxTreatment: product.taxTreatment,
    subjectToWithholding: product.subjectToWithholding,
    unitCost: product.costPrice,
  };
}

async function requireProduct(tx: Tx, tenantId: string, productId: string): Promise<typeof products.$inferSelect> {
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId), isNull(products.deletedAt)));
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
  return product;
}

async function requireOrder(tx: Tx, tenantId: string, id: string): Promise<Order> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id), isNull(orders.deletedAt)));
  if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
  return order;
}

async function requireDraftOrder(tx: Tx, tenantId: string, id: string): Promise<Order> {
  const order = await requireOrder(tx, tenantId, id);
  if (order.status !== "draft") {
    throw new TRPCError({ code: "CONFLICT", message: `Only a draft order can be edited (this one is ${order.status}).` });
  }
  return order;
}

/**
 * Recomputes the order-level totals + per-VAT-rate summary from the current
 * lines and persists them. Line snapshots are not touched — each line's
 * `netUnitPrice` / `lineBaseAmount` were frozen at creation and a line's base
 * equals its rate-group contribution.
 */
async function recalculateTotals(tx: Tx, tenantId: string, orderId: string): Promise<void> {
  const [lines, settings] = await Promise.all([
    tx
      .select()
      .from(orderLineItems)
      .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.orderId, orderId)))
      .orderBy(asc(orderLineItems.createdAt)),
    readSettings(tx, tenantId),
  ]);

  const totals = computeDocumentTotals(lines.map(toDocumentLine), {
    withholdingRatePercent: settings.irpfEnabled ? settings.irpfRatePercent : undefined,
  });

  await tx
    .update(orders)
    .set({
      subtotalAmount: totals.subtotal,
      taxAmount: totals.taxTotal,
      withholdingAmount: totals.withholding,
      totalAmount: totals.total,
      taxSummary: totals.taxGroups,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
}

// ---------------------------------------------------------------------------
// creation

/**
 * Called from `opportunityService.moveOpportunityToStage` inside its
 * transaction when an opportunity enters a `won` stage. Idempotent (the partial
 * unique index on `opportunity_id` plus this pre-check). Snapshots the lines of
 * the opportunity's most recent non-deleted quote; an empty draft if there is
 * no quote.
 */
export async function createOrderFromQuote(
  tx: Tx,
  tenantId: string,
  params: { opportunityId: string; accountId: string | null },
): Promise<Order> {
  const [existing] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.opportunityId, params.opportunityId)));
  if (existing) return existing;

  const settings = await readSettings(tx, tenantId);

  const [quote] = await tx
    .select()
    .from(quotes)
    .where(and(eq(quotes.tenantId, tenantId), eq(quotes.opportunityId, params.opportunityId), isNull(quotes.deletedAt)))
    .orderBy(desc(quotes.createdAt))
    .limit(1);

  const [order] = await tx
    .insert(orders)
    .values({
      tenantId,
      opportunityId: params.opportunityId,
      accountId: params.accountId,
      quoteId: quote?.id ?? null,
      status: "draft",
      currency: settings.defaultCurrency,
    })
    .returning();

  if (quote) {
    const rows = await tx
      .select({ li: quoteLineItems, product: products })
      .from(quoteLineItems)
      .innerJoin(products, eq(quoteLineItems.productId, products.id))
      .where(and(eq(quoteLineItems.tenantId, tenantId), eq(quoteLineItems.quoteId, quote.id)))
      .orderBy(asc(quoteLineItems.createdAt));

    for (const { li, product } of rows) {
      await insertLine(
        tx,
        tenantId,
        order.id,
        // The quote snapshotted its own list price, discount and cost; carry
        // those, not today's catalogue values. Tax treatment still comes from
        // the product (a quote is modelled ex-tax).
        {
          ...snapshotFromProduct(product, settings, String(li.quantity), li.discountPercent),
          listUnitPrice: li.unitPrice,
          discountAmount: li.discountAmount,
          unitCost: li.unitCost ?? product.costPrice,
        },
      );
    }
  }

  await recalculateTotals(tx, tenantId, order.id);
  return requireOrder(tx, tenantId, order.id);
}

const orderLineInput = z.object({
  productId: z.string().uuid(),
  quantity,
  discountPercent: discountPercent.default(0),
});

export const createOrderInput = z.object({
  accountId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(orderLineInput).default([]),
});

/** Standalone order entry — a repeat customer who never went through the pipeline. */
export async function createOrder(tenantId: string, rawInput: z.input<typeof createOrderInput>): Promise<Order> {
  const input = createOrderInput.parse(rawInput);
  return withTenantContext(tenantId, async (tx) => {
    const settings = await readSettings(tx, tenantId);

    if (input.accountId) {
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, input.accountId), isNull(accounts.deletedAt)));
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
    }

    const [order] = await tx
      .insert(orders)
      .values({
        tenantId,
        accountId: input.accountId ?? null,
        status: "draft",
        currency: settings.defaultCurrency,
        notes: input.notes ?? null,
      })
      .returning();

    for (const line of input.lines) {
      const product = await requireProduct(tx, tenantId, line.productId);
      await insertLine(
        tx,
        tenantId,
        order.id,
        snapshotFromProduct(product, settings, line.quantity.toFixed(3), line.discountPercent.toFixed(2)),
      );
    }

    await recalculateTotals(tx, tenantId, order.id);
    return requireOrder(tx, tenantId, order.id);
  });
}

// ---------------------------------------------------------------------------
// line editing (draft only)

export const addOrderLineInput = z.object({
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity,
  discountPercent: discountPercent.default(0),
});

export async function addLineItem(tenantId: string, rawInput: z.input<typeof addOrderLineInput>): Promise<OrderLineItem> {
  const input = addOrderLineInput.parse(rawInput);
  return withTenantContext(tenantId, async (tx) => {
    await requireDraftOrder(tx, tenantId, input.orderId);
    const [product, settings] = await Promise.all([
      requireProduct(tx, tenantId, input.productId),
      readSettings(tx, tenantId),
    ]);
    const line = await insertLine(
      tx,
      tenantId,
      input.orderId,
      snapshotFromProduct(product, settings, input.quantity.toFixed(3), input.discountPercent.toFixed(2)),
    );
    await recalculateTotals(tx, tenantId, input.orderId);
    return line;
  });
}

export const updateOrderLineInput = z.object({
  id: z.string().uuid(),
  quantity: quantity.optional(),
  discountPercent: discountPercent.optional(),
});

export async function updateLineItem(
  tenantId: string,
  rawInput: z.input<typeof updateOrderLineInput>,
): Promise<OrderLineItem> {
  const input = updateOrderLineInput.parse(rawInput);
  return withTenantContext(tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(orderLineItems)
      .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.id, input.id)));
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Line item not found" });
    await requireDraftOrder(tx, tenantId, existing.orderId);

    const next: typeof existing = {
      ...existing,
      quantity: input.quantity !== undefined ? input.quantity.toFixed(3) : existing.quantity,
      discountPercent: input.discountPercent !== undefined ? input.discountPercent.toFixed(2) : existing.discountPercent,
    };
    const { netUnitPrice, lineBaseAmount } = lineAmounts({
      productId: next.productId,
      description: next.description,
      quantity: next.quantity,
      unitOfMeasure: next.unitOfMeasure,
      listUnitPrice: next.listUnitPrice,
      discountPercent: next.discountPercent,
      discountAmount: next.discountAmount,
      taxRatePercent: next.taxRatePercent,
      taxTreatment: next.taxTreatment,
      subjectToWithholding: next.subjectToWithholding,
      unitCost: next.unitCost,
    });

    const [row] = await tx
      .update(orderLineItems)
      .set({ quantity: next.quantity, discountPercent: next.discountPercent, netUnitPrice, lineBaseAmount })
      .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.id, input.id)))
      .returning();
    await recalculateTotals(tx, tenantId, existing.orderId);
    return row;
  });
}

export async function removeLineItem(tenantId: string, id: string): Promise<void> {
  await withTenantContext(tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(orderLineItems)
      .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.id, id)));
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Line item not found" });
    await requireDraftOrder(tx, tenantId, existing.orderId);
    await tx.delete(orderLineItems).where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.id, id)));
    await recalculateTotals(tx, tenantId, existing.orderId);
  });
}

// ---------------------------------------------------------------------------
// lifecycle

export const confirmOrderInput = z.object({
  id: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
});

/**
 * Draft → confirmed: assigns the `SO-` number (allocated inside this
 * transaction so a rollback releases it), pins the fulfilling warehouse, and
 * reserves stock for every inventory-tracked line. If stock is short and the
 * tenant disallows negative stock, `reserveForOrder` throws and the whole
 * confirmation rolls back — the order stays a draft.
 */
export async function confirmOrder(actor: ActorContext, rawInput: z.input<typeof confirmOrderInput>): Promise<Order> {
  const input = confirmOrderInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const order = await requireOrder(tx, tenantId, input.id);
    if (order.status !== "draft") {
      throw new TRPCError({ code: "CONFLICT", message: `Order is already ${order.status}.` });
    }

    let warehouseId = input.warehouseId ?? null;
    if (warehouseId) {
      const [wh] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, warehouseId), isNull(warehouses.deletedAt)));
      if (!wh) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse not found" });
    } else {
      const [def] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true), isNull(warehouses.deletedAt)));
      warehouseId = def?.id ?? null;
    }

    const period = new Date().getUTCFullYear();
    const seq = await allocateSequence(tx, tenantId, "order", period);
    const settings = await readSettings(tx, tenantId);

    await tx
      .update(orders)
      .set({
        status: "confirmed",
        number: formatDocumentNumber(settings.orderNumberFormat, period, seq),
        warehouseId,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.id)));

    await reserveForOrder(tx, tenantId, { id: input.id, warehouseId }, actor.userId);

    return requireOrder(tx, tenantId, input.id);
  });
}

export const cancelOrderInput = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

export async function cancelOrder(actor: ActorContext, rawInput: z.input<typeof cancelOrderInput>): Promise<Order> {
  requireRole(actor.role, MANAGER_ROLES);
  const input = cancelOrderInput.parse(rawInput);
  return withTenantContext(actor.tenantId, async (tx) => {
    const order = await requireOrder(tx, actor.tenantId, input.id);
    if (order.status === "cancelled") {
      throw new TRPCError({ code: "CONFLICT", message: "Order is already cancelled." });
    }
    if (order.status === "fulfilled" || order.status === "partially_fulfilled") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A partly or fully fulfilled order can't be cancelled." });
    }
    const [updated] = await tx
      .update(orders)
      .set({
        status: "cancelled",
        notes: input.reason ? `${order.notes ? `${order.notes}\n` : ""}Cancelled: ${input.reason}` : order.notes,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.tenantId, actor.tenantId), eq(orders.id, input.id)))
      .returning();
    await releaseReservation(tx, actor.tenantId, input.id, actor.userId);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// reads

export const listOrdersInput = z.object({
  page: z.number().int().min(1).default(1),
  search: z.string().trim().max(200).default(""),
  status: z.enum(["draft", "confirmed", "partially_fulfilled", "fulfilled", "cancelled"]).optional(),
});

export async function listOrders(tenantId: string, rawInput: z.input<typeof listOrdersInput> = {}) {
  const input = listOrdersInput.parse(rawInput);
  return withTenantContext(tenantId, async (tx) => {
    const conditions = [eq(orders.tenantId, tenantId), isNull(orders.deletedAt)];
    if (input.status) conditions.push(eq(orders.status, input.status));
    if (input.search) {
      const term = `%${input.search}%`;
      conditions.push(or(ilike(orders.number, term), ilike(accounts.name, term))!);
    }
    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      tx
        .select({
          id: orders.id,
          number: orders.number,
          status: orders.status,
          accountId: orders.accountId,
          accountName: accounts.name,
          opportunityId: orders.opportunityId,
          totalAmount: orders.totalAmount,
          currency: orders.currency,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .leftJoin(accounts, eq(orders.accountId, accounts.id))
        .where(where)
        .orderBy(desc(orders.createdAt))
        .limit(ORDER_PAGE_SIZE)
        .offset((input.page - 1) * ORDER_PAGE_SIZE),
      tx.select({ total: count() }).from(orders).leftJoin(accounts, eq(orders.accountId, accounts.id)).where(where),
    ]);

    return { items, total };
  });
}

export async function getOrderWithLineItems(tenantId: string, id: string) {
  return withTenantContext(tenantId, async (tx) => {
    const order = await requireOrder(tx, tenantId, id);
    const lineItems = await tx
      .select()
      .from(orderLineItems)
      .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.orderId, id)))
      .orderBy(asc(orderLineItems.createdAt));
    return { order, lineItems };
  });
}

// Retained for backwards compatibility with the opportunity detail page.
export async function getOrderByOpportunity(tenantId: string, opportunityId: string): Promise<Order | null> {
  const [order] = await withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.opportunityId, opportunityId), isNull(orders.deletedAt))),
  );
  return order ?? null;
}

export async function getOrder(tenantId: string, id: string): Promise<Order> {
  return withTenantContext(tenantId, (tx) => requireOrder(tx, tenantId, id));
}
