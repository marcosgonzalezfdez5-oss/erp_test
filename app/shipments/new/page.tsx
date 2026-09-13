import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Skeleton } from "@/components/ui/skeleton";
import { NewShipment } from "./new-shipment";

export default async function NewShipmentPage() {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) redirect("/dashboard");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <NewShipment />
      </Suspense>
    </div>
  );
}
