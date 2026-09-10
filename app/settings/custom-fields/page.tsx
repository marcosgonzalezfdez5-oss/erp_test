import { Lock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePage } from "@/lib/auth/page-guard";
import { CustomFieldsSettings } from "./custom-fields-settings";

export default async function CustomFieldsSettingsPage() {
  const { hasRole } = await requirePage(["admin", "sales_manager"]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Custom fields" description="Define tenant-specific fields for accounts and opportunities." />
      {hasRole ? (
        <CustomFieldsSettings />
      ) : (
        <EmptyState
          icon={Lock}
          title="Manager access required"
          description="Only admins and sales managers can define custom fields."
        />
      )}
    </div>
  );
}
