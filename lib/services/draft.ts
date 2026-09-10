import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { isSystemActor, type ActorContext } from "@/lib/auth/actor";
import {
  draftFollowUpEmail,
  summarize,
  type ActivityLine,
  type EmailContext,
  type SummaryContext,
} from "@/lib/ai/drafting";
import { db } from "@/lib/db/client";
import { drafts, type Draft } from "@/lib/db/schema/draft";
import { users } from "@/lib/db/schema/user";
import { withTenantContext } from "@/lib/db/tenant-context";
import * as accountService from "./account";
import * as activityService from "./activity";
import * as contactService from "./contact";
import * as opportunityService from "./opportunity";
import * as pipelineService from "./pipeline";
import * as taskService from "./task";

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function actorUserId(actor: ActorContext): string | null {
  return isSystemActor(actor) ? null : actor.userId;
}

// --- context assembly (deterministic, tenant-scoped) -----------------------

async function assembleOpportunitySummaryContext(tenantId: string, opportunityId: string): Promise<SummaryContext> {
  const opp = await opportunityService.getOpportunity(tenantId, opportunityId);
  const stages = await pipelineService.listPipelineStages(tenantId);
  const stageName = stages.find((s) => s.id === opp.pipelineStageId)?.name ?? null;

  const activities = await activityService.listActivitiesByOpportunity(tenantId, opportunityId);
  const tasks = await taskService.listTasksByOpportunity(tenantId, opportunityId);

  let accountName: string | null = null;
  if (opp.accountId) {
    const account = await accountService.getAccount(tenantId, opp.accountId).catch(() => null);
    accountName = account?.name ?? null;
  }

  let primaryContactName: string | null = null;
  if (opp.contactId) {
    const contact = await contactService.getContact(tenantId, opp.contactId).catch(() => null);
    if (contact) primaryContactName = `${contact.firstName} ${contact.lastName}`;
  } else if (opp.accountId) {
    const [first] = await contactService.listContactsByAccount(tenantId, opp.accountId);
    if (first) primaryContactName = `${first.firstName} ${first.lastName}`;
  }

  return {
    entityLabel: "opportunity",
    name: opp.name,
    stageName,
    value: opp.value,
    accountName,
    primaryContactName,
    activities: activities.map((a) => ({ type: a.type, note: a.note, date: isoDate(a.createdAt) })),
    openTaskTitles: tasks.filter((t) => !t.completedAt).map((t) => t.title),
  };
}

async function assembleAccountSummaryContext(tenantId: string, accountId: string): Promise<SummaryContext> {
  const account = await accountService.getAccount(tenantId, accountId);
  const contacts = await contactService.listContactsByAccount(tenantId, accountId);
  const opportunities = await opportunityService.listOpportunitiesByAccount(tenantId, accountId);

  const activityLines: ActivityLine[] = [];
  for (const opp of opportunities) {
    const activities = await activityService.listActivitiesByOpportunity(tenantId, opp.id);
    for (const a of activities) {
      activityLines.push({ type: a.type, note: `${opp.name}: ${a.note}`, date: isoDate(a.createdAt) });
    }
  }
  activityLines.sort((a, b) => a.date.localeCompare(b.date));

  return {
    entityLabel: "account",
    name: account.name,
    primaryContactName: contacts[0] ? `${contacts[0].firstName} ${contacts[0].lastName}` : null,
    activities: activityLines,
    openTaskTitles: [],
    notes: [
      `${contacts.length} contact(s) on file.`,
      opportunities.length
        ? `Opportunities: ${opportunities.map((o) => `${o.name} (${o.stageName})`).join("; ")}`
        : "No opportunities yet.",
    ],
  };
}

