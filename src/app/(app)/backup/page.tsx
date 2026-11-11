"use client";
import { getUserErrorMessage } from "@/lib/user-error";
import { useState } from "react";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, DatabaseBackup, Download, RotateCcw, Upload } from "lucide-react";

export default function BackupPage() {
  const convex = useConvex();
  const restore = useMutation(api.dataManagement.restore);
  const clearCompanyData = useAction(api.dataManagement.clearCompanyData);
  const access = useQuery(api.organizations.getMyAccess);
  const allowed = ["owner", "admin"].includes(access?.membership?.role ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [backupReady, setBackupReady] = useState(false);
  const [resetPin, setResetPin] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [file, setFile] = useState<{
    name: string;
    json: string;
    count: number;
    date: string;
  } | null>(null);
  async function download() {
    const backup = await convex.query(api.dataManagement.exportBackup, {});
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `NRK-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupReady(true);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(getUserErrorMessage(e, "Operation failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <DatabaseBackup className="mb-3 h-9 w-9 text-primary" />
        <h1 className="text-3xl font-semibold">Backup & Restore</h1>
        <p className="mt-2 text-muted-foreground">
          Keep a copy of your business records in a safe place.
        </p>
      </div>
      {access && !allowed ? (
        <p>Only an owner or admin can back up and restore data.</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Download data backup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Includes business profile, inventory, invoices, payments,
                ledgers and Girvi records. Passwords and user access are
                excluded. Uploaded images remain in this deployment and are
                referenced by ID.
              </p>
              <p className="text-sm">
                Up to 5,000 records / 3 MB. Larger databases require a Convex
                deployment export.
              </p>
              <Button
                disabled={busy || !allowed}
                onClick={() =>
                  run(async () => {
                    await download();
                    setMessage("Backup downloaded.");
                  })
                }
              >
                <Download />
                Download backup
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Restore from backup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Restores this organization in the same deployment to the
                selected backup. Records in the backup will be restored; current
                records absent from it will be soft deleted. Download a fresh
                backup first.
              </p>
              <input
                aria-label="Choose backup JSON"
                type="file"
                accept=".json,application/json"
                disabled={busy || !allowed}
                className="w-full text-sm"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  setFile(null);
                  if (!selected) return;
                  run(async () => {
                    if (selected.size > 3_000_000)
                      throw new Error("File exceeds 3 MB");
                    const json = await selected.text();
                    const b = JSON.parse(json);
                    if (
                      b.format !== "nrk-erp-backup" ||
                      ![1, 2].includes(b.version) ||
                      !b.tables
                    )
                      throw new Error("Invalid NRK backup");
                    setFile({
                      name: selected.name,
                      json,
                      count: Object.values(b.tables).reduce<number>(
                        (n, rows) =>
                          n + (Array.isArray(rows) ? rows.length : 0),
                        0,
                      ),
                      date: new Date(b.exportedAt).toLocaleString("en-IN"),
                    });
                  });
                }}
              />
              {file && (
                <div className="rounded-lg bg-muted p-3 text-sm">
                  {file.name}
                  <br />
                  {file.count} records · {file.date}
                </div>
              )}
              <Button
                variant="destructive"
                disabled={busy || !file || !allowed}
                onClick={() => {
                  if (
                    !file ||
                    !window.confirm(
                      `Replace current business data with ${file.count} records from ${file.date}?`,
                    )
                  )
                    return;
                  run(async () => {
                    await download();
                    const result = await restore({ json: file.json });
                    setMessage(
                      `Restored ${result.count} records. A pre-restore backup was also downloaded.`,
                    );
                    setFile(null);
                  });
                }}
              >
                <Upload />
                {busy ? "Working…" : "Restore backup"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      {access?.membership?.role === "owner" && access.organization && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Clear company records
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This soft-deletes operational records in <strong>{access.organization.name}</strong>, including invoices, purchases, inventory, parties and Girvi records. Company settings, branches, tax and purity setup, accounts, booking years and the audit trail are retained. You can restore records from a backup.
            </p>
            <Button
              variant="outline"
              disabled={busy || !allowed}
              onClick={() => run(async () => {
                await download();
                setMessage("Safety backup downloaded. Confirm the company name and enter your MPIN to continue.");
              })}
            >
              <Download />
              Download safety backup
            </Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                Type <span className="font-mono">RESET {access.organization.name}</span>
                <input
                  value={resetConfirmation}
                  onChange={(event) => setResetConfirmation(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 font-normal"
                  autoComplete="off"
                  placeholder={`RESET ${access.organization.name}`}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Owner app MPIN
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={resetPin}
                  onChange={(event) => setResetPin(event.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-md border bg-background px-3 py-2 font-normal"
                  autoComplete="off"
                  placeholder="4 to 6 digits"
                />
              </label>
            </div>
            <Button
              variant="destructive"
              disabled={busy || !allowed || !backupReady || resetConfirmation !== `RESET ${access.organization.name}` || !/^\d{4,6}$/.test(resetPin)}
              onClick={() => run(async () => {
                // Always create a fresh downloadable backup immediately before the reset.
                await download();
                const result = await clearCompanyData({ confirmation: resetConfirmation, pin: resetPin });
                setMessage(`Company data cleared. ${result.count} records were soft-deleted; your fresh backup was downloaded.`);
                setResetPin("");
                setResetConfirmation("");
                setBackupReady(false);
              })}
            >
              <RotateCcw />
              {busy ? "Working…" : "Soft-delete company data"}
            </Button>
            {!backupReady && <p className="text-xs text-muted-foreground">Download a safety backup before this action is enabled.</p>}
          </CardContent>
        </Card>
      )}
      {message && (
        <p role="status" className="rounded-lg border p-4 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
