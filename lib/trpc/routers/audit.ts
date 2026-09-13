import * as auditService from "@/lib/services/audit";
import { router } from "../init";
import { managerProcedure } from "../procedures";

export const auditRouter = router({
  list: managerProcedure
    .input(auditService.listAuditEntriesInput)
    .query(({ ctx, input }) => auditService.listAuditEntries(ctx.session.tenantId, input)),
});
