import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { resolveSessionContext } from "@/lib/auth/session";
import { ProductsList } from "./products-list";

export default async function ProductsPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }

  const session = await resolveSessionContext();
  const canManage = session?.role === "admin" || session?.role === "sales_manager";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Products" />
      <ProductsList canManage={canManage} />
    </div>
  );
}
