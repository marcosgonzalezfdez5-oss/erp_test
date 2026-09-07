import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { OpportunitiesBoard } from "./opportunities-list";

export default async function OpportunitiesPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
      <h1 className="text-xl font-semibold">Opportunities</h1>
      <OpportunitiesBoard />
    </div>
  );
}
