import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as pipelineService from "./pipeline";
import * as leadService from "./lead";
import * as opportunityService from "./opportunity";
import { getPipelineSummary } from "./dashboard";

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
  await pipelineService.seedDefaultPipeline(tenant.id);
  return tenant;
}

async function createOpportunity(tenantId: string, name: string, value?: number) {
  const lead = await leadService.createLead(tenantId, { firstName: name, lastName: "Lead" });
  const opportunity = await leadService.convertLeadToOpportunity(tenantId, { leadId: lead.id });
  if (value !== undefined) {
    await opportunityService.updateOpportunityValue(tenantId, { id: opportunity.id, value });
  }
  return opportunity;
}

describe("dashboard service — pipeline summary", () => {
  it("counts and sums opportunity value per stage, including empty stages", async () => {
    const tenant = await createTenant("a");
    const stages = await pipelineService.listPipelineStages(tenant.id);
    const qualification = stages.find((s) => s.name === "Qualification")!;
    const negotiation = stages.find((s) => s.name === "Negotiation")!;
    const won = stages.find((s) => s.kind === "won")!;

    await createOpportunity(tenant.id, "A", 1000);
    await createOpportunity(tenant.id, "B", 2500.5);
    const c = await createOpportunity(tenant.id, "C", 500);
    await opportunityService.moveOpportunityToStage(tenant.id, { id: c.id, pipelineStageId: negotiation.id });
    const d = await createOpportunity(tenant.id, "D", 100);
    await opportunityService.moveOpportunityToStage(tenant.id, { id: d.id, pipelineStageId: won.id });

    const summary = await getPipelineSummary(tenant.id);
    const byStageId = new Map(summary.map((s) => [s.stageId, s]));

    expect(byStageId.get(qualification.id)).toMatchObject({ opportunityCount: 2, totalValue: "3500.50" });
    expect(byStageId.get(negotiation.id)).toMatchObject({ opportunityCount: 1, totalValue: "500.00" });
    expect(byStageId.get(won.id)).toMatchObject({ opportunityCount: 1, totalValue: "100.00" });

    const proposal = stages.find((s) => s.name === "Proposal")!;
    expect(byStageId.get(proposal.id)).toMatchObject({ opportunityCount: 0, totalValue: "0.00" });
  });

  it("treats opportunities with no value set as contributing 0, not null", async () => {
    const tenant = await createTenant("a");
    await createOpportunity(tenant.id, "A");

    const summary = await getPipelineSummary(tenant.id);
    const qualification = summary.find((s) => s.stageName === "Qualification")!;
    expect(qualification.opportunityCount).toBe(1);
    expect(qualification.totalValue).toBe("0.00");
  });

  it("does not include another tenant's opportunities", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");
    await createOpportunity(tenantA.id, "A", 999);

    const summaryB = await getPipelineSummary(tenantB.id);
    const totalForB = summaryB.reduce((sum, s) => sum + s.opportunityCount, 0);
    expect(totalForB).toBe(0);
  });
});
