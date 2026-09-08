import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/is-uuid";
import { AccountDetail } from "./account-detail";

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <AccountDetail accountId={id} />
    </div>
  );
}
