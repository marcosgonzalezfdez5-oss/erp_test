import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import type { ActorContext } from "@/lib/auth/actor";
import type { MembershipRole } from "@/lib/db/schema/membership";
import * as warehouseService from "./warehouse";

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
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `user_${label}_${crypto.randomUUID()}`, email: `${label}@example.com` })
    .returning();
  createdUserIds.push(user.id);
  return { tenantId: tenant.id, userId: user.id, role };
}

describe("warehouse service — default handling", () => {
  it("makes the first warehouse the default automatically", async () => {
    const actor = await createActor("a");
    const first = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
    expect(first.isDefault).toBe(true);

    const second = await warehouseService.createWarehouse(actor, { name: "Valencia", code: "VLC" });
    expect(second.isDefault).toBe(false);

    const def = await warehouseService.getDefaultWarehouse(actor.tenantId);
    expect(def?.id).toBe(first.id);
  });

  it("moves the default and never leaves two defaults", async () => {
    const actor = await createActor("a");
    const mad = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
    const vlc = await warehouseService.createWarehouse(actor, { name: "Valencia", code: "VLC" });

    await warehouseService.setDefaultWarehouse(actor, vlc.id);

    const list = await warehouseService.listWarehouses(actor.tenantId);
    expect(list.filter((w) => w.isDefault).map((w) => w.id)).toEqual([vlc.id]);
    expect((await warehouseService.getWarehouse(actor.tenantId, mad.id)).isDefault).toBe(false);
  });

  it("honours isDefault:true on create by switching the default", async () => {
    const actor = await createActor("a");
    const mad = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
    const vlc = await warehouseService.createWarehouse(actor, { name: "Valencia", code: "VLC", isDefault: true });

    expect((await warehouseService.getWarehouse(actor.tenantId, mad.id)).isDefault).toBe(false);
    expect(vlc.isDefault).toBe(true);
  });
});

describe("warehouse service — codes and deletion", () => {
  it("rejects a duplicate active code but frees it after soft-delete", async () => {
    const actor = await createActor("a");
    await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
    const second = await warehouseService.createWarehouse(actor, { name: "Madrid 2", code: "MAD2" });

    await expect(
      warehouseService.createWarehouse(actor, { name: "Clash", code: "MAD" }),
    ).rejects.toThrow();

    await warehouseService.deleteWarehouse(actor, second.id);
    // MAD2 is now free to reuse
    const reused = await warehouseService.createWarehouse(actor, { name: "New", code: "MAD2" });
    expect(reused.code).toBe("MAD2");
  });

  it("won't delete the default warehouse until another is promoted", async () => {
    const actor = await createActor("a");
    const mad = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
    const vlc = await warehouseService.createWarehouse(actor, { name: "Valencia", code: "VLC" });

    await expect(warehouseService.deleteWarehouse(actor, mad.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    await warehouseService.setDefaultWarehouse(actor, vlc.id);
    await warehouseService.deleteWarehouse(actor, mad.id);
    expect(await warehouseService.listWarehouses(actor.tenantId)).toHaveLength(1);
  });
});

describe("warehouse service — authorization and isolation", () => {
  it("requires a manager role to mutate", async () => {
    const actor = await createActor("a", "sales_rep");
    await expect(
      warehouseService.createWarehouse(actor, { name: "X", code: "X" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cannot read or mutate another tenant's warehouse", async () => {
    const a = await createActor("a");
    const b = await createActor("b");
    const wh = await warehouseService.createWarehouse(a, { name: "Madrid", code: "MAD" });

    await expect(warehouseService.getWarehouse(b.tenantId, wh.id)).rejects.toThrow(TRPCError);
    await expect(warehouseService.updateWarehouse(b, { id: wh.id, name: "Hacked" })).rejects.toThrow(TRPCError);
    await expect(warehouseService.deleteWarehouse(b, wh.id)).rejects.toThrow(TRPCError);
    await expect(warehouseService.setDefaultWarehouse(b, wh.id)).rejects.toThrow(TRPCError);
    expect(await warehouseService.listWarehouses(b.tenantId)).toHaveLength(0);
  });
});
