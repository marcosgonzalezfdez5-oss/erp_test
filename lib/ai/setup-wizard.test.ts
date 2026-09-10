import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import { aiToolInvocations } from "@/lib/db/schema/ai-tool-invocation";
import { withTenantContext } from "@/lib/db/tenant-context";
import type { ActorContext } from "@/lib/auth/actor";

vi.mock("ai", () => ({ generateObject: vi.fn() }));

import { generateObject } from "ai";
import { proposeFields, proposePipeline } from "./setup-wizard";

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  for (const id of createdTenantIds.splice(0)) await db.delete(tenants).where(eq(tenants.id, id));
  for (const id of createdUserIds.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function createActor(label: string): Promise<ActorContext> {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `user_${label}_${crypto.randomUUID()}`, email: `${label}@example.com` })
    .returning();
  createdUserIds.push(user.id);
  return { tenantId: tenant.id, userId: user.id, role: "sales_manager" };
}

describe("proposePipeline", () => {
  it("prompts with existing stages + sample columns and logs the invocation", async () => {
    const actor = await createActor("a");
    const object = { stages: [{ name: "Site Survey", kind: "open", rationale: "HVAC installs start with a survey" }] };
    vi.mocked(generateObject).mockResolvedValue({ object } as never);

    const result = await proposePipeline(actor, {
      industryHint: "commercial HVAC",
      existingStageNames: ["Qualification", "Won", "Lost"],
      headers: ["Deal", "Survey date"],
      sampleRows: [["Acme retrofit", "2026-01-05"]],
    });

    expect(result).toEqual(object);
    const call = vi.mocked(generateObject).mock.calls[0][0];
    expect(call.prompt).toContain("Qualification");
    expect(call.prompt).toContain("Survey date");
    expect(call.prompt).toContain("commercial HVAC");

    const [logged] = await withTenantContext(actor.tenantId, (tx) =>
      tx
        .select()
        .from(aiToolInvocations)
        .where(and(eq(aiToolInvocations.tenantId, actor.tenantId), eq(aiToolInvocations.toolName, "proposePipeline"))),
    );
    expect(logged?.userId).toBe(actor.userId);
  });
});

describe("proposeFields", () => {
  it("tells the model which fields already exist and logs the invocation", async () => {
    const actor = await createActor("a");
    vi.mocked(generateObject).mockResolvedValue({ object: { fields: [] } } as never);

    await proposeFields(actor, {
      entityType: "opportunity",
      existingFieldNames: ["Install type"],
      headers: ["Warranty months"],
      sampleRows: [["24"]],
    });

    const call = vi.mocked(generateObject).mock.calls[0][0];
    expect(call.prompt).toContain("Install type");
    expect(call.prompt).toContain("Warranty months");

    const [logged] = await withTenantContext(actor.tenantId, (tx) =>
      tx
        .select()
        .from(aiToolInvocations)
        .where(and(eq(aiToolInvocations.tenantId, actor.tenantId), eq(aiToolInvocations.toolName, "proposeFields"))),
    );
    expect(logged).toBeDefined();
  });
});
