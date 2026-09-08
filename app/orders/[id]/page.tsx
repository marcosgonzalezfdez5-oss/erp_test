import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/is-uuid";
import { OrderDetail } from "./order-detail";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
      <OrderDetail orderId={id} />
    </div>
  );
}
