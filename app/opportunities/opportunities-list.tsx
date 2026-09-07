"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";

export function OpportunitiesBoard() {
  const utils = trpc.useUtils();
  const stagesQuery = trpc.pipeline.list.useQuery();
  const opportunitiesQuery = trpc.opportunity.list.useQuery();
  const moveStage = trpc.opportunity.moveStage.useMutation({
    onSuccess: () => utils.opportunity.list.invalidate(),
  });

  const stages = stagesQuery.data ?? [];
  const opportunities = opportunitiesQuery.data ?? [];

  if (stages.length === 0) {
    return <p className="text-sm text-zinc-500">No pipeline stages configured.</p>;
  }

  return (
    <div className="flex gap-4 overflow-x-auto">
      {stages.map((stage) => (
        <div
          key={stage.id}
          data-testid={`stage-column-${stage.name}`}
          className="flex w-64 flex-shrink-0 flex-col gap-2 rounded border border-black/10 p-3 dark:border-white/20"
        >
          <h2 className="text-sm font-medium">{stage.name}</h2>
          <ul className="flex flex-col gap-2">
            {opportunities
              .filter((o) => o.pipelineStageId === stage.id)
              .map((opportunity) => (
                <li key={opportunity.id} className="rounded border border-black/10 p-2 text-sm dark:border-white/20">
                  <Link href={`/opportunities/${opportunity.id}`} className="underline">
                    {opportunity.name}
                  </Link>
                  <label className="mt-2 flex flex-col gap-1 text-xs text-zinc-500">
                    Move to stage
                    <select
                      aria-label={`Move ${opportunity.name} to stage`}
                      className="rounded border border-black/10 px-2 py-1 text-black dark:border-white/20 dark:bg-black dark:text-white"
                      value={opportunity.pipelineStageId}
                      onChange={(e) => moveStage.mutate({ id: opportunity.id, pipelineStageId: e.target.value })}
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
