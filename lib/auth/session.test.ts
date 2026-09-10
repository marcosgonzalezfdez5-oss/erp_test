import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  clerkClient: vi.fn(),
}));

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import { mapClerkOrgRole, resolveSessionContext } from "./session";
import { listPipelineStages } from "@/lib/services/pipeline";

const clerkOrgId = `org_test_${crypto.randomUUID()}`;
const clerkUserId = `user_test_${crypto.randomUUID()}`;

function mockAuth(overrides: Partial<Awaited<ReturnType<typeof auth>>> = {}) {
  vi.mocked(auth).mockResolvedValue({
    userId: clerkUserId,
    orgId: clerkOrgId,
    orgRole: "org:admin",
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof auth>>);
}

beforeEach(() => {
  mockAuth();
  vi.mocked(currentUser).mockResolvedValue({
    primaryEmailAddress: { emailAddress: "test@example.com" },
    emailAddresses: [],
    fullName: "Test User",
  } as unknown as Awaited<ReturnType<typeof currentUser>>);
  vi.mocked(clerkClient).mockResolvedValue({
    organizations: {
      getOrganization: vi.fn().mockResolvedValue({ name: "Test Org" }),
    },
  } as unknown as Awaited<ReturnType<typeof clerkClient>>);
});

afterEach(async () => {
  await db.delete(tenants).where(eq(tenants.clerkOrgId, clerkOrgId));
  await db.delete(users).where(eq(users.clerkUserId, clerkUserId));
});

describe("resolveSessionContext", () => {
  it("creates tenant/user/membership rows on first sync and maps org:admin to admin", async () => {
    const session = await resolveSessionContext();
    expect(session?.role).toBe("admin");

    const [tenant] = await db.select().from(tenants).where(eq(tenants.clerkOrgId, clerkOrgId));
    expect(tenant?.name).toBe("Test Org");

    const stages = await listPipelineStages(tenant.id);
    expect(stages.map((s) => s.name)).toEqual(["Qualification", "Proposal", "Negotiation", "Won", "Lost"]);
  });

  it("is idempotent on repeated calls (no duplicate tenant rows)", async () => {
    await resolveSessionContext();
    await resolveSessionContext();

    const rows = await db.select().from(tenants).where(eq(tenants.clerkOrgId, clerkOrgId));
    expect(rows).toHaveLength(1);
  });

  it("returns null when there is no active organization", async () => {
    mockAuth({ orgId: null } as unknown as Partial<Awaited<ReturnType<typeof auth>>>);

    const session = await resolveSessionContext();
    expect(session).toBeNull();
  });

  it("re-syncs a membership role when the Clerk org role changes", async () => {
    mockAuth({ orgRole: "org:member" });
    expect((await resolveSessionContext())?.role).toBe("sales_rep");

    // Clerk is the source of truth — a dashboard role change must propagate
    // on the member's next request, not be ignored because a row already exists.
    mockAuth({ orgRole: "org:sales_manager" });
    expect((await resolveSessionContext())?.role).toBe("sales_manager");
  });
});

describe("mapClerkOrgRole", () => {
  it.each([
    ["org:admin", "admin"],
    ["org:sales_manager", "sales_manager"],
    ["org:member", "sales_rep"],
    ["something_else", "sales_rep"],
    [null, "sales_rep"],
    [undefined, "sales_rep"],
  ] as const)("maps %s to %s", (orgRole, expected) => {
    expect(mapClerkOrgRole(orgRole)).toBe(expected);
  });
});
