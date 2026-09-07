import { z } from "zod";
import * as productService from "@/lib/services/product";
import { router } from "../init";
import { tenantProcedure } from "../procedures";

export const productRouter = router({
  list: tenantProcedure.query(({ ctx }) => productService.listProducts(ctx.session.tenantId)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => productService.getProduct(ctx.session.tenantId, input.id)),

  create: tenantProcedure
    .input(productService.createProductInput)
    .mutation(({ ctx, input }) => productService.createProduct(ctx.session.tenantId, input)),

  update: tenantProcedure
    .input(productService.updateProductInput)
    .mutation(({ ctx, input }) => productService.updateProduct(ctx.session.tenantId, input)),

  delete: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => productService.deleteProduct(ctx.session.tenantId, input.id)),
});
