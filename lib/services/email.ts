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
import * as draftService from "./draft";

export const sendEmailInput = z.object({
  draftId: z.string().uuid(),
  toAddress: z.string().trim().email(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
});

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

/**
 * Sends a reviewed follow-up email draft via Resend and records it. A human
 * sending their own draft calls this directly; an AI/automation-originated
 * send goes through the `send_follow_up_email` Suggestion, whose apply() lands
 * here after human approval (CLAUDE.md §8/§16).
 */
export async function send(actor: ActorContext, input: z.infer<typeof sendEmailInput>): Promise<EmailMessage> {
  requireRole(actor.role, ["admin", "sales_manager", "sales_rep"]);

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
  const { fromName, replyTo } = await senderIdentity(actor.tenantId, isSystemActor(actor) ? null : actor.userId);

  const [queued] = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .insert(emailMessages)
      .values({
        tenantId: actor.tenantId,
        draftId: draft.id,
        opportunityId,
        contactId: recipient.contactId,
        toAddress: input.toAddress,
        fromName,
        replyTo,
        subject: input.subject,
        body: input.body,
        status: "queued",
        sentByUserId: isSystemActor(actor) ? null : actor.userId,
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
    });
    if (response.error) {
      throw new Error(response.error.message);
    }

    await draftService.markDraftSent(actor.tenantId, draft.id);
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
