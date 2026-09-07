import { z } from "zod";
import * as accountService from "@/lib/services/account";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const accountRouter = router({
  list: tenantProcedure.query(({ ctx }) => accountService.listAccounts(ctx.session.tenantId)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => accountService.getAccount(ctx.session.tenantId, input.id)),

  create: tenantProcedure
    .input(accountService.createAccountInput)
    .mutation(({ ctx, input }) => accountService.createAccount(ctx.session.tenantId, input)),

  update: tenantProcedure
    .input(accountService.updateAccountInput)
    .mutation(({ ctx, input }) => accountService.updateAccount(ctx.session.tenantId, input)),

  delete: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => accountService.deleteAccount(ctx.session.tenantId, input.id)),
});
