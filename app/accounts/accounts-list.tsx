"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EditDialog } from "@/components/edit-dialog";
import { EmptyState } from "@/components/empty-state";
import { FieldError } from "@/components/field-error";
import { Pager } from "@/components/pager";
import { QueryError } from "@/components/query-error";
import { SearchInput } from "@/components/search-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export function AccountsList() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const accounts = trpc.account.list.useQuery({ page, search });

  const createAccount = trpc.account.create.useMutation({
    onSuccess: () => {
      utils.account.list.invalidate();
      toast.success("Account created");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateAccount = trpc.account.update.useMutation({
    onSuccess: () => {
      utils.account.list.invalidate();
      setEditingId(null);
      toast.success("Account updated");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteAccount = trpc.account.delete.useMutation({
    onSuccess: () => {
      utils.account.list.invalidate();
      toast.success("Account deleted");
    },
    onError: (error) => toast.error(error.message),
  });

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) {
            setNameError("Enter a name.");
            return;
          }
          setNameError(null);
          createAccount.mutate({ name });
          setName("");
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="account-name">Name</Label>
          <Input
            id="account-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
          <FieldError message={nameError} />
        </div>
        <Button type="submit" className="mt-[26px]" disabled={createAccount.isPending}>
          Create account
        </Button>
      </form>

      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder="Search accounts…"
      />

      {accounts.isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {accounts.isError && <QueryError message="Couldn't load your accounts." onRetry={() => accounts.refetch()} />}

      {accounts.data?.items.length === 0 && (
        <EmptyState
          icon={Building2}
          title={search ? "No accounts match your search" : "No accounts yet"}
          description={search ? "Try a different search term." : "Create your first account to get started."}
        />
      )}

      {accounts.data && accounts.data.items.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {accounts.data.items.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <Link
                href={`/accounts/${account.id}`}
                className="text-sm font-medium text-foreground hover:text-primary hover:underline"
              >
                {account.name}
              </Link>
              <div className="flex shrink-0 gap-1">
                <EditDialog
                  trigger={
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${account.name}`}>
                      <Pencil />
                    </Button>
                  }
                  title="Edit account"
                  open={editingId === account.id}
                  onOpenChange={(open) => {
                    setEditingId(open ? account.id : null);
                    if (open) setEditName(account.name);
                  }}
                  pending={updateAccount.isPending}
                  onSubmit={() => {
                    if (!editName.trim()) return;
                    updateAccount.mutate({ id: account.id, name: editName });
                  }}
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`edit-account-name-${account.id}`}>Name</Label>
                    <Input
                      id={`edit-account-name-${account.id}`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                </EditDialog>
                <DeleteConfirmDialog
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${account.name}`}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  }
                  title={`Delete "${account.name}"?`}
                  description="This account will be removed from your active list. This won't delete its contacts."
                  pending={deleteAccount.isPending}
                  onConfirm={() => deleteAccount.mutate({ id: account.id })}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {accounts.data && (
        // 20 mirrors accountService.PAGE_SIZE (lib/services/account.ts) — not imported
        // directly since that module pulls in server-only DB code.
        <Pager page={page} pageSize={20} total={accounts.data.total} onPageChange={setPage} />
      )}
    </div>
  );
}
