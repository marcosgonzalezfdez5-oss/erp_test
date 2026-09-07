"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

export function PipelineSettings() {
  const utils = trpc.useUtils();
  const stagesQuery = trpc.pipeline.list.useQuery();
  const rename = trpc.pipeline.rename.useMutation({ onSuccess: () => utils.pipeline.list.invalidate() });
  const reorder = trpc.pipeline.reorder.useMutation({ onSuccess: () => utils.pipeline.list.invalidate() });
  const createStage = trpc.pipeline.create.useMutation({ onSuccess: () => utils.pipeline.list.invalidate() });
  const deleteStage = trpc.pipeline.delete.useMutation({ onSuccess: () => utils.pipeline.list.invalidate() });

  const [editing, setEditing] = useState<Record<string, string>>({});
  const [newStageName, setNewStageName] = useState("");

  const stages = stagesQuery.data ?? [];

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const reordered = [...stages];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    reorder.mutate({ orderedIds: reordered.map((s) => s.id) });
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-2">
        {stages.map((stage, index) => {
          const value = editing[stage.id] ?? stage.name;
          return (
            <li key={stage.id} className="flex items-center gap-2">
              <input
                aria-label={`Stage name: ${stage.name}`}
                className="rounded border border-black/10 px-2 py-1 dark:border-white/20"
                value={value}
                onChange={(e) => setEditing((prev) => ({ ...prev, [stage.id]: e.target.value }))}
              />
              <span className="text-xs text-zinc-500">{stage.kind}</span>
              <button
                type="button"
                className="disabled:opacity-50"
                disabled={value === stage.name}
                onClick={() => rename.mutate({ id: stage.id, name: value })}
              >
                Save
              </button>
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>
                Move up
              </button>
              <button type="button" disabled={index === stages.length - 1} onClick={() => move(index, 1)}>
                Move down
              </button>
              <button type="button" onClick={() => deleteStage.mutate({ id: stage.id })}>
                Remove
              </button>
            </li>
          );
        })}
      </ul>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newStageName.trim()) return;
          createStage.mutate({ name: newStageName });
          setNewStageName("");
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          New stage name
          <input
            className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
          />
        </label>
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-background">
          Add stage
        </button>
      </form>
    </div>
  );
}
