import { z } from "zod";

const uuidSchema = z.string().uuid();

/** Whether a route param is a well-formed UUID — cheap guard so an obviously
 * bad `[id]` URL renders not-found instead of round-tripping to a tRPC 400. */
export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}
