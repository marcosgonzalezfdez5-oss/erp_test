"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface DateRange {
  from: string;
  to: string;
}

/** A plain from/to pair backed by native date inputs — no calendar widget. */
export function useDateRange(): [DateRange, (next: Partial<DateRange>) => void] {
  const [range, setRange] = useState<DateRange>({ from: "", to: "" });
  return [range, (next) => setRange((r) => ({ ...r, ...next }))];
}

export function DateRangeFields({
  range,
  onChange,
}: {
  range: DateRange;
  onChange: (next: Partial<DateRange>) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-from">From</Label>
        <Input
          id="report-from"
          type="date"
          className="w-40"
          value={range.from}
          max={range.to || undefined}
          onChange={(e) => onChange({ from: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-to">To</Label>
        <Input
          id="report-to"
          type="date"
          className="w-40"
          value={range.to}
          min={range.from || undefined}
          onChange={(e) => onChange({ to: e.target.value })}
        />
      </div>
      {(range.from || range.to) && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ from: "", to: "" })}>
          Clear
        </Button>
      )}
    </div>
  );
}

export function ExportCsvButton({ report, params }: { report: string; params?: Record<string, string> }) {
  const query = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v));
  const href = `/api/reports/${report}/csv${query.toString() ? `?${query}` : ""}`;
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} download>
        <Download data-icon="inline-start" />
        Export CSV
      </a>
    </Button>
  );
}
