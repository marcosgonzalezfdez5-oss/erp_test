import Link from "next/link";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePage } from "@/lib/auth/page-guard";

const REPORTS = [
  {
    href: "/reports/ar-aging",
    title: "AR aging",
    description: "Outstanding customer invoices bucketed by how far past due they are.",
  },
  {
    href: "/reports/stock-valuation",
    title: "Stock valuation",
    description: "On-hand quantity at unit cost, by warehouse and product.",
  },
  {
    href: "/reports/margin",
    title: "Margin",
    description: "Revenue against snapshotted cost per product, over issued invoices.",
  },
  {
    href: "/reports/sales",
    title: "Sales by VAT rate",
    description: "Taxable base and output VAT grouped by rate — the input for a VAT return.",
  },
];

export default async function ReportsPage() {
  const { hasRole } = await requirePage(["admin", "sales_manager"]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Reports" description="Point-in-time figures pulled straight from your orders, stock, and invoices." />
      {hasRole ? (
        <ul className="flex flex-col divide-y rounded-md border">
          {REPORTS.map((report) => (
            <li key={report.href}>
              <Link href={report.href} className="flex flex-col gap-0.5 px-4 py-3.5 hover:bg-muted/50">
                <span className="font-medium text-foreground">{report.title}</span>
                <span className="text-sm text-muted-foreground">{report.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Lock}
          title="Manager access required"
          description="Only admins and sales managers can view reports."
        />
      )}
    </div>
  );
}
