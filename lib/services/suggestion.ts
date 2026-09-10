import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { isSystemActor, type ActorContext } from "@/lib/auth/actor";
import { requireRole } from "@/lib/auth/authorize";
import type { MembershipRole } from "@/lib/db/schema/membership";
import {
  suggestionKindEnum,
  suggestionSourceEnum,
  suggestionStatusEnum,
  suggestions,
  type Suggestion,
  type SuggestionKind,
} from "@/lib/db/schema/suggestion";
import { withTenantContext } from "@/lib/db/tenant-context";
import * as customFieldService from "./custom-field";
import * as emailService from "./email";
import * as opportunityService from "./opportunity";
import * as pipelineService from "./pipeline";
import * as taskService from "./task";

/**
 * The registry is the ONLY place that knows how to validate and apply a
 * suggestion kind. Each entry: a Zod schema for the payload, the role(s) that
 * may approve it, a human description, and an apply() that calls exactly one
 * existing business service (CLAUDE.md §9/§11/§16). Adding a kind = adding a
 * registry entry + an enum value; nothing else in this file changes.
 */
type KindDef = {
  payloadSchema: z.ZodTypeAny;
  requiredRole: MembershipRole[];
  describe: (payload: never) => string;
  apply: (actor: ActorContext, payload: never) => Promise<void>;
};

const KIND_REGISTRY = {
  create_pipeline_stage: {
    payloadSchema: pipelineService.createStageInput,
    requiredRole: ["admin", "sales_manager"],
    describe: (p: z.infer<typeof pipelineService.createStageInput>) =>
      `Add pipeline stage "${p.name}" (${p.kind})`,
    apply: async (actor, p: z.infer<typeof pipelineService.createStageInput>) => {
      await pipelineService.createStage(actor.tenantId, p);
    },
  },
  create_custom_field_definition: {
    payloadSchema: customFieldService.createDefinitionInput,
    requiredRole: ["admin", "sales_manager"],
    describe: (p: z.infer<typeof customFieldService.createDefinitionInput>) =>
      `Add ${p.entityType} field "${p.name}" (${p.fieldType})`,
    apply: async (actor, p: z.infer<typeof customFieldService.createDefinitionInput>) => {
      await customFieldService.createDefinition(actor.tenantId, p);
    },
  },
  move_opportunity_stage: {
    payloadSchema: opportunityService.moveStageInput,
    requiredRole: ["admin", "sales_manager", "sales_rep"],
    describe: () => "Move an opportunity to a different pipeline stage",
    apply: async (actor, p: z.infer<typeof opportunityService.moveStageInput>) => {
      await opportunityService.moveOpportunityToStage(actor.tenantId, p);
    },
  },
  create_task: {
    payloadSchema: taskService.createTaskInput,
    requiredRole: ["admin", "sales_manager", "sales_rep"],
    describe: (p: z.infer<typeof taskService.createTaskInput>) => `Create task "${p.title}"`,
    apply: async (actor, p: z.infer<typeof taskService.createTaskInput>) => {
      await taskService.createTask(actor.tenantId, p);
    },
  },
  send_follow_up_email: {
    payloadSchema: emailService.sendEmailInput,
    requiredRole: ["admin", "sales_manager", "sales_rep"],
    describe: (p: z.infer<typeof emailService.sendEmailInput>) => `Send a follow-up email to ${p.toAddress}`,
    apply: async (actor, p: z.infer<typeof emailService.sendEmailInput>) => {
      await emailService.send(actor, p);
    },
  },
} satisfies Partial<Record<SuggestionKind, KindDef>>;

function getKindDef(kind: SuggestionKind): KindDef {
  const entry = (KIND_REGISTRY as Partial<Record<SuggestionKind, KindDef>>)[kind];
  if (!entry) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Suggestion kind "${kind}" cannot be applied yet.` });
  }
  return entry;
}

function describe(suggestion: Pick<Suggestion, "kind" | "payload">): string {
  try {
    const def = getKindDef(suggestion.kind);
    return def.describe(def.payloadSchema.parse(suggestion.payload) as never);
  } catch {
    return suggestion.kind;
  }
}

export type SuggestionWithDescription = Suggestion & { description: string };

function withDescription(row: Suggestion): SuggestionWithDescription {
  return { ...row, description: describe(row) };
}

// ---------------------------------------------------------------------------

export const createSuggestionInput = z.object({
  source: z.enum(suggestionSourceEnum.enumValues),
  kind: z.enum(suggestionKindEnum.enumValues),
  payload: z.unknown(),
  rationale: z.string().max(2000).optional(),
  targetEntityType: z.string().max(50).optional(),
  targetEntityId: z.string().uuid().optional(),
  groupKey: z.string().max(200).optional(),
});

/**
 * Creates a pending suggestion. Called by services (setup wizard, automation
 * actions), never exposed as a "create arbitrary suggestion" procedure. The
 * payload is validated against the kind's schema here so a bad proposal fails
 * loudly at creation, not silently at approval.
 */
export async function createSuggestion(
  tenantId: string,
  input: z.infer<typeof createSuggestionInput>,
  createdByUserId: string | null,
): Promise<Suggestion> {
  const parsed = createSuggestionInput.parse(input);
  const def = getKindDef(parsed.kind);

  let payload: unknown;
  try {
    payload = def.payloadSchema.parse(parsed.payload);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid payload for suggestion kind "${parsed.kind}".` });
  }

  const [row] = await withTenantContext(tenantId, (tx) =>
    tx
      .insert(suggestions)
      .values({
        tenantId,
        source: parsed.source,
        kind: parsed.kind,
        payload,
        rationale: parsed.rationale ?? null,
        targetEntityType: parsed.targetEntityType ?? null,
        targetEntityId: parsed.targetEntityId ?? null,
        groupKey: parsed.groupKey ?? null,
        createdByUserId,
      })
      .returning(),
  );
  return row;
}

