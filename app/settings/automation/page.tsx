import { Lock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePage } from "@/lib/auth/page-guard";
import { AutomationRules } from "./automation-rules";

export default async function AutomationSettingsPage() {
  const { hasRole } = await requirePage(["admin", "sales_manager"]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader
        title="Automation"
        description="Have the ERP react to changes automatically. Anything consequential is proposed for your approval, not applied silently."
      />
      {hasRole ? (
        <AutomationRules />
      ) : (
        <EmptyState
          icon={Lock}
          title="Manager access required"
          description="Only admins and sales managers can configure automation."
        />
      )}
    </div>
  );
}
