import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { LeadsList } from "./leads-list";

export default async function LeadsPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <h1 className="text-xl font-semibold">Leads</h1>
      <LeadsList />
    </div>
  );
}