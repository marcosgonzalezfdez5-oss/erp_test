import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { ActorContext } from "@/lib/auth/actor";
import type { MembershipRole } from "@/lib/db/schema/membership";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import * as customFieldService from "./custom-field";
import * as pipelineService from "./pipeline";
import * as suggestionService from "./suggestion";
import * as setupWizardService from "./setup-wizard";

// No OPENAI_API_KEY in the test env, so proposePipeline/proposeFields throw and
// analyzeForSetup exercises its deterministic fallback — exactly the path we
// need to work when AI is unavailable (CLAUDE.md §9).

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await db.delete(tenants).where(eq(tenants.id, id));
  for (const id of createdUserIds.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function createActor(label: string, role: MembershipRole = "sales_manager"): Promise<ActorContext> {
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

const CSV = "Deal,Region,Install type\nAcme retrofit,North,Ducted\nGlobex HQ,South,Split";

describe("setup wizard — analyzeForSetup", () => {
  it("requires manager access", async () => {
    const rep = await createActor("a", "sales_rep");
    await expect(
      setupWizardService.analyzeForSetup(rep, { entityType: "account", csvText: CSV }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("falls back deterministically when AI is unavailable", async () => {
    const actor = await createActor("a");
    const result = await setupWizardService.analyzeForSetup(actor, { entityType: "lead", csvText: CSV });

    expect(result.pipeline.aiAvailable).toBe(false);
    expect(result.fields.aiAvailable).toBe(false);
    expect(result.fields.entityType).toBe("opportunity");
    // A freshly-seeded tenant already has every default stage, so nothing new.
    expect(result.pipeline.stages).toEqual([]);
    expect(result.existingStageNames).toEqual(["Qualification", "Proposal", "Negotiation", "Won", "Lost"]);
  });

  it("does not see another tenant's stages or fields", async () => {
    const a = await createActor("a");
    const b = await createActor("b");
    await pipelineService.createStage(a.tenantId, { name: "A-only stage", kind: "open" });
    await customFieldService.createDefinition(a.tenantId, {
      entityType: "account",
      name: "A-only field",
      fieldType: "text",
      required: false,
    });

    const result = await setupWizardService.analyzeForSetup(b, { entityType: "account", csvText: CSV });
    expect(result.existingStageNames).not.toContain("A-only stage");
    expect(result.existingFieldNames).not.toContain("A-only field");
  });
});

describe("setup wizard — createSetupSuggestions", () => {
  it("creates one pending suggestion per kept item, sharing a group key", async () => {
    const actor = await createActor("a");

    const { groupKey, created } = await setupWizardService.createSetupSuggestions(actor, {
      stages: [{ name: "Site Survey", kind: "open" }],
      fields: [
        { entityType: "account", name: "Region", fieldType: "select", options: ["North", "South"], required: false },
      ],
    });

    expect(created).toBe(2);
    const list = await suggestionService.listSuggestions(actor.tenantId, { groupKey });
    expect(list).toHaveLength(2);
    expect(list.every((s) => s.source === "setup_wizard" && s.status === "pending")).toBe(true);
  });

  it("requires manager access", async () => {
    const rep = await createActor("a", "sales_rep");
    await expect(
      setupWizardService.createSetupSuggestions(rep, { stages: [{ name: "X", kind: "open" }], fields: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("end to end: create suggestions then approve the group applies stages + fields", async () => {
    const actor = await createActor("a");
    const { groupKey } = await setupWizardService.createSetupSuggestions(actor, {
      stages: [{ name: "Site Survey", kind: "open" }],
      fields: [{ entityType: "opportunity", name: "Install type", fieldType: "text", required: false }],
    });

    const results = await suggestionService.approveGroup(actor, groupKey);
    expect(results.every((r) => r.ok)).toBe(true);

    const stages = await pipelineService.listPipelineStages(actor.tenantId);
    expect(stages.map((s) => s.name)).toContain("Site Survey");
    const defs = await customFieldService.listDefinitions(actor.tenantId, "opportunity");
    expect(defs.map((d) => d.name)).toContain("Install type");
  });

  it("keeps setup suggestions isolated per tenant", async () => {
    const a = await createActor("a");
    const b = await createActor("b");
    const { groupKey } = await setupWizardService.createSetupSuggestions(a, {
      stages: [{ name: "A Survey", kind: "open" }],
      fields: [],
    });

    expect(await suggestionService.listSuggestions(b.tenantId, { groupKey })).toHaveLength(0);
  });
});
