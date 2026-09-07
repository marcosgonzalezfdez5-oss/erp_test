import { z } from "zod";
import * as opportunityService from "@/lib/services/opportunity";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const opportunityRouter = router({
  list: tenantProcedure.query(({ ctx }) => opportunityService.listOpportunities(ctx.session.tenantId)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => opportunityService.getOpportunity(ctx.session.tenantId, input.id)),

  moveStage: tenantProcedure
    .input(opportunityService.moveStageInput)
    .mutation(({ ctx, input }) => opportunityService.moveOpportunityToStage(ctx.session.tenantId, input)),

  updateValue: tenantProcedure
    .input(opportunityService.updateValueInput)
    .mutation(({ ctx, input }) => opportunityService.updateOpportunityValue(ctx.session.tenantId, input)),
});
