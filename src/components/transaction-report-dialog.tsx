"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadCsv } from "@/lib/csv-export";

export type ReportField<T> = {
  id: string;
  label: string;
  value: (row: T) => string | number;
};

export function TransactionReportDialog<T>({
  filename,
  label,
  rows,
  fields,
}: {
  filename: string;
  label: string;
  rows: T[];
  fields: ReportField<T>[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(fields.map((field) => field.id));
  const selectedFields = fields.filter((field) => selected.includes(field.id));

  function generate() {
    if (selectedFields.length === 0 || rows.length === 0) return;
    downloadCsv(
      filename,
      selectedFields.map((field) => field.label),
      rows.map((row) => selectedFields.map((field) => field.value(row))),
    );
    setOpen(false);
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={() => setOpen(true)}>
        <Download className="h-4 w-4" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Select Report Options</DialogTitle></DialogHeader>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {fields.map((field) => {
              const checked = selected.includes(field.id);
              return (
                <label key={field.id} className="flex cursor-pointer items-center gap-3 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => setSelected((previous) =>
                      value === true
                        ? [...previous, field.id]
                        : previous.filter((id) => id !== field.id),
                    )}
                  />
                  {field.label}
                </label>
              );
            })}
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button variant="ghost" onClick={() => setSelected(selected.length === fields.length ? [] : fields.map((field) => field.id))}>
              {selected.length === fields.length ? "Clear selection" : "Select all"}
            </Button>
            <Button onClick={generate} disabled={selectedFields.length === 0 || rows.length === 0}>
              Generate Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
