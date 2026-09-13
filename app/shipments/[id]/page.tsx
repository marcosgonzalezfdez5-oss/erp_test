import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/is-uuid";
import { resolveSessionContext } from "@/lib/auth/session";
import { ShipmentDetail } from "./shipment-detail";

export default async function ShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) redirect("/dashboard");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const session = await resolveSessionContext();
  const canManage = session?.role === "admin" || session?.role === "sales_manager";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col">
      <ShipmentDetail shipmentId={id} canManage={canManage} />
    </div>
  );
}
