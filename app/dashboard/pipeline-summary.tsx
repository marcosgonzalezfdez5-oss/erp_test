"use client";

import { GitBranch } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { StatCard } from "@/components/stat-card";
import { StageProgress } from "@/components/stage-progress";
import { Money, sumMoney } from "@/components/money";
import { Skeleton } from "@/components/ui/skeleton";

export function PipelineSummary() {
  const summary = trpc.dashboard.pipelineSummary.useQuery();

  if (summary.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (summary.isError) {
    return <QueryError message="Couldn't load your pipeline." onRetry={() => summary.refetch()} />;
  }

  const stages = summary.data ?? [];
  const totalOpportunities = stages.reduce((sum, stage) => sum + stage.opportunityCount, 0);

  if (totalOpportunities === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No opportunities yet"
        description="Once leads convert into opportunities, your pipeline will show up here."
      />
    );
  }

  const openStages = stages.filter((stage) => stage.stageKind === "open");
  const wonStages = stages.filter((stage) => stage.stageKind === "won");
  const lostStages = stages.filter((stage) => stage.stageKind === "lost");
  const openCount = openStages.reduce((sum, stage) => sum + stage.opportunityCount, 0);
  const lostCount = lostStages.reduce((sum, stage) => sum + stage.opportunityCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Open pipeline value"
          value={<Money value={sumMoney(openStages.map((stage) => stage.totalValue))} />}
          hint={`${openCount} open deal${openCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Won value"
          value={<Money value={sumMoney(wonStages.map((stage) => stage.totalValue))} />}
          hint={wonStages.map((stage) => stage.stageName).join(", ") || "No won stage configured"}
        />
        <StatCard
          label="Lost deals"
          value={lostCount}
          hint={lostStages.map((stage) => stage.stageName).join(", ") || "No lost stage configured"}
        />
      </div>

      <div className="rounded-md border bg-card p-4">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Pipeline by stage</h2>
        <StageProgress
          className="mb-6"
          stages={stages.map((stage) => ({ id: stage.stageId, name: stage.stageName, count: stage.opportunityCount }))}
        />
        <div className="divide-y">
          {stages.map((stage) => (
            <div
              key={stage.stageId}
              data-testid={`dashboard-stage-${stage.stageName}`}
              className="flex items-center justify-between py-2 text-sm"
            >
              <span className="font-medium text-foreground">{stage.stageName}</span>
              <span className="flex items-center gap-4 text-muted-foreground">
                <span className="font-mono tabular-nums">{stage.opportunityCount}</span>
                <Money value={stage.totalValue} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
