import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { ActorContext } from "@/lib/auth/actor";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import * as leadService from "./lead";
import * as pipelineService from "./pipeline";
import * as contactService from "./contact";
import * as accountService from "./account";
import * as opportunityService from "./opportunity";
import * as draftService from "./draft";
import * as emailService from "./email";
import * as productService from "./product";
import * as warehouseService from "./warehouse";
import * as tenantSettingsService from "./tenant-settings";
import * as orderService from "./order";
import * as shipmentService from "./shipment";
import * as invoiceService from "./invoice";

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_ADDRESS", "sales@example.com");
  resendSend.mockResolvedValue({ data: { id: "re_123" }, error: null });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const id of createdTenantIds.splice(0)) await db.delete(tenants).where(eq(tenants.id, id));
  for (const id of createdUserIds.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function setup(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  await pipelineService.seedDefaultPipeline(tenant.id);
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `user_${label}_${crypto.randomUUID()}`, email: `${label}@example.com` })
    .returning();
  createdUserIds.push(user.id);
  const actor: ActorContext = { tenantId: tenant.id, userId: user.id, role: "sales_rep" };

  const account = await accountService.createAccount(tenant.id, { name: `Acme ${label}` });
  await contactService.createContact(tenant.id, {
    accountId: account.id,
    firstName: "Dana",
    lastName: "Lee",
    email: "dana@acme.test",
  });
  const lead = await leadService.createLead(tenant.id, { firstName: "Dana", lastName: "Lee", accountId: account.id });
  const opp = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id, name: "Acme deal" });
  // link the account so recipient resolution has something to find
  await opportunityService.updateOpportunity(tenant.id, { id: opp.id, name: "Acme deal" });

  const draft = await draftService.generateFollowUpEmail(actor, { opportunityId: opp.id });
  return { actor, opp, draft, account };
}

const sendInput = (draftId: string) => ({
  draftId,
  toAddress: "dana@acme.test",
  subject: "Following up",
  body: "Hi Dana, just checking in.",
});

