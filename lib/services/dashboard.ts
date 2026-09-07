import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { opportunities } from "@/lib/db/schema/opportunity";
import { pipelineStages, pipelineStageKindEnum } from "@/lib/db/schema/pipeline-stage";
import { withTenantContext } from "@/lib/db/tenant-context";

export interface PipelineStageSummary {
  stageId: string;
  stageName: string;
  stageKind: (typeof pipelineStageKindEnum.enumValues)[number];
  opportunityCount: number;
  totalValue: string;
}

export function getPipelineSummary(tenantId: string): Promise<PipelineStageSummary[]> {
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx
      .select({
        stageId: pipelineStages.id,
        stageName: pipelineStages.name,
        stageKind: pipelineStages.kind,
        opportunityCount: sql<number>`count(${opportunities.id})::int`,
        totalValueRaw: sql<string>`coalesce(sum(${opportunities.value}), 0)`,
      })
      .from(pipelineStages)
      .leftJoin(
        opportunities,
        and(
          eq(opportunities.pipelineStageId, pipelineStages.id),
          eq(opportunities.tenantId, tenantId),
          isNull(opportunities.deletedAt),
        ),
      )
      .where(eq(pipelineStages.tenantId, tenantId))
      .groupBy(pipelineStages.id)
      .orderBy(asc(pipelineStages.order));

    return rows.map((row) => ({
      stageId: row.stageId,
      stageName: row.stageName,
      stageKind: row.stageKind,
      opportunityCount: row.opportunityCount,
      totalValue: Number(row.totalValueRaw).toFixed(2),
    }));
  });
}
