import type { MembershipRole } from "@/lib/db/schema/membership";

/**
 * The server-derived identity every service/tool call runs as: a tenant, an
 * acting user, and a role. Tenant context is ALWAYS derived here server-side,
 * never accepted from a client or model (CLAUDE.md §7/§16).
 *
 * `SessionContext` (lib/auth/session.ts) is the request-scoped instance of
 * this shape. Automation runs as `systemActor(tenantId)` (Step 5) with
 * `userId = SYSTEM_ACTOR_USER_ID` and `role = "admin"`.
 */
export type ActorContext = {
  tenantId: string;
  userId: string;
  role: MembershipRole;
};

/**
 * Sentinel `userId` for automation-originated actions — there is no human
 * user. Never inserted into `users`; callers that persist an FK to a real
 * user (e.g. `suggestions.createdByUserId`) store `null` for the system
 * actor instead of this value.
 */
export const SYSTEM_ACTOR_USER_ID = "00000000-0000-0000-0000-000000000000";

export function isSystemActor(actor: ActorContext): boolean {
  return actor.userId === SYSTEM_ACTOR_USER_ID;
}
