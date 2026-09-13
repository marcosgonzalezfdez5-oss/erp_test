import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { isSystemActor, type ActorContext } from "@/lib/auth/actor";
import { auditLogEntries, type AuditLogEntry } from "@/lib/db/schema/audit-log";
import { withTenantContext, type Tx } from "@/lib/db/tenant-context";

export type AuditDiff = Record<string, { from: unknown; to: unknown }>;

export interface AuditInput {
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  diff?: AuditDiff;
}

/**
 * Appends one audit entry **inside the caller's transaction** — pass the same
 * `tx` the mutation runs in so the trail commits (or rolls back) with it. The
 * system actor is recorded as a null `actorUserId`, matching the FK convention
 * elsewhere (CLAUDE.md §4).
 */
export async function recordAudit(
  tx: Tx,
  tenantId: string,
  actor: ActorContext,
  input: AuditInput,
): Promise<void> {
  await tx.insert(auditLogEntries).values({
    tenantId,
    actorUserId: isSystemActor(actor) ? null : actor.userId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    summary: input.summary,
    diff: input.diff ?? null,
  });
}

export const listAuditEntriesInput = z
  .object({
    entityType: z.string().max(50).optional(),
    entityId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .optional();

export function listAuditEntries(
  tenantId: string,
  filter?: z.input<typeof listAuditEntriesInput>,
): Promise<AuditLogEntry[]> {
  const limit = filter?.limit ?? 100;
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(auditLogEntries)
      .where(
        and(
          eq(auditLogEntries.tenantId, tenantId),
          filter?.entityType ? eq(auditLogEntries.entityType, filter.entityType) : undefined,
          filter?.entityId ? eq(auditLogEntries.entityId, filter.entityId) : undefined,
        ),
      )
      .orderBy(desc(auditLogEntries.createdAt))
      .limit(limit),
  );
}
