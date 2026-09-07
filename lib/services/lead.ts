import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { leads } from "@/lib/db/schema/lead";
import { opportunities } from "@/lib/db/schema/opportunity";
import { pipelineStages } from "@/lib/db/schema/pipeline-stage";
import { withTenantContext } from "@/lib/db/tenant-context";

export const createLeadInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(1).max(50).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  accountId: z.string().uuid().optional(),
});

export function listLeads(tenantId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), isNull(leads.deletedAt)))
      .orderBy(asc(leads.createdAt)),
  );
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
  return withTenantContext(tenantId, async (tx) => {
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
}
