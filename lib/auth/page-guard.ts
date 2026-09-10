import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { MembershipRole } from "@/lib/db/schema/membership";
import { resolveSessionContext } from "./session";

/**
 * Server-Component guard shared by protected pages. Runs the same
 * `auth.protect()` + active-org check every page did inline, then resolves
 * our session context. When `allowed` is passed, `hasRole` reports whether
 * the current role is in it — the page renders an access-denied state rather
 * than redirecting, so a mistargeted link is legible instead of bouncing.
 * The tRPC layer (roleProcedure) is the actual enforcement; this is UX.
 */
export async function requirePage(allowed?: MembershipRole[]): Promise<{
  session: NonNullable<Awaited<ReturnType<typeof resolveSessionContext>>>;
  hasRole: boolean;
}> {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) redirect("/dashboard");

  const session = await resolveSessionContext();
  if (!session) redirect("/dashboard");

  return { session, hasRole: !allowed || allowed.includes(session.role) };
}
