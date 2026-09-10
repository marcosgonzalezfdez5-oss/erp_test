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
import { draftFollowUpEmail, summarize } from "./drafting";

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
  return { tenantId: tenant.id, userId: user.id, role: "sales_rep" };
}

describe("summarize", () => {
  it("builds the prompt only from the supplied context and logs the invocation", async () => {
    const actor = await createActor("a");
    vi.mocked(generateObject).mockResolvedValue({ object: { summary: "All good", keyRisks: ["slow replies"] } } as never);

    const result = await summarize(actor, {
      entityLabel: "opportunity",
      name: "Acme retrofit",
      stageName: "Negotiation",
      value: "5000.00",
      activities: [{ type: "call", note: "Discussed scope", date: "2026-01-05" }],
      openTaskTitles: ["Send revised quote"],
    });

    expect(result.body).toContain("All good");
    expect(result.body).toContain("slow replies");
    expect(result.model).toBe("gpt-4o-mini");

    const call = vi.mocked(generateObject).mock.calls[0][0];
    expect(call.prompt).toContain("Acme retrofit");
    expect(call.prompt).toContain("Discussed scope");

    const [logged] = await withTenantContext(actor.tenantId, (tx) =>
      tx
        .select()
        .from(aiToolInvocations)
        .where(and(eq(aiToolInvocations.tenantId, actor.tenantId), eq(aiToolInvocations.toolName, "summarize"))),
    );
    // The audit stores a digest, not the raw activity notes.
    expect(JSON.stringify(logged.arguments)).not.toContain("Discussed scope");
    expect(logged.userId).toBe(actor.userId);
  });
});

describe("draftFollowUpEmail", () => {
  it("returns the model's subject + body and logs the invocation", async () => {
    const actor = await createActor("a");
    vi.mocked(generateObject).mockResolvedValue({
      object: { subject: "Next steps on Acme", body: "Hi Dana, ..." },
    } as never);

    const result = await draftFollowUpEmail(actor, {
      opportunityName: "Acme retrofit",
      contactFirstName: "Dana",
      lastActivity: { type: "call", note: "scope", date: "2026-01-05" },
    });

    expect(result).toMatchObject({ subject: "Next steps on Acme", model: "gpt-4o-mini" });
    const [logged] = await withTenantContext(actor.tenantId, (tx) =>
      tx
        .select()
        .from(aiToolInvocations)
        .where(
          and(eq(aiToolInvocations.tenantId, actor.tenantId), eq(aiToolInvocations.toolName, "draftFollowUpEmail")),
        ),
    );
    expect(logged).toBeDefined();
  });
});
