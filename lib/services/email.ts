import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { Resend } from "resend";
import { z } from "zod";
import { isSystemActor, type ActorContext } from "@/lib/auth/actor";
import { requireRole } from "@/lib/auth/authorize";
import { db } from "@/lib/db/client";
import { emailMessages, type EmailMessage } from "@/lib/db/schema/email";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import { withTenantContext } from "@/lib/db/tenant-context";
import { deliveryNoteModel, invoiceDocumentModel } from "@/lib/documents/data";
import { renderDocumentPdf } from "@/lib/documents/pdf";
import { trackingUrlFor } from "@/lib/shipping/carriers";
import * as draftService from "./draft";
import * as invoiceService from "./invoice";
import { getShipmentWithLines } from "./shipment";

export const sendEmailInput = z.object({
  draftId: z.string().uuid(),
  toAddress: z.string().trim().email(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
});

const SENDER_ROLES: ActorContext["role"][] = ["admin", "sales_manager", "sales_rep"];

function resendClient(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Email sending isn't configured yet. Set RESEND_API_KEY to enable it.",
    });
  }
  return new Resend(key);
}

async function senderIdentity(tenantId: string, userId: string | null) {
  const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  let replyTo: string | undefined;
  if (userId) {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    replyTo = user?.email || undefined;
  }
  return { fromName: tenant?.name ?? "Sales", replyTo };
}

interface DeliverInput {
  actor: ActorContext;
  toAddress: string;
  subject: string;
  body: string;
  refs?: Partial<Pick<EmailMessage, "draftId" | "opportunityId" | "contactId" | "invoiceId" | "shipmentId">>;
  attachments?: Array<{ filename: string; content: Buffer }>;
  /** Runs after a successful provider send, before the row flips to "sent". */
  onSent?: () => Promise<void>;
}

/**
 * The one low-level send path: insert a `queued` `email_messages` row (the §8
 * audit trail), hand it to Resend, then flip it to `sent` / `failed`. Every
 * caller here is a human acting on their own reviewed content.
 */
async function deliver(input: DeliverInput): Promise<EmailMessage> {
  const { actor } = input;
  const actingUserId = isSystemActor(actor) ? null : actor.userId;
  const { fromName, replyTo } = await senderIdentity(actor.tenantId, actingUserId);

  const [queued] = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .insert(emailMessages)
      .values({
        tenantId: actor.tenantId,
        draftId: input.refs?.draftId ?? null,
        opportunityId: input.refs?.opportunityId ?? null,
        contactId: input.refs?.contactId ?? null,
        invoiceId: input.refs?.invoiceId ?? null,
        shipmentId: input.refs?.shipmentId ?? null,
        toAddress: input.toAddress,
        fromName,
        replyTo,
        subject: input.subject,
        body: input.body,
        status: "queued",
        sentByUserId: actingUserId,
      })
      .returning(),
  );

  try {
    const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "onboarding@resend.dev";
    const response = await resendClient().emails.send({
      from: `${fromName} <${fromAddress}>`,
      to: input.toAddress,
      subject: input.subject,
      text: input.body,
      replyTo,
      attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    if (response.error) {
      throw new Error(response.error.message);
    }

    if (input.onSent) await input.onSent();

    const [sent] = await withTenantContext(actor.tenantId, (tx) =>
      tx
        .update(emailMessages)
        .set({ status: "sent", providerMessageId: response.data?.id ?? null, sentAt: new Date() })
        .where(and(eq(emailMessages.tenantId, actor.tenantId), eq(emailMessages.id, queued.id)))
        .returning(),
    );
    return sent;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    await withTenantContext(actor.tenantId, (tx) =>
      tx
        .update(emailMessages)
        .set({ status: "failed", error: message })
        .where(and(eq(emailMessages.tenantId, actor.tenantId), eq(emailMessages.id, queued.id))),
    );
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: "BAD_GATEWAY", message: `Could not send the email: ${message}` });
  }
}

/**
 * Sends a reviewed follow-up email draft via Resend and records it. A human
 * sending their own draft calls this directly; an AI/automation-originated
 * send goes through the `send_follow_up_email` Suggestion, whose apply() lands
 * here after human approval (CLAUDE.md §8/§16).
 */
