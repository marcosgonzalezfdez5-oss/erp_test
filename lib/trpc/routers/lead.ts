import { z } from "zod";
import * as leadService from "@/lib/services/lead";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const leadRouter = router({
  list: tenantProcedure.query(({ ctx }) => leadService.listLeads(ctx.session.tenantId)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => leadService.getLead(ctx.session.tenantId, input.id)),

  create: tenantProcedure
    .input(leadService.createLeadInput)
    .mutation(({ ctx, input }) => leadService.createLead(ctx.session.tenantId, input)),

  convertToOpportunity: tenantProcedure
    .input(leadService.convertToOpportunityInput)
    .mutation(({ ctx, input }) => leadService.convertLeadToOpportunity(ctx.session.tenantId, input)),
});
