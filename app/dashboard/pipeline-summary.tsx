"use client";

import { trpc } from "@/lib/trpc/client";

export function PipelineSummary() {
  const summary = trpc.dashboard.pipelineSummary.useQuery();

  if (!summary.data) {
    return null;
  }

  const totalOpportunities = summary.data.reduce((sum, stage) => sum + stage.opportunityCount, 0);

  if (totalOpportunities === 0) {
    return <p className="text-sm text-zinc-500">No opportunities yet.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-zinc-500">
          <th className="pb-2">Stage</th>
          <th className="pb-2">Opportunities</th>
          <th className="pb-2">Value</th>
        </tr>
      </thead>
      <tbody>
        {summary.data.map((stage) => (
          <tr key={stage.stageId} data-testid={`dashboard-stage-${stage.stageName}`}>
            <td className="py-1">{stage.stageName}</td>
            <td className="py-1">{stage.opportunityCount}</td>
            <td className="py-1">${stage.totalValue}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
