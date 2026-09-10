import { z } from "zod";
import * as emailService from "@/lib/services/email";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const emailRouter = router({
  send: tenantProcedure
    .input(emailService.sendEmailInput)
    .mutation(({ ctx, input }) => emailService.send(ctx.session, input)),

  listSent: tenantProcedure
    .input(z.object({ opportunityId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) => emailService.listSentEmails(ctx.session.tenantId, input)),
});
