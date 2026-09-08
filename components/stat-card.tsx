import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border bg-card p-4", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-card-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
