"use client";

import { formatMoney } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc/client";
import { DateRangeFields, ExportCsvButton, useDateRange } from "../report-controls";

export function MarginReport() {
  const [range, setRange] = useDateRange();
  const query = trpc.report.margin.useQuery({
    from: range.from || undefined,
    to: range.to || undefined,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Margin"
        description="Revenue net of discount against snapshotted cost, over issued invoices and credit notes."
        action={<ExportCsvButton report="margin" params={{ from: range.from, to: range.to }} />}
      />

      <DateRangeFields range={range} onChange={setRange} />

      {query.isLoading && <Skeleton className="h-40 w-full" />}
      {query.isError && <QueryError message="Couldn't load the margin report." onRetry={() => query.refetch()} />}

      {query.data && query.data.rows.length === 0 && (
        <EmptyState title="No invoiced sales" description="Issue an invoice to see margin here." />
      )}

      {query.data && query.data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.map((row) => (
                <TableRow key={row.productId ?? row.productName}>
                  <TableCell className="font-medium text-foreground">{row.productName}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.revenue)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.cost)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.margin)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{row.marginPercent}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium text-foreground">Total</TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatMoney(query.data.totals.revenue)}
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatMoney(query.data.totals.cost)}
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatMoney(query.data.totals.margin)}
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {query.data.totals.marginPercent}%
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
