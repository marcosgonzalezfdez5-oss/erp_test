import { parse } from "csv-parse/sync";

export const NEW_CUSTOM_FIELD_TARGET = "__new_custom_field__";

export type ImportEntityType = "account" | "lead";

// The native fields each entity type can be mapped to. Accounts have almost
// no native fields (see CLAUDE.md §6/§12 — deliberately not full EAV), which
// is exactly why "propose a new custom field" matters most for accounts.
export const TARGET_FIELDS: Record<ImportEntityType, string[]> = {
  account: ["name"],
  lead: ["firstName", "lastName", "email", "phone", "company"],
};

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = parse(text, {
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  const [headers = [], ...rows] = records;
  return { headers, rows };
}
