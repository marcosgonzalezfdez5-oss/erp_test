import { Lock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requirePage } from "@/lib/auth/page-guard";
import { SalesByTaxRateReport } from "./sales-report";

export default async function SalesReportPage() {
  const { hasRole } = await requirePage(["admin", "sales_manager"]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      {hasRole ? (
        <SalesByTaxRateReport />
      ) : (
        <EmptyState icon={Lock} title="Manager access required" description="Only admins and sales managers can view reports." />
      )}
    </div>
  );
}
