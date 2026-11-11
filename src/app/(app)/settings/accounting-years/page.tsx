"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarRange, LockKeyhole, Plus, UnlockKeyhole } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getUserErrorMessage } from "@/lib/user-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const dayMs = 24 * 60 * 60 * 1000;
function inputDate(value: string) { return new Date(`${value}T00:00:00.000Z`).getTime(); }
function showDate(value: number) { return new Date(value).toLocaleDateString("en-IN", { timeZone: "UTC" }); }

export default function AccountingYearsPage() {
  const access = useQuery(api.organizations.getMyAccess);
  const years = useQuery(api.accountingYears.list);
  const create = useMutation(api.accountingYears.create);
  const setClosed = useMutation(api.accountingYears.setClosed);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const owner = access?.membership?.role === "owner";

  async function add() {
    if (!name.trim() || !start || !end) { setError("Enter a year name and both dates."); return; }
    setBusy(true); setError(""); setMessage("");
    try { await create({ name, startsAt: inputDate(start), endsAt: inputDate(end) + dayMs - 1 }); setName(""); setStart(""); setEnd(""); setMessage("Booking year added."); }
    catch (e) { setError(getUserErrorMessage(e, "Could not add the booking year.")); }
    finally { setBusy(false); }
  }

  async function toggle(id: Id<"accountingYears">, closed: boolean) {
    setBusy(true); setError(""); setMessage("");
    try { await setClosed({ id, closed }); setMessage(closed ? "Booking year closed. New bills and edits in its dates are blocked." : "Booking year reopened."); }
    catch (e) { setError(getUserErrorMessage(e, "Could not update the booking year.")); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto flex max-w-4xl flex-col gap-5">
    <div><h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><CalendarRange className="h-6 w-6 text-primary" />Booking years</h1><p className="mt-1 text-sm text-muted-foreground">Create each company’s financial year separately. Closing a year blocks new bills and edits dated within that year.</p></div>
    {owner && <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <div className="grid gap-2"><Label htmlFor="year-name">Year name</Label><Input id="year-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="2026–27" /></div>
      <div className="grid gap-2"><Label htmlFor="year-start">Start date</Label><Input id="year-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
      <div className="grid gap-2"><Label htmlFor="year-end">End date</Label><Input id="year-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
      <Button onClick={() => void add()} disabled={busy}><Plus className="h-4 w-4" />Add year</Button>
    </CardContent></Card>}
    <div className="grid gap-3">{years?.map((year) => <Card key={year._id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-semibold">{year.name}</p><p className="text-sm text-muted-foreground">{showDate(year.startsAt)} – {showDate(year.endsAt)}</p></div><div className="flex items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${year.status === "closed" ? "bg-muted text-muted-foreground" : "bg-success/10 text-success"}`}>{year.status === "closed" ? "Closed" : "Open"}</span>{owner && <Button variant="outline" size="sm" disabled={busy} onClick={() => void toggle(year._id, year.status === "open")}>{year.status === "open" ? <><LockKeyhole className="h-4 w-4" />Close year</> : <><UnlockKeyhole className="h-4 w-4" />Reopen</>}</Button>}</div></CardContent></Card>)}{years?.length === 0 && <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No booking years yet. Add one to start tracking a financial year.</p>}{years === undefined && <p className="text-sm text-muted-foreground">Loading booking years…</p>}</div>
    {!owner && <p className="text-sm text-muted-foreground">Only the owner can create, close, or reopen booking years.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm text-success">{message}</p>}
  </div>;
}
