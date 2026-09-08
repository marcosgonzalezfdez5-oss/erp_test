"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type EntityType = "account" | "opportunity";

type FieldValue = {
  definitionId: string;
  name: string;
  fieldType: "text" | "number" | "date" | "boolean" | "select";
  options: string[] | null;
  required: boolean;
  value: unknown;
};

/** A required field counts as unset when it has no value — or, for a checkbox,
 * when it isn't ticked (see the custom-field service's isEmptyValue). */
function isRequiredUnset(field: FieldValue): boolean {
  if (!field.required) return false;
  if (field.fieldType === "boolean") return field.value !== true;
  return field.value == null || field.value === "";
}

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

export function CustomFieldsForm({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const utils = trpc.useUtils();
  const values = trpc.customField.listValuesForEntity.useQuery({ entityType, entityId });
  const setValue = trpc.customField.setValue.useMutation({
    onSuccess: () => utils.customField.listValuesForEntity.invalidate({ entityType, entityId }),
    onError: (error) => toast.error(error.message),
  });
  const clearValue = trpc.customField.clearValue.useMutation({
    onSuccess: () => {
      utils.customField.listValuesForEntity.invalidate({ entityType, entityId });
      toast.success("Field cleared");
    },
    onError: (error) => toast.error(error.message),
  });

  const [draft, setDraft] = useState<Record<string, string>>({});

  if (!values.data || values.data.length === 0) {
    return null;
  }

  const missingRequired = values.data.filter(isRequiredUnset);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Custom fields</h2>
      {missingRequired.length > 0 && (
        <p className="text-sm text-destructive">
          {missingRequired.length} required{" "}
          {missingRequired.length === 1 ? "field is" : "fields are"} not set:{" "}
          {missingRequired.map((f) => f.name).join(", ")}
        </p>
      )}
      <div className="flex flex-col gap-3">
        {values.data.map((field) => {
          const savedValue = field.value == null ? "" : String(field.value);
          const draftValue = draft[field.definitionId] ?? savedValue;
          const fieldId = `custom-field-${field.definitionId}`;
          const unset = isRequiredUnset(field);
          const parsedNumber = field.fieldType === "number" ? Number(draftValue) : null;

          if (field.fieldType === "boolean") {
            return (
              <div key={field.definitionId} className="flex flex-col gap-1 text-sm">
                <label className="flex items-center gap-2 text-foreground">
                  <Checkbox
                    checked={field.value === true}
                    onCheckedChange={(checked) =>
                      setValue.mutate({ definitionId: field.definitionId, entityId, value: checked === true })
                    }
                  />
                  {field.name}
                  {field.required && <RequiredMark />}
                </label>
                {unset && <p className="text-sm text-destructive">Required — tick to confirm.</p>}
              </div>
            );
          }

          if (field.fieldType === "select") {
            return (
              <div key={field.definitionId} className="flex flex-col gap-1 text-sm">
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor={fieldId}>
                      {field.name}
                      {field.required && <RequiredMark />}
                    </Label>
                    <select
                      id={fieldId}
                      className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={savedValue}
                      onChange={(e) =>
                        setValue.mutate({ definitionId: field.definitionId, entityId, value: e.target.value })
                      }
                    >
                      <option value="" disabled>
                        Select…
                      </option>
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  {savedValue && !field.required && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={clearValue.isPending}
                      onClick={() => clearValue.mutate({ definitionId: field.definitionId, entityId })}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                {unset && <p className="text-sm text-destructive">Required — pick an option.</p>}
              </div>
            );
          }

          return (
            <div key={field.definitionId} className="flex flex-col gap-1">
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor={fieldId}>
                    {field.name}
                    {field.required && <RequiredMark />}
                  </Label>
                  <Input
                    id={fieldId}
                    type={field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : "text"}
                    value={draftValue}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [field.definitionId]: e.target.value }))}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    draftValue === savedValue ||
                    draftValue.trim() === "" ||
                    (field.fieldType === "number" && Number.isNaN(parsedNumber))
                  }
                  onClick={() =>
                    setValue.mutate({
                      definitionId: field.definitionId,
                      entityId,
                      value: field.fieldType === "number" ? Number(draftValue) : draftValue,
                    })
                  }
                >
                  Save
                </Button>
                {savedValue && !field.required && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={clearValue.isPending}
                    onClick={() => clearValue.mutate({ definitionId: field.definitionId, entityId })}
                  >
                    Clear
                  </Button>
                )}
              </div>
              {unset && <p className="text-sm text-destructive">Required — not set.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
