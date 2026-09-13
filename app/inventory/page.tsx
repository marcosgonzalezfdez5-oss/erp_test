import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { resolveSessionContext } from "@/lib/auth/session";
import { InventoryView } from "./inventory-view";

export default async function InventoryPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) redirect("/dashboard");

  const session = await resolveSessionContext();
  const canManage = session?.role === "admin" || session?.role === "sales_manager";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col">
      <InventoryView canManage={canManage} />
    </div>
  );
}
