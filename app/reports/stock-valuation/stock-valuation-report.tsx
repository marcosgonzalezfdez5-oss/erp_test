"use client";

import { formatMoney } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc/client";
import { ExportCsvButton } from "../report-controls";

export function StockValuationReport() {
  const query = trpc.report.stockValuation.useQuery();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stock valuation"
        description="On-hand quantity valued at each product's current unit cost."
        action={<ExportCsvButton report="stock-valuation" />}
      />

      {query.isLoading && <Skeleton className="h-40 w-full" />}
      {query.isError && <QueryError message="Couldn't load the valuation." onRetry={() => query.refetch()} />}

      {query.data && query.data.rows.length === 0 && (
        <EmptyState title="No stock on hand" description="Receive stock into a warehouse to value it here." />
      )}

      {query.data && query.data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Warehouse</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.map((row) => (
                <TableRow key={`${row.warehouseId}-${row.productId}`}>
                  <TableCell className="text-muted-foreground">{row.warehouseName}</TableCell>
                  <TableCell className="font-medium text-foreground">{row.productName}</TableCell>
                  <TableCell className="text-muted-foreground">{row.sku ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{row.quantityOnHand}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.unitCost)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              {query.data.warehouseTotals.map((wt) => (
                <TableRow key={wt.warehouseName}>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    {wt.warehouseName} subtotal
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(wt.value)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={5} className="font-medium text-foreground">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatMoney(query.data.grandTotal)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
