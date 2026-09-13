import { z } from "zod";
import * as shipmentService from "@/lib/services/shipment";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const shipmentRouter = router({
  list: tenantProcedure
    .input(shipmentService.listShipmentsInput)
    .query(({ ctx, input }) => shipmentService.listShipments(ctx.session.tenantId, input)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => shipmentService.getShipmentWithLines(ctx.session.tenantId, input.id)),

  fulfillment: tenantProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(({ ctx, input }) => shipmentService.getOrderFulfillment(ctx.session.tenantId, input.orderId)),

  create: tenantProcedure
    .input(shipmentService.createShipmentInput)
    .mutation(({ ctx, input }) => shipmentService.createShipment(ctx.session, input)),

  update: tenantProcedure
    .input(shipmentService.updateShipmentInput)
    .mutation(({ ctx, input }) => shipmentService.updateShipment(ctx.session, input)),

  transition: tenantProcedure
    .input(shipmentService.transitionShipmentInput)
    .mutation(({ ctx, input }) => shipmentService.transitionShipment(ctx.session, input)),

  cancel: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => shipmentService.cancelShipment(ctx.session, input.id)),
});
