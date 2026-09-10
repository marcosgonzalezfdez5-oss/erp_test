import { z } from "zod";
import * as productService from "@/lib/services/product";
import { router } from "../init";
import { managerProcedure, tenantProcedure } from "../procedures";

export const productRouter = router({
  list: tenantProcedure
    .input(productService.listProductsInput.optional())
    .query(({ ctx, input }) => productService.listProducts(ctx.session.tenantId, input)),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => productService.getProduct(ctx.session.tenantId, input.id)),

  // The catalog feeds quote pricing — managing it is a manager+ surface.
  create: managerProcedure
    .input(productService.createProductInput)
    .mutation(({ ctx, input }) => productService.createProduct(ctx.session.tenantId, input)),

  update: managerProcedure
    .input(productService.updateProductInput)
    .mutation(({ ctx, input }) => productService.updateProduct(ctx.session.tenantId, input)),

  delete: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => productService.deleteProduct(ctx.session.tenantId, input.id)),
});
