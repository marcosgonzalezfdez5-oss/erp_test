"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FieldError } from "@/components/field-error";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type Trigger = "opportunity_stage_changed" | "opportunity_created" | "opportunity_idle";
type Action = "create_task" | "propose_opportunity_stage_change" | "draft_follow_up_email";
type StageKind = "" | "open" | "won" | "lost";

const TRIGGER_LABEL: Record<Trigger, string> = {
  opportunity_stage_changed: "An opportunity changes stage",
  opportunity_created: "An opportunity is created",
  opportunity_idle: "An opportunity goes quiet",
};

const ACTION_LABEL: Record<Action, string> = {
  create_task: "Create a task",
  propose_opportunity_stage_change: "Propose moving it to a stage",
  draft_follow_up_email: "Draft a follow-up email",
};

const selectClassName =
  "h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function AutomationRules() {
  const utils = trpc.useUtils();
  const rules = trpc.automation.listRules.useQuery();
  const runs = trpc.automation.listRuns.useQuery(undefined);
  const stages = trpc.pipeline.list.useQuery();

  const createRule = trpc.automation.createRule.useMutation({
    onSuccess: () => {
      utils.automation.listRules.invalidate();
      toast.success("Automation rule created");
      resetForm();
    },
    onError: (error) => toast.error(error.message),
  });
  const setEnabled = trpc.automation.setEnabled.useMutation({
    onSuccess: () => utils.automation.listRules.invalidate(),
    onError: (error) => toast.error(error.message),
  });
  const deleteRule = trpc.automation.deleteRule.useMutation({
    onSuccess: () => {
      utils.automation.listRules.invalidate();
      toast.success("Automation rule deleted");
    },
    onError: (error) => toast.error(error.message),
  });

  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("opportunity_stage_changed");
  const [toStageKind, setToStageKind] = useState<StageKind>("");
  const [idleDays, setIdleDays] = useState("7");
  const [action, setAction] = useState<Action>("create_task");
  const [taskTitle, setTaskTitle] = useState("");
  const [targetStageId, setTargetStageId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setToStageKind("");
    setIdleDays("7");
    setTaskTitle("");
    setTargetStageId("");
    setFormError(null);
  }

  function submit() {
    if (!name.trim()) {
      setFormError("Give the rule a name.");
      return;
    }
    if (action === "create_task" && !taskTitle.trim()) {
      setFormError("Enter the task title to create.");
      return;
    }
    if (action === "propose_opportunity_stage_change" && !targetStageId) {
      setFormError("Choose the stage to propose.");
      return;
    }

    const actionConfig =
      action === "create_task"
        ? { title: taskTitle.trim() }
        : action === "propose_opportunity_stage_change"
          ? { targetStageId }
          : {};

    if (trigger === "opportunity_idle") {
      const days = Number(idleDays);
      if (!Number.isInteger(days) || days < 1) {
        setFormError("Enter a whole number of days.");
        return;
      }
      createRule.mutate({
        trigger,
        name: name.trim(),
        conditions: { idleDays: days, ...(toStageKind ? { stageKind: toStageKind } : {}) },
        action,
        actionConfig,
      });
      return;
    }

    if (trigger === "opportunity_stage_changed") {
      createRule.mutate({
        trigger,
        name: name.trim(),
        conditions: toStageKind ? { toStageKind } : {},
        action,
        actionConfig,
      });
      return;
    }

    createRule.mutate({ trigger, name: name.trim(), conditions: {}, action, actionConfig });
  }

  const previewStage = stages.data?.find((s) => s.id === targetStageId)?.name;
  const preview = `When ${TRIGGER_LABEL[trigger].toLowerCase()}${
    trigger === "opportunity_stage_changed" && toStageKind ? ` to a ${toStageKind} stage` : ""
  }${trigger === "opportunity_idle" ? ` for ${idleDays || "?"} days` : ""}, ${ACTION_LABEL[action].toLowerCase()}${
    action === "create_task" && taskTitle ? ` "${taskTitle}"` : ""
  }${action === "propose_opportunity_stage_change" && previewStage ? ` (${previewStage})` : ""}.`;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">Your rules</h2>
        {rules.isLoading && <Skeleton className="h-16 w-full" />}
        {rules.isError && <QueryError message="Couldn't load automation rules." onRetry={() => rules.refetch()} />}
        {rules.data?.length === 0 && (
          <EmptyState title="No automation rules yet" description="Create one below to have the ERP react to changes for you." />
        )}
        {rules.data && rules.data.length > 0 && (
          <ul className="flex flex-col divide-y rounded-md border">
            {rules.data.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{rule.name}</span>
                  <span className="text-xs text-muted-foreground">
                    When {TRIGGER_LABEL[rule.trigger as Trigger].toLowerCase()}, {ACTION_LABEL[rule.action as Action].toLowerCase()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEnabled.mutate({ id: rule.id, enabled: !rule.enabled })}
                  >
                    {rule.enabled ? "On" : "Off"}
                  </Button>
                  <DeleteConfirmDialog
                    trigger={
                      <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive">
                        Delete
                      </Button>
                    }
                    title={`Delete "${rule.name}"?`}
                    description="This rule stops running. Runs it already produced are kept."
                    pending={deleteRule.isPending}
                    onConfirm={() => deleteRule.mutate({ id: rule.id })}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">New rule</h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-name">Name</Label>
          <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-trigger">When…</Label>
          <select
            id="rule-trigger"
            className={selectClassName}
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as Trigger)}
          >
            {(Object.keys(TRIGGER_LABEL) as Trigger[]).map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        {trigger === "opportunity_stage_changed" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-stage-kind">Only when the new stage is</Label>
            <select
              id="rule-stage-kind"
              className={selectClassName}
              value={toStageKind}
              onChange={(e) => setToStageKind(e.target.value as StageKind)}
            >
              <option value="">Any stage</option>
              <option value="open">An open stage</option>
              <option value="won">The won stage</option>
              <option value="lost">The lost stage</option>
            </select>
          </div>
        )}

        {trigger === "opportunity_idle" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-idle-days">Days without activity</Label>
            <Input
              id="rule-idle-days"
              type="number"
              min="1"
              className="w-28"
              value={idleDays}
              onChange={(e) => setIdleDays(e.target.value)}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-action">Then…</Label>
          <select
            id="rule-action"
            className={selectClassName}
            value={action}
            onChange={(e) => setAction(e.target.value as Action)}
          >
            {(Object.keys(ACTION_LABEL) as Action[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </div>

        {action === "create_task" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-task-title">Task title</Label>
            <Input id="rule-task-title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
          </div>
        )}

        {action === "propose_opportunity_stage_change" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-target-stage">Stage to propose</Label>
            <select
              id="rule-target-stage"
              className={selectClassName}
              value={targetStageId}
              onChange={(e) => setTargetStageId(e.target.value)}
            >
              <option value="">Choose a stage…</option>
              {stages.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="text-sm text-muted-foreground">{preview}</p>
        <FieldError message={formError} />
        <Button type="button" className="w-fit" disabled={createRule.isPending} onClick={submit}>
          Create rule
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">Recent activity</h2>
        {runs.isLoading && <Skeleton className="h-12 w-full" />}
        {runs.data?.length === 0 && <p className="text-sm text-muted-foreground">Nothing has run yet.</p>}
        {runs.data && runs.data.length > 0 && (
          <ul className="flex flex-col divide-y rounded-md border text-sm">
            {runs.data.map((run) => (
              <li key={run.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-foreground">{run.status}</span>
                <span className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
