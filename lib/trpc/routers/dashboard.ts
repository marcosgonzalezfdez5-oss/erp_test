import * as dashboardService from "@/lib/services/dashboard";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const dashboardRouter = router({
  pipelineSummary: tenantProcedure.query(({ ctx }) => dashboardService.getPipelineSummary(ctx.session.tenantId)),
});
