"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { CustomFieldsForm } from "@/components/custom-fields-form";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EditDialog } from "@/components/edit-dialog";
import { FieldError } from "@/components/field-error";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function OpportunityDetail({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const opportunity = trpc.opportunity.get.useQuery({ id: opportunityId });
  const activities = trpc.activity.listByOpportunity.useQuery({ opportunityId });
  const tasks = trpc.task.listByOpportunity.useQuery({ opportunityId });
  const quotes = trpc.quote.listByOpportunity.useQuery({ opportunityId });
  const order = trpc.order.getByOpportunity.useQuery({ opportunityId });

  const createActivity = trpc.activity.create.useMutation({
    onSuccess: () => {
      utils.activity.listByOpportunity.invalidate({ opportunityId });
      toast.success("Activity added");
    },
    onError: (error) => toast.error(error.message),
  });
  const createTask = trpc.task.create.useMutation({
    onSuccess: () => {
      utils.task.listByOpportunity.invalidate({ opportunityId });
      toast.success("Task added");
    },
    onError: (error) => toast.error(error.message),
  });
  const setCompletion = trpc.task.setCompletion.useMutation({
    onSuccess: () => utils.task.listByOpportunity.invalidate({ opportunityId }),
    onError: (error) => toast.error(error.message),
  });
  const createQuote = trpc.quote.create.useMutation({
    onSuccess: () => {
      utils.quote.listByOpportunity.invalidate({ opportunityId });
      toast.success("Quote created");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateValue = trpc.opportunity.updateValue.useMutation({
    onSuccess: () => {
      setValueDraft(null);
      utils.opportunity.get.invalidate({ id: opportunityId });
      toast.success("Deal value saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateOpportunity = trpc.opportunity.update.useMutation({
    onSuccess: () => {
      utils.opportunity.get.invalidate({ id: opportunityId });
      setEditOpen(false);
      toast.success("Opportunity updated");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteOpportunity = trpc.opportunity.delete.useMutation({
    onSuccess: () => {
      toast.success("Opportunity deleted");
      router.push("/opportunities");
    },
    onError: (error) => toast.error(error.message),
  });

  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [valueDraft, setValueDraft] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editNameError, setEditNameError] = useState<string | null>(null);

  if (opportunity.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (opportunity.isError) {
    return <QueryError message="Couldn't load this opportunity." onRetry={() => opportunity.refetch()} />;
  }
  if (!opportunity.data) {
    return <EmptyState title="Opportunity not found" description="It may have been deleted or moved." />;
  }

  const savedValue = opportunity.data.value ?? "";
  const currentValueDraft = valueDraft ?? savedValue;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={opportunity.data.name}
        action={
          <div className="flex gap-2">
            <EditDialog
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <Pencil /> Edit
                </Button>
              }
              title="Edit opportunity"
              open={editOpen}
              onOpenChange={(open) => {
                setEditOpen(open);
                if (open) {
                  setEditName(opportunity.data.name);
                  setEditNameError(null);
                }
              }}
              pending={updateOpportunity.isPending}
              onSubmit={() => {
                if (!editName.trim()) {
                  setEditNameError("Enter a name.");
                  return;
                }
                updateOpportunity.mutate({ id: opportunityId, name: editName });
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-opportunity-name">Name</Label>
                <Input id="edit-opportunity-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                <FieldError message={editNameError} />
              </div>
            </EditDialog>
            <DeleteConfirmDialog
              trigger={
                <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 /> Delete
                </Button>
              }
              title={`Delete "${opportunity.data.name}"?`}
              description="This opportunity will be removed from your active pipeline, along with access to its activities, tasks, and quotes."
              pending={deleteOpportunity.isPending}
              onConfirm={() => deleteOpportunity.mutate({ id: opportunityId })}
            />
          </div>
        }
      />

      {order.data && (
        <Link
          href={`/orders/${order.data.id}`}
          data-testid="order-banner"
          className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success hover:bg-success/15"
        >
          Order created {new Date(order.data.createdAt).toLocaleDateString()} — view order
        </Link>
      )}

      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deal-value">Deal value</Label>
          <Input
            id="deal-value"
            type="number"
            min="0"
            step="0.01"
            className="w-40"
            value={currentValueDraft}
            onChange={(e) => setValueDraft(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={currentValueDraft === savedValue}
          onClick={() =>
            updateValue.mutate({
              id: opportunityId,
              value: currentValueDraft.trim() === "" ? null : Number(currentValueDraft),
            })
          }
        >
          Save
        </Button>
        {savedValue && (
          <span className="pb-2 text-sm text-muted-foreground">
            (<Money value={savedValue} />)
          </span>
        )}
      </div>

      <CustomFieldsForm entityType="opportunity" entityId={opportunityId} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Activities</h2>
        <ul className="flex flex-col gap-1.5">
          {activities.data?.map((activity) => (
            <li key={activity.id} className="text-sm">
              <span className="text-xs text-muted-foreground">{activity.type}</span> — {activity.note}
            </li>
          ))}
          {activities.data?.length === 0 && <li className="text-sm text-muted-foreground">No activities yet.</li>}
        </ul>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) {
              setNoteError("Enter a note.");
              return;
            }
            setNoteError(null);
            createActivity.mutate({ opportunityId, type: "note", note });
            setNote("");
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="activity-note">Note</Label>
            <Input
              id="activity-note"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError(null);
              }}
            />
            <FieldError message={noteError} />
          </div>
          <Button type="submit">Add activity</Button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Tasks</h2>
        <ul className="flex flex-col gap-2">
          {tasks.data?.map((task) => (
            <li key={task.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label={`Complete ${task.title}`}
                checked={Boolean(task.completedAt)}
                onCheckedChange={(checked) => setCompletion.mutate({ id: task.id, completed: checked === true })}
              />
              <span className={cn(task.completedAt && "text-muted-foreground line-through")}>{task.title}</span>
            </li>
          ))}
          {tasks.data?.length === 0 && <li className="text-sm text-muted-foreground">No tasks yet.</li>}
        </ul>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!taskTitle.trim()) {
              setTaskError("Enter a task title.");
              return;
            }
            setTaskError(null);
            createTask.mutate({ opportunityId, title: taskTitle });
            setTaskTitle("");
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="task-title">Task title</Label>
            <Input
              id="task-title"
              value={taskTitle}
              onChange={(e) => {
                setTaskTitle(e.target.value);
                setTaskError(null);
              }}
            />
            <FieldError message={taskError} />
          </div>
          <Button type="submit">Add task</Button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Quotes</h2>
        <ul className="flex flex-col gap-1.5">
          {quotes.data?.map((quote, index) => (
            <li key={quote.id} className="text-sm">
              <Link href={`/quotes/${quote.id}`} className="text-primary hover:underline">
                Quote #{index + 1}
              </Link>
            </li>
          ))}
          {quotes.data?.length === 0 && <li className="text-sm text-muted-foreground">No quotes yet.</li>}
        </ul>
        <Button type="button" variant="outline" className="w-fit" disabled={createQuote.isPending} onClick={() => createQuote.mutate({ opportunityId })}>
          Create quote
        </Button>
      </section>
    </div>
  );
}
