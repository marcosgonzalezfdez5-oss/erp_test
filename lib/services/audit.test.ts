import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import { SYSTEM_ACTOR_USER_ID, type ActorContext } from "@/lib/auth/actor";
import { withTenantContext } from "@/lib/db/tenant-context";
import * as auditService from "./audit";

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
  return { tenantId: tenant.id, userId: user.id, role: "admin" };
}

const entity = () => ({ entityType: "invoice", entityId: crypto.randomUUID() });

describe("audit service", () => {
  it("records an entry inside the caller's transaction and lists it", async () => {
    const actor = await createActor("a");
    const target = entity();

    await withTenantContext(actor.tenantId, (tx) =>
      auditService.recordAudit(tx, actor.tenantId, actor, {
        ...target,
        action: "invoice.issue",
        summary: "Issued INV-2026-0001",
        diff: { status: { from: "draft", to: "issued" } },
      }),
    );

    const entries = await auditService.listAuditEntries(actor.tenantId, { entityId: target.entityId });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "invoice.issue", actorUserId: actor.userId });
    expect(entries[0].diff).toEqual({ status: { from: "draft", to: "issued" } });
  });

  it("stores a null actor for the system actor", async () => {
    const actor = await createActor("a");
    const systemActor: ActorContext = { tenantId: actor.tenantId, userId: SYSTEM_ACTOR_USER_ID, role: "admin" };
    const target = entity();

    await withTenantContext(actor.tenantId, (tx) =>
      auditService.recordAudit(tx, actor.tenantId, systemActor, { ...target, action: "stock.adjust", summary: "auto" }),
    );

    const [row] = await auditService.listAuditEntries(actor.tenantId, { entityId: target.entityId });
    expect(row.actorUserId).toBeNull();
  });

  it("rolls back with the caller's transaction", async () => {
    const actor = await createActor("a");
    const target = entity();

    await expect(
      withTenantContext(actor.tenantId, async (tx) => {
        await auditService.recordAudit(tx, actor.tenantId, actor, { ...target, action: "invoice.issue", summary: "x" });
        throw new Error("mutation failed");
      }),
    ).rejects.toThrow("mutation failed");

    expect(await auditService.listAuditEntries(actor.tenantId, { entityId: target.entityId })).toHaveLength(0);
  });

  it("filters by entity and does not leak across tenants", async () => {
    const a = await createActor("a");
    const b = await createActor("b");
    const invoiceTarget = entity();
    const stockTarget = { entityType: "stock_movement", entityId: crypto.randomUUID() };

    await withTenantContext(a.tenantId, async (tx) => {
      await auditService.recordAudit(tx, a.tenantId, a, { ...invoiceTarget, action: "invoice.issue", summary: "i" });
      await auditService.recordAudit(tx, a.tenantId, a, { ...stockTarget, action: "stock.adjust", summary: "s" });
    });

    expect(await auditService.listAuditEntries(a.tenantId, { entityType: "invoice" })).toHaveLength(1);
    expect(await auditService.listAuditEntries(b.tenantId)).toHaveLength(0);
  });
});
