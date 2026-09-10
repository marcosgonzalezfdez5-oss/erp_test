import { z } from "zod";
import * as pipelineService from "@/lib/services/pipeline";
import { router } from "../init";
import { managerProcedure, tenantProcedure } from "../procedures";

export const pipelineRouter = router({
  list: tenantProcedure.query(({ ctx }) => pipelineService.listPipelineStages(ctx.session.tenantId)),

  create: managerProcedure
    .input(pipelineService.createStageInput)
    .mutation(({ ctx, input }) => pipelineService.createStage(ctx.session.tenantId, input)),

  rename: managerProcedure
    .input(pipelineService.renameStageInput)
    .mutation(({ ctx, input }) => pipelineService.renameStage(ctx.session.tenantId, input)),

  reorder: managerProcedure
    .input(pipelineService.reorderStagesInput)
    .mutation(({ ctx, input }) => pipelineService.reorderStages(ctx.session.tenantId, input)),

  delete: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => pipelineService.deleteStage(ctx.session.tenantId, input.id)),
});
