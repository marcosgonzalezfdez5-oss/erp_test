import { z } from "zod";
import * as invoiceService from "@/lib/services/invoice";
import { router } from "../init";
import { managerProcedure, tenantProcedure } from "../procedures";

export const invoiceRouter = router({
  list: tenantProcedure
    .input(invoiceService.listInvoicesInput)
    .query(({ ctx, input }) => invoiceService.listInvoices(ctx.session.tenantId, input)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => invoiceService.getInvoiceWithLineItems(ctx.session.tenantId, input.id)),

  createFromOrder: tenantProcedure
    .input(invoiceService.createInvoiceFromOrderInput)
    .mutation(({ ctx, input }) => invoiceService.createInvoiceFromOrder(ctx.session, input)),

  createFromShipments: tenantProcedure
    .input(invoiceService.createInvoiceFromShipmentsInput)
    .mutation(({ ctx, input }) => invoiceService.createInvoiceFromShipments(ctx.session, input)),

  createBlank: tenantProcedure
    .input(invoiceService.createBlankInvoiceInput)
    .mutation(({ ctx, input }) => invoiceService.createBlankInvoice(ctx.session, input)),

  update: tenantProcedure
    .input(invoiceService.updateInvoiceInput)
    .mutation(({ ctx, input }) => invoiceService.updateInvoice(ctx.session, input)),

  delete: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => invoiceService.deleteInvoice(ctx.session, input.id)),

  addLineItem: tenantProcedure
    .input(invoiceService.addInvoiceLineInput)
    .mutation(({ ctx, input }) => invoiceService.addInvoiceLine(ctx.session, input)),

  updateLineItem: tenantProcedure
    .input(invoiceService.updateInvoiceLineInput)
    .mutation(({ ctx, input }) => invoiceService.updateInvoiceLine(ctx.session, input)),

  removeLineItem: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => invoiceService.removeInvoiceLine(ctx.session, input.id)),

  issue: tenantProcedure
    .input(invoiceService.issueInvoiceInput)
    .mutation(({ ctx, input }) => invoiceService.issueInvoice(ctx.session, input)),

  // Manager-gated at the router too (the service re-checks for non-tRPC callers).
  rectify: managerProcedure
    .input(invoiceService.rectifyInvoiceInput)
    .mutation(({ ctx, input }) => invoiceService.rectifyInvoice(ctx.session, input)),
});
