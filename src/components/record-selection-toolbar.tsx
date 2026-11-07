"use client";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import type { RecordSelection } from "@/hooks/use-record-selection";
export function RecordSelectionToolbar({
  selection,
  children,
  disabled = false,
}: {
  selection: RecordSelection;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="selection-toolbar flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm font-medium">
          <Checkbox
            aria-label="Select all visible records"
            checked={
              selection.all ? true : selection.partial ? "indeterminate" : false
            }
            disabled={disabled || selection.total === 0}
            onCheckedChange={(checked) => selection.selectAll(checked === true)}
          />
          Select all
        </label>
        <span
          role="status"
          className="rounded-md bg-secondary px-2.5 py-1 text-sm font-semibold tabular-nums"
        >
          {selection.count} / {selection.total} selected
        </span>
        <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
          <Switch
            aria-label="Auto-select all matching records"
            checked={selection.auto}
            disabled={disabled}
            onCheckedChange={selection.setAuto}
          />
          Auto-select all
        </label>
        {selection.count > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={selection.clear}
          >
            Clear
          </Button>
        )}
      </div>
      {children}
      {selection.auto && (
        <p className="w-full text-xs text-muted-foreground">
          New matching results are selected automatically. You can uncheck
          individual records.
        </p>
      )}
    </div>
  );
}
