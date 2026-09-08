"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { isNotFoundError } from "@/lib/trpc/is-not-found";
import { Skeleton } from "@/components/ui/skeleton";

export function OrderDetail({ orderId }: { orderId: string }) {
  const order = trpc.order.get.useQuery({ id: orderId });
  const opportunityId = order.data?.opportunityId;
  const opportunity = trpc.opportunity.get.useQuery(
    { id: opportunityId ?? "" },
    { enabled: Boolean(opportunityId) },
  );
  const quotes = trpc.quote.listByOpportunity.useQuery(
    { opportunityId: opportunityId ?? "" },
    { enabled: Boolean(opportunityId) },
  );

  if (order.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (order.isError) {
    if (isNotFoundError(order.error)) {
      return <EmptyState title="Order not found" description="It may have been deleted." />;
    }
    return <QueryError message="Couldn't load this order." onRetry={() => order.refetch()} />;
  }
  if (!order.data) {
    // Unreachable: order.get throws NOT_FOUND for a missing row. Kept for
    // TypeScript narrowing of order.data below.
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {opportunityId && (
        <Link
          href={`/opportunities/${opportunityId}`}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to opportunity
        </Link>
      )}

      <PageHeader title="Order" description={`Created ${new Date(order.data.createdAt).toLocaleDateString()}`} />

      <dl className="grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Opportunity</dt>
        <dd className="text-foreground">
          {opportunity.data ? (
            <Link href={`/opportunities/${opportunityId}`} className="text-primary hover:underline">
              {opportunity.data.name}
            </Link>
          ) : (
            "—"
          )}
        </dd>
        <dt className="text-muted-foreground">Deal value</dt>
        <dd className="text-foreground">
          {opportunity.data?.value ? <Money value={opportunity.data.value} /> : "—"}
        </dd>
      </dl>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Quotes</h2>
        <ul className="flex flex-col gap-1.5">
          {quotes.data?.map((quote, index) => (
            <li key={quote.id} className="text-sm">
              <Link href={`/quotes/${quote.id}`} className="text-primary hover:underline">
                Quote #{index + 1}
              </Link>
            </li>
          ))}
          {quotes.data?.length === 0 && <li className="text-sm text-muted-foreground">No quotes yet.</li>}
        </ul>
      </div>
    </div>
  );
}
