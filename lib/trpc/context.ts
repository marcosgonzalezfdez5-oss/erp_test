import { resolveSessionContext } from "@/lib/auth/session";

export async function createTRPCContext() {
  const session = await resolveSessionContext();
  return { session };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
