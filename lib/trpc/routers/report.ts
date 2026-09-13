import * as reportService from "@/lib/services/reports";
import { router } from "../init";
import { managerProcedure } from "../procedures";

export const reportRouter = router({
  arAging: managerProcedure
    .input(reportService.arAgingInput)
    .query(({ ctx, input }) => reportService.arAging(ctx.session.tenantId, input)),

  stockValuation: managerProcedure.query(({ ctx }) => reportService.stockValuation(ctx.session.tenantId)),

  margin: managerProcedure
    .input(reportService.marginInput)
    .query(({ ctx, input }) => reportService.margin(ctx.session.tenantId, input)),

  salesByTaxRate: managerProcedure
    .input(reportService.salesByTaxRateInput)
    .query(({ ctx, input }) => reportService.salesByTaxRate(ctx.session.tenantId, input)),
});
