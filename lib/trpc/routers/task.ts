import { z } from "zod";
import * as taskService from "@/lib/services/task";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const taskRouter = router({
  listByOpportunity: tenantProcedure
    .input(z.object({ opportunityId: z.string().uuid() }))
    .query(({ ctx, input }) => taskService.listTasksByOpportunity(ctx.session.tenantId, input.opportunityId)),

  create: tenantProcedure
    .input(taskService.createTaskInput)
    .mutation(({ ctx, input }) => taskService.createTask(ctx.session.tenantId, input)),

  setCompletion: tenantProcedure
    .input(taskService.setTaskCompletionInput)
    .mutation(({ ctx, input }) => taskService.setTaskCompletion(ctx.session.tenantId, input)),
});
