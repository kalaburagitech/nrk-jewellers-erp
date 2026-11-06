"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { ArrowLeftRight, Banknote, Landmark, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type Account = Doc<"bankAccounts"> & { balancePaise: number };

function AddAccountDialog({ onClose }: { onClose: () => void }) {
  const createAccount = useMutation(api.cashBank.createAccount);
  const [name, setName] = useState("");
  const [type, setType] = useState<"cash" | "bank">("bank");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [openingBalanceRupees, setOpeningBalanceRupees] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await createAccount({
        name,
        type,
        bankName: type === "bank" ? bankName || undefined : undefined,
        accountNumber: type === "bank" ? accountNumber || undefined : undefined,
        openingBalancePaise: rupeesToPaise(openingBalanceRupees || "0") ?? 0,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add cash or bank account</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "cash" | "bank")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank">Bank account</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "cash" ? "Cash in hand" : "SBI Current A/C"} />
          </div>
          {type === "bank" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Bank name</Label>
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="optional" />
              </div>
              <div className="grid gap-2">
                <Label>Account number</Label>
                <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="optional" />
              </div>
            </div>
          )}
          <div className="grid gap-2">
            <Label>Opening balance (₹)</Label>
            <Input
              inputMode="decimal"
              placeholder="0.00"
              value={openingBalanceRupees}
              onChange={(e) => setOpeningBalanceRupees(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving…" : "Add account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransactionDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const recordTransaction = useMutation(api.cashBank.recordTransaction);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amountRupees, setAmountRupees] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const amountPaise = rupeesToPaise(amountRupees || "0") ?? 0;
    if (amountPaise <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (!description.trim()) {
      setError("A description is required.");
      return;
    }
    setSubmitting(true);
    try {
      await recordTransaction({ accountId: account._id, direction, amountPaise, description });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record this transaction.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record transaction — {account.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Direction</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "in" | "out")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Money in (deposit / received)</SelectItem>
                <SelectItem value="out">Money out (withdrawal / paid)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Amount (₹)</Label>
            <Input inputMode="decimal" placeholder="0.00" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Owner drawing, bank interest" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const transfer = useMutation(api.cashBank.transfer);
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const amountPaise = rupeesToPaise(amountRupees || "0") ?? 0;
    if (!fromAccountId || !toAccountId) {
      setError("Select both accounts.");
      return;
    }
    if (fromAccountId === toAccountId) {
      setError("Pick two different accounts.");
      return;
    }
    if (amountPaise <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSubmitting(true);
    try {
      await transfer({
        fromAccountId: fromAccountId as Id<"bankAccounts">,
        toAccountId: toAccountId as Id<"bankAccounts">,
        amountPaise,
        description: description || undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record this transfer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer between accounts</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>From</Label>
              <Select value={fromAccountId} onValueChange={setFromAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>To</Label>
              <Select value={toAccountId} onValueChange={setToAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Amount (₹)</Label>
            <Input inputMode="decimal" placeholder="0.00" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving…" : "Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LedgerDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const ledger = useQuery(api.cashBank.getLedger, { accountId: account._id });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{account.name} — ledger</DialogTitle>
        </DialogHeader>
        {ledger === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : ledger.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.entries.map((entry) => (
                  <TableRow key={entry._id}>
                    <TableCell className="text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString("en-IN")}
                    </TableCell>
                    <TableCell>{entry.description}</TableCell>
                    <TableCell className="text-right">{entry.debitPaise > 0 ? formatPaise(entry.debitPaise) : "—"}</TableCell>
                    <TableCell className="text-right">{entry.creditPaise > 0 ? formatPaise(entry.creditPaise) : "—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatPaise(entry.balancePaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function CashBankPage() {
  const accounts = useQuery(api.cashBank.list);
  const [adding, setAdding] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transactionFor, setTransactionFor] = useState<Account | null>(null);
  const [ledgerFor, setLedgerFor] = useState<Account | null>(null);

  const totalPaise = accounts?.reduce((sum, a) => sum + a.balancePaise, 0) ?? 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cash & Bank</h1>
          <p className="text-sm text-muted-foreground">Cash in hand and bank account balances, deposits, withdrawals and transfers.</p>
        </div>
        <div className="flex gap-2">
          {accounts && accounts.length >= 2 && (
            <Button variant="outline" onClick={() => setTransferring(true)}>
              <ArrowLeftRight className="h-4 w-4" />
              Transfer
            </Button>
          )}
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add Account
          </Button>
        </div>
      </div>

      {accounts && accounts.length > 0 && (
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Wallet className="h-6 w-6 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Total cash + bank position</p>
              <p className="text-2xl font-semibold tracking-tight">{formatPaise(totalPaise)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {accounts === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Landmark className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No cash or bank accounts yet.</p>
            <Button size="sm" onClick={() => setAdding(true)}>
              Add your first account
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {accounts.map((account) => (
            <Card key={account._id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  {account.type === "cash" ? <Banknote className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
                  {account.name}
                </CardTitle>
                <Badge variant="secondary" className="capitalize">
                  {account.type}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {account.type === "bank" && (account.bankName || account.accountNumber) && (
                  <p className="text-xs text-muted-foreground">
                    {account.bankName}
                    {account.bankName && account.accountNumber ? " · " : ""}
                    {account.accountNumber}
                  </p>
                )}
                <p className="text-2xl font-semibold tracking-tight">{formatPaise(account.balancePaise)}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setTransactionFor(account)}>
                    Record Transaction
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setLedgerFor(account)}>
                    View Ledger
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {adding && <AddAccountDialog onClose={() => setAdding(false)} />}
      {transferring && accounts && <TransferDialog accounts={accounts} onClose={() => setTransferring(false)} />}
      {transactionFor && <TransactionDialog account={transactionFor} onClose={() => setTransactionFor(null)} />}
      {ledgerFor && <LedgerDialog account={ledgerFor} onClose={() => setLedgerFor(null)} />}
    </div>
  );
}
