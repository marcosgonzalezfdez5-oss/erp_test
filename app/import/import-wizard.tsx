"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { NEW_CUSTOM_FIELD_TARGET, TARGET_FIELDS, type ImportEntityType } from "@/lib/csv";

const SKIP_TARGET = "";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  company: "Company",
};

const entityTypeOptions: { value: ImportEntityType; label: string; recordLink: string }[] = [
  { value: "account", label: "Accounts", recordLink: "/accounts" },
  { value: "lead", label: "Leads", recordLink: "/leads" },
];

export function ImportWizard() {
  const [entityType, setEntityType] = useState<ImportEntityType>("account");
  const [csvText, setCsvText] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const analyze = trpc.csvImport.analyze.useMutation({
    onSuccess: (result) => {
      const next: Record<string, string> = {};
      for (const entry of result.mapping) {
        next[entry.column] = entry.suggestedTarget ?? SKIP_TARGET;
      }
      setMapping(next);
    },
  });
  const run = trpc.csvImport.run.useMutation();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    run.reset();
    analyze.mutate({ entityType, csvText: text });
  }

  const targetOptions = [
    { value: SKIP_TARGET, label: "Don't import" },
    ...TARGET_FIELDS[entityType].map((field) => ({ value: field, label: FIELD_LABELS[field] ?? field })),
    ...(entityType === "account" ? [{ value: NEW_CUSTOM_FIELD_TARGET, label: "New custom field" }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-1 text-sm">
        What are you importing?
        <select
          className="rounded border border-black/10 px-3 py-2 dark:border-white/20 dark:bg-black"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value as ImportEntityType);
            setCsvText(null);
            setMapping({});
            analyze.reset();
            run.reset();
          }}
        >
          {entityTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        CSV file
        <input type="file" accept=".csv,text/csv" onChange={handleFileChange} />
      </label>

      {analyze.isPending && <p className="text-sm text-zinc-500">Analyzing columns…</p>}

      {analyze.data && !analyze.data.aiAvailable && (
        <p className="text-sm text-zinc-500">
          AI suggestion unavailable — map the columns below manually.
        </p>
      )}

      {analyze.data && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-500">{analyze.data.rowCount} rows found. Review the mapping below:</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="pb-2">Column</th>
                <th className="pb-2">Maps to</th>
              </tr>
            </thead>
            <tbody>
              {analyze.data.headers.map((column) => (
                <tr key={column}>
                  <td className="py-1">{column}</td>
                  <td className="py-1">
                    <select
                      aria-label={`Map ${column} to`}
                      className="rounded border border-black/10 px-2 py-1 dark:border-white/20 dark:bg-black"
                      value={mapping[column] ?? SKIP_TARGET}
                      onChange={(e) => setMapping((prev) => ({ ...prev, [column]: e.target.value }))}
                    >
                      {targetOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            type="button"
            className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
            disabled={run.isPending || !csvText}
            onClick={() => {
              if (!csvText) return;
              run.mutate({
                entityType,
                csvText,
                mapping: Object.entries(mapping)
                  .filter(([, target]) => target !== SKIP_TARGET)
                  .map(([column, target]) => ({ column, target })),
              });
            }}
          >
            Import {analyze.data.rowCount} rows
          </button>
        </div>
      )}

      {run.data && (
        <div className="flex flex-col gap-2 rounded border border-black/10 p-3 text-sm dark:border-white/20">
          <p data-testid="import-summary">
            Imported {run.data.imported} of {analyze.data?.rowCount ?? run.data.imported + run.data.failed.length}.
          </p>
          {run.data.failed.length > 0 && (
            <ul className="flex flex-col gap-1 text-zinc-500">
              {run.data.failed.map((failure) => (
                <li key={failure.row}>
                  Row {failure.row}: {failure.error}
                </li>
              ))}
            </ul>
          )}
          <Link
            href={entityTypeOptions.find((o) => o.value === entityType)!.recordLink}
            className="w-fit underline"
          >
            View {entityType === "account" ? "accounts" : "leads"}
          </Link>
        </div>
      )}
    </div>
  );
}
