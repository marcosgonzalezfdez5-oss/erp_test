import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import { aiToolInvocations } from "@/lib/db/schema/ai-tool-invocation";
import { withTenantContext } from "@/lib/db/tenant-context";

vi.mock("ai", () => ({ generateObject: vi.fn() }));

import { generateObject } from "ai";
import { proposeColumnMapping } from "./csv-mapping";

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

async function createTenantAndUser(label: string) {
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

  return { tenant, user };
}

describe("proposeColumnMapping", () => {
  it("calls the model with the entity's target fields and returns its proposal", async () => {
    const { tenant, user } = await createTenantAndUser("a");
    const mockProposal = {
      mappings: [
        { column: "Company", suggestedField: "name", isNewCustomField: false, reason: "obvious match" },
        { column: "Industry", suggestedField: null, isNewCustomField: true, reason: "no native field fits" },
      ],
    };
    vi.mocked(generateObject).mockResolvedValue({ object: mockProposal } as never);

    const result = await proposeColumnMapping(tenant.id, user.id, {
      entityType: "account",
      headers: ["Company", "Industry"],
      sampleRows: [["Acme Corp", "Manufacturing"]],
    });

    expect(result).toEqual(mockProposal);
    expect(generateObject).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateObject).mock.calls[0][0];
    expect(call.prompt).toContain("name");
    expect(call.prompt).toContain("Company");
  });

  it("logs the tool invocation for audit", async () => {
    const { tenant, user } = await createTenantAndUser("a");
    const mockProposal = { mappings: [] };
    vi.mocked(generateObject).mockResolvedValue({ object: mockProposal } as never);

    await proposeColumnMapping(tenant.id, user.id, {
      entityType: "lead",
      headers: ["First"],
      sampleRows: [],
    });

    const [logged] = await withTenantContext(tenant.id, (tx) =>
      tx
        .select()
        .from(aiToolInvocations)
        .where(and(eq(aiToolInvocations.tenantId, tenant.id), eq(aiToolInvocations.toolName, "proposeColumnMapping"))),
    );
    expect(logged).toBeDefined();
    expect(logged.userId).toBe(user.id);
    expect(logged.result).toEqual(mockProposal);
  });

  it("does not offer isNewCustomField as guidance for leads (no custom field support yet)", async () => {
    const { tenant, user } = await createTenantAndUser("a");
    vi.mocked(generateObject).mockResolvedValue({ object: { mappings: [] } } as never);

    await proposeColumnMapping(tenant.id, user.id, {
      entityType: "lead",
      headers: ["Notes"],
      sampleRows: [],
    });

    const call = vi.mocked(generateObject).mock.calls[0][0];
    expect(call.prompt).toContain("no custom fields yet");
  });
});
