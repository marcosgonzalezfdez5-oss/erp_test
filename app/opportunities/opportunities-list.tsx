"use client";

import { useState } from "react";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { Money } from "@/components/money";
import { SearchInput } from "@/components/search-input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function OpportunitiesBoard() {
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();
  const stagesQuery = trpc.pipeline.list.useQuery();
  const opportunitiesQuery = trpc.opportunity.list.useQuery();
  const moveStage = trpc.opportunity.moveStage.useMutation({
    onSuccess: () => utils.opportunity.list.invalidate(),
    onError: (error) => toast.error(error.message),
  });

  if (stagesQuery.isLoading || opportunitiesQuery.isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-64 w-64 shrink-0" />
        ))}
      </div>
    );
  }

  if (stagesQuery.isError || opportunitiesQuery.isError) {
    return (
      <QueryError
        message="Couldn't load your pipeline."
        onRetry={() => {
          stagesQuery.refetch();
          opportunitiesQuery.refetch();
        }}
      />
    );
  }

  const stages = stagesQuery.data ?? [];
  const allOpportunities = opportunitiesQuery.data ?? [];
  const opportunities = search
    ? allOpportunities.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : allOpportunities;

  if (stages.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No pipeline stages configured"
        description="Set up your pipeline stages in Settings before opportunities can move through them."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SearchInput value={search} onChange={setSearch} placeholder="Search opportunities…" />
      <div className="flex gap-4 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const stageOpportunities = opportunities.filter((o) => o.pipelineStageId === stage.id);
          return (
            <div
              key={stage.id}
              data-testid={`stage-column-${stage.name}`}
              className="flex w-64 shrink-0 flex-col gap-3 rounded-md border bg-card p-3"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-foreground">{stage.name}</h2>
                <Badge variant="secondary">{stageOpportunities.length}</Badge>
              </div>
              <ul className="flex flex-col gap-2">
                {stageOpportunities.map((opportunity) => (
                  <li key={opportunity.id} className="rounded-md border bg-background p-2.5 text-sm">
                    <Link
                      href={`/opportunities/${opportunity.id}`}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {opportunity.name}
                    </Link>
                    {opportunity.value && (
                      <div className="mt-0.5">
                        <Money value={opportunity.value} className="text-xs text-muted-foreground" />
                      </div>
                    )}
                    <label className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                      Move to stage
                      <select
                        aria-label={`Move ${opportunity.name} to stage`}
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                {stageOpportunities.length === 0 && (
                  <li className="rounded-md border border-dashed p-2.5 text-center text-xs text-muted-foreground">
                    No opportunities
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
