import * as inventoryService from "@/lib/services/inventory";
import { router } from "../init";
import { managerProcedure, tenantProcedure } from "../procedures";

export const inventoryRouter = router({
  levels: tenantProcedure
    .input(inventoryService.stockLevelsFilter)
    .query(({ ctx, input }) => inventoryService.getStockLevels(ctx.session.tenantId, input)),

  movements: tenantProcedure
    .input(inventoryService.listMovementsFilter)
    .query(({ ctx, input }) => inventoryService.listMovements(ctx.session.tenantId, input)),

  receive: managerProcedure
    .input(inventoryService.receiveStockInput)
    .mutation(({ ctx, input }) => inventoryService.receiveStock(ctx.session, input)),

  adjust: managerProcedure
    .input(inventoryService.adjustStockInput)
    .mutation(({ ctx, input }) => inventoryService.adjustStock(ctx.session, input)),

  transfer: managerProcedure
    .input(inventoryService.transferStockInput)
    .mutation(({ ctx, input }) => inventoryService.transferStock(ctx.session, input)),
});
