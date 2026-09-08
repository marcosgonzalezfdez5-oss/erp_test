import { z } from "zod";
import * as leadService from "@/lib/services/lead";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const leadRouter = router({
  list: tenantProcedure
    .input(leadService.listLeadsInput.optional())
    .query(({ ctx, input }) => leadService.listLeads(ctx.session.tenantId, input)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => leadService.getLead(ctx.session.tenantId, input.id)),

  create: tenantProcedure
    .input(leadService.createLeadInput)
    .mutation(({ ctx, input }) => leadService.createLead(ctx.session.tenantId, input)),

  convertToOpportunity: tenantProcedure
    .input(leadService.convertToOpportunityInput)
    .mutation(({ ctx, input }) => leadService.convertLeadToOpportunity(ctx.session.tenantId, input)),

  delete: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => leadService.deleteLead(ctx.session.tenantId, input.id)),

  unconvert: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => leadService.unconvertLead(ctx.session.tenantId, input.id)),
});
