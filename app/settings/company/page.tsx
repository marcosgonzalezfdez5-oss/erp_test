import { Lock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePage } from "@/lib/auth/page-guard";
import { CompanySettings } from "./company-settings";

export default async function CompanySettingsPage() {
  const { hasRole } = await requirePage(["admin", "sales_manager"]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Company" description="Your legal identity, tax defaults, and document numbering." />
      {hasRole ? (
        <CompanySettings />
      ) : (
        <EmptyState
          icon={Lock}
          title="Manager access required"
          description="Only admins and sales managers can change company settings."
        />
      )}
    </div>
  );
}
