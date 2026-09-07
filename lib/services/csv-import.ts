import { z } from "zod";
import { NEW_CUSTOM_FIELD_TARGET, parseCsv } from "@/lib/csv";
import { importEntityTypeEnum, proposeColumnMapping } from "@/lib/ai/csv-mapping";
import * as accountService from "./account";
import * as leadService from "./lead";
import * as customFieldService from "./custom-field";

export { NEW_CUSTOM_FIELD_TARGET };

export const analyzeInput = z.object({
  entityType: importEntityTypeEnum,
  csvText: z.string().min(1),
});

export interface AnalyzedColumn {
  column: string;
  suggestedTarget: string | null;
  reason: string;
}

export interface AnalyzeResult {
  headers: string[];
  rowCount: number;
  mapping: AnalyzedColumn[];
  aiAvailable: boolean;
}

// Parsing always happens here, synchronously and deterministically, so the
// mapping review screen works even if the AI call below fails or no
// OPENAI_API_KEY is configured — AI only pre-fills suggestions, it's never
// required for the import to function (CLAUDE.md §9: "AI proposes, humans
// dispose").
export async function analyzeCsv(
  tenantId: string,
  userId: string,
  input: z.infer<typeof analyzeInput>,
): Promise<AnalyzeResult> {
  const { headers, rows } = parseCsv(input.csvText);

  try {
    const proposal = await proposeColumnMapping(tenantId, userId, {
      entityType: input.entityType,
      headers,
      sampleRows: rows.slice(0, 5),
    });
    const proposedByColumn = new Map(proposal.mappings.map((m) => [m.column, m]));

    return {
      headers,
      rowCount: rows.length,
      mapping: headers.map((column) => {
        const proposed = proposedByColumn.get(column);
        if (!proposed) {
          return { column, suggestedTarget: null, reason: "" };
        }
        return {
          column,
          suggestedTarget: proposed.isNewCustomField ? NEW_CUSTOM_FIELD_TARGET : proposed.suggestedField,
          reason: proposed.reason,
        };
      }),
      aiAvailable: true,
    };
  } catch {
    return {
      headers,
      rowCount: rows.length,
      mapping: headers.map((column) => ({ column, suggestedTarget: null, reason: "" })),
      aiAvailable: false,
    };
  }
}

export const runImportInput = z.object({
  entityType: importEntityTypeEnum,
  csvText: z.string().min(1),
  // target is a key from TARGET_FIELDS[entityType], NEW_CUSTOM_FIELD_TARGET,
  // or anything else (treated as "don't import this column").
  mapping: z.array(z.object({ column: z.string(), target: z.string() })),
});

export interface ImportResult {
  imported: number;
  failed: { row: number; error: string }[];
}

function firstValueForTarget(
  record: Record<string, string>,
  mapping: { column: string; target: string }[],
  target: string,
): string | undefined {
  for (const entry of mapping) {
    if (entry.target === target) {
      const value = record[entry.column]?.trim();
      if (value) return value;
    }
  }
  return undefined;
}

export async function runImport(tenantId: string, input: z.infer<typeof runImportInput>): Promise<ImportResult> {
  const { headers, rows } = parseCsv(input.csvText);
  const mapping = input.mapping.filter((m) => headers.includes(m.column));

  // Create each flagged "new custom field" once up front, not once per row.
  const newFieldDefinitionIdByColumn = new Map<string, string>();
  if (input.entityType === "account") {
    for (const entry of mapping) {
      if (entry.target === NEW_CUSTOM_FIELD_TARGET && !newFieldDefinitionIdByColumn.has(entry.column)) {
        const definition = await customFieldService.createDefinition(tenantId, {
          entityType: "account",
          name: entry.column,
          fieldType: "text",
          required: false,
        });
        newFieldDefinitionIdByColumn.set(entry.column, definition.id);
      }
    }
  }

  const result: ImportResult = { imported: 0, failed: [] };

  for (const [index, row] of rows.entries()) {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = row[i] ?? "";
    });

    try {
      if (input.entityType === "account") {
        const name = firstValueForTarget(record, mapping, "name");
        if (!name) {
          throw new Error('Missing required field "name"');
        }
        const account = await accountService.createAccount(tenantId, { name });

        for (const [column, definitionId] of newFieldDefinitionIdByColumn) {
          const value = record[column]?.trim();
          if (value) {
            await customFieldService.setValue(tenantId, { definitionId, entityId: account.id, value });
          }
        }
      } else {
        const firstName = firstValueForTarget(record, mapping, "firstName");
        const lastName = firstValueForTarget(record, mapping, "lastName");
        if (!firstName || !lastName) {
          throw new Error('Missing required field(s) "firstName"/"lastName"');
        }
        await leadService.createLead(tenantId, {
          firstName,
          lastName,
          email: firstValueForTarget(record, mapping, "email"),
          phone: firstValueForTarget(record, mapping, "phone"),
          company: firstValueForTarget(record, mapping, "company"),
        });
      }
      result.imported++;
    } catch (err) {
      result.failed.push({ row: index + 1, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return result;
}
