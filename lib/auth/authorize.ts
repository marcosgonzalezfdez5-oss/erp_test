import { TRPCError } from "@trpc/server";
import type { MembershipRole } from "@/lib/db/schema/membership";

/**
 * Role check for use inside business services (CLAUDE.md §11/§16) — call
 * this from the service, not (only) from tRPC middleware, since AI tools
 * call services directly and must be gated the same way as the UI.
 */
export function requireRole(role: MembershipRole, allowed: MembershipRole[]): void {
  if (!allowed.includes(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Requires one of: ${allowed.join(", ")}`,
    });
  }
}
