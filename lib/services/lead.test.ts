import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as leadService from "./lead";
import * as pipelineService from "./pipeline";
import * as opportunityService from "./opportunity";
import * as activityService from "./activity";
import * as taskService from "./task";
import * as quoteService from "./quote";

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

    expect(listed.items.map((l) => l.id)).toContain(lead.id);
    expect(lead.convertedOpportunityId).toBeNull();
  });

  it("filters by search and paginates results, scoped to the requesting tenant", async () => {
    const tenantA = await createTenantWithPipeline("a");
    const tenantB = await createTenantWithPipeline("b");
    await leadService.createLead(tenantA.id, { firstName: "Jane", lastName: "Doe" });
    await leadService.createLead(tenantA.id, { firstName: "John", lastName: "Smith" });
    await leadService.createLead(tenantB.id, { firstName: "Jane", lastName: "Roe" });

    const searched = await leadService.listLeads(tenantA.id, { page: 1, search: "jane" });
    expect(searched.items.map((l) => l.lastName)).toEqual(["Doe"]);
    expect(searched.total).toBe(1);

    const listedByA = await leadService.listLeads(tenantA.id, { page: 1, search: "" });
    expect(listedByA.total).toBe(2);
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

  it("soft-deletes a lead", async () => {
    const tenant = await createTenantWithPipeline("a");
    const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });

    await leadService.deleteLead(tenant.id, lead.id);
    const listed = await leadService.listLeads(tenant.id);
    expect(listed.items.map((l) => l.id)).not.toContain(lead.id);
  });

  it("rejects deleteLead for an id belonging to another tenant", async () => {
    const tenantA = await createTenantWithPipeline("a");
    const tenantB = await createTenantWithPipeline("b");
    const lead = await leadService.createLead(tenantA.id, { firstName: "Jane", lastName: "Doe" });

    await expect(leadService.deleteLead(tenantB.id, lead.id)).rejects.toThrow(TRPCError);
  });

  it("unconverts a lead, soft-deleting the opportunity it created", async () => {
    const tenant = await createTenantWithPipeline("a");
    const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });
    const opportunity = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id });

    const unconverted = await leadService.unconvertLead(tenant.id, lead.id);
    expect(unconverted.convertedOpportunityId).toBeNull();

    const opportunities = await opportunityService.listOpportunities(tenant.id);
    expect(opportunities.map((o) => o.id)).not.toContain(opportunity.id);
  });

  it("rejects unconvert for a lead that hasn't been converted", async () => {
    const tenant = await createTenantWithPipeline("a");
    const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });

    await expect(leadService.unconvertLead(tenant.id, lead.id)).rejects.toThrow(TRPCError);
  });

  it("blocks unconvert once the opportunity has an activity, task, or quote", async () => {
    const tenant = await createTenantWithPipeline("a");
    const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });
    const opportunity = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id });

    await activityService.createActivity(tenant.id, {
      opportunityId: opportunity.id,
      type: "note",
      note: "Had a call",
    });

    await expect(leadService.unconvertLead(tenant.id, lead.id)).rejects.toThrow(TRPCError);

    const stillConverted = await leadService.getLead(tenant.id, lead.id);
    expect(stillConverted.convertedOpportunityId).toBe(opportunity.id);
  });

  it("blocks unconvert once the opportunity has a task", async () => {
    const tenant = await createTenantWithPipeline("a");
    const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });
    const opportunity = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id });

    await taskService.createTask(tenant.id, { opportunityId: opportunity.id, title: "Send contract" });

    await expect(leadService.unconvertLead(tenant.id, lead.id)).rejects.toThrow(TRPCError);
  });

  it("blocks unconvert once the opportunity has a quote", async () => {
    const tenant = await createTenantWithPipeline("a");
    const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });
    const opportunity = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id });

    await quoteService.createQuote(tenant.id, { opportunityId: opportunity.id });

    await expect(leadService.unconvertLead(tenant.id, lead.id)).rejects.toThrow(TRPCError);
  });

  it("rejects unconvertLead for an id belonging to another tenant", async () => {
    const tenantA = await createTenantWithPipeline("a");
    const tenantB = await createTenantWithPipeline("b");
    const lead = await leadService.createLead(tenantA.id, { firstName: "Jane", lastName: "Doe" });
    await leadService.convertLeadToOpportunity(tenantA.id, { leadId: lead.id });

    await expect(leadService.unconvertLead(tenantB.id, lead.id)).rejects.toThrow(TRPCError);
  });
});
