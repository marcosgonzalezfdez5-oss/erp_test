import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { requireRole } from "@/lib/auth/authorize";
import { warehouses, type Warehouse } from "@/lib/db/schema/warehouse";
import { withTenantContext, type Tx } from "@/lib/db/tenant-context";

const MANAGER_ROLES: ActorContext["role"][] = ["admin", "sales_manager"];

const addressInput = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().min(1).max(20),
  province: z.string().trim().max(120).optional(),
  country: z.string().trim().length(2).toUpperCase(),
});

export const createWarehouseInput = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(20),
  address: addressInput.optional(),
  isDefault: z.boolean().optional(),
});

export const updateWarehouseInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(1).max(20).optional(),
  address: addressInput.nullish(),
});

export function listWarehouses(tenantId: string): Promise<Warehouse[]> {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)))
      .orderBy(asc(warehouses.name)),
  );
}

async function requireWarehouse(tx: Tx, tenantId: string, id: string): Promise<Warehouse> {
  const [row] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, id), isNull(warehouses.deletedAt)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse not found" });
  return row;
}

export function getWarehouse(tenantId: string, id: string): Promise<Warehouse> {
  return withTenantContext(tenantId, (tx) => requireWarehouse(tx, tenantId, id));
}

/** The tenant's default fulfilling location. Null only when no warehouse exists yet. */
export async function getDefaultWarehouse(tenantId: string): Promise<Warehouse | null> {
  const [row] = await withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true), isNull(warehouses.deletedAt))),
  );
  return row ?? null;
}

async function countActive(tx: Tx, tenantId: string): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)));
  return n;
}

async function clearDefaultExcept(tx: Tx, tenantId: string, keepId?: string): Promise<void> {
  await tx
    .update(warehouses)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.isDefault, true),
        keepId ? ne(warehouses.id, keepId) : undefined,
      ),
    );
}

export async function createWarehouse(
  actor: ActorContext,
  rawInput: z.input<typeof createWarehouseInput>,
): Promise<Warehouse> {
  requireRole(actor.role, MANAGER_ROLES);
  const input = createWarehouseInput.parse(rawInput);
  return withTenantContext(actor.tenantId, async (tx) => {
    // The first warehouse is always the default; otherwise honour the flag.
    const makeDefault = input.isDefault || (await countActive(tx, actor.tenantId)) === 0;
    if (makeDefault) await clearDefaultExcept(tx, actor.tenantId);

    const [row] = await tx
      .insert(warehouses)
      .values({
        tenantId: actor.tenantId,
        name: input.name,
        code: input.code,
        address: input.address ?? null,
        isDefault: makeDefault,
      })
      .returning();
    return row;
  });
}

export async function updateWarehouse(
  actor: ActorContext,
  rawInput: z.input<typeof updateWarehouseInput>,
): Promise<Warehouse> {
  requireRole(actor.role, MANAGER_ROLES);
  const input = updateWarehouseInput.parse(rawInput);
  return withTenantContext(actor.tenantId, async (tx) => {
    await requireWarehouse(tx, actor.tenantId, input.id);
    const [row] = await tx
      .update(warehouses)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.address !== undefined ? { address: input.address ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(warehouses.tenantId, actor.tenantId), eq(warehouses.id, input.id)))
      .returning();
    return row;
  });
}

export async function setDefaultWarehouse(actor: ActorContext, id: string): Promise<Warehouse> {
  requireRole(actor.role, MANAGER_ROLES);
  return withTenantContext(actor.tenantId, async (tx) => {
    await requireWarehouse(tx, actor.tenantId, id);
    await clearDefaultExcept(tx, actor.tenantId, id);
    const [row] = await tx
      .update(warehouses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(warehouses.tenantId, actor.tenantId), eq(warehouses.id, id)))
      .returning();
    return row;
  });
}

export async function deleteWarehouse(actor: ActorContext, id: string): Promise<void> {
  requireRole(actor.role, MANAGER_ROLES);
  await withTenantContext(actor.tenantId, async (tx) => {
    const warehouse = await requireWarehouse(tx, actor.tenantId, id);
    if (warehouse.isDefault) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Set another warehouse as the default before deleting this one.",
      });
    }
    await tx
      .update(warehouses)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(warehouses.tenantId, actor.tenantId), eq(warehouses.id, id)));
  });
}
