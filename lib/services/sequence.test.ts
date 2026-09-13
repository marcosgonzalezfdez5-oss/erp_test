import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { sequences } from "@/lib/db/schema/sequence";
import { withTenantContext } from "@/lib/db/tenant-context";
import * as sequenceService from "./sequence";

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
});

async function createTenant(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  return tenant;
}

describe("formatDocumentNumber (pure)", () => {
  it("expands period and zero-padded counter tokens", () => {
    expect(sequenceService.formatDocumentNumber("INV-{YYYY}-{SEQ:4}", 2026, 42)).toBe("INV-2026-0042");
    expect(sequenceService.formatDocumentNumber("{YY}/{SEQ}", 2026, 7)).toBe("26/7");
    expect(sequenceService.formatDocumentNumber("REC-{YYYY}-{SEQ:6}", 2026, 1234567)).toBe("REC-2026-1234567");
  });
});

describe("sequence allocation", () => {
  it("hands out consecutive numbers per (tenant, kind, period)", async () => {
    const tenant = await createTenant("a");
    expect(await sequenceService.nextNumber(tenant.id, "invoice", 2026)).toBe(1);
    expect(await sequenceService.nextNumber(tenant.id, "invoice", 2026)).toBe(2);
    expect(await sequenceService.nextNumber(tenant.id, "invoice", 2026)).toBe(3);
  });

  it("keeps separate counters per kind and per period", async () => {
    const tenant = await createTenant("a");
    expect(await sequenceService.nextNumber(tenant.id, "invoice", 2026)).toBe(1);
    expect(await sequenceService.nextNumber(tenant.id, "credit_note", 2026)).toBe(1);
    expect(await sequenceService.nextNumber(tenant.id, "invoice", 2027)).toBe(1);
    expect(await sequenceService.nextNumber(tenant.id, "invoice", 2026)).toBe(2);
  });

  it("stays gapless under concurrent allocation", async () => {
    const tenant = await createTenant("a");
    const results = await Promise.all(
      Array.from({ length: 12 }, () => sequenceService.nextNumber(tenant.id, "order", 2026)),
    );
    expect([...results].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(results).size).toBe(12); // no duplicates
  });

  it("releases the number when the caller's transaction rolls back", async () => {
    const tenant = await createTenant("a");
    expect(await sequenceService.nextNumber(tenant.id, "invoice", 2026)).toBe(1);

    await expect(
      withTenantContext(tenant.id, async (tx) => {
        await sequenceService.allocate(tx, tenant.id, "invoice", 2026); // would be 2
        throw new Error("issue failed after allocation");
      }),
    ).rejects.toThrow("issue failed after allocation");

    // the rolled-back allocation left no gap — the next real allocation is still 2
    expect(await sequenceService.nextNumber(tenant.id, "invoice", 2026)).toBe(2);
  });

  it("scopes counters per tenant and does not leak rows across tenants", async () => {
    const a = await createTenant("a");
    const b = await createTenant("b");

    await sequenceService.nextNumber(a.id, "invoice", 2026);
    await sequenceService.nextNumber(a.id, "invoice", 2026);
    expect(await sequenceService.nextNumber(b.id, "invoice", 2026)).toBe(1);

    const visibleToB = await withTenantContext(b.id, (tx) =>
      tx.select().from(sequences).where(eq(sequences.tenantId, a.id)),
    );
    expect(visibleToB).toHaveLength(0);
  });
});
