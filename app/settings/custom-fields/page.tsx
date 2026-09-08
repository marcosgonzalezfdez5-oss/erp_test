import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { CustomFieldsSettings } from "./custom-fields-settings";

export default async function CustomFieldsSettingsPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Custom fields" description="Define tenant-specific fields for accounts and opportunities." />
      <CustomFieldsSettings />
    </div>
  );
}
