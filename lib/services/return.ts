import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { isSystemActor } from "@/lib/auth/actor";
import { requireRole } from "@/lib/auth/authorize";
import { invoices, rectificationReasonEnum, type Invoice } from "@/lib/db/schema/invoice";
import { orderLineItems } from "@/lib/db/schema/order";
import { products } from "@/lib/db/schema/product";
import { shipmentLineItems, shipments } from "@/lib/db/schema/shipment";
import { warehouses } from "@/lib/db/schema/warehouse";
import { withTenantContext } from "@/lib/db/tenant-context";
import { fromMilliUnits, toMilliUnits } from "@/lib/money";
import { recordAudit } from "./audit";
import { creditNoteForOrderLines } from "./invoice";
import { recordReturnMovement } from "./inventory";
import { recomputeFulfillment } from "./shipment";

const MANAGER_ROLES: ActorContext["role"][] = ["admin", "sales_manager"];

const quantity = z.number().positive().multipleOf(0.001).max(1_000_000);

export const recordReturnInput = z.object({
  shipmentId: z.string().uuid(),
  lines: z.array(z.object({ shipmentLineItemId: z.string().uuid(), quantity })).min(1),
  restockWarehouseId: z.string().uuid().optional(),
  createCreditNote: z.boolean().default(true),
  rectificationReason: z.enum(rectificationReasonEnum.enumValues).default("R1"),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Manager+. Records a customer return against a dispatched shipment: restocks
 * the goods at their original cost, walks back the order lines' shipped
 * quantity (and the order's fulfilment status), and — unless told not to —
 * raises a `REC-` credit note against the order's issued invoice for the
 * returned lines.
 */
export async function recordReturn(
  actor: ActorContext,
  rawInput: z.input<typeof recordReturnInput>,
): Promise<{ creditNote: Invoice | null; restocked: Array<{ productId: string | null; quantity: string }> }> {
  requireRole(actor.role, MANAGER_ROLES);
  const input = recordReturnInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const [shipment] = await tx
      .select()
      .from(shipments)
      .where(and(eq(shipments.tenantId, tenantId), eq(shipments.id, input.shipmentId), isNull(shipments.deletedAt)))
      .for("update");
    if (!shipment) throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });
    if (shipment.stockAppliedAt === null) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This shipment hasn't been dispatched — nothing to return." });
    }

    const restockWarehouseId = input.restockWarehouseId ?? shipment.shipFromWarehouseId;
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(
        and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, restockWarehouseId), isNull(warehouses.deletedAt)),
      );
    if (!warehouse) throw new TRPCError({ code: "NOT_FOUND", message: "Restock warehouse not found" });

    const requestedIds = input.lines.map((l) => l.shipmentLineItemId);
    const rows = await tx
      .select({ sli: shipmentLineItems, orderLine: orderLineItems, product: products })
      .from(shipmentLineItems)
      .innerJoin(orderLineItems, eq(shipmentLineItems.orderLineItemId, orderLineItems.id))
      .leftJoin(products, eq(shipmentLineItems.productId, products.id))
      .where(
        and(
          eq(shipmentLineItems.tenantId, tenantId),
          eq(shipmentLineItems.shipmentId, shipment.id),
          inArray(shipmentLineItems.id, requestedIds),
        ),
      );
    if (rows.length !== requestedIds.length) {
      throw new TRPCError({ code: "NOT_FOUND", message: "One or more shipment lines not found on this shipment" });
    }
    const wantById = new Map(input.lines.map((l) => [l.shipmentLineItemId, l.quantity]));

    const restocked: Array<{ productId: string | null; quantity: string }> = [];
    const perOrderLine = new Map<string, bigint>();

    for (const { sli, orderLine, product } of rows) {
      const wantMilli = toMilliUnits(wantById.get(sli.id)!.toFixed(3));
      if (wantMilli > toMilliUnits(orderLine.quantityShipped)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Can't return more of "${sli.description}" than is currently shipped.`,
        });
      }
      const qty = fromMilliUnits(wantMilli);

      if (product?.tracksInventory) {
        await recordReturnMovement(tx, tenantId, {
          productId: sli.productId!,
          warehouseId: restockWarehouseId,
          quantity: qty,
          unitCost: sli.unitCost ?? orderLine.unitCost,
          shipmentId: shipment.id,
          note: input.note ?? null,
          actorUserId: isSystemActor(actor) ? null : actor.userId,
        });
      }

      await tx
        .update(orderLineItems)
        .set({ quantityShipped: sql`${orderLineItems.quantityShipped} - ${qty}` })
        .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.id, orderLine.id)));

      restocked.push({ productId: sli.productId, quantity: qty });
      perOrderLine.set(orderLine.id, (perOrderLine.get(orderLine.id) ?? 0n) + wantMilli);
    }

    await recomputeFulfillment(tx, tenantId, shipment.orderId);

    let creditNote: Invoice | null = null;
    if (input.createCreditNote) {
      const [issued] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            eq(invoices.orderId, shipment.orderId),
            eq(invoices.documentType, "invoice"),
            inArray(invoices.status, ["issued", "partially_paid", "paid"]),
          ),
        )
        .orderBy(desc(invoices.issueDate));
      if (!issued) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No issued invoice on this order to rectify — record the return with createCreditNote: false.",
        });
      }

      creditNote = await creditNoteForOrderLines(tx, tenantId, actor, {
        orderId: shipment.orderId,
        lines: [...perOrderLine].map(([orderLineItemId, milli]) => ({
          orderLineItemId,
          quantity: fromMilliUnits(milli),
        })),
        reason: input.rectificationReason,
        rectifiesInvoiceId: issued.id,
        note: input.note ?? null,
      });
    }

    await recordAudit(tx, tenantId, actor, {
      entityType: "shipment",
      entityId: shipment.id,
      action: "return.record",
      summary: `Return against ${shipment.number ?? shipment.id}${creditNote ? ` → credit note ${creditNote.number}` : ""}`,
    });

    return { creditNote, restocked };
  });
}
