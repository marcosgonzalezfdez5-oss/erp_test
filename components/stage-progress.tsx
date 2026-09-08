import { cn } from "@/lib/utils";

export type StageProgressItem = {
  id: string;
  name: string;
  count?: number;
};

/**
 * Numbered horizontal stepper for pipeline stages — numbering is earned
 * here because stage order is a genuine sequence, not decorative (see
 * frontend design plan).
 */
export function StageProgress({ stages, className }: { stages: StageProgressItem[]; className?: string }) {
  return (
    <ol className={cn("flex items-start", className)}>
      {stages.map((stage, index) => (
        <li key={stage.id} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <span className="flex size-7 items-center justify-center rounded-full border-2 border-primary bg-primary/10 font-mono text-xs font-semibold text-primary">
              {index + 1}
            </span>
            <span className="max-w-20 text-xs font-medium text-foreground">{stage.name}</span>
            {stage.count !== undefined && (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{stage.count}</span>
            )}
          </div>
          {index < stages.length - 1 && <div className="mx-2 h-0.5 flex-1 bg-border" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}
