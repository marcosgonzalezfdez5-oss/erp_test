import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as pipelineService from "./pipeline";
import * as leadService from "./lead";
import * as activityService from "./activity";

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

describe("activity service", () => {
  it("creates and lists activities for an opportunity", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");

    const activity = await activityService.createActivity(tenant.id, {
      opportunityId: opportunity.id,
      type: "call",
      note: "Talked about renewal",
    });

    const listed = await activityService.listActivitiesByOpportunity(tenant.id, opportunity.id);
    expect(listed.map((a) => a.id)).toContain(activity.id);
    expect(listed[0].note).toBe("Talked about renewal");
  });

  it("rejects creating an activity for an opportunity belonging to another tenant", async () => {
    const { opportunity } = await createTenantWithOpportunity("a");
    const other = await createTenantWithOpportunity("b");

    await expect(
      activityService.createActivity(other.tenant.id, {
        opportunityId: opportunity.id,
        type: "note",
        note: "Should not be allowed",
      }),
    ).rejects.toThrow(TRPCError);
  });
});
