import { z } from "zod";
import { SYSTEM_ACTOR_USER_ID, type ActorContext } from "@/lib/auth/actor";
import type { AutomationAction, AutomationRule, AutomationRun } from "@/lib/db/schema/automation";
import * as draftService from "@/lib/services/draft";
import * as suggestionService from "@/lib/services/suggestion";
import * as taskService from "@/lib/services/task";
import type { TriggerContext } from "./conditions";

export const createTaskConfig = z
  .object({
    title: z.string().trim().min(1).max(200),
    dueInDays: z.number().int().min(0).max(365).optional(),
  })
  .strict();

export const proposeStageChangeConfig = z
  .object({
    targetStageId: z.string().uuid(),
  })
  .strict();

export const draftFollowUpEmailConfig = z.object({}).strict();

export const actionConfigSchema = {
  create_task: createTaskConfig,
  propose_opportunity_stage_change: proposeStageChangeConfig,
  draft_follow_up_email: draftFollowUpEmailConfig,
} satisfies Record<AutomationAction, z.ZodTypeAny>;

export function systemActor(tenantId: string): ActorContext {
  return { tenantId, userId: SYSTEM_ACTOR_USER_ID, role: "admin" };
}

export interface ActionResult {
  resultSuggestionId?: string;
  resultDraftId?: string;
}

/**
 * One handler per action. `create_task` and `draft_follow_up_email` are
 * low-risk / draft-only and apply directly; `propose_opportunity_stage_change`
 * is consequential, so it creates a Suggestion for a human to approve
 * (CLAUDE.md §10/§16). Every handler calls exactly one business service.
 */
export const ACTION_HANDLERS: Record<
  AutomationAction,
  (run: AutomationRun, rule: AutomationRule) => Promise<ActionResult>
> = {
  create_task: async (run, rule) => {
    const ctx = run.triggerContext as unknown as TriggerContext;
    const config = createTaskConfig.parse(rule.actionConfig);
    const dueDate =
      config.dueInDays != null ? new Date(Date.now() + config.dueInDays * 24 * 60 * 60 * 1000) : undefined;
    await taskService.createTask(run.tenantId, {
      opportunityId: ctx.opportunityId,
      title: config.title,
      dueDate,
    });
    return {};
  },

  propose_opportunity_stage_change: async (run, rule) => {
    const ctx = run.triggerContext as unknown as TriggerContext;
    const config = proposeStageChangeConfig.parse(rule.actionConfig);
    const suggestion = await suggestionService.createSuggestion(
      run.tenantId,
      {
        source: "automation",
        kind: "move_opportunity_stage",
        payload: { id: ctx.opportunityId, pipelineStageId: config.targetStageId },
        rationale: `Automation rule "${rule.name}"`,
        targetEntityType: "opportunity",
        targetEntityId: ctx.opportunityId,
      },
      null,
    );
    return { resultSuggestionId: suggestion.id };
  },

  draft_follow_up_email: async (run) => {
    const ctx = run.triggerContext as unknown as TriggerContext;
    const draft = await draftService.generateFollowUpEmail(systemActor(run.tenantId), {
      opportunityId: ctx.opportunityId,
    });
    return { resultDraftId: draft.id };
  },
};
