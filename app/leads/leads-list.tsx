"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

export function LeadsList() {
  const utils = trpc.useUtils();
  const leads = trpc.lead.list.useQuery();
  const createLead = trpc.lead.create.useMutation({
    onSuccess: () => utils.lead.list.invalidate(),
  });
  const convert = trpc.lead.convertToOpportunity.useMutation({
    onSuccess: () => {
      utils.lead.list.invalidate();
      utils.opportunity.list.invalidate();
    },
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!firstName.trim() || !lastName.trim()) return;
          createLead.mutate({ firstName, lastName });
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
          className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
          disabled={createLead.isPending}
        >
          Create lead
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {leads.data?.map((lead) => (
          <li key={lead.id} className="flex items-center gap-3">
            <span>
              {lead.firstName} {lead.lastName}
            </span>
            {lead.convertedOpportunityId ? (
              <span className="text-xs text-zinc-500">Converted</span>
            ) : (
              <button
                type="button"
                className="text-sm underline disabled:opacity-50"
                disabled={convert.isPending}
                onClick={() => convert.mutate({ leadId: lead.id })}
              >
                Convert to Opportunity
              </button>
            )}
          </li>
        ))}
        {leads.data?.length === 0 && <li className="text-sm text-zinc-500">No leads yet.</li>}
      </ul>
    </div>
  );
}
