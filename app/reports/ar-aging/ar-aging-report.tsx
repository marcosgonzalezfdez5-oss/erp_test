"use client";

import { formatMoney } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc/client";
import { ExportCsvButton } from "../report-controls";

const COLUMNS = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
  { key: "total", label: "Total" },
] as const;

export function ArAgingReport() {
  const query = trpc.report.arAging.useQuery({});

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AR aging"
        description={
          query.data
            ? `Outstanding as of ${new Date(query.data.asOf).toLocaleDateString()}.`
            : "Outstanding customer invoices by age."
        }
        action={<ExportCsvButton report="ar-aging" />}
      />

      {query.isLoading && <Skeleton className="h-40 w-full" />}
      {query.isError && <QueryError message="Couldn't load the aging report." onRetry={() => query.refetch()} />}

      {query.data && query.data.rows.length === 0 && (
        <EmptyState title="Nothing outstanding" description="Every issued invoice has been paid in full." />
      )}

      {query.data && query.data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                {COLUMNS.map((c) => (
                  <TableHead key={c.key} className="text-right">
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.map((row) => (
                <TableRow key={row.accountId ?? row.accountName}>
                  <TableCell className="font-medium text-foreground">{row.accountName}</TableCell>
                  {COLUMNS.map((c) => (
                    <TableCell key={c.key} className="text-right font-mono tabular-nums">
                      {formatMoney(row[c.key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium text-foreground">Total</TableCell>
                {COLUMNS.map((c) => (
                  <TableCell key={c.key} className="text-right font-mono font-medium tabular-nums">
                    {formatMoney(query.data.totals[c.key])}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
