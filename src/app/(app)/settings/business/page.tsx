"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

function ImageUploadCard({
  title,
  description,
  imageUrl,
  previewClassName,
  generateUploadUrl,
  setImage,
}: {
  title: string;
  description: string;
  imageUrl: string | null | undefined;
  previewClassName: string;
  generateUploadUrl: () => Promise<string>;
  setImage: (args: { storageId: Id<"_storage"> }) => Promise<unknown>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = await result.json();
      await setImage({ storageId });
    } catch {
      setError("Could not upload image.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{description}</p>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={title} className={previewClassName} />
        )}
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="button"
          variant="outline"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="self-start"
        >
          {uploading ? "Uploading…" : "Upload new image"}
        </Button>
      </CardContent>
    </Card>
  );
}

function LoginImageCard() {
  const currentImageUrl = useQuery(api.organizations.getPublicLoginImageUrl);
  const generateUploadUrl = useMutation(api.organizations.generateLoginImageUploadUrl);
  const setLoginImage = useMutation(api.organizations.setLoginImage);

  return (
    <ImageUploadCard
      title="Login screen background"
      description="Shown behind the sign-in form. Falls back to the default image until one is uploaded."
      imageUrl={currentImageUrl}
      previewClassName="h-40 w-full rounded-md border border-border object-cover"
      generateUploadUrl={generateUploadUrl}
      setImage={setLoginImage}
    />
  );
}

function AppIconCard() {
  const currentIconUrl = useQuery(api.organizations.getPublicAppIconUrl);
  const generateUploadUrl = useMutation(api.organizations.generateAppIconUploadUrl);
  const setAppIcon = useMutation(api.organizations.setAppIcon);

  return (
    <ImageUploadCard
      title="App icon"
      description="Used as the icon when staff install this app to their desktop or phone home screen. Falls back to the NRK mark until one is uploaded — a square image works best."
      imageUrl={currentIconUrl}
      previewClassName="h-24 w-24 rounded-xl border border-border object-cover"
      generateUploadUrl={generateUploadUrl}
      setImage={setAppIcon}
    />
  );
}

function ProfileForm({ profile }: { profile: Doc<"organizations"> }) {
  const updateProfile = useMutation(api.organizations.updateProfile);

  const [name, setName] = useState(profile.name);
  const [legalName, setLegalName] = useState(profile.legalName ?? "");
  const [gstin, setGstin] = useState(profile.gstin ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [address, setAddress] = useState(profile.address ?? "");
  const [state, setState] = useState(profile.state ?? "");
  const [tagline, setTagline] = useState(profile.tagline ?? "");
  const [motto, setMotto] = useState(profile.motto ?? "");
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
        state: state || undefined,
        tagline: tagline || undefined,
        motto: motto || undefined,
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
          <Label>Business type (shown under the name on bills)</Label>
          <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Gold and Silver Merchants" />
        </div>
        <div className="grid gap-2">
          <Label>Motto (shown in italics on bills)</Label>
          <Input value={motto} onChange={(e) => setMotto(e.target.value)} placeholder="e.g. The Name of Purity" />
        </div>
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
      <div className="grid gap-2">
        <Label>State</Label>
        <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Karnataka" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="text-sm text-success">Saved.</p>}
      <Button onClick={handleSave} disabled={submitting} className="self-end">
        {submitting ? "Saving…" : "Save"}
      </Button>
    </>
  );
}

function InvoiceLogoCard() {
  const currentLogoUrl = useQuery(api.organizations.getInvoiceLogoUrl);
  const generateUploadUrl = useMutation(api.organizations.generateInvoiceLogoUploadUrl);
  const setInvoiceLogo = useMutation(api.organizations.setInvoiceLogo);

  return (
    <ImageUploadCard
      title="Invoice logo"
      description="Shown at the top-left of every printed and shared invoice. A square or wide image works best."
      imageUrl={currentLogoUrl}
      previewClassName="h-20 w-20 rounded-md border border-border object-contain bg-white p-1"
      generateUploadUrl={generateUploadUrl}
      setImage={setInvoiceLogo}
    />
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

      <InvoiceLogoCard />
      <LoginImageCard />
      <AppIconCard />
    </div>
  );
}
