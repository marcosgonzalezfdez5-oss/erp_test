import { z } from "zod";
import { customFieldEntityTypeEnum } from "@/lib/db/schema/custom-field";
import * as customFieldService from "@/lib/services/custom-field";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const customFieldRouter = router({
  listDefinitions: tenantProcedure
    .input(z.object({ entityType: z.enum(customFieldEntityTypeEnum.enumValues) }))
    .query(({ ctx, input }) => customFieldService.listDefinitions(ctx.session.tenantId, input.entityType)),

  createDefinition: tenantProcedure
    .input(customFieldService.createDefinitionInput)
    .mutation(({ ctx, input }) => customFieldService.createDefinition(ctx.session.tenantId, input)),

  deleteDefinition: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => customFieldService.deleteDefinition(ctx.session.tenantId, input.id)),

  updateDefinition: tenantProcedure
    .input(customFieldService.updateDefinitionInput)
    .mutation(({ ctx, input }) => customFieldService.updateDefinition(ctx.session.tenantId, input)),

  listValuesForEntity: tenantProcedure
    .input(z.object({ entityType: z.enum(customFieldEntityTypeEnum.enumValues), entityId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      customFieldService.listValuesForEntity(ctx.session.tenantId, input.entityType, input.entityId),
    ),

  setValue: tenantProcedure
    .input(customFieldService.setValueInput)
    .mutation(({ ctx, input }) => customFieldService.setValue(ctx.session.tenantId, input)),

  clearValue: tenantProcedure
    .input(customFieldService.clearValueInput)
    .mutation(({ ctx, input }) => customFieldService.clearValue(ctx.session.tenantId, input)),
});
