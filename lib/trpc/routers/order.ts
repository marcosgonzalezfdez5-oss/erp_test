import { z } from "zod";
import * as orderService from "@/lib/services/order";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const orderRouter = router({
  getByOpportunity: tenantProcedure
    .input(z.object({ opportunityId: z.string().uuid() }))
    .query(({ ctx, input }) => orderService.getOrderByOpportunity(ctx.session.tenantId, input.opportunityId)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => orderService.getOrder(ctx.session.tenantId, input.id)),
});
