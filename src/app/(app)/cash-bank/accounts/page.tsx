"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportTable, SummaryTiles, fmtDate } from "@/components/report-kit";
import { getUserErrorMessage } from "@/lib/user-error";
import { rupeesToPaise } from "@/lib/money";

type Kind = Doc<"accountEntries">["kind"];
type Tab = "income" | "capital" | "loans" | "assets";

const TABS: { id: Tab; label: string; kinds: { kind: Kind; label: string; nameLabel: string }[]; help: string }[] = [
  { id: "income", label: "Other Income", kinds: [{ kind: "other_income", label: "Other Income", nameLabel: "Income category (e.g. Interest, Rent, Commission)" }], help: "Money earned outside sales — counted in Profit & Loss." },
  { id: "capital", label: "Capital", kinds: [{ kind: "capital_in", label: "Capital Added", nameLabel: "Owner / partner name" }, { kind: "drawings", label: "Owner Drawings", nameLabel: "Owner / partner name" }], help: "Money the owners put in or took out — shown on the Balance Sheet." },
  { id: "loans", label: "Loans", kinds: [{ kind: "loan_taken", label: "Loan Received", nameLabel: "Lender (bank / person)" }, { kind: "loan_repaid", label: "Loan Repaid", nameLabel: "Lender (bank / person)" }, { kind: "loan_interest", label: "Loan Interest Paid", nameLabel: "Lender (bank / person)" }], help: "Business loans. Interest is an expense in Profit & Loss; the balance owed is on the Balance Sheet." },
  { id: "assets", label: "Fixed Assets", kinds: [{ kind: "fixed_asset", label: "Fixed Asset Bought", nameLabel: "Asset (e.g. Weighing scale, Safe, Counter)" }], help: "Things the shop owns and uses (not stock for sale) — shown on the Balance Sheet." },
];

const today = () => new Date().toISOString().slice(0, 10);

function EntryDialog({ kinds }: { kinds: (typeof TABS)[number]["kinds"] }) {
  const create = useMutation(api.accountEntries.create);
  const accounts = useQuery(api.cashBank.list);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>(kinds[0].kind);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState("none");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = kinds.find((k) => k.kind === kind) ?? kinds[0];

  async function save() {
    const amountPaise = rupeesToPaise(amount);
    if (!amountPaise) return setError("Enter an amount greater than zero.");
    setBusy(true);
    setError("");
    try {
      await create({ kind, name, amountPaise, entryDate: new Date(`${date}T12:00:00`).getTime(), paymentAccountId: accountId === "none" ? undefined : (accountId as Id<"bankAccounts">), description: description || undefined });
      setOpen(false);
      setName(""); setAmount(""); setDescription("");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4" />Add {kinds.length === 1 ? kinds[0].label : "Entry"}</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{current.label}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {kinds.length > 1 && (
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{kinds.map((k) => <SelectItem key={k.kind} value={k.kind}>{k.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5"><Label>{current.nameLabel}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Amount (₹)</Label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5">
            <Label>{["other_income", "capital_in", "loan_taken"].includes(kind) ? "Received in" : "Paid from"}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not through a cash/bank account</SelectItem>
                {accounts?.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountsPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? "income");
  const entries = useQuery(api.accountEntries.list);
  const remove = useMutation(api.accountEntries.remove);
  const access = useQuery(api.organizations.getMyAccess);
  const canDelete = ["owner", "admin"].includes(access?.membership?.role ?? "");
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const kinds = new Set(current.kinds.map((k) => k.kind));
  const rows = entries?.filter((e) => kinds.has(e.kind));
  const label = (k: Kind) => current.kinds.find((x) => x.kind === k)?.label ?? k;
  const sum = (k: Kind) => rows?.filter((r) => r.kind === k).reduce((a, r) => a + r.amountPaise, 0) ?? 0;

  const tiles =
    tab === "capital" ? [{ label: "Capital Added", paise: sum("capital_in"), tone: "green" as const }, { label: "Drawings", paise: sum("drawings"), tone: "red" as const }, { label: "Net Capital", paise: sum("capital_in") - sum("drawings"), tone: "blue" as const }]
    : tab === "loans" ? [{ label: "Loans Received", paise: sum("loan_taken"), tone: "blue" as const }, { label: "Repaid", paise: sum("loan_repaid"), tone: "green" as const }, { label: "Loan Balance Owed", paise: sum("loan_taken") - sum("loan_repaid"), tone: "red" as const }, { label: "Interest Paid", paise: sum("loan_interest"), tone: "amber" as const }]
    : [{ label: `Total ${current.label}`, paise: rows?.reduce((a, r) => a + r.amountPaise, 0) ?? 0, tone: "blue" as const }];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Other Income, Capital &amp; Loans</h1>
          <p className="text-sm text-muted-foreground">{current.help}</p>
        </div>
        <EntryDialog key={tab} kinds={current.kinds} />
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>{TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>
      {rows && <SummaryTiles tiles={tiles} />}
      <ReportTable
        rows={rows}
        rowKey={(r) => r._id}
        csvName={`accounts-${tab}`}
        empty="Nothing recorded yet."
        columns={[
          { key: "date", label: "Date", value: (r) => r.entryDate, render: (r) => fmtDate(r.entryDate) },
          { key: "type", label: "Type", value: (r) => label(r.kind) },
          { key: "name", label: "Name", value: (r) => r.name },
          { key: "desc", label: "Description", value: (r) => r.description ?? "" },
          { key: "amt", label: "Amount", value: (r) => r.amountPaise, money: true, align: "right" },
          ...(canDelete ? [{ key: "del", label: "", value: () => "", render: (r: Doc<"accountEntries">) => (
            <Button variant="ghost" size="icon" aria-label="Delete entry" onClick={() => { const reason = window.prompt("Reason for deleting this entry?"); if (reason) void remove({ id: r._id, reason }); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          ) }] : []),
        ]}
      />
    </div>
  );
}

export default function Page() {
  return <Suspense><AccountsPage /></Suspense>;
}
