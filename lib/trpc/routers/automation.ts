import { z } from "zod";
import * as automationService from "@/lib/services/automation";
import { router } from "../init";
import { managerProcedure } from "../procedures";

export const automationRouter = router({
  listRules: managerProcedure.query(({ ctx }) => automationService.listRules(ctx.session.tenantId)),

  getRule: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => automationService.getRule(ctx.session.tenantId, input.id)),

  createRule: managerProcedure
    .input(automationService.createRuleInput)
    .mutation(({ ctx, input }) => automationService.createRule(ctx.session, input)),

  updateRule: managerProcedure
    .input(automationService.updateRuleInput)
    .mutation(({ ctx, input }) => automationService.updateRule(ctx.session, input)),

  setEnabled: managerProcedure
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => automationService.setRuleEnabled(ctx.session, input)),

  deleteRule: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => automationService.deleteRule(ctx.session, input.id)),

  listRuns: managerProcedure
    .input(automationService.listRunsInput)
    .query(({ ctx, input }) => automationService.listRuns(ctx.session.tenantId, input)),
});
