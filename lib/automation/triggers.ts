import { and, eq } from "drizzle-orm";
import { automationRules, automationRuns, type AutomationTrigger } from "@/lib/db/schema/automation";
import { withTenantContext } from "@/lib/db/tenant-context";
import { evaluateConditions, type TriggerContext } from "./conditions";

function dedupeKey(ruleId: string, trigger: AutomationTrigger, ctx: TriggerContext): string {
  switch (trigger) {
    case "opportunity_created":
      return `${ruleId}:${ctx.opportunityId}:created`;
    case "opportunity_stage_changed":
      return `${ruleId}:${ctx.opportunityId}:stage:${ctx.toStageId ?? "?"}`;
    case "opportunity_idle":
      return `${ruleId}:${ctx.opportunityId}:idle`;
  }
}

/**
 * Fires an event trigger: finds the tenant's enabled rules for it, evaluates
 * conditions, and enqueues one pending automation_run per match. Best-effort —
 * it owns its errors and never throws into the caller (a failed automation
 * dispatch must not fail the stage move that caused it).
 */
export async function dispatchTrigger(
  tenantId: string,
  trigger: Extract<AutomationTrigger, "opportunity_stage_changed" | "opportunity_created">,
  context: TriggerContext,
): Promise<void> {
  try {
    const rules = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(automationRules)
        .where(
          and(
            eq(automationRules.tenantId, tenantId),
            eq(automationRules.trigger, trigger),
            eq(automationRules.enabled, true),
          ),
        ),
    );

    for (const rule of rules) {
      let matches = false;
      try {
        matches = evaluateConditions(trigger, rule.conditions, context);
      } catch {
        matches = false;
      }
      if (!matches) continue;

      await withTenantContext(tenantId, (tx) =>
        tx
          .insert(automationRuns)
          .values({
            tenantId,
            ruleId: rule.id,
            status: "pending",
            triggerContext: { ...context },
            dedupeKey: dedupeKey(rule.id, trigger, context),
          })
          .onConflictDoNothing({ target: [automationRuns.tenantId, automationRuns.dedupeKey] }),
      );
    }
  } catch (err) {
    console.error(`[automation] dispatchTrigger(${trigger}) failed for tenant ${tenantId}`, err);
  }
}