async function assembleEmailContext(
  tenantId: string,
  opportunityId: string,
  senderName: string | null,
  instructions?: string,
): Promise<EmailContext & { contactEmail: string | null; contactId: string | null }> {
  const summaryCtx = await assembleOpportunitySummaryContext(tenantId, opportunityId);
  const opp = await opportunityService.getOpportunity(tenantId, opportunityId);

  let contactFirstName: string | null = null;
  let contactEmail: string | null = null;
  let contactId: string | null = null;
  if (opp.contactId) {
    const contact = await contactService.getContact(tenantId, opp.contactId).catch(() => null);
    if (contact) {
      contactFirstName = contact.firstName;
      contactEmail = contact.email ?? null;
      contactId = contact.id;
    }
  } else if (opp.accountId) {
    const [first] = await contactService.listContactsByAccount(tenantId, opp.accountId);
    if (first) {
      contactFirstName = first.firstName;
      contactEmail = first.email ?? null;
      contactId = first.id;
    }
  }

  const lastActivity = summaryCtx.activities.at(-1) ?? null;

  return {
    opportunityName: summaryCtx.name,
    stageName: summaryCtx.stageName,
    accountName: summaryCtx.accountName,
    contactFirstName,
    senderName,
    lastActivity,
    instructions,
    contactEmail,
    contactId,
  };
}

// --- summaries ------------------------------------------------------------

export const generateSummaryInput = z.object({
  entityType: z.enum(["opportunity", "account"]),
  entityId: z.string().uuid(),
});

/** Generates (or regenerates) the single active summary for a record. */
export async function generateSummary(
  actor: ActorContext,
  input: z.infer<typeof generateSummaryInput>,
): Promise<Draft> {
  const ctx =
    input.entityType === "opportunity"
      ? await assembleOpportunitySummaryContext(actor.tenantId, input.entityId)
      : await assembleAccountSummaryContext(actor.tenantId, input.entityId);

  let body: string;
  let model: string | null;
  try {
    const result = await summarize(actor, ctx);
    body = result.body;
    model = result.model;
  } catch {
    const last = ctx.activities.at(-1);
    body = [
      `${ctx.activities.length} activit${ctx.activities.length === 1 ? "y" : "ies"} logged`,
      last ? `; last contact ${last.date} (${last.type})` : "",
      `. ${ctx.openTaskTitles.length} open task(s).`,
      ctx.stageName ? ` Current stage: ${ctx.stageName}.` : "",
    ].join("");
    model = null;
  }

  const kind = input.entityType === "opportunity" ? "opportunity_summary" : "account_summary";

  return withTenantContext(actor.tenantId, async (tx) => {
    // One active summary per (kind, target): retire the previous one.
    await tx
      .update(drafts)
      .set({ status: "dismissed", updatedAt: new Date() })
      .where(
        and(
          eq(drafts.tenantId, actor.tenantId),
          eq(drafts.kind, kind),
          eq(drafts.targetEntityId, input.entityId),
          eq(drafts.status, "active"),
        ),
      );

    const [row] = await tx
      .insert(drafts)
      .values({
        tenantId: actor.tenantId,
        kind,
        targetEntityType: input.entityType,
        targetEntityId: input.entityId,
        body,
        model,
        aiGenerated: model !== null,
        createdByUserId: actorUserId(actor),
      })
      .returning();
    return row;
  });
}

// --- follow-up emails ----------------------------------------------------

export const draftEmailInput = z.object({
  opportunityId: z.string().uuid(),
  instructions: z.string().max(500).optional(),
});

