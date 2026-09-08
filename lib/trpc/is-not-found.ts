/**
 * True when a tRPC query/mutation error is a NOT_FOUND — i.e. the record the
 * caller asked for doesn't exist (or isn't visible to their tenant), as opposed
 * to a transient failure worth retrying. Detail pages use this to show a
 * "not found" state instead of a generic "couldn't load" error.
 */
export function isNotFoundError(
  error: { data?: { code?: string } | null } | null | undefined,
): boolean {
  return error?.data?.code === "NOT_FOUND";
}
