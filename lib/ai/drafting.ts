import { generateObject } from "ai";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { logAiToolInvocation } from "./audit";
import { defaultModel } from "./model";

/**
 * Activity-history summaries and follow-up email drafts (CLAUDE.md §9). The
 * context objects are assembled deterministically by lib/services/draft.ts
 * from tenant-scoped data — no ids, no tenant_id reach the model. Callers wrap
 * these in try/catch and fall back to a template; the model is never required.
 */

export function currentModelId(): string {
  return process.env.AI_MODEL ?? "gpt-4o-mini";
}

export interface ActivityLine {
  type: string;
  note: string;
  date: string;
}

export interface SummaryContext {
  entityLabel: "opportunity" | "account";
  name: string;
  stageName?: string | null;
  value?: string | null;
  accountName?: string | null;
  primaryContactName?: string | null;
  activities: ActivityLine[];
  openTaskTitles: string[];
  /** Extra one-line context (e.g. an account's open opportunities). */
  notes?: string[];
}

const summarySchema = z.object({
  summary: z.string(),
  keyRisks: z.array(z.string()),
});

function summaryDigest(ctx: SummaryContext) {
  return {
    entityLabel: ctx.entityLabel,
    activityCount: ctx.activities.length,
    openTaskCount: ctx.openTaskTitles.length,
    hasValue: ctx.value != null,
  };
}

export async function summarize(
  actor: ActorContext,
  ctx: SummaryContext,
): Promise<{ body: string; model: string }> {
  const prompt = [
    `Summarise this ${ctx.entityLabel} for a salesperson in 2-4 sentences, then list any risks.`,
    `Name: ${ctx.name}`,
    ctx.stageName ? `Stage: ${ctx.stageName}` : null,
    ctx.value != null ? `Value: ${ctx.value}` : null,
    ctx.accountName ? `Account: ${ctx.accountName}` : null,
    ctx.primaryContactName ? `Primary contact: ${ctx.primaryContactName}` : null,
    ctx.openTaskTitles.length ? `Open tasks: ${ctx.openTaskTitles.join("; ")}` : "No open tasks.",
    ...(ctx.notes ?? []),
    "Activity history (oldest first):",
    ...ctx.activities.map((a) => `- ${a.date} [${a.type}] ${a.note}`),
    ctx.activities.length ? null : "(no activity logged yet)",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const { object } = await generateObject({ model: defaultModel(), schema: summarySchema, prompt });
  await logAiToolInvocation(actor.tenantId, actor.userId, "summarize", summaryDigest(ctx), object);

  const body = object.keyRisks.length
    ? `${object.summary}\n\nWatch: ${object.keyRisks.join("; ")}`
    : object.summary;
  return { body, model: currentModelId() };
}

export interface EmailContext {
  opportunityName: string;
  stageName?: string | null;
  accountName?: string | null;
  contactFirstName?: string | null;
  senderName?: string | null;
  lastActivity?: ActivityLine | null;
  instructions?: string;
}

const emailSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export async function draftFollowUpEmail(
  actor: ActorContext,
  ctx: EmailContext,
): Promise<{ subject: string; body: string; model: string }> {
  const prompt = [
    "Write a short, friendly follow-up email from a salesperson to a prospect.",
    `Opportunity: ${ctx.opportunityName}`,
    ctx.accountName ? `Company: ${ctx.accountName}` : null,
    ctx.stageName ? `Current stage: ${ctx.stageName}` : null,
    ctx.contactFirstName ? `Recipient first name: ${ctx.contactFirstName}` : null,
    ctx.senderName ? `Sign off as: ${ctx.senderName}` : null,
    ctx.lastActivity
      ? `Last contact was ${ctx.lastActivity.date} (${ctx.lastActivity.type}): ${ctx.lastActivity.note}`
      : "There is no logged prior contact.",
    ctx.instructions ? `Extra instructions: ${ctx.instructions}` : null,
    "Keep it under 120 words. Plain text, no placeholders in brackets.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const { object } = await generateObject({ model: defaultModel(), schema: emailSchema, prompt });
  await logAiToolInvocation(actor.tenantId, actor.userId, "draftFollowUpEmail", {
    hasInstructions: Boolean(ctx.instructions),
    hasPriorContact: Boolean(ctx.lastActivity),
  }, object);

  return { subject: object.subject, body: object.body, model: currentModelId() };
}
