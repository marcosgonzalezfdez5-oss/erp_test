"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { Pager } from "@/components/pager";
import { QueryError } from "@/components/query-error";
import { SearchInput } from "@/components/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function QuotesList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const quotes = trpc.quote.list.useQuery({ page, search });

  return (
    <div className="flex flex-col gap-6">
      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder="Search quotes by opportunity…"
      />

      {quotes.isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {quotes.isError && <QueryError message="Couldn't load your quotes." onRetry={() => quotes.refetch()} />}

      {quotes.data?.items.length === 0 && (
        <EmptyState
          icon={FileText}
          title={search ? "No quotes match your search" : "No quotes yet"}
          description={
            search ? "Try a different search term." : "Create a quote from an opportunity's detail page to see it here."
          }
        />
      )}

      {quotes.data && quotes.data.items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Opportunity</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.data.items.map((quote) => (
              <TableRow key={quote.id}>
                <TableCell>
                  <Link href={`/quotes/${quote.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                    {quote.opportunityName}
                  </Link>
                </TableCell>
                <TableCell>
                  <Money value={quote.total} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(quote.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {quotes.data && (
        // 20 mirrors quoteService.PAGE_SIZE (lib/services/quote.ts) — not imported
        // directly since that module pulls in server-only DB code.
        <Pager page={page} pageSize={20} total={quotes.data.total} onPageChange={setPage} />
      )}
    </div>
  );
}
