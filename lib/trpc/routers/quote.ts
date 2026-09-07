import { z } from "zod";
import * as quoteService from "@/lib/services/quote";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const quoteRouter = router({
  listByOpportunity: tenantProcedure
    .input(z.object({ opportunityId: z.string().uuid() }))
    .query(({ ctx, input }) => quoteService.listQuotesByOpportunity(ctx.session.tenantId, input.opportunityId)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => quoteService.getQuoteWithLineItems(ctx.session.tenantId, input.id)),

  create: tenantProcedure
    .input(quoteService.createQuoteInput)
    .mutation(({ ctx, input }) => quoteService.createQuote(ctx.session.tenantId, input)),

  delete: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => quoteService.deleteQuote(ctx.session.tenantId, input.id)),

  addLineItem: tenantProcedure
    .input(quoteService.addLineItemInput)
    .mutation(({ ctx, input }) => quoteService.addLineItem(ctx.session.tenantId, input)),

  updateLineItemQuantity: tenantProcedure
    .input(quoteService.updateLineItemQuantityInput)
    .mutation(({ ctx, input }) => quoteService.updateLineItemQuantity(ctx.session.tenantId, input)),

  removeLineItem: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => quoteService.removeLineItem(ctx.session.tenantId, input.id)),
});
