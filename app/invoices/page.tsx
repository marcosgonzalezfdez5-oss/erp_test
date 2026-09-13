import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { InvoicesList } from "./invoices-list";

export default async function InvoicesPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) redirect("/dashboard");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col">
      <InvoicesList />
    </div>
  );
}
