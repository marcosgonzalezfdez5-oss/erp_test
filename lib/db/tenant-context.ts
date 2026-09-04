import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { db } from "./client";
import type * as schema from "./schema";

export type Tx = PgTransaction<PostgresJsQueryResultHKT, typeof schema>;

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
