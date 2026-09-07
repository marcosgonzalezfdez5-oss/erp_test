import { auth } from "@clerk/nextjs/server";
import { OrganizationList } from "@clerk/nextjs";
import { resolveSessionContext } from "@/lib/auth/session";
import { PipelineSummary } from "./pipeline-summary";

export default async function DashboardPage() {
  await auth.protect();
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16">
        <h1 className="text-xl font-semibold">Create or select an organization to continue</h1>
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p data-testid="session-role" className="text-sm text-zinc-500">
        Signed in as: {session?.role ?? "unknown"}
      </p>
      <PipelineSummary />
    </div>
  );
}
