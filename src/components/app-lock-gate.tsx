"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAction, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { KeyRound, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AppLockControls = { lock: () => void; clear: () => void };
const AppLockContext = createContext<AppLockControls>({ lock: () => {}, clear: () => {} });

export function useAppLock() {
  return useContext(AppLockContext);
}

export function AppLockGate({ userId, children }: { userId: string; children: ReactNode }) {
  const pinStatus = useQuery(api.appSecurity.getMyAppPinStatus, {});
  const setPin = useAction(api.appSecurity.setMyAppPin);
  const verifyPin = useAction(api.appSecurity.verifyMyAppPin);
  const resetPin = useAction(api.appSecurity.resetMyAppPinWithPassword);
  const { signOut } = useAuthActions();
  const storageKey = `nrk-app-unlocked:${userId}`;
  const [sessionChecked, setSessionChecked] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPinValue] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [accountPassword, setAccountPassword] = useState("");
  const [recoveryPin, setRecoveryPin] = useState("");
  const [recoveryConfirmPin, setRecoveryConfirmPin] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");

  useEffect(() => {
    if (pinStatus === undefined) return;
    const sessionIsUnlocked = window.sessionStorage.getItem(storageKey) === "1";
    setUnlocked(pinStatus.configured && sessionIsUnlocked);
    setSessionChecked(true);
  }, [pinStatus?.configured, storageKey]);

  const lock = useCallback(() => {
    window.sessionStorage.removeItem(storageKey);
    setPinValue("");
    setConfirmPin("");
    setError(null);
    setUnlocked(false);
    setSessionChecked(true);
  }, [storageKey]);

  const clear = useCallback(() => {
    window.sessionStorage.removeItem(storageKey);
    setUnlocked(false);
  }, [storageKey]);

  const controls = useMemo(() => ({ lock, clear }), [lock, clear]);

  function finishUnlock() {
    window.sessionStorage.setItem(storageKey, "1");
    setPinValue("");
    setConfirmPin("");
    setError(null);
    setUnlocked(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!/^\d{4,6}$/.test(pin)) {
      setError("Enter a 4 to 6 digit MPIN.");
      return;
    }
    if (!pinStatus?.configured && pin !== confirmPin) {
      setError("The MPIN entries don’t match. Please try again.");
      return;
    }

    setBusy(true);
    try {
      if (pinStatus?.configured) {
        const result = await verifyPin({ pin });
        if (!result.valid) {
          setError("That MPIN doesn’t match. Please try again.");
          return;
        }
      } else {
        await setPin({ pin });
      }
      finishUnlock();
    } catch {
      setError("We couldn’t verify the MPIN. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    clear();
    await signOut();
  }

  async function handlePinRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setRecoveryMessage("");
    if (!/^\d{4,6}$/.test(recoveryPin)) { setError("Choose a 4 to 6 digit MPIN."); return; }
    if (recoveryPin !== recoveryConfirmPin) { setError("The new MPIN entries don’t match."); return; }
    setBusy(true);
    try {
      await resetPin({ accountPassword, pin: recoveryPin });
      window.sessionStorage.setItem(storageKey, "1");
      setPinValue("");
      setAccountPassword("");
      setRecoveryPin("");
      setRecoveryConfirmPin("");
      setError(null);
      setRecoveryMessage("MPIN updated. Unlocking your workspace…");
      setUnlocked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset your MPIN. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (pinStatus === undefined || !sessionChecked) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (unlocked) {
    return <AppLockContext.Provider value={controls}>{children}</AppLockContext.Provider>;
  }

  const settingUp = !pinStatus.configured;

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/70 shadow-lg">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {settingUp ? <ShieldCheck className="h-6 w-6" /> : <KeyRound className="h-6 w-6" />}
          </div>
          <CardTitle>{settingUp ? "Set your app MPIN" : "Unlock NRK Jewellers ERP"}</CardTitle>
          <CardDescription>
            {settingUp
              ? "Create a 4 to 6 digit MPIN for quickly unlocking this software."
              : "Enter your MPIN to continue to your workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="app-mpin">{settingUp ? "New MPIN" : "MPIN"}</Label>
              <Input
                autoFocus
                id="app-mpin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="[0-9]{4,6}"
                maxLength={6}
                value={pin}
                onChange={(event) => setPinValue(event.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
            </div>
            {settingUp && (
              <div className="grid gap-2">
                <Label htmlFor="app-mpin-confirm">Confirm MPIN</Label>
                <Input
                  id="app-mpin-confirm"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="[0-9]{4,6}"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                />
              </div>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
              Your account stays signed in. The MPIN only locks and unlocks this app; it does not sign you out.
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? "Please wait…" : settingUp ? "Save MPIN and continue" : "Unlock app"}
            </Button>
          </form>
          {!settingUp && (
            <div className="mt-3 grid gap-2">
              <Button variant="ghost" className="w-full" onClick={() => { setShowRecovery((shown) => !shown); setError(null); setRecoveryMessage(""); }}>
                {showRecovery ? "Back to MPIN" : "Forgot MPIN? Reset with account password"}
              </Button>
              {showRecovery && <form className="grid gap-3 rounded-lg border p-3" onSubmit={handlePinRecovery}>
                <p className="text-sm text-muted-foreground">Verify your account password to choose a new MPIN. You’ll stay signed in.</p>
                <div className="grid gap-2"><Label htmlFor="mpin-account-password">Account password</Label><Input id="mpin-account-password" type="password" autoComplete="current-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} required /></div>
                <div className="grid gap-2"><Label htmlFor="mpin-recovery-new">New MPIN</Label><Input id="mpin-recovery-new" type="password" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} value={recoveryPin} onChange={(event) => setRecoveryPin(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></div>
                <div className="grid gap-2"><Label htmlFor="mpin-recovery-confirm">Confirm new MPIN</Label><Input id="mpin-recovery-confirm" type="password" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} value={recoveryConfirmPin} onChange={(event) => setRecoveryConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></div>
                <Button type="submit" disabled={busy}>{busy ? "Verifying…" : "Verify and reset MPIN"}</Button>
              </form>}
              {recoveryMessage && <p role="status" className="text-sm text-success">{recoveryMessage}</p>}
              <Button variant="ghost" className="w-full" onClick={() => void handleSignOut()}>
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
