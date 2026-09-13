import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ShipmentsList } from "./shipments-list";

export default async function ShipmentsPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) redirect("/dashboard");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col">
      <ShipmentsList />
    </div>
  );
}
