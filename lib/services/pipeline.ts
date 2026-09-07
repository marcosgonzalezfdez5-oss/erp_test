import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { pipelineStages, pipelineStageKindEnum } from "@/lib/db/schema/pipeline-stage";
import { withTenantContext } from "@/lib/db/tenant-context";

const DEFAULT_STAGES: Array<{ name: string; kind: (typeof pipelineStageKindEnum.enumValues)[number] }> = [
  { name: "Qualification", kind: "open" },
  { name: "Proposal", kind: "open" },
  { name: "Negotiation", kind: "open" },
  { name: "Won", kind: "won" },
  { name: "Lost", kind: "lost" },
];

/** Called once, right after a tenant is first created — see lib/auth/session.ts. */
export function seedDefaultPipeline(tenantId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .insert(pipelineStages)
      .values(DEFAULT_STAGES.map((stage, index) => ({ tenantId, name: stage.name, kind: stage.kind, order: index })))
      .returning(),
  );
}

export function listPipelineStages(tenantId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx.select().from(pipelineStages).where(eq(pipelineStages.tenantId, tenantId)).orderBy(asc(pipelineStages.order)),
  );
}

export const createStageInput = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(pipelineStageKindEnum.enumValues).default("open"),
});

export async function createStage(tenantId: string, input: z.infer<typeof createStageInput>) {
  return withTenantContext(tenantId, async (tx) => {
    const [{ maxOrder }] = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${pipelineStages.order}), -1)` })
      .from(pipelineStages)
      .where(eq(pipelineStages.tenantId, tenantId));

    const [stage] = await tx
      .insert(pipelineStages)
      .values({ tenantId, name: input.name, kind: input.kind, order: maxOrder + 1 })
      .returning();
    return stage;
  });
}

export const renameStageInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
});

export async function renameStage(tenantId: string, input: z.infer<typeof renameStageInput>) {
  const [stage] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(pipelineStages)
      .set({ name: input.name })
      .where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.id, input.id)))
      .returning(),
  );
  if (!stage) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline stage not found" });
  }
  return stage;
}

export const reorderStagesInput = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export function reorderStages(tenantId: string, input: z.infer<typeof reorderStagesInput>) {
  return withTenantContext(tenantId, async (tx) => {
    for (const [index, id] of input.orderedIds.entries()) {
      await tx
        .update(pipelineStages)
        .set({ order: index })
        .where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.id, id)));
    }
    return tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.tenantId, tenantId))
      .orderBy(asc(pipelineStages.order));
  });
}

export async function deleteStage(tenantId: string, id: string) {
  const [stage] = await withTenantContext(tenantId, (tx) =>
    tx
      .delete(pipelineStages)
      .where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.id, id)))
      .returning(),
  );
  if (!stage) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline stage not found" });
  }
  return stage;
}