export const listSuggestionsInput = z
  .object({
    status: z.enum(suggestionStatusEnum.enumValues).optional(),
    source: z.enum(suggestionSourceEnum.enumValues).optional(),
    groupKey: z.string().optional(),
  })
  .optional();

export async function listSuggestions(
  tenantId: string,
  filter?: z.infer<typeof listSuggestionsInput>,
): Promise<SuggestionWithDescription[]> {
  const rows = await withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(suggestions)
      .where(
        and(
          eq(suggestions.tenantId, tenantId),
          filter?.status ? eq(suggestions.status, filter.status) : undefined,
          filter?.source ? eq(suggestions.source, filter.source) : undefined,
          filter?.groupKey ? eq(suggestions.groupKey, filter.groupKey) : undefined,
        ),
      )
      .orderBy(desc(suggestions.createdAt)),
  );
  return rows.map(withDescription);
}

async function requireSuggestion(tenantId: string, id: string): Promise<Suggestion> {
  const [row] = await withTenantContext(tenantId, (tx) =>
    tx.select().from(suggestions).where(and(eq(suggestions.tenantId, tenantId), eq(suggestions.id, id))),
  );
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Suggestion not found" });
  }
  return row;
}

export async function getSuggestion(tenantId: string, id: string): Promise<SuggestionWithDescription> {
  return withDescription(await requireSuggestion(tenantId, id));
}

export async function pendingCount(tenantId: string): Promise<number> {
  const [row] = await withTenantContext(tenantId, (tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(suggestions)
      .where(and(eq(suggestions.tenantId, tenantId), eq(suggestions.status, "pending"))),
  );
  return row?.count ?? 0;
}

function reviewerId(actor: ActorContext): string | null {
  return isSystemActor(actor) ? null : actor.userId;
}

/**
 * Approves a pending suggestion: validates the payload, checks the acting
 * role against the kind, runs apply() (one service call), then marks it
 * approved. If apply() throws, the suggestion stays pending with last_error
 * set and the original typed error propagates — so a transient failure or a
 * since-deleted target is retryable, not silently lost.
 */
export async function approveSuggestion(actor: ActorContext, id: string): Promise<Suggestion> {
  const suggestion = await requireSuggestion(actor.tenantId, id);
  if (suggestion.status !== "pending") {
    throw new TRPCError({ code: "CONFLICT", message: `Suggestion is already ${suggestion.status}.` });
  }

  const def = getKindDef(suggestion.kind);
  const payload = def.payloadSchema.parse(suggestion.payload) as never;
  requireRole(actor.role, def.requiredRole);

  try {
    await def.apply(actor, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apply failed";
    await withTenantContext(actor.tenantId, (tx) =>
      tx
        .update(suggestions)
        .set({ lastError: message, updatedAt: new Date() })
        .where(and(eq(suggestions.tenantId, actor.tenantId), eq(suggestions.id, id))),
    );
    throw err;
  }

  const [row] = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .update(suggestions)
      .set({
        status: "approved",
        reviewedByUserId: reviewerId(actor),
        reviewedAt: new Date(),
        appliedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(suggestions.tenantId, actor.tenantId), eq(suggestions.id, id)))
      .returning(),
  );
  return row;
}

export const rejectSuggestionInput = z.object({
  id: z.string().uuid(),
  reason: z.string().max(2000).optional(),
});

export async function rejectSuggestion(
  actor: ActorContext,
  input: z.infer<typeof rejectSuggestionInput>,
): Promise<Suggestion> {
  const suggestion = await requireSuggestion(actor.tenantId, input.id);
  if (suggestion.status !== "pending") {
    throw new TRPCError({ code: "CONFLICT", message: `Suggestion is already ${suggestion.status}.` });
  }
  requireRole(actor.role, getKindDef(suggestion.kind).requiredRole);

  const [row] = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .update(suggestions)
      .set({
        status: "rejected",
        reviewedByUserId: reviewerId(actor),
        reviewedAt: new Date(),
        lastError: input.reason ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(suggestions.tenantId, actor.tenantId), eq(suggestions.id, input.id)))
      .returning(),
  );
  return row;
}

export type GroupApprovalResult = { id: string; ok: boolean; error?: string };

/** Approves every pending suggestion in a group, allowing partial success. */
export async function approveGroup(actor: ActorContext, groupKey: string): Promise<GroupApprovalResult[]> {
  const pending = await withTenantContext(actor.tenantId, (tx) =>
    tx
      .select({ id: suggestions.id })
      .from(suggestions)
      .where(
        and(
          eq(suggestions.tenantId, actor.tenantId),
          eq(suggestions.groupKey, groupKey),
          eq(suggestions.status, "pending"),
        ),
      ),
  );

  const results: GroupApprovalResult[] = [];
  for (const { id } of pending) {
    try {
      await approveSuggestion(actor, id);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : "Approval failed" });
    }
  }
  return results;
}
