"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Switch } from "@/components/ui/switch";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getUserErrorMessage } from "@/lib/user-error";

/** Settings → Change Passcode (needs the current passcode). */
export function ChangePasscodeDialog() {
  const change = useAction(api.appSecurity.changeMyAppPin);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    if (next !== confirm) return setMessage({ ok: false, text: "The new passcodes do not match." });
    setBusy(true);
    setMessage(null);
    try {
      const r = await change({ currentPin: current, newPin: next });
      if (r.changed) {
        setMessage({ ok: true, text: "Passcode changed." });
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        setMessage({ ok: false, text: r.lockedUntil ? `Too many wrong tries. Try again after ${new Date(r.lockedUntil).toLocaleTimeString("en-IN")}.` : "Current passcode is wrong." });
      }
    } catch (e) {
      setMessage({ ok: false, text: getUserErrorMessage(e, "Could not change the passcode.") });
    } finally {
      setBusy(false);
    }
  }

  const pin = (value: string, set: (v: string) => void, label: string) => (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={value} onChange={(e) => set(e.target.value.replace(/\D/g, ""))} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setMessage(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Change Passcode</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Change Passcode</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {pin(current, setCurrent, "Current passcode")}
          {pin(next, setNext, "New passcode (4–6 digits)")}
          {pin(confirm, setConfirm, "Confirm new passcode")}
          {message && <p className={`text-sm ${message.ok ? "text-emerald-600" : "text-destructive"}`}>{message.text}</p>}
        </div>
        <DialogFooter>
          <Button disabled={busy || !current || next.length < 4} onClick={submit}>{busy ? "Saving…" : "Change Passcode"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → Enable Passcode: switching needs the current passcode. */
export function PasscodeToggle() {
  const status = useQuery(api.appSecurity.getMyAppPinStatus, {});
  const setEnabled = useAction(api.appSecurity.setMyAppPinEnabled);
  const [target, setTarget] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!status?.configured) return null;

  async function confirm() {
    if (target === null) return;
    setBusy(true);
    setError("");
    try {
      const r = await setEnabled({ pin, enabled: target });
      if (r.changed) { setTarget(null); setPin(""); }
      else setError(r.lockedUntil ? `Too many wrong tries. Try after ${new Date(r.lockedUntil).toLocaleTimeString("en-IN")}.` : "Wrong passcode.");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not change this setting."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Switch aria-label="Enable passcode" checked={status.enabled} onCheckedChange={(c) => { setTarget(c); setError(""); }} />
      <Dialog open={target !== null} onOpenChange={(o) => { if (!o) { setTarget(null); setPin(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{target ? "Turn passcode on" : "Turn passcode off"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{target ? "The app will ask for the passcode every time it opens." : "Anyone with this device and your login can open the app without a passcode."}</p>
          <div className="grid gap-1.5">
            <Label>Current passcode</Label>
            <Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button disabled={busy || pin.length < 4} onClick={confirm}>{busy ? "Saving…" : "Confirm"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
