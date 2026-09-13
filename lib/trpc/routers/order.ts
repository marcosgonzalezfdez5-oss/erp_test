import { z } from "zod";
import * as orderService from "@/lib/services/order";
import { router } from "../init";
import { managerProcedure, tenantProcedure } from "../procedures";

export const orderRouter = router({
  list: tenantProcedure
    .input(orderService.listOrdersInput.optional())
    .query(({ ctx, input }) => orderService.listOrders(ctx.session.tenantId, input)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => orderService.getOrderWithLineItems(ctx.session.tenantId, input.id)),

  getByOpportunity: tenantProcedure
    .input(z.object({ opportunityId: z.string().uuid() }))
    .query(({ ctx, input }) => orderService.getOrderByOpportunity(ctx.session.tenantId, input.opportunityId)),

  create: tenantProcedure
    .input(orderService.createOrderInput)
    .mutation(({ ctx, input }) => orderService.createOrder(ctx.session.tenantId, input)),

  confirm: tenantProcedure
    .input(orderService.confirmOrderInput)
    .mutation(({ ctx, input }) => orderService.confirmOrder(ctx.session, input)),

  // Manager-gated at the router too (the service re-checks for non-tRPC callers).
  cancel: managerProcedure
    .input(orderService.cancelOrderInput)
    .mutation(({ ctx, input }) => orderService.cancelOrder(ctx.session, input)),

  addLineItem: tenantProcedure
    .input(orderService.addOrderLineInput)
    .mutation(({ ctx, input }) => orderService.addLineItem(ctx.session.tenantId, input)),

  updateLineItem: tenantProcedure
    .input(orderService.updateOrderLineInput)
    .mutation(({ ctx, input }) => orderService.updateLineItem(ctx.session.tenantId, input)),

  removeLineItem: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => orderService.removeLineItem(ctx.session.tenantId, input.id)),
});
