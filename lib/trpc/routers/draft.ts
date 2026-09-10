import { z } from "zod";
import * as draftService from "@/lib/services/draft";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const draftRouter = router({
  summarize: tenantProcedure
    .input(draftService.generateSummaryInput)
    .mutation(({ ctx, input }) => draftService.generateSummary(ctx.session, input)),

  draftEmail: tenantProcedure
    .input(draftService.draftEmailInput)
    .mutation(({ ctx, input }) => draftService.generateFollowUpEmail(ctx.session, input)),

  list: tenantProcedure
    .input(draftService.listDraftsInput)
    .query(({ ctx, input }) => draftService.listDrafts(ctx.session.tenantId, input)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => draftService.getDraft(ctx.session.tenantId, input.id)),

  update: tenantProcedure
    .input(draftService.updateDraftInput)
    .mutation(({ ctx, input }) => draftService.updateDraft(ctx.session, input)),

  dismiss: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => draftService.dismissDraft(ctx.session, input.id)),
});
