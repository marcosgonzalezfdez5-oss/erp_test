import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { requireRole } from "@/lib/auth/authorize";
import {
  actionConfigSchema,
} from "@/lib/automation/actions";
import {
  idleConditions,
  opportunityCreatedConditions,
  stageChangedConditions,
} from "@/lib/automation/conditions";
import {
  automationActionEnum,
  automationRules,
  automationRuns,
  type AutomationAction,
  type AutomationRule,
  type AutomationRun,
} from "@/lib/db/schema/automation";
import { withTenantContext } from "@/lib/db/tenant-context";

const MANAGER_ROLES: ActorContext["role"][] = ["admin", "sales_manager"];

const ruleName = z.string().trim().min(1).max(120);
const action = z.enum(automationActionEnum.enumValues);
const actionConfig = z.record(z.string(), z.unknown()).default({});

// A rule pairs a trigger with that trigger's condition shape; actionConfig is
// validated against the chosen action separately (validateActionConfig).
export const createRuleInput = z.discriminatedUnion("trigger", [
  z.object({
    trigger: z.literal("opportunity_stage_changed"),
    name: ruleName,
    conditions: stageChangedConditions.default({}),
    action,
    actionConfig,
  }),
  z.object({
    trigger: z.literal("opportunity_created"),
    name: ruleName,
    conditions: opportunityCreatedConditions.default({}),
    action,
    actionConfig,
  }),
  z.object({
    trigger: z.literal("opportunity_idle"),
    name: ruleName,
    conditions: idleConditions,
    action,
    actionConfig,
  }),
]);

export const updateRuleInput = z.object({
  id: z.string().uuid(),
  name: ruleName.optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  actionConfig: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

function validateActionConfig(actionName: AutomationAction, config: unknown): Record<string, unknown> {
  try {
    return actionConfigSchema[actionName].parse(config ?? {}) as Record<string, unknown>;
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid settings for the "${actionName}" action.`,
    });
  }
}

export async function createRule(
  actor: ActorContext,
  input: z.infer<typeof createRuleInput>,
): Promise<AutomationRule> {
  requireRole(actor.role, MANAGER_ROLES);
  const actionConfigValidated = validateActionConfig(input.action, input.actionConfig);

  const [row] = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .insert(automationRules)
      .values({
        tenantId: actor.tenantId,
        name: input.name,
        trigger: input.trigger,
        conditions: input.conditions as Record<string, unknown>,
        action: input.action,
        actionConfig: actionConfigValidated,
        createdByUserId: actor.userId,
      })
      .returning(),
  );
  return row;
}

async function requireRule(tenantId: string, id: string): Promise<AutomationRule> {
  const [row] = await withTenantContext(tenantId, (tx) =>
    tx.select().from(automationRules).where(and(eq(automationRules.tenantId, tenantId), eq(automationRules.id, id))),
  );
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Automation rule not found" });
  return row;
}

export function listRules(tenantId: string): Promise<AutomationRule[]> {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(automationRules)
      .where(eq(automationRules.tenantId, tenantId))
      .orderBy(desc(automationRules.createdAt)),
  );
}

export function getRule(tenantId: string, id: string): Promise<AutomationRule> {
  return requireRule(tenantId, id);
}

export async function updateRule(
  actor: ActorContext,
  input: z.infer<typeof updateRuleInput>,
): Promise<AutomationRule> {
  requireRole(actor.role, MANAGER_ROLES);
  const existing = await requireRule(actor.tenantId, input.id);

  const conditions =
    input.conditions !== undefined
      ? (conditionSchemaFor(existing.trigger).parse(input.conditions) as Record<string, unknown>)
      : undefined;
  const actionConfig =
    input.actionConfig !== undefined ? validateActionConfig(existing.action, input.actionConfig) : undefined;

  const [row] = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .update(automationRules)
      .set({
        name: input.name ?? existing.name,
        conditions: conditions ?? existing.conditions,
        actionConfig: actionConfig ?? existing.actionConfig,
        enabled: input.enabled ?? existing.enabled,
        updatedAt: new Date(),
      })
      .where(and(eq(automationRules.tenantId, actor.tenantId), eq(automationRules.id, input.id)))
      .returning(),
  );
  return row;
}

function conditionSchemaFor(trigger: AutomationRule["trigger"]) {
  if (trigger === "opportunity_stage_changed") return stageChangedConditions;
  if (trigger === "opportunity_created") return opportunityCreatedConditions;
  return idleConditions;
}

export async function setRuleEnabled(
  actor: ActorContext,
  input: { id: string; enabled: boolean },
): Promise<AutomationRule> {
  requireRole(actor.role, MANAGER_ROLES);
  await requireRule(actor.tenantId, input.id);
  const [row] = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .update(automationRules)
      .set({ enabled: input.enabled, updatedAt: new Date() })
      .where(and(eq(automationRules.tenantId, actor.tenantId), eq(automationRules.id, input.id)))
      .returning(),
  );
  return row;
}

export async function deleteRule(actor: ActorContext, id: string): Promise<void> {
  requireRole(actor.role, MANAGER_ROLES);
  await requireRule(actor.tenantId, id);
  await withTenantContext(actor.tenantId, (tx) =>
    tx.delete(automationRules).where(and(eq(automationRules.tenantId, actor.tenantId), eq(automationRules.id, id))),
  );
}

export const listRunsInput = z
  .object({
    ruleId: z.string().uuid().optional(),
    status: z.enum(["pending", "running", "succeeded", "failed", "skipped"]).optional(),
  })
  .optional();

export function listRuns(tenantId: string, filter?: z.infer<typeof listRunsInput>): Promise<AutomationRun[]> {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.tenantId, tenantId),
          filter?.ruleId ? eq(automationRuns.ruleId, filter.ruleId) : undefined,
          filter?.status ? eq(automationRuns.status, filter.status) : undefined,
        ),
      )
      .orderBy(desc(automationRuns.createdAt))
      .limit(100),
  );
}
