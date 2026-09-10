import * as setupWizardService from "@/lib/services/setup-wizard";
import { router } from "../init";
import { managerProcedure } from "../procedures";

export const setupWizardRouter = router({
  analyze: managerProcedure
    .input(setupWizardService.analyzeForSetupInput)
    .mutation(({ ctx, input }) => setupWizardService.analyzeForSetup(ctx.session, input)),

  createSuggestions: managerProcedure
    .input(setupWizardService.createSetupSuggestionsInput)
    .mutation(({ ctx, input }) => setupWizardService.createSetupSuggestions(ctx.session, input)),
});
