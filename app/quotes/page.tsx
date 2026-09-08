import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { QuotesList } from "./quotes-list";

export default async function QuotesPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Quotes" description="Every quote across your pipeline. Create new ones from an opportunity." />
      <QuotesList />
    </div>
  );
}
