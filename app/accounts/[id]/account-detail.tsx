"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { CustomFieldsForm } from "@/components/custom-fields-form";

export function AccountDetail({ accountId }: { accountId: string }) {
  const utils = trpc.useUtils();
  const account = trpc.account.get.useQuery({ id: accountId });
  const contacts = trpc.contact.listByAccount.useQuery({ accountId });
  const createContact = trpc.contact.create.useMutation({
    onSuccess: () => utils.contact.listByAccount.invalidate({ accountId }),
  });
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  if (account.isLoading) {
    return <p>Loading…</p>;
  }
  if (!account.data) {
    return <p>Account not found.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{account.data.name}</h1>

      <CustomFieldsForm entityType="account" entityId={accountId} />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">Contacts</h2>
        <ul className="flex flex-col gap-1">
          {contacts.data?.map((contact) => (
            <li key={contact.id}>
              {contact.firstName} {contact.lastName}
            </li>
          ))}
          {contacts.data?.length === 0 && <li className="text-sm text-zinc-500">No contacts yet.</li>}
        </ul>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!firstName.trim() || !lastName.trim()) return;
          createContact.mutate({ accountId, firstName, lastName });
          setFirstName("");
          setLastName("");
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          First name
          <input
            className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Last name
          <input
            className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="self-start rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
          disabled={createContact.isPending}
        >
          Add contact
        </button>
      </form>
    </div>
  );
}
