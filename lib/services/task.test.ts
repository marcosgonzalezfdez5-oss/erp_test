import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as pipelineService from "./pipeline";
import * as leadService from "./lead";
import * as taskService from "./task";

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

describe("task service", () => {
  it("creates and lists tasks for an opportunity, starting open", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");

    const task = await taskService.createTask(tenant.id, {
      opportunityId: opportunity.id,
      title: "Send proposal",
    });
    expect(task.completedAt).toBeNull();

    const listed = await taskService.listTasksByOpportunity(tenant.id, opportunity.id);
    expect(listed.map((t) => t.id)).toContain(task.id);
  });

  it("marks a task complete and can reopen it", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");
    const task = await taskService.createTask(tenant.id, { opportunityId: opportunity.id, title: "Follow up" });

    const completed = await taskService.setTaskCompletion(tenant.id, { id: task.id, completed: true });
    expect(completed.completedAt).not.toBeNull();

    const reopened = await taskService.setTaskCompletion(tenant.id, { id: task.id, completed: false });
    expect(reopened.completedAt).toBeNull();
  });

  it("rejects creating a task for an opportunity belonging to another tenant", async () => {
    const { opportunity } = await createTenantWithOpportunity("a");
    const other = await createTenantWithOpportunity("b");

    await expect(
      taskService.createTask(other.tenant.id, { opportunityId: opportunity.id, title: "Should not be allowed" }),
    ).rejects.toThrow(TRPCError);
  });

  it("rejects completing a task belonging to another tenant", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");
    const other = await createTenantWithOpportunity("b");
    const task = await taskService.createTask(tenant.id, { opportunityId: opportunity.id, title: "Follow up" });

    await expect(taskService.setTaskCompletion(other.tenant.id, { id: task.id, completed: true })).rejects.toThrow(
      TRPCError,
    );
  });
});
