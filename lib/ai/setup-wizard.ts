import { generateObject } from "ai";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { logAiToolInvocation } from "./audit";
import { defaultModel } from "./model";

// Single-shot structured extraction, mirroring lib/ai/csv-mapping.ts. Callers
// (lib/services/setup-wizard.ts) wrap these in try/catch and fall back to a
// deterministic result — the model is never required (CLAUDE.md §9).

const pipelineStageProposalSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(["open", "won", "lost"]),
  rationale: z.string(),
});

export const pipelineProposalSchema = z.object({
  stages: z.array(pipelineStageProposalSchema).min(3).max(10),
});
export type PipelineProposal = z.infer<typeof pipelineProposalSchema>;

export const proposePipelineInput = z.object({
  industryHint: z.string().max(120).optional(),
  existingStageNames: z.array(z.string()),
  headers: z.array(z.string()).max(60),
  sampleRows: z.array(z.array(z.string())).max(20),
});

export async function proposePipeline(
  actor: ActorContext,
  input: z.infer<typeof proposePipelineInput>,
): Promise<PipelineProposal> {
  const prompt = [
    "You are proposing a sales pipeline (an ordered list of stages an opportunity moves through) for a company setting up a CRM.",
    'Every pipeline needs at least one "open" stage and exactly one "won" and one "lost" stage.',
    input.industryHint ? `The company describes its industry as: ${input.industryHint}.` : null,
    input.existingStageNames.length
      ? `They already have these stages, so do not repeat them: ${input.existingStageNames.join(", ")}.`
      : null,
    `Columns from a sample of their data: ${JSON.stringify(input.headers)}`,
    `Sample rows: ${JSON.stringify(input.sampleRows)}`,
    "Propose 3-8 stages with a short rationale each. Keep names short (1-3 words).",
  ]
    .filter(Boolean)
    .join("\n");

  const { object } = await generateObject({ model: defaultModel(), schema: pipelineProposalSchema, prompt });
  await logAiToolInvocation(actor.tenantId, actor.userId, "proposePipeline", input, object);
  return object;
}

const fieldProposalSchema = z.object({
  name: z.string().min(1).max(100),
  fieldType: z.enum(["text", "number", "date", "select", "boolean"]),
  options: z.array(z.string()).optional(),
  rationale: z.string(),
});

export const fieldsProposalSchema = z.object({
  fields: z.array(fieldProposalSchema).max(15),
});
export type FieldsProposal = z.infer<typeof fieldsProposalSchema>;

export const proposeFieldsInput = z.object({
  entityType: z.enum(["account", "opportunity"]),
  existingFieldNames: z.array(z.string()),
  headers: z.array(z.string()).max(60),
  sampleRows: z.array(z.array(z.string())).max(20),
});

export async function proposeFields(
  actor: ActorContext,
  input: z.infer<typeof proposeFieldsInput>,
): Promise<FieldsProposal> {
  const prompt = [
    `You are proposing custom fields to add to the "${input.entityType}" record type in a CRM, based on a sample of imported data.`,
    "Field types: text, number, date, select (needs an options list), boolean.",
    "Only propose a field when a column carries real business data that has no obvious home on a standard CRM record.",
    "Never propose a field for names, emails, phone numbers, or an opportunity's value/stage — those are standard.",
    input.existingFieldNames.length
      ? `These fields already exist, do not repeat them: ${input.existingFieldNames.join(", ")}.`
      : null,
    `Columns: ${JSON.stringify(input.headers)}`,
    `Sample rows: ${JSON.stringify(input.sampleRows)}`,
    "Return an empty list if nothing is worth adding.",
  ]
    .filter(Boolean)
    .join("\n");

  const { object } = await generateObject({ model: defaultModel(), schema: fieldsProposalSchema, prompt });
  await logAiToolInvocation(actor.tenantId, actor.userId, "proposeFields", input, object);
  return object;
}
