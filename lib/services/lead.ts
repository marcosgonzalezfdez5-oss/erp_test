import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { activities } from "@/lib/db/schema/activity";
import { leads } from "@/lib/db/schema/lead";
import { opportunities } from "@/lib/db/schema/opportunity";
import { pipelineStages } from "@/lib/db/schema/pipeline-stage";
import { quotes } from "@/lib/db/schema/quote";
import { tasks } from "@/lib/db/schema/task";
import { withTenantContext } from "@/lib/db/tenant-context";
import { dispatchTrigger } from "@/lib/automation/triggers";

export const PAGE_SIZE = 20;

export const createLeadInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(1).max(50).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  accountId: z.string().uuid().optional(),
});

export const listLeadsInput = z.object({
  page: z.number().int().min(1).default(1),
  search: z.string().trim().max(200).default(""),
});

export async function listLeads(tenantId: string, rawInput: z.input<typeof listLeadsInput> = {}) {
  const input = listLeadsInput.parse(rawInput);
  return withTenantContext(tenantId, async (tx) => {
    const conditions = [eq(leads.tenantId, tenantId), isNull(leads.deletedAt)];
    if (input.search) {
      const term = `%${input.search}%`;
      conditions.push(or(ilike(leads.firstName, term), ilike(leads.lastName, term))!);
    }
    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(leads)
        .where(where)
        .orderBy(asc(leads.createdAt))
        .limit(PAGE_SIZE)
        .offset((input.page - 1) * PAGE_SIZE),
      tx.select({ total: count() }).from(leads).where(where),
    ]);

    return { items, total };
  });
}

export async function getLead(tenantId: string, id: string) {
  const [lead] = await withTenantContext(tenantId, (tx) =>
    tx.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, id), isNull(leads.deletedAt))),
  );
  if (!lead) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found" });
  }
  return lead;
}

export async function createLead(tenantId: string, input: z.infer<typeof createLeadInput>) {
  const [lead] = await withTenantContext(tenantId, (tx) => tx.insert(leads).values({ tenantId, ...input }).returning());
  return lead;
}

export const convertToOpportunityInput = z.object({
  leadId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
});

/**
 * Creates the Opportunity in the tenant's first *open* pipeline stage
 * (lowest `order` among kind="open") — never a hardcoded stage name, per
 * CLAUDE.md §5/§7.
 */
export async function convertLeadToOpportunity(tenantId: string, input: z.infer<typeof convertToOpportunityInput>) {
  const opportunity = await withTenantContext(tenantId, async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), eq(leads.id, input.leadId), isNull(leads.deletedAt)));
    if (!lead) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    if (lead.convertedOpportunityId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Lead has already been converted" });
    }

    const [firstOpenStage] = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.kind, "open")))
      .orderBy(asc(pipelineStages.order))
      .limit(1);
    if (!firstOpenStage) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tenant has no open pipeline stage" });
    }

    const [opportunity] = await tx
      .insert(opportunities)
      .values({
        tenantId,
        pipelineStageId: firstOpenStage.id,
        accountId: lead.accountId,
        name: input.name ?? `${lead.firstName} ${lead.lastName}`,
      })
      .returning();

    await tx
      .update(leads)
      .set({ convertedOpportunityId: opportunity.id, updatedAt: new Date() })
      .where(eq(leads.id, lead.id));

    return opportunity;
  });

  await dispatchTrigger(tenantId, "opportunity_created", { opportunityId: opportunity.id });

  return opportunity;
}

export async function deleteLead(tenantId: string, id: string) {
  const [lead] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(leads)
      .set({ deletedAt: new Date() })
      .where(and(eq(leads.tenantId, tenantId), eq(leads.id, id), isNull(leads.deletedAt)))
      .returning(),
  );
  if (!lead) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found" });
  }
  return lead;
}

/**
 * Reverses a mistaken conversion: soft-deletes the Opportunity it created and
 * clears `convertedOpportunityId`. Blocked once the opportunity has any real
 * work attached (an Activity, Task, or Quote) — activities in particular are
 * append-only with no delete path (CLAUDE.md §12), so this must never remove
 * one as a side effect.
 */
export async function unconvertLead(tenantId: string, id: string) {
  return withTenantContext(tenantId, async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), eq(leads.id, id), isNull(leads.deletedAt)));
    if (!lead) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    if (!lead.convertedOpportunityId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Lead has not been converted" });
    }
    const opportunityId = lead.convertedOpportunityId;

    const [[{ activityCount }], [{ taskCount }], [{ quoteCount }]] = await Promise.all([
      tx.select({ activityCount: count() }).from(activities).where(eq(activities.opportunityId, opportunityId)),
      tx.select({ taskCount: count() }).from(tasks).where(eq(tasks.opportunityId, opportunityId)),
      tx.select({ quoteCount: count() }).from(quotes).where(eq(quotes.opportunityId, opportunityId)),
    ]);

    if (activityCount > 0 || taskCount > 0 || quoteCount > 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This opportunity already has activity, tasks, or quotes attached — delete it directly instead.",
      });
    }

    await tx.update(opportunities).set({ deletedAt: new Date() }).where(eq(opportunities.id, opportunityId));

    const [updated] = await tx
      .update(leads)
      .set({ convertedOpportunityId: null, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    return updated;
  });
}
