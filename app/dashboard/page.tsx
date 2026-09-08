import { auth } from "@clerk/nextjs/server";
import { OrganizationList } from "@clerk/nextjs";
import { resolveSessionContext } from "@/lib/auth/session";
import { PageHeader } from "@/components/page-header";
import { PipelineSummary } from "./pipeline-summary";

export default async function DashboardPage() {
  await auth.protect();
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Create or select an organization to continue
        </h1>
        <OrganizationList
          hidePersonal
          afterCreateOrganizationUrl="/dashboard"
          afterSelectOrganizationUrl="/dashboard"
        />
      </div>
    );
  }

  const session = await resolveSessionContext();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={
          <span data-testid="session-role">Signed in as: {session?.role ?? "unknown"}</span>
        }
      />
      <PipelineSummary />
    </div>
  );
}
