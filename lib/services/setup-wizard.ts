import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { requireRole } from "@/lib/auth/authorize";
import { parseCsv } from "@/lib/csv";
import {
  proposeFields,
  proposePipeline,
  type FieldsProposal,
  type PipelineProposal,
} from "@/lib/ai/setup-wizard";
import * as customFieldService from "./custom-field";
import * as pipelineService from "./pipeline";
import * as suggestionService from "./suggestion";

const MANAGER_ROLES = ["admin", "sales_manager"] as const;

export const analyzeForSetupInput = z.object({
  // Matches the CSV import entity types; leads map to opportunity-level fields.
  entityType: z.enum(["account", "lead"]),
  csvText: z.string().min(1),
  industryHint: z.string().max(120).optional(),
});

type CustomFieldEntity = "account" | "opportunity";

export interface SetupAnalysis {
  pipeline: { stages: PipelineProposal["stages"]; aiAvailable: boolean };
  fields: { entityType: CustomFieldEntity; fields: FieldsProposal["fields"]; aiAvailable: boolean };
  existingStageNames: string[];
  existingFieldNames: string[];
}

/**
 * Analyses a sample of imported data and proposes pipeline stages + custom
 * fields. The model is optional: if it fails or no key is configured, the
 * pipeline falls back to the standard defaults not yet present and the field
 * list falls back to empty — the manual path in the wizard still works
 * (CLAUDE.md §9).
 */
export async function analyzeForSetup(
  actor: ActorContext,
  input: z.infer<typeof analyzeForSetupInput>,
): Promise<SetupAnalysis> {
  requireRole(actor.role, [...MANAGER_ROLES]);

  const { headers, rows } = parseCsv(input.csvText);
  const sampleRows = rows.slice(0, 20);

  const fieldEntity: CustomFieldEntity = input.entityType === "lead" ? "opportunity" : "account";

  const existingStages = await pipelineService.listPipelineStages(actor.tenantId);
  const existingStageNames = existingStages.map((s) => s.name);
  const existingDefs = await customFieldService.listDefinitions(actor.tenantId, fieldEntity);
  const existingFieldNames = existingDefs.map((d) => d.name);

  let pipeline: SetupAnalysis["pipeline"];
  try {
    const proposal = await proposePipeline(actor, {
      industryHint: input.industryHint,
      existingStageNames,
      headers,
      sampleRows,
    });
    // Never re-propose a stage they already have.
    const existing = new Set(existingStageNames.map((n) => n.toLowerCase()));
    pipeline = {
      stages: proposal.stages.filter((s) => !existing.has(s.name.toLowerCase())),
      aiAvailable: true,
    };
  } catch {
    const existing = new Set(existingStageNames.map((n) => n.toLowerCase()));
    pipeline = {
      stages: pipelineService.DEFAULT_STAGES.filter((s) => !existing.has(s.name.toLowerCase())).map((s) => ({
        ...s,
        rationale: "Standard default stage",
      })),
      aiAvailable: false,
    };
  }

  let fields: SetupAnalysis["fields"];
  try {
    const proposal = await proposeFields(actor, {
      entityType: fieldEntity,
      existingFieldNames,
      headers,
      sampleRows,
    });
    const existing = new Set(existingFieldNames.map((n) => n.toLowerCase()));
    fields = {
      entityType: fieldEntity,
      fields: proposal.fields.filter((f) => !existing.has(f.name.toLowerCase())),
      aiAvailable: true,
    };
  } catch {
    fields = { entityType: fieldEntity, fields: [], aiAvailable: false };
  }

  return { pipeline, fields, existingStageNames, existingFieldNames };
}

export const createSetupSuggestionsInput = z.object({
  groupKey: z.string().uuid().optional(),
  stages: z.array(pipelineService.createStageInput),
  fields: z.array(customFieldService.createDefinitionInput),
});

/**
 * Turns the wizard's kept proposals into pending suggestions (one per stage /
 * field, batched by groupKey). Applying them is entirely the Suggestion
 * primitive's job — see suggestionService.approveGroup.
 */
export async function createSetupSuggestions(
  actor: ActorContext,
  input: z.infer<typeof createSetupSuggestionsInput>,
): Promise<{ groupKey: string; created: number }> {
  requireRole(actor.role, [...MANAGER_ROLES]);

  const groupKey = input.groupKey ?? crypto.randomUUID();

  for (const stage of input.stages) {
    await suggestionService.createSuggestion(
      actor.tenantId,
      {
        source: "setup_wizard",
        kind: "create_pipeline_stage",
        payload: stage,
        rationale: "Proposed during guided setup",
        groupKey,
      },
      actor.userId,
    );
  }

  for (const field of input.fields) {
    await suggestionService.createSuggestion(
      actor.tenantId,
      {
        source: "setup_wizard",
        kind: "create_custom_field_definition",
        payload: field,
        rationale: "Proposed during guided setup",
        groupKey,
      },
      actor.userId,
    );
  }

  return { groupKey, created: input.stages.length + input.fields.length };
}
