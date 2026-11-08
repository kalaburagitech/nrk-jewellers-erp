"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { downloadCsv } from "@/lib/csv-export";
import { parseCsvToRecords } from "@/lib/csv-import";

type RowResult = { label: string; error: string };

/**
 * Generic "upload a CSV, create one row per line" dialog. Each caller supplies its own column
 * template and a row handler that calls the matching create mutation — this just owns the
 * file-parsing, sequential submission, and per-row success/failure reporting shared by all of them.
 */
export function ImportCsvDialog({
  title,
  templateFilename,
  templateHeaders,
  templateExampleRow,
  rowLabel,
  onImportRow,
}: {
  title: string;
  templateFilename: string;
  templateHeaders: string[];
  templateExampleRow?: string[];
  rowLabel: (record: Record<string, string>) => string;
  onImportRow: (record: Record<string, string>) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ succeeded: number; failed: RowResult[] } | null>(null);

  function reset() {
    setRows(null);
    setFileName("");
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResults(null);
    const text = await file.text();
    setRows(parseCsvToRecords(text));
  }

  async function handleImport() {
    if (!rows) return;
    setImporting(true);
    const failed: RowResult[] = [];
    let succeeded = 0;
    for (const record of rows) {
      try {
        await onImportRow(record);
        succeeded++;
      } catch (e) {
        failed.push({ label: rowLabel(record) || "(unnamed row)", error: getUserErrorMessage(e, "Could not import this row.") });
      }
    }
    setResults({ succeeded, failed });
    setImporting(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="h-4 w-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => downloadCsv(templateFilename, templateHeaders, templateExampleRow ? [templateExampleRow] : [])}
          >
            <Download className="h-4 w-4" />
            Download template
          </Button>

          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
          <Button type="button" variant="outline" className="self-start" onClick={() => fileInputRef.current?.click()}>
            {fileName || "Choose CSV file"}
          </Button>

          {rows && !results && (
            <p className="text-sm text-muted-foreground">{rows.length} row(s) found in {fileName}.</p>
          )}

          {results && (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                <span className="font-medium text-success">{results.succeeded} imported</span>
                {results.failed.length > 0 && <span className="text-destructive"> · {results.failed.length} failed</span>}
              </p>
              {results.failed.length > 0 && (
                <div className="flex flex-col gap-1 rounded-md border border-destructive/40 p-3">
                  {results.failed.map((r, i) => (
                    <p key={i} className="text-destructive">
                      {r.label}: {r.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          {results ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button onClick={handleImport} disabled={!rows || rows.length === 0 || importing}>
              {importing ? "Importing…" : `Import ${rows?.length ?? 0} row(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