/** Drafts a follow-up email for an opportunity. Always a new draft. */
export async function generateFollowUpEmail(
  actor: ActorContext,
  input: z.infer<typeof draftEmailInput>,
): Promise<Draft> {
  const senderName = isSystemActor(actor) ? null : await currentUserName(actor.userId);
  const ctx = await assembleEmailContext(actor.tenantId, input.opportunityId, senderName, input.instructions);

  let subject: string;
  let body: string;
  let model: string | null;
  try {
    const result = await draftFollowUpEmail(actor, ctx);
    subject = result.subject;
    body = result.body;
    model = result.model;
  } catch {
    subject = `Following up on ${ctx.opportunityName}`;
    const greeting = ctx.contactFirstName ? `Hi ${ctx.contactFirstName},` : "Hi,";
    body = [
      greeting,
      "",
      ctx.lastActivity
        ? `Following up on our ${ctx.lastActivity.type} on ${ctx.lastActivity.date}. Do you have any questions I can help with?`
        : `Just checking in on ${ctx.opportunityName}. Is there anything you need from us to move forward?`,
      "",
      senderName ? senderName : "Thanks",
    ].join("\n");
    model = null;
  }

  return withTenantContext(actor.tenantId, async (tx) => {
    const [row] = await tx
      .insert(drafts)
      .values({
        tenantId: actor.tenantId,
        kind: "follow_up_email",
        targetEntityType: "opportunity",
        targetEntityId: input.opportunityId,
        subject,
        body,
        model,
        aiGenerated: model !== null,
        createdByUserId: actorUserId(actor),
      })
      .returning();
    return row;
  });
}

async function currentUserName(userId: string): Promise<string | null> {
  // users is not tenant-scoped (a user can belong to many tenants) — a direct
  // lookup by PK is correct here and avoids a new service.
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return row?.name ?? null;
}

// --- read / edit / dismiss --------------------------------------------------

export const listDraftsInput = z
  .object({
    entityType: z.string().optional(),
    entityId: z.string().uuid().optional(),
    kind: z.enum(["opportunity_summary", "account_summary", "follow_up_email"]).optional(),
    status: z.enum(["active", "dismissed", "sent"]).optional(),
  })
  .optional();

export function listDrafts(tenantId: string, filter?: z.infer<typeof listDraftsInput>): Promise<Draft[]> {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.tenantId, tenantId),
          filter?.entityId ? eq(drafts.targetEntityId, filter.entityId) : undefined,
          filter?.kind ? eq(drafts.kind, filter.kind) : undefined,
          filter?.status ? eq(drafts.status, filter.status) : undefined,
        ),
      )
      .orderBy(desc(drafts.createdAt)),
  );
}

async function requireDraft(tenantId: string, id: string): Promise<Draft> {
  const [row] = await withTenantContext(tenantId, (tx) =>
    tx.select().from(drafts).where(and(eq(drafts.tenantId, tenantId), eq(drafts.id, id))),
  );
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
  return row;
}

export function getDraft(tenantId: string, id: string): Promise<Draft> {
  return requireDraft(tenantId, id);
}

export const updateDraftInput = z.object({
  id: z.string().uuid(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(20000),
});

export async function updateDraft(actor: ActorContext, input: z.infer<typeof updateDraftInput>): Promise<Draft> {
  await requireDraft(actor.tenantId, input.id);
  const [row] = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .update(drafts)
      .set({
        subject: input.subject ?? null,
        body: input.body,
        editedByUserId: actorUserId(actor),
        updatedAt: new Date(),
      })
      .where(and(eq(drafts.tenantId, actor.tenantId), eq(drafts.id, input.id)))
      .returning(),
  );
  return row;
}

export async function dismissDraft(actor: ActorContext, id: string): Promise<Draft> {
  await requireDraft(actor.tenantId, id);
  const [row] = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .update(drafts)
      .set({ status: "dismissed", updatedAt: new Date() })
      .where(and(eq(drafts.tenantId, actor.tenantId), eq(drafts.id, id)))
      .returning(),
  );
  return row;
}

/** Used by lib/services/email.ts after a successful send. */
export async function markDraftSent(tenantId: string, id: string): Promise<void> {
  await withTenantContext(tenantId, (tx) =>
    tx
      .update(drafts)
      .set({ status: "sent", updatedAt: new Date() })
      .where(and(eq(drafts.tenantId, tenantId), eq(drafts.id, id))),
  );
}

/** Used by lib/services/email.ts to pull the recipient for a follow-up. */
export function resolveEmailRecipient(tenantId: string, opportunityId: string) {
  return assembleEmailContext(tenantId, opportunityId, null).then((ctx) => ({
    toAddress: ctx.contactEmail,
    contactId: ctx.contactId,
  }));
}
