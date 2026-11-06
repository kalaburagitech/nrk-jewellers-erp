"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DateRange = { startDate: number; endDate: number };

function toDateInputValue(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function startOfDay(dateString: string) {
  return new Date(`${dateString}T00:00:00.000Z`).getTime();
}

function endOfDay(dateString: string) {
  return new Date(`${dateString}T23:59:59.999Z`).getTime();
}

export function defaultLast30Days(): DateRange {
  const now = Date.now();
  return { startDate: now - 30 * 24 * 60 * 60 * 1000, endDate: now };
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="grid gap-2">
        <Label>From</Label>
        <Input
          type="date"
          className="w-40"
          value={toDateInputValue(value.startDate)}
          onChange={(e) => e.target.value && onChange({ ...value, startDate: startOfDay(e.target.value) })}
        />
      </div>
      <div className="grid gap-2">
        <Label>To</Label>
        <Input
          type="date"
          className="w-40"
          value={toDateInputValue(value.endDate)}
          onChange={(e) => e.target.value && onChange({ ...value, endDate: endOfDay(e.target.value) })}
        />
      </div>
    </div>
  );
}
