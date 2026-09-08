"use client";

import { useState } from "react";
import { Contact, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FieldError } from "@/components/field-error";
import { Pager } from "@/components/pager";
import { QueryError } from "@/components/query-error";
import { SearchInput } from "@/components/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export function LeadsList() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const leads = trpc.lead.list.useQuery({ page, search });

  const createLead = trpc.lead.create.useMutation({
    onSuccess: () => {
      utils.lead.list.invalidate();
      toast.success("Lead created");
    },
    onError: (error) => toast.error(error.message),
  });
  const convert = trpc.lead.convertToOpportunity.useMutation({
    onSuccess: () => {
      utils.lead.list.invalidate();
      utils.opportunity.list.invalidate();
      toast.success("Opportunity created");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteLead = trpc.lead.delete.useMutation({
    onSuccess: () => {
      utils.lead.list.invalidate();
      toast.success("Lead deleted");
    },
    onError: (error) => toast.error(error.message),
  });
  // No preemptive check for whether an unconvert would be blocked (it would
  // need an activity/task/quote count per row) — attempt it and surface the
  // server's explanation via toast on failure, same as every other mutation.
  const unconvert = trpc.lead.unconvert.useMutation({
    onSuccess: () => {
      utils.lead.list.invalidate();
      utils.opportunity.list.invalidate();
      toast.success("Conversion undone");
    },
    onError: (error) => toast.error(error.message),
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!firstName.trim() || !lastName.trim()) {
            setFormError("Enter a first and last name.");
            return;
          }
          setFormError(null);
          createLead.mutate({ firstName, lastName });
          setFirstName("");
          setLastName("");
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-first-name">First name</Label>
          <Input
            id="lead-first-name"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              setFormError(null);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-last-name">Last name</Label>
          <Input
            id="lead-last-name"
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              setFormError(null);
            }}
          />
        </div>
        <Button type="submit" className="mt-[26px]" disabled={createLead.isPending}>
          Create lead
        </Button>
      </form>
      <FieldError message={formError} />

      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder="Search leads…"
      />

      {leads.isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {leads.isError && <QueryError message="Couldn't load your leads." onRetry={() => leads.refetch()} />}

      {leads.data?.items.length === 0 && (
        <EmptyState
          icon={Contact}
          title={search ? "No leads match your search" : "No leads yet"}
          description={search ? "Try a different search term." : "Leads you create or import will show up here."}
        />
      )}

      {leads.data && leads.data.items.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {leads.data.items.map((lead) => {
            const name = `${lead.firstName} ${lead.lastName}`;
            return (
              <li key={lead.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="text-sm text-foreground">{name}</span>
                <div className="flex items-center gap-1">
                  {lead.convertedOpportunityId ? (
                    <>
                      <Badge variant="secondary">Converted</Badge>
                      <DeleteConfirmDialog
                        trigger={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Undo conversion for ${name}`}
                          >
                            <Undo2 />
                          </Button>
                        }
                        title={`Undo conversion for "${name}"?`}
                        description="This deletes the opportunity that was created and marks the lead unconverted again. Not possible once the opportunity has an activity, task, or quote."
                        confirmLabel="Undo conversion"
                        pending={unconvert.isPending}
                        onConfirm={() => unconvert.mutate({ id: lead.id })}
                      />
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={convert.isPending}
                      onClick={() => convert.mutate({ leadId: lead.id })}
                    >
                      Convert to Opportunity
                    </Button>
                  )}
                  <DeleteConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${name}`}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 />
                      </Button>
                    }
                    title={`Delete "${name}"?`}
                    description="This lead will be removed from your active list."
                    pending={deleteLead.isPending}
                    onConfirm={() => deleteLead.mutate({ id: lead.id })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {leads.data && (
        // 20 mirrors leadService.PAGE_SIZE (lib/services/lead.ts).
        <Pager page={page} pageSize={20} total={leads.data.total} onPageChange={setPage} />
      )}
    </div>
  );
}
