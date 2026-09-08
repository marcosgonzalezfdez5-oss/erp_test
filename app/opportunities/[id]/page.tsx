import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { OpportunityDetail } from "./opportunity-detail";

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }
  const { id } = await params;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <OpportunityDetail opportunityId={id} />
    </div>
  );
}
