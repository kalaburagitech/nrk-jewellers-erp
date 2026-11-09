"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPaise } from "@/lib/money";
import { rupeesToPaise } from "@/lib/money";
import { girviInterestPaise } from "@/lib/girvi-interest";
import { Landmark, Plus, Search } from "lucide-react";

function RepayDialog({
  loan,
  close,
}: {
  loan: Doc<"girviLoans">;
  close: () => void;
}) {
  const [asOf] = useState(() => Date.now());
  const receive = useMutation(api.girvi.receive);
  const receipts = useQuery(api.girvi.receipts, { id: loan._id });
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  const [release, setRelease] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const estimatedInterest = receipts
    ? Math.max(
        0,
        girviInterestPaise(
          loan.principalPaise,
          loan.monthlyInterestBasisPoints,
          loan.issuedAt,
          loan.releasedAt ?? asOf,
          receipts,
        ) - loan.interestReceivedPaise,
      )
    : null;
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Ticket {loan.ticketNumber} · {loan.customerName}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          {loan.description} · {(loan.weightMg / 1000).toFixed(3)} g ·{" "}
          {loan.storageLocation}
        </p>
        <p>
          Principal outstanding:{" "}
          <strong>
            {formatPaise(loan.principalPaise - loan.principalRepaidPaise)}
          </strong>
        </p>
        <p className="rounded-lg bg-muted p-3 text-sm">
          Estimated interest outstanding:{" "}
          <strong>
            {estimatedInterest === null
              ? "Loading…"
              : formatPaise(estimatedInterest)}
          </strong>
          <br />
          Simple interest on reducing principal, using 30-day months. Enter the
          agreed interest received below.
        </p>
        <p className="text-sm text-muted-foreground">
          Monthly interest: {(loan.monthlyInterestBasisPoints / 100).toFixed(2)}
          %. Enter the agreed interest received separately. Metal is released
          only when you select release and all principal is repaid.
        </p>
        {loan.status === "active" && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await receive({
                  id: loan._id,
                  principalPaise: rupeesToPaise(principal || "0") ?? -1,
                  interestPaise: rupeesToPaise(interest || "0") ?? -1,
                  release,
                });
                close();
              } catch (e) {
                setError(getUserErrorMessage(e, "Repayment failed"));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block text-sm">
              Principal received (₹)
              <Input
                type="number"
                min="0"
                step="0.01"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Interest received (₹)
              <Input
                type="number"
                min="0"
                step="0.01"
                value={interest}
                onChange={(e) => setInterest(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={release}
                onChange={(e) => setRelease(e.target.checked)}
              />
              Release pledged metal to customer
            </label>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <Button disabled={busy}>
              {busy ? "Saving…" : "Record repayment"}
            </Button>
          </form>
        )}
        <div className="max-h-48 overflow-auto border-t pt-3">
          <h3 className="mb-2 font-medium">Receipt history</h3>
          {receipts?.map((r) => (
            <p className="py-1 text-sm" key={r._id}>
              {new Date(r.createdAt).toLocaleDateString("en-IN")} · Principal{" "}
              {formatPaise(r.principalPaise)} · Interest{" "}
              {formatPaise(r.interestPaise)}
            </p>
          ))}
          {receipts?.length === 0 && (
            <p className="text-sm text-muted-foreground">No repayments yet.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
export default function GirviPage() {
  const accounts = useQuery(api.cashBank.list);
  const loans = useQuery(api.girvi.list);
  const create = useMutation(api.girvi.create);
  const cancel = useMutation(api.girvi.cancel);
  const access = useQuery(api.organizations.getMyAccess);
  const canWrite = [
    "owner",
    "admin",
    "accountant",
    "billing_operator",
  ].includes(access?.membership?.role ?? "");
  const canDelete = ["owner", "admin"].includes(access?.membership?.role ?? "");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Doc<"girviLoans"> | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = loans?.filter((l) => l.status === "active");
  const today = new Date().toLocaleDateString("en-CA");
  const visibleLoans = loans?.filter(
    (loan) =>
      (status === "all" || loan.status === status) &&
      `${loan.ticketNumber} ${loan.customerName} ${loan.phone}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selection = useRecordSelection(
    visibleLoans?.map((row) => row._id) ?? [],
    `girvi:${status}:${search}`,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-semibold">
            <Landmark className="text-primary" />
            Girvi · Metal loans
          </h1>
          <p className="mt-2 text-muted-foreground">
            Pledged metal, loan disbursements and repayments in one register.
          </p>
        </div>
        {canWrite && (
          <Button
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            <Plus />
            New Girvi ticket
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Active tickets", String(active?.length ?? 0)],
          [
            "Principal outstanding",
            formatPaise(
              active?.reduce(
                (s, l) => s + l.principalPaise - l.principalRepaidPaise,
                0,
              ) ?? 0,
            ),
          ],
          [
            "Interest collected",
            formatPaise(
              loans?.reduce((s, l) => s + l.interestReceivedPaise, 0) ?? 0,
            ),
          ],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Loan disbursements and repayments automatically update the selected Cash
        & Bank account. Interest received is recorded separately from principal.
      </p>
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4" />
          <Input
            aria-label="Search Girvi loans"
            placeholder="Ticket, name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Loan status"
          className="rounded-md border bg-background px-3"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["active", "released", "cancelled", "all"].map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>
      {error && !open && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <BulkRecordActions selection={selection} table="girviLoans" />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="w-12 p-4">
                <Checkbox
                  aria-label="Select all visible records"
                  checked={
                    selection.all
                      ? true
                      : selection.partial
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(checked) =>
                    selection.selectAll(checked === true)
                  }
                />
              </th>
              {[
                "Ticket / Customer",
                "Metal held",
                "Loan / Balance",
                "Monthly rate",
                "Due date",
                "Status",
                "Actions",
              ].map((h) => (
                <th key={h} className="p-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loans
              ?.filter(
                (l) =>
                  (status === "all" || l.status === status) &&
                  `${l.ticketNumber} ${l.customerName} ${l.phone}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((loan) => (
                <tr
                  key={loan._id}
                  className={`border-t ${selection.has(loan._id) ? "bg-primary/5" : ""}`}
                >
                  <td className="p-4">
                    <Checkbox
                      aria-label={`Select ticket ${loan.ticketNumber}`}
                      checked={selection.has(loan._id)}
                      onCheckedChange={() => selection.toggle(loan._id)}
                    />
                  </td>
                  <td className="p-4">
                    <strong>{loan.ticketNumber}</strong>
                    <p>{loan.customerName}</p>
                    <p className="text-muted-foreground">{loan.phone}</p>
                  </td>
                  <td className="p-4">
                    {loan.description}
                    <p className="text-muted-foreground">
                      {loan.metal} · {(loan.weightMg / 1000).toFixed(3)}g
                    </p>
                    <p>{loan.storageLocation}</p>
                  </td>
                  <td className="p-4">
                    {formatPaise(loan.principalPaise)}
                    <p className="font-semibold text-primary">
                      {formatPaise(
                        loan.principalPaise - loan.principalRepaidPaise,
                      )}
                    </p>
                  </td>
                  <td className="p-4">
                    {(loan.monthlyInterestBasisPoints / 100).toFixed(2)}%
                  </td>
                  <td className="p-4">
                    {new Date(loan.dueAt).toLocaleDateString("en-IN")}
                  </td>
                  <td className="p-4 capitalize">{loan.status}</td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelected(loan)}
                      >
                        {canWrite && loan.status === "active"
                          ? "Repay / Release"
                          : "View"}
                      </Button>
                      {canDelete && loan.status === "active" && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={async () => {
                            const reason = window.prompt(
                              "Cancel this ticket? Enter reason (only tickets without repayments can be cancelled):",
                            );
                            if (!reason?.trim()) return;
                            setBusy(true);
                            try {
                              await cancel({ id: loan._id, reason });
                            } catch (e) {
                              setError(
                                getUserErrorMessage(e, "Delete failed"),
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loans === undefined ? (
          <p className="p-6">Loading…</p>
        ) : (
          loans.filter((l) => status === "all" || l.status === status)
            .length === 0 && (
            <p className="p-8 text-center text-muted-foreground">
              No {status === "all" ? "" : status} tickets.
            </p>
          )
        )}
      </div>
      {selected && (
        <RepayDialog loan={selected} close={() => setSelected(null)} />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New Girvi ticket</DialogTitle>
          </DialogHeader>
          <form
            className="grid grid-cols-2 gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const val = (key: string) => String(f.get(key) ?? "");
              setBusy(true);
              setError("");
              try {
                await create({
                  accountId: val("accountId") as Id<"bankAccounts">,
                  ticketNumber: val("ticketNumber"),
                  customerName: val("customerName"),
                  phone: val("phone"),
                  metal: val("metal") as "gold" | "silver",
                  description: val("description"),
                  storageLocation: val("storageLocation"),
                  weightMg: Math.round(Number(val("weight")) * 1000),
                  principalPaise: rupeesToPaise(val("principal")) ?? -1,
                  monthlyInterestBasisPoints: Math.round(
                    Number(val("rate")) * 100,
                  ),
                  issuedAt: new Date(
                    `${val("issuedAt")}T00:00:00+05:30`,
                  ).getTime(),
                  dueAt: new Date(`${val("dueAt")}T00:00:00+05:30`).getTime(),
                });
                setOpen(false);
              } catch (e) {
                setError(
                  getUserErrorMessage(e, "Could not create ticket"),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {[
              ["ticketNumber", "Ticket number", "text"],
              ["customerName", "Customer name", "text"],
              ["phone", "Phone", "tel"],
              ["description", "Item description / purity", "text"],
              ["storageLocation", "Packet / locker location", "text"],
              ["weight", "Net metal weight (g)", "number"],
              ["principal", "Loan issued (₹)", "number"],
              ["rate", "Monthly interest (%)", "number"],
              ["issuedAt", "Issued on", "date"],
              ["dueAt", "Due on", "date"],
            ].map(([name, label, type]) => (
              <label key={name} className="text-sm">
                {label}
                <Input
                  required={name !== "phone"}
                  name={name}
                  type={type}
                  step={name === "weight" ? "0.001" : "0.01"}
                  min={type === "number" ? "0" : undefined}
                  max={name === "issuedAt" ? today : undefined}
                  defaultValue={name === "issuedAt" ? today : undefined}
                />
              </label>
            ))}
            <label className="text-sm">
              Cash / bank account
              <select
                required
                name="accountId"
                className="mt-1 w-full rounded-md border bg-background p-2"
              >
                <option value="">Select account</option>
                {accounts
                  ?.filter((a) => a.isActive)
                  .map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              Metal
              <select
                name="metal"
                className="mt-1 w-full rounded-md border bg-background p-2"
              >
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
              </select>
            </label>
            {error && (
              <p role="alert" className="col-span-2 text-destructive">
                {error}
              </p>
            )}
            <Button disabled={busy} className="col-span-2">
              {busy ? "Saving…" : "Issue loan & save ticket"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
