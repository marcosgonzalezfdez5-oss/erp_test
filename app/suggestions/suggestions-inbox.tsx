"use client";

import { useState } from "react";
import { Inbox } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type Tab = "pending" | "history";

const SOURCE_LABEL: Record<string, string> = {
  setup_wizard: "Guided setup",
  automation: "Automation",
  ai_assist: "AI assist",
  manual: "Manual",
};

const STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Superseded",
  pending: "Pending",
};

function formatWhen(value: string | Date) {
  return new Date(value).toLocaleString();
}

export function SuggestionsInbox() {
  const [tab, setTab] = useState<Tab>("pending");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b">
        {(["pending", "history"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
              (tab === value
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {value === "pending" ? "Pending" : "History"}
          </button>
        ))}
      </div>

      {tab === "pending" ? <PendingList /> : <HistoryList />}
    </div>
  );
}

function PendingList() {
  const utils = trpc.useUtils();
  const suggestions = trpc.suggestion.list.useQuery({ status: "pending" });

  function invalidate() {
    utils.suggestion.list.invalidate();
    utils.suggestion.pendingCount.invalidate();
  }

  const approve = trpc.suggestion.approve.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Suggestion approved");
    },
    onError: (error) => toast.error(error.message),
  });
  const reject = trpc.suggestion.reject.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Suggestion rejected");
    },
    onError: (error) => toast.error(error.message),
  });
  const approveGroup = trpc.suggestion.approveGroup.useMutation({
    onSuccess: (results) => {
      invalidate();
      const failed = results.filter((r) => !r.ok).length;
      if (failed === 0) toast.success("All suggestions approved");
      else toast.warning(`${results.length - failed} approved, ${failed} could not be applied`);
    },
    onError: (error) => toast.error(error.message),
  });

  if (suggestions.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (suggestions.isError) {
    return <QueryError message="Couldn't load suggestions." onRetry={() => suggestions.refetch()} />;
  }
  if (!suggestions.data || suggestions.data.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing to review"
        description="When guided setup or an automation proposes a change, it shows up here for approval."
      />
    );
  }

  // Group by groupKey; standalone suggestions (no groupKey) each form their own group.
  const groups = new Map<string, typeof suggestions.data>();
  for (const s of suggestions.data) {
    const key = s.groupKey ?? `solo:${s.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const busy = approve.isPending || reject.isPending || approveGroup.isPending;

  return (
    <div className="flex flex-col gap-6">
      {[...groups.entries()].map(([key, items]) => {
        const grouped = items.length > 1 && !key.startsWith("solo:");
        return (
          <div key={key} className="flex flex-col gap-2">
            {grouped && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {items.length} proposed changes from {SOURCE_LABEL[items[0].source] ?? items[0].source}
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => approveGroup.mutate({ groupKey: items[0].groupKey! })}
                >
                  Approve all
                </Button>
              </div>
            )}
            <ul className="flex flex-col divide-y rounded-md border">
              {items.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-foreground">{s.description}</span>
                      {s.rationale && <span className="text-sm text-muted-foreground">{s.rationale}</span>}
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {SOURCE_LABEL[s.source] ?? s.source}
                    </Badge>
                  </div>
                  {s.lastError && (
                    <p className="text-sm text-destructive">Last attempt failed: {s.lastError}</p>
                  )}
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={busy} onClick={() => approve.mutate({ id: s.id })}>
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => reject.mutate({ id: s.id })}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function HistoryList() {
  const suggestions = trpc.suggestion.list.useQuery({});

  if (suggestions.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (suggestions.isError) {
    return <QueryError message="Couldn't load suggestions." onRetry={() => suggestions.refetch()} />;
  }

  const reviewed = (suggestions.data ?? []).filter((s) => s.status !== "pending");
  if (reviewed.length === 0) {
    return <EmptyState icon={Inbox} title="No history yet" description="Approved and rejected suggestions appear here." />;
  }

  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {reviewed.map((s) => (
        <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-foreground">{s.description}</span>
            <span className="text-sm text-muted-foreground">
              {STATUS_LABEL[s.status] ?? s.status}
              {s.reviewedAt ? ` · ${formatWhen(s.reviewedAt)}` : ""}
              {` · ${SOURCE_LABEL[s.source] ?? s.source}`}
            </span>
          </div>
          <Badge variant={s.status === "approved" ? "secondary" : "outline"} className="shrink-0">
            {STATUS_LABEL[s.status] ?? s.status}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
