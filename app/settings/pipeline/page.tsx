import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PipelineSettings } from "./pipeline-settings";

export default async function PipelineSettingsPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Pipeline" description="Configure the stages opportunities move through." />
      <PipelineSettings />
    </div>
  );
}
