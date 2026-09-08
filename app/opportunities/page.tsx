import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { OpportunitiesBoard } from "./opportunities-list";

export default async function OpportunitiesPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Opportunities" />
      <OpportunitiesBoard />
    </div>
  );
}
