"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { CustomFieldsForm } from "@/components/custom-fields-form";

export function OpportunityDetail({ opportunityId }: { opportunityId: string }) {
  const utils = trpc.useUtils();
  const opportunity = trpc.opportunity.get.useQuery({ id: opportunityId });
  const activities = trpc.activity.listByOpportunity.useQuery({ opportunityId });
  const tasks = trpc.task.listByOpportunity.useQuery({ opportunityId });
  const quotes = trpc.quote.listByOpportunity.useQuery({ opportunityId });
  const order = trpc.order.getByOpportunity.useQuery({ opportunityId });

  const createActivity = trpc.activity.create.useMutation({
    onSuccess: () => utils.activity.listByOpportunity.invalidate({ opportunityId }),
  });
  const createTask = trpc.task.create.useMutation({
    onSuccess: () => utils.task.listByOpportunity.invalidate({ opportunityId }),
  });
  const setCompletion = trpc.task.setCompletion.useMutation({
    onSuccess: () => utils.task.listByOpportunity.invalidate({ opportunityId }),
  });
  const createQuote = trpc.quote.create.useMutation({
    onSuccess: () => utils.quote.listByOpportunity.invalidate({ opportunityId }),
  });
  const updateValue = trpc.opportunity.updateValue.useMutation({
    onSuccess: () => {
      setValueDraft(null);
      utils.opportunity.get.invalidate({ id: opportunityId });
    },
  });

  const [note, setNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [valueDraft, setValueDraft] = useState<string | null>(null);

  if (opportunity.isLoading) {
    return <p>Loading…</p>;
  }
  if (!opportunity.data) {
    return <p>Opportunity not found.</p>;
  }

  const savedValue = opportunity.data.value ?? "";
  const currentValueDraft = valueDraft ?? savedValue;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">{opportunity.data.name}</h1>

      {order.data && (
        <p className="rounded border border-black/10 px-3 py-2 text-sm dark:border-white/20" data-testid="order-banner">
          Order created {new Date(order.data.createdAt).toLocaleDateString()}
        </p>
      )}

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Deal value
          <input
            type="number"
            min="0"
            step="0.01"
            className="w-40 rounded border border-black/10 px-3 py-2 dark:border-white/20"
            value={currentValueDraft}
            onChange={(e) => setValueDraft(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded border border-black/10 px-3 py-2 text-sm disabled:opacity-50 dark:border-white/20"
          disabled={currentValueDraft === savedValue}
          onClick={() =>
            updateValue.mutate({
              id: opportunityId,
              value: currentValueDraft.trim() === "" ? null : Number(currentValueDraft),
            })
          }
        >
          Save
        </button>
      </div>

      <CustomFieldsForm entityType="opportunity" entityId={opportunityId} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">Activities</h2>
        <ul className="flex flex-col gap-1">
          {activities.data?.map((activity) => (
            <li key={activity.id} className="text-sm">
              <span className="text-xs text-zinc-500">{activity.type}</span> — {activity.note}
            </li>
          ))}
          {activities.data?.length === 0 && <li className="text-sm text-zinc-500">No activities yet.</li>}
        </ul>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            createActivity.mutate({ opportunityId, type: "note", note });
            setNote("");
          }}
        >
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Note
            <input
              className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button type="submit" className="rounded bg-foreground px-4 py-2 text-background">
            Add activity
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">Tasks</h2>
        <ul className="flex flex-col gap-1">
          {tasks.data?.map((task) => (
            <li key={task.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`Complete ${task.title}`}
                checked={Boolean(task.completedAt)}
                onChange={(e) => setCompletion.mutate({ id: task.id, completed: e.target.checked })}
              />
              <span className={task.completedAt ? "text-zinc-500 line-through" : ""}>{task.title}</span>
            </li>
          ))}
          {tasks.data?.length === 0 && <li className="text-sm text-zinc-500">No tasks yet.</li>}
        </ul>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!taskTitle.trim()) return;
            createTask.mutate({ opportunityId, title: taskTitle });
            setTaskTitle("");
          }}
        >
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Task title
            <input
              className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
          </label>
          <button type="submit" className="rounded bg-foreground px-4 py-2 text-background">
            Add task
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">Quotes</h2>
        <ul className="flex flex-col gap-1">
          {quotes.data?.map((quote, index) => (
            <li key={quote.id} className="text-sm">
              <Link href={`/quotes/${quote.id}`} className="underline">
                Quote #{index + 1}
              </Link>
            </li>
          ))}
          {quotes.data?.length === 0 && <li className="text-sm text-zinc-500">No quotes yet.</li>}
        </ul>
        <button
          type="button"
          className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
          disabled={createQuote.isPending}
          onClick={() => createQuote.mutate({ opportunityId })}
        >
          Create quote
        </button>
      </section>
    </div>
  );
}
