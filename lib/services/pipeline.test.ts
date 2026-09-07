import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as pipelineService from "./pipeline";

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
});

async function createTenant(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  return tenant;
}

describe("pipeline service", () => {
  it("seeds a default pipeline with the expected order and kinds", async () => {
    const tenant = await createTenant("a");

    await pipelineService.seedDefaultPipeline(tenant.id);
    const stages = await pipelineService.listPipelineStages(tenant.id);

    expect(stages.map((s) => s.name)).toEqual(["Qualification", "Proposal", "Negotiation", "Won", "Lost"]);
    expect(stages.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
    expect(stages.map((s) => s.kind)).toEqual(["open", "open", "open", "won", "lost"]);
  });

  it("persists a reorder", async () => {
    const tenant = await createTenant("a");
    const seeded = await pipelineService.seedDefaultPipeline(tenant.id);

    const reversedIds = [...seeded].reverse().map((s) => s.id);
    await pipelineService.reorderStages(tenant.id, { orderedIds: reversedIds });

    const stages = await pipelineService.listPipelineStages(tenant.id);
    expect(stages.map((s) => s.id)).toEqual(reversedIds);
    expect(stages.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("renames a stage", async () => {
    const tenant = await createTenant("a");
    const [firstStage] = await pipelineService.seedDefaultPipeline(tenant.id);

    const renamed = await pipelineService.renameStage(tenant.id, { id: firstStage.id, name: "Discovery" });
    expect(renamed.name).toBe("Discovery");
  });

  it("keeps two tenants' pipelines independent", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");

    await pipelineService.seedDefaultPipeline(tenantA.id);
    await pipelineService.seedDefaultPipeline(tenantB.id);

    const [stageA] = await pipelineService.listPipelineStages(tenantA.id);
    await pipelineService.renameStage(tenantA.id, { id: stageA.id, name: "Renamed for A" });

    const stagesB = await pipelineService.listPipelineStages(tenantB.id);
    expect(stagesB.map((s) => s.name)).toEqual(["Qualification", "Proposal", "Negotiation", "Won", "Lost"]);
  });

  it("rejects renaming a stage that belongs to another tenant", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");
    const [stageA] = await pipelineService.seedDefaultPipeline(tenantA.id);

    await expect(
      pipelineService.renameStage(tenantB.id, { id: stageA.id, name: "Hijacked" }),
    ).rejects.toThrow(TRPCError);
  });
});
