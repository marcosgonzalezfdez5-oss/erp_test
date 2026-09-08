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

async function createTenantWithWonOpportunity(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  await pipelineService.seedDefaultPipeline(tenant.id);

  const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });
  const opportunity = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id });
  const stages = await pipelineService.listPipelineStages(tenant.id);
  const won = stages.find((s) => s.kind === "won")!;
  await opportunityService.moveOpportunityToStage(tenant.id, { id: opportunity.id, pipelineStageId: won.id });

  return { tenant, opportunity };
}

describe("order service", () => {
  it("fetches an order by id", async () => {
    const { tenant, opportunity } = await createTenantWithWonOpportunity("a");
    const byOpportunity = await orderService.getOrderByOpportunity(tenant.id, opportunity.id);
    expect(byOpportunity).not.toBeNull();

    const byId = await orderService.getOrder(tenant.id, byOpportunity!.id);
    expect(byId.opportunityId).toBe(opportunity.id);
  });

  it("throws NOT_FOUND for a nonexistent order id", async () => {
    const { tenant } = await createTenantWithWonOpportunity("a");
    await expect(orderService.getOrder(tenant.id, crypto.randomUUID())).rejects.toThrow(TRPCError);
  });

  it("rejects getOrder for an id belonging to another tenant", async () => {
    const { tenant: tenantA, opportunity } = await createTenantWithWonOpportunity("a");
    const { tenant: tenantB } = await createTenantWithWonOpportunity("b");
    const order = await orderService.getOrderByOpportunity(tenantA.id, opportunity.id);

    await expect(orderService.getOrder(tenantB.id, order!.id)).rejects.toThrow(TRPCError);
  });
});
