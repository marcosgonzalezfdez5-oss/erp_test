import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { ActorContext } from "@/lib/auth/actor";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import * as accountService from "./account";
import * as activityService from "./activity";
import * as leadService from "./lead";
import * as pipelineService from "./pipeline";
import * as draftService from "./draft";

// No OPENAI_API_KEY in the test env: summarize/draftFollowUpEmail throw and the
// service uses its deterministic fallback (model === null).

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await db.delete(tenants).where(eq(tenants.id, id));
  for (const id of createdUserIds.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function setup(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  await pipelineService.seedDefaultPipeline(tenant.id);
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `user_${label}_${crypto.randomUUID()}`, email: `${label}@example.com` })
    .returning();
  createdUserIds.push(user.id);

  const actor: ActorContext = { tenantId: tenant.id, userId: user.id, role: "sales_rep" };

  const lead = await leadService.createLead(tenant.id, { firstName: "Dana", lastName: "Lee" });
  const opp = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id, name: "Acme retrofit" });
  await activityService.createActivity(tenant.id, { opportunityId: opp.id, type: "call", note: "Discussed scope" });

  return { actor, opp };
}

describe("draft service — summaries", () => {
  it("generates a fallback summary and replaces the previous active one", async () => {
    const { actor, opp } = await setup("a");

    const first = await draftService.generateSummary(actor, { entityType: "opportunity", entityId: opp.id });
    expect(first.model).toBeNull();
    expect(first.aiGenerated).toBe(false);
    expect(first.body).toContain("activity");

    const second = await draftService.generateSummary(actor, { entityType: "opportunity", entityId: opp.id });
    expect(second.id).not.toBe(first.id);

    const active = await draftService.listDrafts(actor.tenantId, {
      entityId: opp.id,
      kind: "opportunity_summary",
      status: "active",
    });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(second.id);
  });

  it("summarises an account", async () => {
    const { actor } = await setup("a");
    const acc = await accountService.createAccount(actor.tenantId, { name: "Globex" });
    const summary = await draftService.generateSummary(actor, { entityType: "account", entityId: acc.id });
    expect(summary.kind).toBe("account_summary");
    expect(summary.targetEntityId).toBe(acc.id);
  });

  it("will not summarise another tenant's opportunity", async () => {
    const { opp } = await setup("a");
    const b = await setup("b");
    await expect(
      draftService.generateSummary(b.actor, { entityType: "opportunity", entityId: opp.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("draft service — follow-up emails", () => {
  it("appends a new draft each time and records the editor on update", async () => {
    const { actor, opp } = await setup("a");

    const d1 = await draftService.generateFollowUpEmail(actor, { opportunityId: opp.id });
    const d2 = await draftService.generateFollowUpEmail(actor, { opportunityId: opp.id });
    expect(d1.id).not.toBe(d2.id);
    expect(d1.kind).toBe("follow_up_email");
    expect(d1.model).toBeNull();

    const edited = await draftService.updateDraft(actor, { id: d1.id, subject: "Edited", body: "New body" });
    expect(edited.editedByUserId).toBe(actor.userId);
    expect(edited.body).toBe("New body");

    const dismissed = await draftService.dismissDraft(actor, d2.id);
    expect(dismissed.status).toBe("dismissed");
  });

  it("isolates drafts per tenant", async () => {
    const { actor, opp } = await setup("a");
    const b = await setup("b");
    const draft = await draftService.generateFollowUpEmail(actor, { opportunityId: opp.id });

    await expect(draftService.getDraft(b.actor.tenantId, draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      draftService.updateDraft(b.actor, { id: draft.id, body: "hijack" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await draftService.listDrafts(b.actor.tenantId, { entityId: opp.id })).toHaveLength(0);
  });
});
