import * as returnService from "@/lib/services/return";
import { router } from "../init";
import { managerProcedure } from "../procedures";

export const returnRouter = router({
  // Manager-gated at the router too (the service re-checks for non-tRPC callers).
  record: managerProcedure
    .input(returnService.recordReturnInput)
    .mutation(({ ctx, input }) => returnService.recordReturn(ctx.session, input)),
});
