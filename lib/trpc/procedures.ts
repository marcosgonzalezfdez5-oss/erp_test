import { TRPCError } from "@trpc/server";
import { publicProcedure } from "./init";

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/**
 * Every domain router must be built on this, never `publicProcedure`
 * directly — see CLAUDE.md §7/§13. In this app tenant scoping is inherent
 * to an authenticated session (resolveSessionContext never returns a
 * session without a tenant), so this is protectedProcedure by another name
 * today — kept as a distinct export so routers read as tenant-scoped by
 * intent, and so the two can diverge later without touching call sites.
 */
export const tenantProcedure = protectedProcedure;
