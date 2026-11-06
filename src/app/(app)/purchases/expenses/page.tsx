"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Plus, Receipt as ReceiptIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

const COMMON_CATEGORIES = ["Rent", "Salary", "Electricity", "Transport", "Maintenance", "Other"];

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}
function dateInputToTimestamp(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

function AddExpenseDialog({ accounts }: { accounts: Doc<"bankAccounts">[] }) {
  const createExpense = useMutation(api.expenses.create);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => todayDateInput());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCategory("");
    setAmountRupees("");
    setPaymentAccountId("");
    setDescription("");
    setExpenseDate(todayDateInput());
    setError(null);
  }

  async function handleSave() {
    setError(null);
    const amountPaise = rupeesToPaise(amountRupees || "0") ?? 0;
    if (!category.trim()) {
      setError("Category is required.");
      return;
    }
    if (amountPaise <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSubmitting(true);
    try {
      await createExpense({
        category,
        amountPaise,
        paymentAccountId: paymentAccountId ? (paymentAccountId as Id<"bankAccounts">) : undefined,
        description: description || undefined,
        expenseDate: dateInputToTimestamp(expenseDate),
      });
      setOpen(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record this expense.");
    } finally {
      setSubmitting(false);
    }
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
        <Button>
          <Plus className="h-4 w-4" />
          Add Expense
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record an expense</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Category</Label>
              <Input
                list="expense-categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Rent"
              />
              <datalist id="expense-categories">
                {COMMON_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-2">
              <Label>Amount (₹)</Label>
              <Input inputMode="decimal" placeholder="0.00" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Paid from (optional)</Label>
              <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Not tracked" />
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
              <Label>Date</Label>
              <Input type="date" value={expenseDate} max={todayDateInput()} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving…" : "Save expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteExpenseDialog({ expense, onClose }: { expense: Doc<"expenses">; onClose: () => void }) {
  const removeExpense = useMutation(api.expenses.remove);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await removeExpense({ id: expense._id, reason });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this expense.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &quot;{expense.category}&quot; expense?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {expense.paymentAccountId
            ? "This credits the amount back to the account it was paid from."
            : "This expense wasn't tracked against an account."}
        </p>
        <div className="grid gap-2">
          <Label>Reason</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. entered by mistake" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
            {submitting ? "Deleting…" : "Delete expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ExpensesPage() {
  const expenses = useQuery(api.expenses.list);
  const accounts = useQuery(api.cashBank.list);
  const [deleting, setDeleting] = useState<Doc<"expenses"> | null>(null);

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    accounts?.forEach((a) => map.set(a._id, a.name));
    return map;
  }, [accounts]);

  const totalPaise = expenses?.reduce((sum, e) => sum + e.amountPaise, 0) ?? 0;
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    expenses?.forEach((e) => map.set(e.category, (map.get(e.category) ?? 0) + e.amountPaise));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground">Shop running costs — rent, salary, electricity — kept separate from supplier purchases.</p>
        </div>
        {accounts !== undefined && <AddExpenseDialog accounts={accounts} />}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">Total expenses recorded</p>
            <p className="text-2xl font-semibold tracking-tight">{formatPaise(totalPaise)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By category</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses yet.</p>
            ) : (
              byCategory.map(([category, amount]) => (
                <div key={category} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{category}</span>
                  <span>{formatPaise(amount)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {expenses === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : expenses.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ReceiptIcon className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No expenses recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Paid from</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((e) => (
                    <TableRow key={e._id}>
                      <TableCell>{new Date(e.expenseDate).toLocaleDateString("en-IN")}</TableCell>
                      <TableCell className="font-medium">{e.category}</TableCell>
                      <TableCell className="text-muted-foreground">{e.description ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.paymentAccountId ? accountNameById.get(e.paymentAccountId) ?? "—" : "—"}
                      </TableCell>
                      <TableCell className="text-right">{formatPaise(e.amountPaise)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => setDeleting(e)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {deleting && <DeleteExpenseDialog expense={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
