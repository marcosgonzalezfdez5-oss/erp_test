import { z } from "zod";
import * as paymentService from "@/lib/services/payment";
import { router } from "../init";
import { managerProcedure, tenantProcedure } from "../procedures";

export const paymentRouter = router({
  list: tenantProcedure
    .input(paymentService.listPaymentsInput)
    .query(({ ctx, input }) => paymentService.listPayments(ctx.session.tenantId, input)),

  accountBalance: tenantProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .query(({ ctx, input }) => paymentService.getAccountBalance(ctx.session.tenantId, input.accountId)),

  record: tenantProcedure
    .input(paymentService.recordPaymentInput)
    .mutation(({ ctx, input }) => paymentService.recordPayment(ctx.session, input)),

  allocate: tenantProcedure
    .input(paymentService.allocatePaymentInput)
    .mutation(({ ctx, input }) => paymentService.allocatePayment(ctx.session, input)),

  deallocate: tenantProcedure
    .input(z.object({ allocationId: z.string().uuid() }))
    .mutation(({ ctx, input }) => paymentService.deallocate(ctx.session, input.allocationId)),

  // Manager-gated at the router too (the service re-checks for non-tRPC callers).
  delete: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => paymentService.deletePayment(ctx.session, input.id)),
});
