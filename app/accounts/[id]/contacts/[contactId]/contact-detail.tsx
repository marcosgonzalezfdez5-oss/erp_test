"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EditDialog } from "@/components/edit-dialog";
import { EmptyState } from "@/components/empty-state";
import { FieldError } from "@/components/field-error";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export function ContactDetail({ contactId }: { contactId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const contact = trpc.contact.get.useQuery({ id: contactId });

  const updateContact = trpc.contact.update.useMutation({
    onSuccess: () => {
      utils.contact.get.invalidate({ id: contactId });
      setEditOpen(false);
      toast.success("Contact updated");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteContact = trpc.contact.delete.useMutation({
    onSuccess: (deleted) => {
      toast.success("Contact deleted");
      router.push(`/accounts/${deleted.accountId}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  if (contact.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (contact.isError) {
    return <QueryError message="Couldn't load this contact." onRetry={() => contact.refetch()} />;
  }
  if (!contact.data) {
    return <EmptyState title="Contact not found" description="It may have been deleted." />;
  }

  const data = contact.data;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/accounts/${data.accountId}`}
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to account
      </Link>

      <PageHeader
        title={`${data.firstName} ${data.lastName}`}
        action={
          <div className="flex gap-2">
            <EditDialog
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <Pencil /> Edit
                </Button>
              }
              title="Edit contact"
              open={editOpen}
              onOpenChange={(open) => {
                setEditOpen(open);
                if (open) {
                  setEditFirstName(data.firstName);
                  setEditLastName(data.lastName);
                  setEditEmail(data.email ?? "");
                  setEditPhone(data.phone ?? "");
                  setEditError(null);
                }
              }}
              pending={updateContact.isPending}
              onSubmit={() => {
                if (!editFirstName.trim() || !editLastName.trim()) {
                  setEditError("Enter a first and last name.");
                  return;
                }
                updateContact.mutate({
                  id: contactId,
                  firstName: editFirstName,
                  lastName: editLastName,
                  email: editEmail.trim() || undefined,
                  phone: editPhone.trim() || undefined,
                });
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-contact-first-name">First name</Label>
                <Input
                  id="edit-contact-first-name"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-contact-last-name">Last name</Label>
                <Input
                  id="edit-contact-last-name"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-contact-email">Email</Label>
                <Input
                  id="edit-contact-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-contact-phone">Phone</Label>
                <Input id="edit-contact-phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
              </div>
              <FieldError message={editError} />
            </EditDialog>
            <DeleteConfirmDialog
              trigger={
                <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 /> Delete
                </Button>
              }
              title={`Delete "${data.firstName} ${data.lastName}"?`}
              description="This contact will be removed from the account."
              pending={deleteContact.isPending}
              onConfirm={() => deleteContact.mutate({ id: contactId })}
            />
          </div>
        }
      />

      <dl className="grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Email</dt>
        <dd className="text-foreground">{data.email || "—"}</dd>
        <dt className="text-muted-foreground">Phone</dt>
        <dd className="text-foreground">{data.phone || "—"}</dd>
      </dl>
    </div>
  );
}
