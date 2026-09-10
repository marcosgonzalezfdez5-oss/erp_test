import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { SYSTEM_ACTOR_USER_ID, type ActorContext } from "@/lib/auth/actor";
import type { MembershipRole } from "@/lib/db/schema/membership";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import * as pipelineService from "./pipeline";
import * as leadService from "./lead";
import * as opportunityService from "./opportunity";
import * as suggestionService from "./suggestion";

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
  for (const userId of createdUserIds.splice(0)) {
    await db.delete(users).where(eq(users.id, userId));
  }
});

async function createActor(label: string, role: MembershipRole = "admin"): Promise<ActorContext> {
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

  return { tenantId: tenant.id, userId: user.id, role };
}

function as(actor: ActorContext, role: MembershipRole): ActorContext {
  return { ...actor, role };
}

describe("suggestion service — create + list", () => {
  it("creates a pending suggestion and lists it scoped to the tenant", async () => {
    const actor = await createActor("a");

    const created = await suggestionService.createSuggestion(
      actor.tenantId,
      {
        source: "setup_wizard",
        kind: "create_pipeline_stage",
        payload: { name: "Discovery", kind: "open" },
        rationale: "Your CSV has a 'discovery call' column",
      },
      actor.userId,
    );

    expect(created.status).toBe("pending");
    expect(created.createdByUserId).toBe(actor.userId);

    const list = await suggestionService.listSuggestions(actor.tenantId, { status: "pending" });
    expect(list).toHaveLength(1);
    expect(list[0].description).toBe('Add pipeline stage "Discovery" (open)');
  });

  it("rejects a payload that fails the kind's schema", async () => {
    const actor = await createActor("a");
    await expect(
      suggestionService.createSuggestion(
        actor.tenantId,
        { source: "manual", kind: "create_pipeline_stage", payload: { name: "" } },
        actor.userId,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not leak suggestions across tenants", async () => {
    const a = await createActor("a");
    const b = await createActor("b");
    const s = await suggestionService.createSuggestion(
      a.tenantId,
      { source: "manual", kind: "create_pipeline_stage", payload: { name: "X", kind: "open" } },
      a.userId,
    );

    expect(await suggestionService.listSuggestions(b.tenantId)).toHaveLength(0);
    await expect(suggestionService.getSuggestion(b.tenantId, s.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(suggestionService.approveSuggestion(b, s.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(suggestionService.rejectSuggestion(b, { id: s.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("suggestion service — approve", () => {
  it("applies create_pipeline_stage exactly once and marks it approved", async () => {
    const actor = await createActor("a");
    const before = (await pipelineService.listPipelineStages(actor.tenantId)).length;

    const s = await suggestionService.createSuggestion(
      actor.tenantId,
      { source: "setup_wizard", kind: "create_pipeline_stage", payload: { name: "Discovery", kind: "open" } },
      actor.userId,
    );
    const approved = await suggestionService.approveSuggestion(actor, s.id);

    expect(approved.status).toBe("approved");
    expect(approved.appliedAt).not.toBeNull();
    expect(approved.reviewedByUserId).toBe(actor.userId);

    const stages = await pipelineService.listPipelineStages(actor.tenantId);
    expect(stages.length).toBe(before + 1);
    expect(stages.map((st) => st.name)).toContain("Discovery");
  });

  it("rejects a second approval (CONFLICT) and approval after rejection", async () => {
    const actor = await createActor("a");
    const s = await suggestionService.createSuggestion(
      actor.tenantId,
      { source: "manual", kind: "create_pipeline_stage", payload: { name: "Discovery", kind: "open" } },
      actor.userId,
    );

    await suggestionService.approveSuggestion(actor, s.id);
    await expect(suggestionService.approveSuggestion(actor, s.id)).rejects.toMatchObject({ code: "CONFLICT" });

    const s2 = await suggestionService.createSuggestion(
      actor.tenantId,
      { source: "manual", kind: "create_pipeline_stage", payload: { name: "Other", kind: "open" } },
      actor.userId,
    );
    await suggestionService.rejectSuggestion(actor, { id: s2.id, reason: "not needed" });
    await expect(suggestionService.approveSuggestion(actor, s2.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("enforces the per-kind required role", async () => {
    const actor = await createActor("a");

    const configSuggestion = await suggestionService.createSuggestion(
      actor.tenantId,
      { source: "setup_wizard", kind: "create_pipeline_stage", payload: { name: "Discovery", kind: "open" } },
      actor.userId,
    );
    await expect(
      suggestionService.approveSuggestion(as(actor, "sales_rep"), configSuggestion.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // move_opportunity_stage is approvable by a rep
    const lead = await leadService.createLead(actor.tenantId, { firstName: "Jane", lastName: "Doe" });
    const opp = await leadService.convertLeadToOpportunity(actor.tenantId, { leadId: lead.id });
    const stages = await pipelineService.listPipelineStages(actor.tenantId);
    const negotiation = stages.find((st) => st.name === "Negotiation")!;

    const moveSuggestion = await suggestionService.createSuggestion(
      actor.tenantId,
      {
        source: "automation",
        kind: "move_opportunity_stage",
        payload: { id: opp.id, pipelineStageId: negotiation.id },
        targetEntityType: "opportunity",
        targetEntityId: opp.id,
      },
      null,
    );
    const approved = await suggestionService.approveSuggestion(as(actor, "sales_rep"), moveSuggestion.id);
    expect(approved.status).toBe("approved");
    expect((await opportunityService.getOpportunity(actor.tenantId, opp.id)).pipelineStageId).toBe(negotiation.id);
  });

  it("leaves the suggestion pending with last_error when apply() fails", async () => {
    const actor = await createActor("a");
    const lead = await leadService.createLead(actor.tenantId, { firstName: "Jane", lastName: "Doe" });
    const opp = await leadService.convertLeadToOpportunity(actor.tenantId, { leadId: lead.id });
    const stages = await pipelineService.listPipelineStages(actor.tenantId);
    const negotiation = stages.find((st) => st.name === "Negotiation")!;

    const s = await suggestionService.createSuggestion(
      actor.tenantId,
      { source: "automation", kind: "move_opportunity_stage", payload: { id: opp.id, pipelineStageId: negotiation.id } },
      null,
    );

    // soft-delete the opportunity so apply() hits NOT_FOUND
    await opportunityService.deleteOpportunity(actor.tenantId, opp.id);

    await expect(suggestionService.approveSuggestion(actor, s.id)).rejects.toThrow(TRPCError);

    const reloaded = await suggestionService.getSuggestion(actor.tenantId, s.id);
    expect(reloaded.status).toBe("pending");
    expect(reloaded.lastError).toBeTruthy();
  });

  it("records null reviewer for the system actor", async () => {
    const base = await createActor("a");
    const systemActor: ActorContext = { tenantId: base.tenantId, userId: SYSTEM_ACTOR_USER_ID, role: "admin" };

    const s = await suggestionService.createSuggestion(
      base.tenantId,
      { source: "automation", kind: "create_pipeline_stage", payload: { name: "Auto Stage", kind: "open" } },
      null,
    );
    const approved = await suggestionService.approveSuggestion(systemActor, s.id);
    expect(approved.reviewedByUserId).toBeNull();
  });
});

describe("suggestion service — approveGroup", () => {
  it("approves every pending member and reports partial failure", async () => {
    const actor = await createActor("a");
    const groupKey = crypto.randomUUID();

    const ok1 = await suggestionService.createSuggestion(
      actor.tenantId,
      { source: "setup_wizard", kind: "create_pipeline_stage", payload: { name: "S1", kind: "open" }, groupKey },
      actor.userId,
    );
    const ok2 = await suggestionService.createSuggestion(
      actor.tenantId,
      { source: "setup_wizard", kind: "create_pipeline_stage", payload: { name: "S2", kind: "open" }, groupKey },
      actor.userId,
    );
    // a member that will fail on apply (opportunity doesn't exist)
    const bad = await suggestionService.createSuggestion(
      actor.tenantId,
      {
        source: "setup_wizard",
        kind: "move_opportunity_stage",
        payload: { id: crypto.randomUUID(), pipelineStageId: crypto.randomUUID() },
        groupKey,
      },
      actor.userId,
    );

    const results = await suggestionService.approveGroup(actor, groupKey);
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get(ok1.id)?.ok).toBe(true);
    expect(byId.get(ok2.id)?.ok).toBe(true);
    expect(byId.get(bad.id)?.ok).toBe(false);

    const stages = await pipelineService.listPipelineStages(actor.tenantId);
    expect(stages.map((s) => s.name)).toEqual(expect.arrayContaining(["S1", "S2"]));
  });
});
