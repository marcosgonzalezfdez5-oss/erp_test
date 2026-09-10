import { Lock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePage } from "@/lib/auth/page-guard";
import { SetupWizard } from "./setup-wizard";

export default async function SetupPage() {
  const { hasRole } = await requirePage(["admin", "sales_manager"]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader
        title="Guided setup"
        description="Upload a sample of your existing data and we'll suggest pipeline stages and custom fields to match how you work."
      />
      {hasRole ? (
        <SetupWizard />
      ) : (
        <EmptyState
          icon={Lock}
          title="Manager access required"
          description="Only admins and sales managers can run guided setup."
        />
      )}
    </div>
  );
}
