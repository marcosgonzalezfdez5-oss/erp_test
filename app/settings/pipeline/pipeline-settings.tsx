"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FieldError } from "@/components/field-error";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export function PipelineSettings() {
  const utils = trpc.useUtils();
  const stagesQuery = trpc.pipeline.list.useQuery();
  const rename = trpc.pipeline.rename.useMutation({
    onSuccess: () => {
      utils.pipeline.list.invalidate();
      toast.success("Stage renamed");
    },
    onError: (error) => toast.error(error.message),
  });
  const reorder = trpc.pipeline.reorder.useMutation({
    onSuccess: () => utils.pipeline.list.invalidate(),
    onError: (error) => toast.error(error.message),
  });
  const createStage = trpc.pipeline.create.useMutation({
    onSuccess: () => {
      utils.pipeline.list.invalidate();
      toast.success("Stage added");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteStage = trpc.pipeline.delete.useMutation({
    onSuccess: () => {
      utils.pipeline.list.invalidate();
      toast.success("Stage removed");
    },
    onError: (error) => toast.error(error.message),
  });

  const [editing, setEditing] = useState<Record<string, string>>({});
  const [newStageName, setNewStageName] = useState("");
  const [newStageError, setNewStageError] = useState<string | null>(null);

  const stages = stagesQuery.data ?? [];

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const reordered = [...stages];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    reorder.mutate({ orderedIds: reordered.map((s) => s.id) });
  }

  if (stagesQuery.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  if (stagesQuery.isError) {
    return <QueryError message="Couldn't load your pipeline stages." onRetry={() => stagesQuery.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {stages.length === 0 ? (
        <EmptyState title="No pipeline stages yet" description="Add your first stage below." />
      ) : (
        <ul className="flex flex-col gap-2">
          {stages.map((stage, index) => {
            const value = editing[stage.id] ?? stage.name;
            return (
              <li key={stage.id} className="flex items-center gap-2 rounded-md border bg-card p-2">
                <Input
                  aria-label={`Stage name: ${stage.name}`}
                  className="max-w-56"
                  value={value}
                  onChange={(e) => setEditing((prev) => ({ ...prev, [stage.id]: e.target.value }))}
                />
                <Badge variant="secondary">{stage.kind}</Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={value === stage.name}
                  onClick={() => rename.mutate({ id: stage.id, name: value })}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${stage.name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${stage.name} down`}
                  disabled={index === stages.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <DeleteConfirmDialog
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${stage.name}`}
                      className="ml-auto text-destructive hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  }
                  title={`Remove "${stage.name}"?`}
                  description="Opportunities currently in this stage will need to be moved before it can be removed."
                  pending={deleteStage.isPending}
                  onConfirm={() => deleteStage.mutate({ id: stage.id })}
                />
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newStageName.trim()) {
            setNewStageError("Enter a stage name.");
            return;
          }
          setNewStageError(null);
          createStage.mutate({ name: newStageName });
          setNewStageName("");
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-stage-name">New stage name</Label>
          <Input
            id="new-stage-name"
            value={newStageName}
            onChange={(e) => {
              setNewStageName(e.target.value);
              setNewStageError(null);
            }}
          />
          <FieldError message={newStageError} />
        </div>
        <Button type="submit" className="mt-[26px]">
          Add stage
        </Button>
      </form>
    </div>
  );
}
