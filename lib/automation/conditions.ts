import { z } from "zod";
import type { AutomationTrigger } from "@/lib/db/schema/automation";

/**
 * A fixed, tiny condition evaluator — one strict schema per trigger, no
 * arbitrary expressions (CLAUDE.md §10). Time/threshold checks that need a
 * query (opportunity_idle) are handled by the runner's enqueue step, not
 * here — never by an LLM (§9).
 */

const stageKind = z.enum(["open", "won", "lost"]);

export const stageChangedConditions = z
  .object({
    toStageKind: stageKind.optional(),
    minValue: z.number().nonnegative().optional(),
    maxValue: z.number().nonnegative().optional(),
  })
  .strict();

export const opportunityCreatedConditions = z.object({}).strict();

export const idleConditions = z
  .object({
    idleDays: z.number().int().positive().max(365),
    stageKind: stageKind.optional(),
  })
  .strict();

export const conditionSchemaForTrigger = {
  opportunity_stage_changed: stageChangedConditions,
  opportunity_created: opportunityCreatedConditions,
  opportunity_idle: idleConditions,
} satisfies Record<AutomationTrigger, z.ZodTypeAny>;

export interface TriggerContext {
  opportunityId: string;
  toStageId?: string;
  toStageKind?: string;
  fromStageId?: string;
  value?: string | null;
}

/**
 * Returns whether an event-trigger's conditions match the context. Throws if
 * `conditions` isn't valid for the trigger (caught at rule-create time, so a
 * throw here means corrupt data).
 */
export function evaluateConditions(
  trigger: AutomationTrigger,
  conditions: unknown,
  context: TriggerContext,
): boolean {
  if (trigger === "opportunity_stage_changed") {
    const c = stageChangedConditions.parse(conditions ?? {});
    if (c.toStageKind && context.toStageKind !== c.toStageKind) return false;
    const value = context.value != null && context.value !== "" ? Number(context.value) : null;
    if (c.minValue != null && (value == null || value < c.minValue)) return false;
    if (c.maxValue != null && (value == null || value > c.maxValue)) return false;
    return true;
  }

  if (trigger === "opportunity_created") {
    opportunityCreatedConditions.parse(conditions ?? {});
    return true;
  }

  // opportunity_idle conditions are applied by the enqueue query, not here.
  idleConditions.parse(conditions ?? {});
  return true;
}
