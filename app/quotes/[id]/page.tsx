import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { QuoteDetail } from "./quote-detail";

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }
  const { id } = await params;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <QuoteDetail quoteId={id} />
    </div>
  );
}
