import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/is-uuid";
import { ContactDetail } from "./contact-detail";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string; contactId: string }> }) {
  await auth.protect();
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/dashboard");
  }
  const { id, contactId } = await params;
  if (!isUuid(id) || !isUuid(contactId)) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <ContactDetail contactId={contactId} />
    </div>
  );
}
