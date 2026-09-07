import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { opportunities } from "@/lib/db/schema/opportunity";
import { pipelineStages } from "@/lib/db/schema/pipeline-stage";
import { orders } from "@/lib/db/schema/order";
import { withTenantContext } from "@/lib/db/tenant-context";

export function listOpportunities(tenantId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        value: opportunities.value,
        pipelineStageId: opportunities.pipelineStageId,
        stageName: pipelineStages.name,
        stageOrder: pipelineStages.order,
        createdAt: opportunities.createdAt,
      })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(opportunities.pipelineStageId, pipelineStages.id))
      .where(and(eq(opportunities.tenantId, tenantId), isNull(opportunities.deletedAt)))
      .orderBy(asc(pipelineStages.order), asc(opportunities.createdAt)),
  );
}

export async function getOpportunity(tenantId: string, id: string) {
  const [opportunity] = await withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, id), isNull(opportunities.deletedAt))),
  );
  if (!opportunity) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found" });
  }
  return opportunity;
}

export const moveStageInput = z.object({
  id: z.string().uuid(),
  pipelineStageId: z.string().uuid(),
});

export async function moveOpportunityToStage(tenantId: string, input: z.infer<typeof moveStageInput>) {
  return withTenantContext(tenantId, async (tx) => {
    const [stage] = await tx
      .select({ id: pipelineStages.id, kind: pipelineStages.kind })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.id, input.pipelineStageId)));
    if (!stage) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline stage not found" });
    }

    const [opportunity] = await tx
      .update(opportunities)
      .set({ pipelineStageId: input.pipelineStageId, updatedAt: new Date() })
      .where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, input.id), isNull(opportunities.deletedAt)))
      .returning();
    if (!opportunity) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found" });
    }

    // Moving into a "won" stage creates the stub order exactly once — the
    // unique constraint on orders.opportunityId makes re-triggering (moving
    // to won again, or calling this repeatedly) a no-op rather than a duplicate.
    if (stage.kind === "won") {
      await tx.insert(orders).values({ tenantId, opportunityId: opportunity.id }).onConflictDoNothing({
        target: orders.opportunityId,
      });
    }

    return opportunity;
  });
}

export const updateValueInput = z.object({
  id: z.string().uuid(),
  value: z.number().nonnegative().nullable(),
});

export async function updateOpportunityValue(tenantId: string, input: z.infer<typeof updateValueInput>) {
  const [opportunity] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(opportunities)
      .set({ value: input.value === null ? null : input.value.toFixed(2), updatedAt: new Date() })
      .where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, input.id), isNull(opportunities.deletedAt)))
      .returning(),
  );
  if (!opportunity) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found" });
  }
  return opportunity;
}
