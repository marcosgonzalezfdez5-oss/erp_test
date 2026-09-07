import { z } from "zod";
import * as activityService from "@/lib/services/activity";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const activityRouter = router({
  listByOpportunity: tenantProcedure
    .input(z.object({ opportunityId: z.string().uuid() }))
    .query(({ ctx, input }) => activityService.listActivitiesByOpportunity(ctx.session.tenantId, input.opportunityId)),

  create: tenantProcedure
    .input(activityService.createActivityInput)
    .mutation(({ ctx, input }) => activityService.createActivity(ctx.session.tenantId, input)),
});
