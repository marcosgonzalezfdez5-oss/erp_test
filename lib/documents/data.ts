import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { accounts } from "@/lib/db/schema/account";
import type { PostalAddress } from "@/lib/db/schema/address";
import { invoices, type PartySnapshot } from "@/lib/db/schema/invoice";
import { orders, orderLineItems } from "@/lib/db/schema/order";
import { shipmentLineItems, shipments } from "@/lib/db/schema/shipment";
import { warehouses } from "@/lib/db/schema/warehouse";
import { withTenantContext } from "@/lib/db/tenant-context";
import { toCents } from "@/lib/money";
import * as invoiceService from "@/lib/services/invoice";
import { readSettings } from "@/lib/services/tenant-settings";
import type { DocumentPdfModel, PartyView } from "./pdf";

export type DocumentType = "invoice" | "credit-note" | "delivery-note";

/** Formats a numeric(12,2) string for display only (never for arithmetic). */
function money(value: string, currency: string): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(Number(value));
}

function percent(value: string): string {
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(Number(value))} %`;
}

function date(value: Date | null): string {
  return value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "long" }).format(value) : "—";
}

function addressLines(address: PostalAddress | null): string[] {
  if (!address) return [];
  const out = [address.line1];
  if (address.line2) out.push(address.line2);
  out.push([address.postalCode, address.city].filter(Boolean).join(" "));
  if (address.province) out.push(address.province);
  out.push(address.country);
  return out.filter(Boolean);
}

function partyFromSnapshot(snap: PartySnapshot | null, fallbackName: string): PartyView {
  return {
    name: snap?.name ?? fallbackName,
    taxId: snap?.taxId ?? null,
    addressLines: addressLines(snap?.address ?? null),
  };
}

// ---------------------------------------------------------------------------

export async function invoiceDocumentModel(
  tenantId: string,
  invoiceId: string,
  type: "invoice" | "credit-note",
): Promise<DocumentPdfModel> {
  const { invoice, lineItems } = await invoiceService.getInvoiceWithLineItems(tenantId, invoiceId);
  const wantCredit = type === "credit-note";
  if (wantCredit !== (invoice.documentType === "credit_note")) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  }

  const settings = await withTenantContext(tenantId, (tx) => readSettings(tx, tenantId));

  // Issued documents carry a frozen legal-identity snapshot; a draft preview
  // falls back to the live tenant settings / editable customer fields.
  const seller: PartyView = invoice.sellerSnapshot
    ? partyFromSnapshot(invoice.sellerSnapshot, settings.legalName ?? "—")
    : { name: settings.legalName ?? "—", taxId: settings.taxId, addressLines: addressLines(settings.legalAddress) };
  const buyer: PartyView = invoice.billToSnapshot
    ? partyFromSnapshot(invoice.billToSnapshot, invoice.customerName)
    : {
        name: invoice.customerName,
        taxId: invoice.customerTaxId,
        addressLines: addressLines(invoice.billingAddress ?? null),
      };

  let orderNumber: string | null = null;
  let rectifiesNumber: string | null = null;
  await withTenantContext(tenantId, async (tx) => {
    if (invoice.orderId) {
      const [o] = await tx
        .select({ number: orders.number })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, invoice.orderId)));
      orderNumber = o?.number ?? null;
    }
    if (invoice.rectifiesInvoiceId) {
      const [o] = await tx
        .select({ number: invoices.number })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoice.rectifiesInvoiceId)));
      rectifiesNumber = o?.number ?? null;
    }
  });

  const currency = invoice.currency;
  const meta: DocumentPdfModel["meta"] = [{ label: "Fecha de emisión", value: date(invoice.issueDate) }];
  if (!wantCredit) meta.push({ label: "Vencimiento", value: date(invoice.dueDate) });
  if (orderNumber) meta.push({ label: "Pedido", value: orderNumber });
  if (rectifiesNumber) meta.push({ label: "Factura rectificada", value: rectifiesNumber });
  if (invoice.rectificationReason) meta.push({ label: "Causa (AEAT)", value: invoice.rectificationReason });

  const lines = lineItems.map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unit: li.unitOfMeasure,
    unitPrice: money(li.netUnitPrice, currency),
    discount: toCents(li.discountPercent) > 0n ? percent(li.discountPercent) : "",
    amount: money(li.lineBaseAmount, currency),
  }));

  const taxGroups = (invoice.taxSummary ?? []).map((g) => ({
    base: money(g.base, currency),
    rate: g.taxTreatment === "standard" ? percent(g.taxRatePercent) : "Exento",
    tax: money(g.tax, currency),
    note: g.legalNote,
  }));

  const totals: DocumentPdfModel["totals"] = [
    { label: "Base imponible", value: money(invoice.subtotalAmount, currency) },
    { label: "IVA", value: money(invoice.taxAmount, currency) },
  ];
  if (toCents(invoice.withholdingAmount) > 0n) {
    totals.push({ label: "Retención IRPF", value: `−${money(invoice.withholdingAmount, currency)}` });
  }
  totals.push({ label: wantCredit ? "Total a compensar" : "Total factura", value: money(invoice.totalAmount, currency), strong: true });

  const legalNotes = [...new Set((invoice.taxSummary ?? []).map((g) => g.legalNote).filter((n): n is string => !!n))];
  if (wantCredit && rectifiesNumber) {
    legalNotes.unshift(`Factura rectificativa de la factura ${rectifiesNumber} (art. 15 RD 1619/2012).`);
  }

  return {
    kind: wantCredit ? "credit_note" : "invoice",
    title: wantCredit ? "Factura rectificativa" : "Factura",
    number: invoice.number ?? "BORRADOR",
    date: date(invoice.issueDate ?? invoice.createdAt),
    seller,
    buyer,
    buyerLabel: "Cliente",
    meta,
    showAmounts: true,
    lines,
    taxGroups,
    totals,
    legalNotes,
    notes: invoice.notes,
  };
}

export async function deliveryNoteModel(tenantId: string, shipmentId: string): Promise<DocumentPdfModel> {
  const model = await withTenantContext(tenantId, async (tx) => {
    const [shipment] = await tx
      .select()
      .from(shipments)
      .where(and(eq(shipments.tenantId, tenantId), eq(shipments.id, shipmentId), isNull(shipments.deletedAt)));
    if (!shipment) throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });

    const [order] = await tx
      .select({ number: orders.number, accountId: orders.accountId, shippingAddress: orders.shippingAddress, currency: orders.currency })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, shipment.orderId)));

    const [warehouse] = await tx
      .select({ name: warehouses.name })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, shipment.shipFromWarehouseId)));

    let accountName = "—";
    if (order?.accountId) {
      const [acc] = await tx
        .select({ name: accounts.name })
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, order.accountId)));
      accountName = acc?.name ?? "—";
    }

    const rows = await tx
      .select({ sli: shipmentLineItems, uom: orderLineItems.unitOfMeasure })
      .from(shipmentLineItems)
      .innerJoin(orderLineItems, eq(shipmentLineItems.orderLineItemId, orderLineItems.id))
      .where(and(eq(shipmentLineItems.tenantId, tenantId), eq(shipmentLineItems.shipmentId, shipmentId)));

    const settings = await readSettings(tx, tenantId);

    const meta: DocumentPdfModel["meta"] = [{ label: "Fecha de envío", value: date(shipment.shippedAt) }];
    if (order?.number) meta.push({ label: "Pedido", value: order.number });
    if (warehouse?.name) meta.push({ label: "Almacén de salida", value: warehouse.name });
    if (shipment.carrier) meta.push({ label: "Transportista", value: shipment.carrier.toUpperCase() });
    if (shipment.trackingNumber) meta.push({ label: "Seguimiento", value: shipment.trackingNumber });
    meta.push({ label: "Bultos", value: String(shipment.packageCount) });

    const seller: PartyView = {
      name: settings.legalName ?? "—",
      taxId: settings.taxId,
      addressLines: addressLines(settings.legalAddress),
    };
    const buyer: PartyView = {
      name: accountName,
      taxId: null,
      addressLines: addressLines(shipment.shipToAddress ?? order?.shippingAddress ?? null),
    };

    return {
      kind: "delivery_note" as const,
      title: "Albarán",
      number: shipment.number ?? "BORRADOR",
      date: date(shipment.shippedAt ?? shipment.createdAt),
      seller,
      buyer,
      buyerLabel: "Destinatario",
      meta,
      showAmounts: false,
      lines: rows.map(({ sli, uom }) => ({ description: sli.description, quantity: sli.quantity, unit: uom })),
      taxGroups: [],
      totals: [],
      legalNotes: ["Documento sin valor fiscal. La factura se emite por separado."],
      notes: shipment.notes,
    };
  });
  return model;
}
