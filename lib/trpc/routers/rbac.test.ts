import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { MembershipRole } from "@/lib/db/schema/membership";
import type { SessionContext } from "@/lib/auth/session";
import { router } from "../init";
import { adminProcedure, managerProcedure, roleProcedure } from "../procedures";
import { appRouter } from "./_app";

function session(role: MembershipRole): SessionContext {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    role,
  };
}

// A throwaway router exercising each gate with a resolver that never touches
// the DB — so we can assert the *pass-through* direction without side effects.
const probe = router({
  manager: managerProcedure.query(() => "ok"),
  admin: adminProcedure.query(() => "ok"),
  managerRep: roleProcedure(["sales_rep"]).query(() => "ok"),
  input: managerProcedure.input(z.object({ n: z.number() })).mutation(({ input }) => input.n),
});

describe("roleProcedure gate", () => {
  it("managerProcedure: allows admin and sales_manager, denies sales_rep", async () => {
    await expect(probe.createCaller({ session: session("admin") }).manager()).resolves.toBe("ok");
    await expect(probe.createCaller({ session: session("sales_manager") }).manager()).resolves.toBe("ok");
    await expect(probe.createCaller({ session: session("sales_rep") }).manager()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("adminProcedure: allows only admin", async () => {
    await expect(probe.createCaller({ session: session("admin") }).admin()).resolves.toBe("ok");
    for (const role of ["sales_manager", "sales_rep"] as const) {
      await expect(probe.createCaller({ session: session(role) }).admin()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("rejects unauthenticated callers before checking role", async () => {
    await expect(probe.createCaller({ session: null }).manager()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("runs the role check before input validation", async () => {
    // sales_rep with structurally-invalid input still fails on role, not Zod.
    await expect(
      probe.createCaller({ session: session("sales_rep") }).input({ n: "nope" } as unknown as { n: number }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("appRouter mutations are role-gated", () => {
  const gated: Array<[string, () => Promise<unknown>]> = [
    ["pipeline.create", () => appRouter.createCaller({ session: session("sales_rep") }).pipeline.create({ name: "X" })],
    ["pipeline.rename", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .pipeline.rename({ id: "33333333-3333-3333-3333-333333333333", name: "X" })],
    ["pipeline.reorder", () =>
      appRouter.createCaller({ session: session("sales_rep") }).pipeline.reorder({ orderedIds: [] })],
    ["pipeline.delete", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .pipeline.delete({ id: "33333333-3333-3333-3333-333333333333" })],
    ["customField.createDefinition", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .customField.createDefinition({ entityType: "account", name: "X", fieldType: "text", required: false })],
    ["customField.deleteDefinition", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .customField.deleteDefinition({ id: "33333333-3333-3333-3333-333333333333" })],
    ["customField.updateDefinition", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .customField.updateDefinition({ id: "33333333-3333-3333-3333-333333333333", name: "X" })],
    ["product.create", () =>
      appRouter.createCaller({ session: session("sales_rep") }).product.create({ name: "X", unitPrice: 1 })],
    ["product.update", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .product.update({ id: "33333333-3333-3333-3333-333333333333", name: "X", unitPrice: 1 })],
    ["product.delete", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .product.delete({ id: "33333333-3333-3333-3333-333333333333" })],
    ["tenantSettings.update", () =>
      appRouter.createCaller({ session: session("sales_rep") }).tenantSettings.update({ legalName: "X" })],
    ["warehouse.create", () =>
      appRouter.createCaller({ session: session("sales_rep") }).warehouse.create({ name: "X", code: "X" })],
    ["warehouse.update", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .warehouse.update({ id: "33333333-3333-3333-3333-333333333333", name: "X" })],
    ["warehouse.setDefault", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .warehouse.setDefault({ id: "33333333-3333-3333-3333-333333333333" })],
    ["warehouse.delete", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .warehouse.delete({ id: "33333333-3333-3333-3333-333333333333" })],
    ["order.cancel", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .order.cancel({ id: "33333333-3333-3333-3333-333333333333" })],
    ["inventory.receive", () =>
      appRouter.createCaller({ session: session("sales_rep") }).inventory.receive({
        productId: "33333333-3333-3333-3333-333333333333",
        warehouseId: "44444444-4444-4444-4444-444444444444",
        quantity: 1,
      })],
    ["inventory.adjust", () =>
      appRouter.createCaller({ session: session("sales_rep") }).inventory.adjust({
        productId: "33333333-3333-3333-3333-333333333333",
        warehouseId: "44444444-4444-4444-4444-444444444444",
        newOnHand: 0,
        note: "x",
      })],
    ["inventory.transfer", () =>
      appRouter.createCaller({ session: session("sales_rep") }).inventory.transfer({
        productId: "33333333-3333-3333-3333-333333333333",
        fromWarehouseId: "44444444-4444-4444-4444-444444444444",
        toWarehouseId: "55555555-5555-5555-5555-555555555555",
        quantity: 1,
      })],
    ["invoice.rectify", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .invoice.rectify({ id: "33333333-3333-3333-3333-333333333333", reason: "R1" })],
    ["payment.delete", () =>
      appRouter
        .createCaller({ session: session("sales_rep") })
        .payment.delete({ id: "33333333-3333-3333-3333-333333333333" })],
    ["return.record", () =>
      appRouter.createCaller({ session: session("sales_rep") }).return.record({
        shipmentId: "33333333-3333-3333-3333-333333333333",
        lines: [{ shipmentLineItemId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
      })],
    ["report.arAging", () => appRouter.createCaller({ session: session("sales_rep") }).report.arAging()],
    ["report.stockValuation", () =>
      appRouter.createCaller({ session: session("sales_rep") }).report.stockValuation()],
    ["report.margin", () => appRouter.createCaller({ session: session("sales_rep") }).report.margin()],
    ["report.salesByTaxRate", () =>
      appRouter.createCaller({ session: session("sales_rep") }).report.salesByTaxRate()],
  ];

  it.each(gated)("%s rejects sales_rep with FORBIDDEN (before any DB access)", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("customField.setValue stays open to all roles — a sales_rep is never FORBIDDEN there", async () => {
    // Filling in a field value on a record is day-to-day sales work, not config.
    await appRouter
      .createCaller({ session: session("sales_rep") })
      .customField.setValue({ definitionId: "33333333-3333-3333-3333-333333333333", entityId: "44444444-4444-4444-4444-444444444444", value: "x" })
      .then(
        () => {},
        (err: { code?: string }) => expect(err.code).not.toBe("FORBIDDEN"),
      );
  });
});
