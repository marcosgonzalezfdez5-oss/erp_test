import * as tenantSettingsService from "@/lib/services/tenant-settings";
import { router } from "../init";
import { managerProcedure } from "../procedures";

export const tenantSettingsRouter = router({
  get: managerProcedure.query(({ ctx }) => tenantSettingsService.getSettings(ctx.session.tenantId)),

  update: managerProcedure
    .input(tenantSettingsService.updateTenantSettingsInput)
    .mutation(({ ctx, input }) => tenantSettingsService.updateSettings(ctx.session, input)),
});
