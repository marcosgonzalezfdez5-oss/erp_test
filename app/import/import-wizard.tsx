"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { NEW_CUSTOM_FIELD_TARGET, TARGET_FIELDS, type ImportEntityType } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

const selectClassName =
  "h-8 rounded-lg border border-input bg-background px-2.5 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

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
    onError: (error) => toast.error(error.message),
  });
  const run = trpc.csvImport.run.useMutation({
    onError: (error) => toast.error(error.message),
  });

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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-entity-type">What are you importing?</Label>
        <select
          id="import-entity-type"
          className={selectClassName}
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
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-csv-file">CSV file</Label>
        <input
          id="import-csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
        />
      </div>

      {analyze.isPending && <p className="text-sm text-muted-foreground">Analyzing columns…</p>}

      {analyze.data && !analyze.data.aiAvailable && (
        <p className="text-sm text-muted-foreground">AI suggestion unavailable — map the columns below manually.</p>
      )}

      {analyze.data && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {analyze.data.rowCount} rows found. Review the mapping below:
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Column</TableHead>
                <TableHead>Maps to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analyze.data.headers.map((column) => (
                <TableRow key={column}>
                  <TableCell>{column}</TableCell>
                  <TableCell>
                    <select
                      aria-label={`Map ${column} to`}
                      className={selectClassName}
                      value={mapping[column] ?? SKIP_TARGET}
                      onChange={(e) => setMapping((prev) => ({ ...prev, [column]: e.target.value }))}
                    >
                      {targetOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Button
            type="button"
            className="w-fit"
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
          </Button>
        </div>
      )}

      {run.data && (
        <div className="flex flex-col gap-2 rounded-md border bg-card p-3 text-sm">
          <p data-testid="import-summary">
            Imported {run.data.imported} of {analyze.data?.rowCount ?? run.data.imported + run.data.failed.length}.
          </p>
          {run.data.failed.length > 0 && (
            <ul className="flex flex-col gap-1 text-muted-foreground">
              {run.data.failed.map((failure) => (
                <li key={failure.row}>
                  Row {failure.row}: {failure.error}
                </li>
              ))}
            </ul>
          )}
          <Link
            href={entityTypeOptions.find((o) => o.value === entityType)!.recordLink}
            className="w-fit text-primary hover:underline"
          >
            View {entityType === "account" ? "accounts" : "leads"}
          </Link>
        </div>
      )}
    </div>
  );
}
