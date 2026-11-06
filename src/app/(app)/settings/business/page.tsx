"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Doc } from "../../../../../convex/_generated/dataModel";

function ProfileForm({ profile }: { profile: Doc<"organizations"> }) {
  const updateProfile = useMutation(api.organizations.updateProfile);

  const [name, setName] = useState(profile.name);
  const [legalName, setLegalName] = useState(profile.legalName ?? "");
  const [gstin, setGstin] = useState(profile.gstin ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [address, setAddress] = useState(profile.address ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);
    if (!name.trim()) {
      setError("Business name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await updateProfile({
        name,
        legalName: legalName || undefined,
        gstin: gstin || undefined,
        phone: phone || undefined,
        address: address || undefined,
      });
      setSaved(true);
    } catch {
      setError("Could not save. You may need Owner/Admin access.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="grid gap-2">
        <Label>Display name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="NRK Jewellers" />
      </div>
      <div className="grid gap-2">
        <Label>Legal / registered name</Label>
        <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="optional" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>GSTIN</Label>
          <Input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="optional" />
        </div>
        <div className="grid gap-2">
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="optional" />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Address</Label>
        <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} placeholder="optional" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="text-sm text-success">Saved.</p>}
      <Button onClick={handleSave} disabled={submitting} className="self-end">
        {submitting ? "Saving…" : "Save"}
      </Button>
    </>
  );
}

export default function BusinessProfilePage() {
  const profile = useQuery(api.organizations.getProfile);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Business Profile</h1>
        <p className="text-sm text-muted-foreground">
          Appears on every printed and shared invoice — the shop name, GSTIN and address customers see.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {profile === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : profile === null ? (
            <p className="text-sm text-destructive">Organization not found.</p>
          ) : (
            <ProfileForm key={profile._id} profile={profile} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
