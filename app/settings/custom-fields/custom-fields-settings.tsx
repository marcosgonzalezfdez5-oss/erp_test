"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

type EntityType = "account" | "opportunity";
type FieldType = "text" | "number" | "date" | "select" | "boolean";

const entityTypes: { value: EntityType; label: string }[] = [
  { value: "account", label: "Accounts" },
  { value: "opportunity", label: "Opportunities" },
];

const fieldTypes: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select" },
  { value: "boolean", label: "Boolean" },
];

export function CustomFieldsSettings() {
  const utils = trpc.useUtils();
  const [entityType, setEntityType] = useState<EntityType>("account");
  const definitions = trpc.customField.listDefinitions.useQuery({ entityType });
  const createDefinition = trpc.customField.createDefinition.useMutation({
    onSuccess: () => utils.customField.listDefinitions.invalidate({ entityType }),
  });
  const deleteDefinition = trpc.customField.deleteDefinition.useMutation({
    onSuccess: () => utils.customField.listDefinitions.invalidate({ entityType }),
  });

  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [required, setRequired] = useState(false);

  function resetForm() {
    setName("");
    setFieldType("text");
    setOptionsText("");
    setRequired(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-4 text-sm">
        {entityTypes.map((entity) => (
          <button
            key={entity.value}
            type="button"
            onClick={() => setEntityType(entity.value)}
            className={
              entity.value === entityType
                ? "underline decoration-2 underline-offset-4"
                : "text-zinc-500 hover:text-foreground"
            }
          >
            {entity.label}
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {definitions.data?.map((definition) => (
          <li key={definition.id} className="flex items-center justify-between text-sm">
            <span>
              {definition.name}{" "}
              <span className="text-zinc-500">
                ({definition.fieldType}
                {definition.required ? ", required" : ""})
              </span>
            </span>
            <button
              type="button"
              className="text-zinc-500 underline"
              onClick={() => deleteDefinition.mutate({ id: definition.id })}
            >
              Remove
            </button>
          </li>
        ))}
        {definitions.data?.length === 0 && <li className="text-sm text-zinc-500">No custom fields yet.</li>}
      </ul>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;

          if (fieldType === "select") {
            const options = optionsText
              .split(",")
              .map((option) => option.trim())
              .filter(Boolean);
            if (options.length === 0) return;
            createDefinition.mutate({ entityType, name, fieldType: "select", options, required });
          } else {
            createDefinition.mutate({ entityType, name, fieldType, required });
          }
          resetForm();
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Field name
          <input
            className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Field type
          <select
            className="rounded border border-black/10 px-3 py-2 dark:border-white/20 dark:bg-black"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FieldType)}
          >
            {fieldTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        {fieldType === "select" && (
          <label className="flex flex-col gap-1 text-sm">
            Options (comma-separated)
            <input
              className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder="SMB, Mid-market, Enterprise"
            />
          </label>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required
        </label>

        <button
          type="submit"
          className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
          disabled={createDefinition.isPending}
        >
          Add field
        </button>
      </form>
    </div>
  );
}
