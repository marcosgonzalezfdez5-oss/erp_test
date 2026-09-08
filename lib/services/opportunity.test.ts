import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as pipelineService from "./pipeline";
import * as leadService from "./lead";
import * as opportunityService from "./opportunity";
import * as orderService from "./order";

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
});

async function createTenantWithOpportunity(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  await pipelineService.seedDefaultPipeline(tenant.id);

  const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });
  const opportunity = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id });

  return { tenant, opportunity };
}

describe("opportunity service — stage transitions", () => {
  it("moves an opportunity to another stage", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");
    const stages = await pipelineService.listPipelineStages(tenant.id);
    const negotiation = stages.find((s) => s.name === "Negotiation")!;

    const moved = await opportunityService.moveOpportunityToStage(tenant.id, {
      id: opportunity.id,
      pipelineStageId: negotiation.id,
    });

    expect(moved.pipelineStageId).toBe(negotiation.id);
  });

  it("rejects moving to a stage that doesn't belong to the tenant", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");
    const other = await createTenantWithOpportunity("b");
    const otherStages = await pipelineService.listPipelineStages(other.tenant.id);

    await expect(
      opportunityService.moveOpportunityToStage(tenant.id, {
        id: opportunity.id,
        pipelineStageId: otherStages[0].id,
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("rejects moving an opportunity belonging to another tenant", async () => {
    const { opportunity } = await createTenantWithOpportunity("a");
    const other = await createTenantWithOpportunity("b");
    const otherStages = await pipelineService.listPipelineStages(other.tenant.id);

    await expect(
      opportunityService.moveOpportunityToStage(other.tenant.id, {
        id: opportunity.id,
        pipelineStageId: otherStages[0].id,
      }),
    ).rejects.toThrow(TRPCError);
  });
});

describe("opportunity service — Won/Lost order stub", () => {
  it("creates a stub order exactly once when moved into a won stage, even if re-triggered", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");
    const stages = await pipelineService.listPipelineStages(tenant.id);
    const won = stages.find((s) => s.kind === "won")!;

    await opportunityService.moveOpportunityToStage(tenant.id, { id: opportunity.id, pipelineStageId: won.id });
    const order = await orderService.getOrderByOpportunity(tenant.id, opportunity.id);
    expect(order).not.toBeNull();

    // re-triggering (e.g. moving to won again) must not create a second order
    await opportunityService.moveOpportunityToStage(tenant.id, { id: opportunity.id, pipelineStageId: won.id });
    const orderAgain = await orderService.getOrderByOpportunity(tenant.id, opportunity.id);
    expect(orderAgain!.id).toBe(order!.id);
  });

  it("does not create an order when moved into a lost stage", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");
    const stages = await pipelineService.listPipelineStages(tenant.id);
    const lost = stages.find((s) => s.kind === "lost")!;

    await opportunityService.moveOpportunityToStage(tenant.id, { id: opportunity.id, pipelineStageId: lost.id });
    const order = await orderService.getOrderByOpportunity(tenant.id, opportunity.id);
    expect(order).toBeNull();
  });

  it("scopes order lookups to the requesting tenant", async () => {
    const { tenant: tenantA, opportunity } = await createTenantWithOpportunity("a");
    const { tenant: tenantB } = await createTenantWithOpportunity("b");
    const stagesA = await pipelineService.listPipelineStages(tenantA.id);
    const wonA = stagesA.find((s) => s.kind === "won")!;

    await opportunityService.moveOpportunityToStage(tenantA.id, { id: opportunity.id, pipelineStageId: wonA.id });

    const orderForB = await orderService.getOrderByOpportunity(tenantB.id, opportunity.id);
    expect(orderForB).toBeNull();
  });
});

describe("opportunity service — value", () => {
  it("sets and formats a deal value, and can clear it back to null", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");

    const updated = await opportunityService.updateOpportunityValue(tenant.id, { id: opportunity.id, value: 4200 });
    expect(updated.value).toBe("4200.00");

    const cleared = await opportunityService.updateOpportunityValue(tenant.id, { id: opportunity.id, value: null });
    expect(cleared.value).toBeNull();
  });

  it("rejects setting a value on an opportunity belonging to another tenant", async () => {
    const { opportunity } = await createTenantWithOpportunity("a");
    const { tenant: tenantB } = await createTenantWithOpportunity("b");

    await expect(
      opportunityService.updateOpportunityValue(tenantB.id, { id: opportunity.id, value: 100 }),
    ).rejects.toThrow(TRPCError);
  });
});

describe("opportunity service — update/delete", () => {
  it("renames and soft-deletes an opportunity", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");

    const renamed = await opportunityService.updateOpportunity(tenant.id, { id: opportunity.id, name: "Renamed Deal" });
    expect(renamed.name).toBe("Renamed Deal");

    await opportunityService.deleteOpportunity(tenant.id, opportunity.id);
    const listed = await opportunityService.listOpportunities(tenant.id);
    expect(listed.map((o) => o.id)).not.toContain(opportunity.id);
  });

  it("rejects updateOpportunity/deleteOpportunity for an id belonging to another tenant", async () => {
    const { opportunity } = await createTenantWithOpportunity("a");
    const { tenant: tenantB } = await createTenantWithOpportunity("b");

    await expect(
      opportunityService.updateOpportunity(tenantB.id, { id: opportunity.id, name: "Hijacked" }),
    ).rejects.toThrow(TRPCError);
    await expect(opportunityService.deleteOpportunity(tenantB.id, opportunity.id)).rejects.toThrow(TRPCError);

    const stillThere = await opportunityService.getOpportunity(opportunity.tenantId, opportunity.id);
    expect(stillThere.name).not.toBe("Hijacked");
  });
});
