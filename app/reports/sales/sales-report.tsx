"use client";

import { formatMoney } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc/client";
import { DateRangeFields, ExportCsvButton, useDateRange } from "../report-controls";

function treatmentLabel(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function SalesByTaxRateReport() {
  const [range, setRange] = useDateRange();
  const query = trpc.report.salesByTaxRate.useQuery({
    from: range.from || undefined,
    to: range.to || undefined,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sales by VAT rate"
        description="Taxable base and output VAT per rate — credit notes subtracted. Use this to fill in a VAT return."
        action={<ExportCsvButton report="sales" params={{ from: range.from, to: range.to }} />}
      />

      <DateRangeFields range={range} onChange={setRange} />

      {query.isLoading && <Skeleton className="h-40 w-full" />}
      {query.isError && <QueryError message="Couldn't load the sales report." onRetry={() => query.refetch()} />}

      {query.data && query.data.rows.length === 0 && (
        <EmptyState title="No issued invoices" description="Issue an invoice in this period to see VAT here." />
      )}

      {query.data && query.data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rate</TableHead>
                <TableHead>Treatment</TableHead>
                <TableHead className="text-right">Taxable base</TableHead>
                <TableHead className="text-right">Output VAT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.map((row) => (
                <TableRow key={`${row.taxRatePercent}-${row.taxTreatment}`}>
                  <TableCell className="font-mono tabular-nums">{row.taxRatePercent}%</TableCell>
                  <TableCell className="text-muted-foreground">{treatmentLabel(row.taxTreatment)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.base)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.tax)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium text-foreground">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatMoney(query.data.totals.base)}
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatMoney(query.data.totals.tax)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
