import { z } from "zod";
import * as contactService from "@/lib/services/contact";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const contactRouter = router({
  listByAccount: tenantProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .query(({ ctx, input }) => contactService.listContactsByAccount(ctx.session.tenantId, input.accountId)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => contactService.getContact(ctx.session.tenantId, input.id)),

  create: tenantProcedure
    .input(contactService.createContactInput)
    .mutation(({ ctx, input }) => contactService.createContact(ctx.session.tenantId, input)),

  update: tenantProcedure
    .input(contactService.updateContactInput)
    .mutation(({ ctx, input }) => contactService.updateContact(ctx.session.tenantId, input)),

  delete: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => contactService.deleteContact(ctx.session.tenantId, input.id)),
});
