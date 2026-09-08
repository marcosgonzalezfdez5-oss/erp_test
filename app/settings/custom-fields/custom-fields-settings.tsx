"use client";

import { useState } from "react";
import { Pencil, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EditDialog } from "@/components/edit-dialog";
import { EmptyState } from "@/components/empty-state";
import { FieldError } from "@/components/field-error";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
    onSuccess: () => {
      utils.customField.listDefinitions.invalidate({ entityType });
      toast.success("Field added");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteDefinition = trpc.customField.deleteDefinition.useMutation({
    onSuccess: () => {
      utils.customField.listDefinitions.invalidate({ entityType });
      toast.success("Field removed");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateDefinition = trpc.customField.updateDefinition.useMutation({
    onSuccess: () => {
      utils.customField.listDefinitions.invalidate({ entityType });
      setEditingId(null);
      toast.success("Field renamed");
    },
    onError: (error) => toast.error(error.message),
  });

  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [required, setRequired] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  function resetForm() {
    setName("");
    setFieldType("text");
    setOptionsText("");
    setRequired(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b">
        {entityTypes.map((entity) => (
          <button
            key={entity.value}
            type="button"
            onClick={() => setEntityType(entity.value)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              entity.value === entityType
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {entity.label}
          </button>
        ))}
      </div>

      {definitions.isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      )}

      {definitions.isError && (
        <QueryError message="Couldn't load custom fields." onRetry={() => definitions.refetch()} />
      )}

      {definitions.data?.length === 0 && (
        <EmptyState
          icon={SlidersHorizontal}
          title="No custom fields yet"
          description="Add a field below to start capturing tenant-specific data."
        />
      )}

      {definitions.data && definitions.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {definitions.data.map((definition) => (
            <li
              key={definition.id}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
            >
              <span>
                {definition.name}{" "}
                <span className="text-muted-foreground">
                  ({definition.fieldType}
                  {definition.required ? ", required" : ""})
                </span>
              </span>
              <div className="flex gap-1">
                <EditDialog
                  trigger={
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Rename ${definition.name}`}>
                      <Pencil />
                    </Button>
                  }
                  title="Rename field"
                  open={editingId === definition.id}
                  onOpenChange={(open) => {
                    setEditingId(open ? definition.id : null);
                    if (open) setEditName(definition.name);
                  }}
                  pending={updateDefinition.isPending}
                  onSubmit={() => {
                    if (!editName.trim()) return;
                    updateDefinition.mutate({ id: definition.id, name: editName });
                  }}
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`edit-field-name-${definition.id}`}>Field name</Label>
                    <Input
                      id={`edit-field-name-${definition.id}`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                </EditDialog>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteDefinition.mutate({ id: definition.id })}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) {
            setFormError("Enter a field name.");
            return;
          }

          if (fieldType === "select") {
            const options = optionsText
              .split(",")
              .map((option) => option.trim())
              .filter(Boolean);
            if (options.length === 0) {
              setFormError("Enter at least one option.");
              return;
            }
            createDefinition.mutate({ entityType, name, fieldType: "select", options, required });
          } else {
            createDefinition.mutate({ entityType, name, fieldType, required });
          }
          setFormError(null);
          resetForm();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="field-name">Field name</Label>
          <Input
            id="field-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFormError(null);
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="field-type">Field type</Label>
          <select
            id="field-type"
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FieldType)}
          >
            {fieldTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        {fieldType === "select" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-options">Options (comma-separated)</Label>
            <Input
              id="field-options"
              value={optionsText}
              onChange={(e) => {
                setOptionsText(e.target.value);
                setFormError(null);
              }}
              placeholder="SMB, Mid-market, Enterprise"
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={required} onCheckedChange={(checked) => setRequired(checked === true)} />
          Required
        </label>

        <FieldError message={formError} />

        <Button type="submit" className="w-fit" disabled={createDefinition.isPending}>
          Add field
        </Button>
      </form>
    </div>
  );
}
