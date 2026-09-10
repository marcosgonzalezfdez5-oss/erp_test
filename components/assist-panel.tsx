"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  entityType: "opportunity" | "account";
  entityId: string;
};

export function AssistPanel({ entityType, entityId }: Props) {
  const summaryKind = entityType === "opportunity" ? "opportunity_summary" : "account_summary";
  const utils = trpc.useUtils();

  const summaries = trpc.draft.list.useQuery({ entityId, kind: summaryKind, status: "active" });
  const summary = summaries.data?.[0];

  const generateSummary = trpc.draft.summarize.useMutation({
    onSuccess: () => {
      utils.draft.list.invalidate();
      toast.success("Summary ready");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Summary</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={generateSummary.isPending}
          onClick={() => generateSummary.mutate({ entityType, entityId })}
        >
          {generateSummary.isPending ? "Working…" : summary ? "Regenerate" : "Generate summary"}
        </Button>
      </div>

      {summaries.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : summary ? (
        <div className="flex flex-col gap-1">
          <p className="whitespace-pre-wrap text-sm text-foreground">{summary.body}</p>
          <p className="text-xs text-muted-foreground">
            {summary.model ? `Drafted by AI` : `Basic summary (AI unavailable)`}
            {summary.editedByUserId ? " · edited" : ""} · {new Date(summary.updatedAt).toLocaleString()}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No summary yet. Generate one from this {entityType}&apos;s activity and tasks.
        </p>
      )}

      {entityType === "opportunity" && <FollowUpEmail opportunityId={entityId} />}
    </section>
  );
}

function FollowUpEmail({ opportunityId }: { opportunityId: string }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");

  const sent = trpc.email.listSent.useQuery({ opportunityId });

  const draftEmail = trpc.draft.draftEmail.useMutation({
    onSuccess: (draft) => {
      setDraftId(draft.id);
      setSubject(draft.subject ?? "");
      setBody(draft.body);
      setOpen(true);
    },
    onError: (error) => toast.error(error.message),
  });

  const updateDraft = trpc.draft.update.useMutation({
    onSuccess: () => toast.success("Draft saved"),
    onError: (error) => toast.error(error.message),
  });

  const sendEmail = trpc.email.send.useMutation({
    onSuccess: () => {
      utils.email.listSent.invalidate({ opportunityId });
      toast.success("Email sent");
      setOpen(false);
    },
    onError: (error) => toast.error(error.message),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setInstructions("");
      setTo("");
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Follow-up email</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draftEmail.isPending}
          onClick={() => draftEmail.mutate({ opportunityId, instructions: instructions || undefined })}
        >
          {draftEmail.isPending ? "Drafting…" : "Draft follow-up email"}
        </Button>
      </div>

      {sent.data && sent.data.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {sent.data.map((message) => (
            <li key={message.id}>
              {message.status === "sent" ? "Sent" : message.status === "failed" ? "Failed" : "Queued"} to{" "}
              {message.toAddress} · {new Date(message.createdAt).toLocaleString()}
              {message.status === "failed" && message.error ? ` — ${message.error}` : ""}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Follow-up email</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assist-email-subject">Subject</Label>
              <Input
                id="assist-email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assist-email-body">Message</Label>
              <Textarea
                id="assist-email-body"
                className="min-h-40"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assist-email-to">Send to</Label>
              <Input
                id="assist-email-to"
                type="email"
                placeholder="name@company.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(`${subject}\n\n${body}`).then(
                  () => toast.success("Copied to clipboard"),
                  () => toast.error("Couldn't copy"),
                );
              }}
            >
              Copy
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!draftId || updateDraft.isPending || !body.trim()}
              onClick={() => draftId && updateDraft.mutate({ id: draftId, subject, body })}
            >
              Save draft
            </Button>
            <Button
              type="button"
              disabled={!draftId || sendEmail.isPending || !body.trim() || !subject.trim() || !to.trim()}
              onClick={() => draftId && sendEmail.mutate({ draftId, toAddress: to, subject, body })}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
