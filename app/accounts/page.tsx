import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { AccountsList } from "./accounts-list";

export default async function AccountsPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Accounts" />
      <AccountsList />
    </div>
  );
}
