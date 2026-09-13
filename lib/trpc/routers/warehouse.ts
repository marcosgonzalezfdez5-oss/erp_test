import { z } from "zod";
import * as warehouseService from "@/lib/services/warehouse";
import { router } from "../init";
import { managerProcedure, tenantProcedure } from "../procedures";

export const warehouseRouter = router({
  list: managerProcedure.query(({ ctx }) => warehouseService.listWarehouses(ctx.session.tenantId)),

  // A rep confirming an order or creating a shipment needs to pick a warehouse
  // without holding manager rights — the location list is not sensitive.
  options: tenantProcedure.query(({ ctx }) => warehouseService.listWarehouses(ctx.session.tenantId)),

  get: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => warehouseService.getWarehouse(ctx.session.tenantId, input.id)),

  create: managerProcedure
    .input(warehouseService.createWarehouseInput)
    .mutation(({ ctx, input }) => warehouseService.createWarehouse(ctx.session, input)),

  update: managerProcedure
    .input(warehouseService.updateWarehouseInput)
    .mutation(({ ctx, input }) => warehouseService.updateWarehouse(ctx.session, input)),

  setDefault: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => warehouseService.setDefaultWarehouse(ctx.session, input.id)),

  delete: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => warehouseService.deleteWarehouse(ctx.session, input.id)),
});
