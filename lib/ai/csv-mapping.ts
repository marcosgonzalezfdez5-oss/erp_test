import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { TARGET_FIELDS } from "@/lib/csv";
import { logAiToolInvocation } from "./audit";

export const importEntityTypeEnum = z.enum(["account", "lead"]);
export type ImportEntityType = z.infer<typeof importEntityTypeEnum>;

const columnMappingSchema = z.object({
  column: z.string(),
  suggestedField: z.string().nullable(),
  isNewCustomField: z.boolean(),
  reason: z.string(),
});

export const mappingProposalSchema = z.object({
  mappings: z.array(columnMappingSchema),
});

export type MappingProposal = z.infer<typeof mappingProposalSchema>;

export const proposeMappingInput = z.object({
  entityType: importEntityTypeEnum,
  headers: z.array(z.string()).min(1).max(50),
  sampleRows: z.array(z.array(z.string())).max(5),
});

export async function proposeColumnMapping(
  tenantId: string,
  userId: string,
  input: z.infer<typeof proposeMappingInput>,
): Promise<MappingProposal> {
  const targetFields = TARGET_FIELDS[input.entityType];
  const allowsNewCustomField = input.entityType === "account";

  const prompt = [
    `You are mapping CSV columns to fields on a CRM "${input.entityType}" record for an import.`,
    `Available target fields: ${targetFields.join(", ")}.`,
    allowsNewCustomField
      ? `If a column doesn't match any target field but looks like real business data worth keeping (e.g. industry, website), set suggestedField to null and isNewCustomField to true.`
      : `This entity type has no custom fields yet — if a column doesn't match a target field, set suggestedField to null and isNewCustomField to false.`,
    `If a column is clearly irrelevant (an internal ID, a row number, blank), set suggestedField to null and isNewCustomField to false.`,
    `CSV headers: ${JSON.stringify(input.headers)}`,
    `Sample rows: ${JSON.stringify(input.sampleRows)}`,
  ].join("\n");

  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: mappingProposalSchema,
    prompt,
  });

  await logAiToolInvocation(tenantId, userId, "proposeColumnMapping", input, object);

  return object;
}