describe("email service — send", () => {
  it("sends via Resend, records the message, and marks the draft sent", async () => {
    const { actor, draft, opp } = await setup("a");

    const message = await emailService.send(actor, sendInput(draft.id));
    expect(message.status).toBe("sent");
    expect(message.providerMessageId).toBe("re_123");
    expect(resendSend).toHaveBeenCalledOnce();

    const updatedDraft = await draftService.getDraft(actor.tenantId, draft.id);
    expect(updatedDraft.status).toBe("sent");

    const sent = await emailService.listSentEmails(actor.tenantId, { opportunityId: opp.id });
    expect(sent).toHaveLength(1);
  });

  it("rejects re-sending an already-sent draft", async () => {
    const { actor, draft } = await setup("a");
    await emailService.send(actor, sendInput(draft.id));
    await expect(emailService.send(actor, sendInput(draft.id))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("records a failed row and throws when the provider errors", async () => {
    const { actor, draft } = await setup("a");
    resendSend.mockResolvedValue({ data: null, error: { message: "domain not verified" } });

    await expect(emailService.send(actor, sendInput(draft.id))).rejects.toMatchObject({ code: "BAD_GATEWAY" });

    const sent = await emailService.listSentEmails(actor.tenantId);
    expect(sent[0].status).toBe("failed");
    expect(sent[0].error).toContain("domain not verified");
    const stillActive = await draftService.getDraft(actor.tenantId, draft.id);
    expect(stillActive.status).toBe("active");
  });

  it("fails clearly when RESEND_API_KEY is not configured", async () => {
    const { actor, draft } = await setup("a");
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(emailService.send(actor, sendInput(draft.id))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("will not send another tenant's draft", async () => {
    const { draft } = await setup("a");
    const b = await setup("b");
    await expect(emailService.send(b.actor, sendInput(draft.id))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/** An issued invoice + a shipped shipment for a fresh tenant. */
async function erpScenario(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  await pipelineService.seedDefaultPipeline(tenant.id);
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `user_${label}_${crypto.randomUUID()}`, email: `${label}@example.com` })
    .returning();
  createdUserIds.push(user.id);
  const actor: ActorContext = { tenantId: tenant.id, userId: user.id, role: "sales_rep" };
  const admin: ActorContext = { ...actor, role: "admin" };

  await tenantSettingsService.updateSettings(admin, { legalName: "Vendedor SA", taxId: "B12345678" });
  const account = await accountService.createAccount(tenant.id, { name: "Cliente Acme SL" });
  const warehouse = await warehouseService.createWarehouse(admin, { name: "Madrid", code: "MAD" });
  const product = await productService.createProduct(tenant.id, {
    name: "Widget",
    unitPrice: 100,
    taxRatePercent: 21,
    tracksInventory: false,
  });
  const order = await orderService.createOrder(tenant.id, {
    accountId: account.id,
    lines: [{ productId: product.id, quantity: 3 }],
  });
  await orderService.confirmOrder(admin, { id: order.id, warehouseId: warehouse.id });
  const { lineItems } = await orderService.getOrderWithLineItems(tenant.id, order.id);

  const { shipment } = await shipmentService.createShipment(admin, {
    orderId: order.id,
    shipFromWarehouseId: warehouse.id,
    carrier: "seur",
    trackingNumber: "TRK999",
    lines: [{ orderLineItemId: lineItems[0].id, quantity: 2 }],
  });
  await shipmentService.transitionShipment(admin, { id: shipment.id, status: "shipped" });

  const { shipment: draftShipment } = await shipmentService.createShipment(admin, {
    orderId: order.id,
    shipFromWarehouseId: warehouse.id,
    lines: [{ orderLineItemId: lineItems[0].id, quantity: 1 }],
  });

  const invDraft = await invoiceService.createInvoiceFromOrder(admin, { orderId: order.id });
  const invoice = await invoiceService.issueInvoice(admin, { id: invDraft.id });

  return { actor, invoice, shipment, draftShipment };
}

describe("email service — sendDocument", () => {
  it("emails an issued invoice with the PDF attached and records it against the invoice", async () => {
    const { actor, invoice } = await erpScenario("a");

    const message = await emailService.sendDocument(actor, { invoiceId: invoice.id, toAddress: "cliente@acme.test" });
    expect(message.status).toBe("sent");
    expect(message.invoiceId).toBe(invoice.id);

    expect(resendSend).toHaveBeenCalledOnce();
    const payload = resendSend.mock.calls[0][0];
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].filename).toMatch(/\.pdf$/);
    expect(payload.subject).toContain(invoice.number);
  });

  it("refuses to email a draft invoice", async () => {
    const { actor, invoice } = await erpScenario("a");
    const draft = await invoiceService.createBlankInvoice(actor, { accountId: invoice.accountId! });
    await expect(
      emailService.sendDocument(actor, { invoiceId: draft.id, toAddress: "cliente@acme.test" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("will not email another tenant's invoice", async () => {
    const { invoice } = await erpScenario("a");
    const b = await erpScenario("b");
    await expect(
      emailService.sendDocument(b.actor, { invoiceId: invoice.id, toAddress: "x@y.test" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("email service — notifyShipment", () => {
  it("emails a dispatch notification with the delivery note attached", async () => {
    const { actor, shipment } = await erpScenario("a");

    const message = await emailService.sendShipmentNotification(actor, {
      shipmentId: shipment.id,
      toAddress: "cliente@acme.test",
    });
    expect(message.status).toBe("sent");
    expect(message.shipmentId).toBe(shipment.id);

    const payload = resendSend.mock.calls[0][0];
    expect(payload.attachments).toHaveLength(1);
    expect(payload.text).toContain("TRK999");
  });

  it("refuses to notify for a shipment that hasn't been dispatched", async () => {
    const { actor, draftShipment } = await erpScenario("a");
    await expect(
      emailService.sendShipmentNotification(actor, { shipmentId: draftShipment.id, toAddress: "x@y.test" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("will not notify for another tenant's shipment", async () => {
    const { shipment } = await erpScenario("a");
    const b = await erpScenario("b");
    await expect(
      emailService.sendShipmentNotification(b.actor, { shipmentId: shipment.id, toAddress: "x@y.test" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
