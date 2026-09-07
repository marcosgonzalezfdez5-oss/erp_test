"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

type EntityType = "account" | "opportunity";

export function CustomFieldsForm({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const utils = trpc.useUtils();
  const values = trpc.customField.listValuesForEntity.useQuery({ entityType, entityId });
  const setValue = trpc.customField.setValue.useMutation({
    onSuccess: () => utils.customField.listValuesForEntity.invalidate({ entityType, entityId }),
  });

  const [draft, setDraft] = useState<Record<string, string>>({});

  if (!values.data || values.data.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-zinc-500">Custom fields</h2>
      <div className="flex flex-col gap-3">
        {values.data.map((field) => {
          const savedValue = field.value == null ? "" : String(field.value);
          const draftValue = draft[field.definitionId] ?? savedValue;

          if (field.fieldType === "boolean") {
            return (
              <label key={field.definitionId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={field.value === true}
                  onChange={(e) =>
                    setValue.mutate({ definitionId: field.definitionId, entityId, value: e.target.checked })
                  }
                />
                {field.name}
              </label>
            );
          }

          if (field.fieldType === "select") {
            return (
              <label key={field.definitionId} className="flex flex-col gap-1 text-sm">
                {field.name}
                <select
                  className="rounded border border-black/10 px-3 py-2 dark:border-white/20 dark:bg-black"
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
              </label>
            );
          }

          return (
            <div key={field.definitionId} className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {field.name}
                <input
                  type={field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : "text"}
                  className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
                  value={draftValue}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [field.definitionId]: e.target.value }))}
                />
              </label>
              <button
                type="button"
                className="rounded border border-black/10 px-3 py-2 text-sm disabled:opacity-50 dark:border-white/20"
                disabled={draftValue === savedValue || draftValue.trim() === ""}
                onClick={() =>
                  setValue.mutate({
                    definitionId: field.definitionId,
                    entityId,
                    value: field.fieldType === "number" ? Number(draftValue) : draftValue,
                  })
                }
              >
                Save
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
