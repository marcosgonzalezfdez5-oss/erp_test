import { Lock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePage } from "@/lib/auth/page-guard";
import { PipelineSettings } from "./pipeline-settings";

export default async function PipelineSettingsPage() {
  const { hasRole } = await requirePage(["admin", "sales_manager"]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Pipeline" description="Configure the stages opportunities move through." />
      {hasRole ? (
        <PipelineSettings />
      ) : (
        <EmptyState
          icon={Lock}
          title="Manager access required"
          description="Only admins and sales managers can configure pipeline stages."
        />
      )}
    </div>
  );
}
