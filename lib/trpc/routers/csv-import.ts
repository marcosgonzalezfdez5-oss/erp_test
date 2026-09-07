import * as csvImportService from "@/lib/services/csv-import";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const csvImportRouter = router({
  analyze: tenantProcedure
    .input(csvImportService.analyzeInput)
    .mutation(({ ctx, input }) => csvImportService.analyzeCsv(ctx.session.tenantId, ctx.session.userId, input)),

  run: tenantProcedure
    .input(csvImportService.runImportInput)
    .mutation(({ ctx, input }) => csvImportService.runImport(ctx.session.tenantId, input)),
});
