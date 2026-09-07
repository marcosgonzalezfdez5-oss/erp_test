import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as leadService from "./lead";
import * as pipelineService from "./pipeline";
import * as opportunityService from "./opportunity";

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
});

async function createTenantWithPipeline(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  await pipelineService.seedDefaultPipeline(tenant.id);
  return tenant;
}

describe("lead service", () => {
  it("creates and lists leads", async () => {
    const tenant = await createTenantWithPipeline("a");

    const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });
    const listed = await leadService.listLeads(tenant.id);

    expect(listed.map((l) => l.id)).toContain(lead.id);
    expect(lead.convertedOpportunityId).toBeNull();
  });

  it("converts a lead into an opportunity in the tenant's first open stage", async () => {
    const tenant = await createTenantWithPipeline("a");
    const stages = await pipelineService.listPipelineStages(tenant.id);
    const firstOpenStage = stages.find((s) => s.kind === "open");

    const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });
    const opportunity = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id });

    expect(opportunity.pipelineStageId).toBe(firstOpenStage?.id);
    expect(opportunity.name).toBe("Jane Doe");

    const updatedLead = await leadService.getLead(tenant.id, lead.id);
    expect(updatedLead.convertedOpportunityId).toBe(opportunity.id);

    const opportunities = await opportunityService.listOpportunities(tenant.id);
    expect(opportunities.map((o) => o.id)).toContain(opportunity.id);
  });

  it("uses an explicit name when provided", async () => {
    const tenant = await createTenantWithPipeline("a");
    const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });

    const opportunity = await leadService.convertLeadToOpportunity(tenant.id, {
      leadId: lead.id,
      name: "Acme Renewal",
    });

    expect(opportunity.name).toBe("Acme Renewal");
  });

  it("rejects converting an already-converted lead", async () => {
    const tenant = await createTenantWithPipeline("a");
    const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });

    await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id });

    await expect(leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id })).rejects.toThrow(TRPCError);
  });

  it("rejects converting a lead belonging to another tenant", async () => {
    const tenantA = await createTenantWithPipeline("a");
    const tenantB = await createTenantWithPipeline("b");
    const lead = await leadService.createLead(tenantA.id, { firstName: "Jane", lastName: "Doe" });

    await expect(leadService.convertLeadToOpportunity(tenantB.id, { leadId: lead.id })).rejects.toThrow(TRPCError);
  });
});
