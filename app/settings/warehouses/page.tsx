import { Lock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePage } from "@/lib/auth/page-guard";
import { WarehousesList } from "./warehouses-list";

export default async function WarehousesSettingsPage() {
  const { hasRole } = await requirePage(["admin", "sales_manager"]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Warehouses" description="The locations you hold stock in and fulfil orders from." />
      {hasRole ? (
        <WarehousesList />
      ) : (
        <EmptyState
          icon={Lock}
          title="Manager access required"
          description="Only admins and sales managers can manage warehouses."
        />
      )}
    </div>
  );
}
