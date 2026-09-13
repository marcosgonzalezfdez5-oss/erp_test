import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { PaymentsView } from "./payments-view";

export default async function PaymentsPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) redirect("/dashboard");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col">
      <PaymentsView />
    </div>
  );
}
