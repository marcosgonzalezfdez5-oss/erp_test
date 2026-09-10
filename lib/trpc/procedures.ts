import { TRPCError } from "@trpc/server";
import { requireRole } from "@/lib/auth/authorize";
import type { MembershipRole } from "@/lib/db/schema/membership";
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

/**
 * Server-side role gate (CLAUDE.md §8/§16). Client-side nav gating in
 * `app-sidebar.tsx` is cosmetic — this is the enforcement. The fixed role
 * set is `admin | sales_manager | sales_rep`; do not build a general
 * permissions engine on top of this (§17).
 */
export const roleProcedure = (allowed: MembershipRole[]) =>
  tenantProcedure.use(({ ctx, next }) => {
    requireRole(ctx.session.role, allowed);
    return next({ ctx });
  });

/** Config/settings surfaces: pipeline, custom fields, products, automation, guided setup. */
export const managerProcedure = roleProcedure(["admin", "sales_manager"]);

/** Reserved for admin-only surfaces (team management, tenant config). */
export const adminProcedure = roleProcedure(["admin"]);
