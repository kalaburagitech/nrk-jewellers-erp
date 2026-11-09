"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Coins, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatPaise, rupeesToPaise } from "@/lib/money";

export default function MetalRatesPage() {
  const current = useQuery(api.metalRates.getCurrent);
  const setRate = useMutation(api.metalRates.setRate);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(metalPurityId: Id<"metalPurities">) {
    setError(null);
    const paise = rupeesToPaise(drafts[metalPurityId] ?? "");
    if (!paise || paise <= 0) {
      setError("Enter a valid rate per gram.");
      return;
    }
    setSavingId(metalPurityId);
    try {
      await setRate({ metalPurityId, ratePerGramPaise: paise });
      setDrafts((prev) => ({ ...prev, [metalPurityId]: "" }));
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not update the metal rate. Check your access and try again."));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Metal Rates</h1>
          <p className="text-sm text-muted-foreground">
            The rate applied to a bill is always the rate at the moment it&apos;s finalized — updating
            here never changes a past invoice.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/metal-rates/history">
            <History className="h-4 w-4" />
            History
          </Link>
        </Button>
      </div>

      {current === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : current.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Coins className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No metal purities configured yet.{" "}
              <Link href="/settings/purity" className="underline">
                Add purities in Settings
              </Link>{" "}
              before setting rates.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {current.map(({ purity, latest }) => (
            <Card key={purity._id}>
              <CardHeader className="flex flex-row items-center justify-between pb-0">
                <CardTitle className="text-sm font-medium">{purity.label}</CardTitle>
                <Coins className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div>
                  <p className="text-2xl font-semibold tracking-tight">
                    {latest ? formatPaise(latest.ratePerGramPaise) : "—"}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">/gram</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {latest ? `Updated ${new Date(latest.effectiveAt).toLocaleString("en-IN")}` : "No rate set yet"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    inputMode="decimal"
                    placeholder="New rate per gram"
                    value={drafts[purity._id] ?? ""}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [purity._id]: e.target.value }))}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => handleSave(purity._id)}
                    disabled={savingId === purity._id}
                  >
                    {savingId === purity._id ? "Saving…" : "Update"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
