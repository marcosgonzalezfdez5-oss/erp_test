"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";

export function AccountsList() {
  const utils = trpc.useUtils();
  const accounts = trpc.account.list.useQuery();
  const createAccount = trpc.account.create.useMutation({
    onSuccess: () => utils.account.list.invalidate(),
  });
  const [name, setName] = useState("");

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          createAccount.mutate({ name });
          setName("");
        }}
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Name
          <input
            className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
          disabled={createAccount.isPending}
        >
          Create account
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {accounts.data?.map((account) => (
          <li key={account.id}>
            <Link href={`/accounts/${account.id}`} className="underline">
              {account.name}
            </Link>
          </li>
        ))}
        {accounts.data?.length === 0 && <li className="text-sm text-zinc-500">No accounts yet.</li>}
      </ul>
    </div>
  );
}
