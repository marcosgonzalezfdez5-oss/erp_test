import { z } from "zod";
import * as suggestionService from "@/lib/services/suggestion";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const suggestionRouter = router({
  list: tenantProcedure
    .input(suggestionService.listSuggestionsInput)
    .query(({ ctx, input }) => suggestionService.listSuggestions(ctx.session.tenantId, input)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => suggestionService.getSuggestion(ctx.session.tenantId, input.id)),

  pendingCount: tenantProcedure.query(({ ctx }) => suggestionService.pendingCount(ctx.session.tenantId)),

  // Role is enforced inside the service, per suggestion kind — different kinds
  // need different roles, and non-UI callers (automation) reach the service
  // directly (CLAUDE.md §16).
  approve: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => suggestionService.approveSuggestion(ctx.session, input.id)),

  reject: tenantProcedure
    .input(suggestionService.rejectSuggestionInput)
    .mutation(({ ctx, input }) => suggestionService.rejectSuggestion(ctx.session, input)),

  approveGroup: tenantProcedure
    .input(z.object({ groupKey: z.string().min(1) }))
    .mutation(({ ctx, input }) => suggestionService.approveGroup(ctx.session, input.groupKey)),
});