export async function send(actor: ActorContext, input: z.infer<typeof sendEmailInput>): Promise<EmailMessage> {
  requireRole(actor.role, SENDER_ROLES);

  const draft = await draftService.getDraft(actor.tenantId, input.draftId);
  if (draft.kind !== "follow_up_email") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only follow-up email drafts can be sent." });
  }
  if (draft.status === "sent") {
    throw new TRPCError({ code: "CONFLICT", message: "This draft has already been sent." });
  }

  const opportunityId = draft.targetEntityType === "opportunity" ? draft.targetEntityId : null;
  const recipient = opportunityId
    ? await draftService.resolveEmailRecipient(actor.tenantId, opportunityId)
    : { contactId: null };

  return deliver({
    actor,
    toAddress: input.toAddress,
    subject: input.subject,
    body: input.body,
    refs: { draftId: draft.id, opportunityId, contactId: recipient.contactId },
    onSent: () => draftService.markDraftSent(actor.tenantId, draft.id),
  });
}

// ---------------------------------------------------------------------------
// Fiscal documents

export const sendDocumentInput = z.object({
  invoiceId: z.string().uuid(),
  toAddress: z.string().trim().email(),
  subject: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().max(20000).optional(),
});

/**
 * Emails an issued invoice / credit note to the customer with the rendered PDF
 * attached. Human-triggered only (CLAUDE.md §8) — the tRPC procedure is the
 * only caller.
 */
export async function sendDocument(
  actor: ActorContext,
  rawInput: z.input<typeof sendDocumentInput>,
): Promise<EmailMessage> {
  requireRole(actor.role, SENDER_ROLES);
  const input = sendDocumentInput.parse(rawInput);

  const invoice = await invoiceService.getInvoice(actor.tenantId, input.invoiceId);
  if (!invoice.number || !invoice.issueDate) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only an issued document can be emailed." });
  }

  const isCredit = invoice.documentType === "credit_note";
  const model = await invoiceDocumentModel(actor.tenantId, invoice.id, isCredit ? "credit-note" : "invoice");
  const pdf = await renderDocumentPdf(model);

  const label = isCredit ? "Factura rectificativa" : "Factura";
  const subject = input.subject ?? `${label} ${invoice.number}`;
  const body =
    input.message ??
    `Estimado cliente,\n\nAdjuntamos ${label.toLowerCase()} ${invoice.number} por un importe total de ${invoice.totalAmount} ${invoice.currency}.\n\nUn saludo.`;

  return deliver({
    actor,
    toAddress: input.toAddress,
    subject,
    body,
    refs: { invoiceId: invoice.id, opportunityId: null },
    attachments: [{ filename: `${invoice.number.replace(/[^\w.-]+/g, "-")}.pdf`, content: pdf }],
  });
}

export const sendShipmentNotificationInput = z.object({
  shipmentId: z.string().uuid(),
  toAddress: z.string().trim().email(),
  message: z.string().trim().max(20000).optional(),
});

/**
 * Sends the customer a dispatch / tracking notification for a shipped shipment,
 * with the delivery note (albarán) attached. Human-triggered only — never
 * automatic (CLAUDE.md §8, ERP plan Milestone 3).
 */
export async function sendShipmentNotification(
  actor: ActorContext,
  rawInput: z.input<typeof sendShipmentNotificationInput>,
): Promise<EmailMessage> {
  requireRole(actor.role, SENDER_ROLES);
  const input = sendShipmentNotificationInput.parse(rawInput);

  const { shipment } = await getShipmentWithLines(actor.tenantId, input.shipmentId);
  if (!shipment.shippedAt || !shipment.number) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The shipment hasn't been dispatched yet." });
  }

  const trackingUrl =
    shipment.trackingUrl ??
    (shipment.carrier && shipment.trackingNumber ? trackingUrlFor(shipment.carrier, shipment.trackingNumber) : null);

  const parts = [`Su pedido ha sido enviado (albarán ${shipment.number}).`];
  if (shipment.carrier) parts.push(`Transportista: ${shipment.carrier.toUpperCase()}.`);
  if (shipment.trackingNumber) parts.push(`Nº de seguimiento: ${shipment.trackingNumber}.`);
  if (trackingUrl) parts.push(`Seguimiento: ${trackingUrl}`);
  const body = input.message ?? `Estimado cliente,\n\n${parts.join("\n")}\n\nUn saludo.`;

  const model = await deliveryNoteModel(actor.tenantId, shipment.id);
  const pdf = await renderDocumentPdf(model);

  return deliver({
    actor,
    toAddress: input.toAddress,
    subject: `Envío de su pedido — albarán ${shipment.number}`,
    body,
    refs: { shipmentId: shipment.id, opportunityId: null },
    attachments: [{ filename: `${shipment.number.replace(/[^\w.-]+/g, "-")}.pdf`, content: pdf }],
  });
}

export function listSentEmails(tenantId: string, filter?: { opportunityId?: string }): Promise<EmailMessage[]> {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.tenantId, tenantId),
          filter?.opportunityId ? eq(emailMessages.opportunityId, filter.opportunityId) : undefined,
        ),
      )
      .orderBy(desc(emailMessages.createdAt)),
  );
}
