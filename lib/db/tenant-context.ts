import { sql } from "drizzle-orm";
import { db } from "./client";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every query against a tenant-owned table must run inside this wrapper.
 * It sets the `app.tenant_id` session var (scoped to the transaction via
 * set_config(..., true)) that RLS policies check — see CLAUDE.md §7.
 * This is defense-in-depth: callers must still filter by tenantId explicitly.
 */
export function withTenantContext<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
