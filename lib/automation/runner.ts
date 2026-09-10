import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { automationRules, automationRuns } from "@/lib/db/schema/automation";
import { opportunities } from "@/lib/db/schema/opportunity";
import { pipelineStages } from "@/lib/db/schema/pipeline-stage";
import { tenants } from "@/lib/db/schema/tenant";
import { withTenantContext } from "@/lib/db/tenant-context";
import { ACTION_HANDLERS } from "./actions";
import { idleConditions } from "./conditions";

const MAX_ATTEMPTS = 3;

async function allTenantIds(): Promise<string[]> {
  // `tenants` is not an RLS table — a plain scan is correct here. Everything
  // downstream runs inside withTenantContext for the specific tenant.
  const rows = await db.select({ id: tenants.id }).from(tenants);
  return rows.map((r) => r.id);
}

/**
 * Enqueues runs for scheduled triggers (opportunity_idle): for each enabled
 * idle rule, find that tenant's opportunities with no recent activity and
 * insert a day-bucketed pending run. Pure SQL — no LLM (CLAUDE.md §9).
 */
export async function enqueueScheduledRuns(): Promise<{ enqueued: number }> {
  let enqueued = 0;
  const bucket = new Date().toISOString().slice(0, 10);

  for (const tenantId of await allTenantIds()) {
    const rules = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(automationRules)
        .where(
          and(
            eq(automationRules.tenantId, tenantId),
            eq(automationRules.trigger, "opportunity_idle"),
            eq(automationRules.enabled, true),
          ),
        ),
    );
    if (rules.length === 0) continue;

    for (const rule of rules) {
      let config: { idleDays: number; stageKind?: "open" | "won" | "lost" };
      try {
        config = idleConditions.parse(rule.conditions);
      } catch {
        continue;
      }

      const staleOpps = await withTenantContext(tenantId, (tx) =>
        tx
          .select({ id: opportunities.id })
          .from(opportunities)
          .innerJoin(pipelineStages, eq(opportunities.pipelineStageId, pipelineStages.id))
          .where(
            and(
              eq(opportunities.tenantId, tenantId),
              sql`${opportunities.deletedAt} is null`,
              config.stageKind ? eq(pipelineStages.kind, config.stageKind) : undefined,
              sql`${opportunities.createdAt} < now() - (${config.idleDays} || ' days')::interval`,
              sql`not exists (
                select 1 from activities a
                where a.opportunity_id = ${opportunities.id}
                  and a.created_at > now() - (${config.idleDays} || ' days')::interval
              )`,
            ),
          ),
      );

      for (const opp of staleOpps) {
        const inserted = await withTenantContext(tenantId, (tx) =>
          tx
            .insert(automationRuns)
            .values({
              tenantId,
              ruleId: rule.id,
              status: "pending",
              triggerContext: { opportunityId: opp.id },
              dedupeKey: `${rule.id}:${opp.id}:idle:${bucket}`,
            })
            .onConflictDoNothing({ target: [automationRuns.tenantId, automationRuns.dedupeKey] })
            .returning({ id: automationRuns.id }),
        );
        if (inserted.length > 0) enqueued++;
      }
    }
  }

  return { enqueued };
}

/**
 * Processes due pending runs. Each run: mark running (+1 attempt), dispatch to
 * the action handler, then mark succeeded/failed. A handler failure keeps the
 * run pending for retry until MAX_ATTEMPTS, then fails it. Other runs are
 * unaffected.
 */
export async function drainPendingRuns(limit = 50): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const tenantId of await allTenantIds()) {
    const due = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(automationRuns)
        .where(
          and(
            eq(automationRuns.tenantId, tenantId),
            eq(automationRuns.status, "pending"),
            lte(automationRuns.scheduledFor, new Date()),
          ),
        )
        .limit(limit),
    );

    for (const run of due) {
      processed++;
      const attempts = run.attempts + 1;
      await withTenantContext(tenantId, (tx) =>
        tx
          .update(automationRuns)
          .set({ status: "running", startedAt: new Date(), attempts })
          .where(and(eq(automationRuns.tenantId, tenantId), eq(automationRuns.id, run.id))),
      );

      const [rule] = await withTenantContext(tenantId, (tx) =>
        tx.select().from(automationRules).where(eq(automationRules.id, run.ruleId)),
      );

      if (!rule || !rule.enabled) {
        await withTenantContext(tenantId, (tx) =>
          tx
            .update(automationRuns)
            .set({ status: "skipped", finishedAt: new Date(), error: "Rule missing or disabled" })
            .where(and(eq(automationRuns.tenantId, tenantId), eq(automationRuns.id, run.id))),
        );
        continue;
      }

      try {
        const result = await ACTION_HANDLERS[rule.action]({ ...run, attempts }, rule);
        await withTenantContext(tenantId, (tx) =>
          tx
            .update(automationRuns)
            .set({
              status: "succeeded",
              finishedAt: new Date(),
              resultSuggestionId: result.resultSuggestionId ?? null,
              resultDraftId: result.resultDraftId ?? null,
              error: null,
            })
            .where(and(eq(automationRuns.tenantId, tenantId), eq(automationRuns.id, run.id))),
        );
        succeeded++;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Action failed";
        const giveUp = attempts >= MAX_ATTEMPTS;
        await withTenantContext(tenantId, (tx) =>
          tx
            .update(automationRuns)
            .set({
              status: giveUp ? "failed" : "pending",
              finishedAt: giveUp ? new Date() : null,
              error: message,
            })
            .where(and(eq(automationRuns.tenantId, tenantId), eq(automationRuns.id, run.id))),
        );
        if (giveUp) failed++;
      }
    }
  }

  return { processed, succeeded, failed };
}
