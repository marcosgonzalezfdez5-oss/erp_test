"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { AssistPanel } from "@/components/assist-panel";
import { CustomFieldsForm } from "@/components/custom-fields-form";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EditDialog } from "@/components/edit-dialog";
import { FieldError } from "@/components/field-error";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { isNotFoundError } from "@/lib/trpc/is-not-found";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export function AccountDetail({ accountId }: { accountId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const account = trpc.account.get.useQuery({ id: accountId });
  const contacts = trpc.contact.listByAccount.useQuery({ accountId });
  const createContact = trpc.contact.create.useMutation({
    onSuccess: () => {
      utils.contact.listByAccount.invalidate({ accountId });
      toast.success("Contact added");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateAccount = trpc.account.update.useMutation({
    onSuccess: () => {
      utils.account.get.invalidate({ id: accountId });
      setEditOpen(false);
      toast.success("Account updated");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteAccount = trpc.account.delete.useMutation({
    onSuccess: () => {
      toast.success("Account deleted");
      router.push("/accounts");
    },
    onError: (error) => toast.error(error.message),
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");

  if (account.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (account.isError) {
    if (isNotFoundError(account.error)) {
      return <EmptyState title="Account not found" description="It may have been deleted." />;
    }
    return <QueryError message="Couldn't load this account." onRetry={() => account.refetch()} />;
  }
  if (!account.data) {
    // Unreachable: account.get throws NOT_FOUND for a missing row. Kept for
    // TypeScript narrowing of account.data below.
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={account.data.name}
        action={
          <div className="flex gap-2">
            <EditDialog
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <Pencil /> Edit
                </Button>
              }
              title="Edit account"
              open={editOpen}
              onOpenChange={(open) => {
                setEditOpen(open);
                if (open) setEditName(account.data.name);
              }}
              pending={updateAccount.isPending}
              onSubmit={() => {
                if (!editName.trim()) return;
                updateAccount.mutate({ id: accountId, name: editName });
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-account-detail-name">Name</Label>
                <Input id="edit-account-detail-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
            </EditDialog>
            <DeleteConfirmDialog
              trigger={
                <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 /> Delete
                </Button>
              }
              title={`Delete "${account.data.name}"?`}
              description="This account will be removed from your active list. This won't delete its contacts."
              pending={deleteAccount.isPending}
              onConfirm={() => deleteAccount.mutate({ id: accountId })}
            />
          </div>
        }
      />

      <CustomFieldsForm entityType="account" entityId={accountId} />

      <AssistPanel entityType="account" entityId={accountId} />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Contacts</h2>
        <ul className="flex flex-col gap-1">
          {contacts.data?.map((contact) => (
            <li key={contact.id}>
              <Link
                href={`/accounts/${accountId}/contacts/${contact.id}`}
                className="text-sm text-foreground hover:text-primary hover:underline"
              >
                {contact.firstName} {contact.lastName}
              </Link>
            </li>
          ))}
          {contacts.data?.length === 0 && <li className="text-sm text-muted-foreground">No contacts yet.</li>}
        </ul>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!firstName.trim() || !lastName.trim()) {
            setContactError("Enter a first and last name.");
            return;
          }
          setContactError(null);
          createContact.mutate({ accountId, firstName, lastName });
          setFirstName("");
          setLastName("");
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-first-name">First name</Label>
          <Input
            id="contact-first-name"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              setContactError(null);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-last-name">Last name</Label>
          <Input
            id="contact-last-name"
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              setContactError(null);
            }}
          />
        </div>
        <FieldError message={contactError} />
        <Button type="submit" className="self-start" disabled={createContact.isPending}>
          Add contact
        </Button>
      </form>
    </div>
  );
}
