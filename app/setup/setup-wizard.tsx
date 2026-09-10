"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ImportEntity = "account" | "lead";
type StageKind = "open" | "won" | "lost";
type FieldType = "text" | "number" | "date" | "select" | "boolean";

type StageDraft = { keep: boolean; name: string; kind: StageKind; rationale: string };
type FieldDraft = { keep: boolean; name: string; fieldType: FieldType; options: string; rationale: string };

const selectClassName =
  "h-8 rounded-lg border border-input bg-background px-2.5 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SetupWizard() {
  const router = useRouter();
  const [entityType, setEntityType] = useState<ImportEntity>("account");
  const [csvText, setCsvText] = useState<string | null>(null);
  const [industry, setIndustry] = useState("");
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [existingStages, setExistingStages] = useState<string[]>([]);
  const [fieldEntity, setFieldEntity] = useState<"account" | "opportunity">("account");
  const [aiNote, setAiNote] = useState<string | null>(null);

  const analyze = trpc.setupWizard.analyze.useMutation({
    onSuccess: (result) => {
      setStages(result.pipeline.stages.map((s) => ({ keep: true, ...s })));
      setFields(
        result.fields.fields.map((f) => ({
          keep: true,
          name: f.name,
          fieldType: f.fieldType,
          options: (f.options ?? []).join(", "),
          rationale: f.rationale,
        })),
      );
      setExistingStages(result.existingStageNames);
      setFieldEntity(result.fields.entityType);
      setAiNote(
        result.pipeline.aiAvailable && result.fields.aiAvailable
          ? null
          : "AI is unavailable, so these are standard defaults. Edit them or add your own.",
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const createSuggestions = trpc.setupWizard.createSuggestions.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.created} suggestions ready for review`);
      router.push(`/suggestions`);
    },
    onError: (error) => toast.error(error.message),
  });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvText(await file.text());
  }

  function addStage() {
    setStages((prev) => [...prev, { keep: true, name: "", kind: "open", rationale: "Added manually" }]);
  }
  function addField() {
    setFields((prev) => [...prev, { keep: true, name: "", fieldType: "text", options: "", rationale: "Added manually" }]);
  }

  const keptStages = stages.filter((s) => s.keep && s.name.trim());
  const keptFields = fields.filter((f) => f.keep && f.name.trim());

  function submit() {
    createSuggestions.mutate({
      stages: keptStages.map((s) => ({ name: s.name.trim(), kind: s.kind })),
      fields: keptFields.map((f) =>
        f.fieldType === "select"
          ? {
              entityType: fieldEntity,
              name: f.name.trim(),
              fieldType: "select" as const,
              options: f.options
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean),
              required: false,
            }
          : { entityType: fieldEntity, name: f.name.trim(), fieldType: f.fieldType, required: false },
      ),
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-entity">What does this data describe?</Label>
          <select
            id="setup-entity"
            className={selectClassName}
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as ImportEntity)}
          >
            <option value="account">Companies / accounts</option>
            <option value="lead">Leads / deals</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-industry">Your industry (optional)</Label>
          <Input
            id="setup-industry"
            placeholder="e.g. commercial HVAC installation"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-csv">A sample export (CSV)</Label>
          <input
            id="setup-csv"
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
          />
        </div>

        <Button
          type="button"
          className="w-fit"
          disabled={!csvText || analyze.isPending}
          onClick={() => csvText && analyze.mutate({ entityType, csvText, industryHint: industry || undefined })}
        >
          {analyze.isPending ? "Analyzing…" : "Analyze"}
        </Button>
      </section>

      {aiNote && <p className="text-sm text-muted-foreground">{aiNote}</p>}

      {analyze.data && (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium text-foreground">Pipeline stages to add</h2>
              {existingStages.length > 0 && (
                <p className="text-sm text-muted-foreground">You already have: {existingStages.join(", ")}.</p>
              )}
            </div>
            {stages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No new stages suggested. Add your own below.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border">
                {stages.map((stage, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <Checkbox
                      checked={stage.keep}
                      onCheckedChange={(v) =>
                        setStages((prev) => prev.map((s, j) => (j === i ? { ...s, keep: v === true } : s)))
                      }
                      aria-label={`Keep stage ${stage.name}`}
                    />
                    <Input
                      className="w-40"
                      value={stage.name}
                      aria-label={`Stage ${i + 1} name`}
                      onChange={(e) =>
                        setStages((prev) => prev.map((s, j) => (j === i ? { ...s, name: e.target.value } : s)))
                      }
                    />
                    <select
                      className={selectClassName}
                      value={stage.kind}
                      aria-label={`Stage ${i + 1} kind`}
                      onChange={(e) =>
                        setStages((prev) =>
                          prev.map((s, j) => (j === i ? { ...s, kind: e.target.value as StageKind } : s)),
                        )
                      }
                    >
                      <option value="open">Open</option>
                      <option value="won">Won</option>
                      <option value="lost">Lost</option>
                    </select>
                    <span className="text-sm text-muted-foreground">{stage.rationale}</span>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addStage}>
              Add stage
            </Button>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-foreground">
              Custom fields to add to {fieldEntity === "account" ? "accounts" : "opportunities"}
            </h2>
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">No new fields suggested. Add your own below.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border">
                {fields.map((field, i) => (
                  <li key={i} className="flex flex-col gap-2 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <Checkbox
                        checked={field.keep}
                        onCheckedChange={(v) =>
                          setFields((prev) => prev.map((f, j) => (j === i ? { ...f, keep: v === true } : f)))
                        }
                        aria-label={`Keep field ${field.name}`}
                      />
                      <Input
                        className="w-40"
                        value={field.name}
                        aria-label={`Field ${i + 1} name`}
                        onChange={(e) =>
                          setFields((prev) => prev.map((f, j) => (j === i ? { ...f, name: e.target.value } : f)))
                        }
                      />
                      <select
                        className={selectClassName}
                        value={field.fieldType}
                        aria-label={`Field ${i + 1} type`}
                        onChange={(e) =>
                          setFields((prev) =>
                            prev.map((f, j) => (j === i ? { ...f, fieldType: e.target.value as FieldType } : f)),
                          )
                        }
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                        <option value="select">Select</option>
                        <option value="boolean">Yes / no</option>
                      </select>
                      <span className="text-sm text-muted-foreground">{field.rationale}</span>
                    </div>
                    {field.fieldType === "select" && (
                      <Input
                        className="w-full max-w-md"
                        placeholder="Options, comma separated"
                        value={field.options}
                        aria-label={`Field ${i + 1} options`}
                        onChange={(e) =>
                          setFields((prev) => prev.map((f, j) => (j === i ? { ...f, options: e.target.value } : f)))
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addField}>
              Add field
            </Button>
          </section>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={createSuggestions.isPending || keptStages.length + keptFields.length === 0}
              onClick={submit}
            >
              Create {keptStages.length + keptFields.length} suggestions for review
            </Button>
            <span className="text-sm text-muted-foreground">
              Nothing changes until you approve them on the Suggestions page.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
