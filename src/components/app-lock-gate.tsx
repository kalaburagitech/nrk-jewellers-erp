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

function PasscodeBoxes({
  id,
  label,
  value,
  onChange,
  autoFocus = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative w-fit max-w-full rounded-xl focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      <div aria-hidden="true" className="grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <span
            key={index}
            className={`flex h-11 w-8 items-center justify-center rounded-lg border bg-background sm:h-14 sm:w-12 ${index === Math.min(value.length, 5) ? "border-primary" : "border-input"}`}
          >
            {value[index] ? <span className="h-2.5 w-2.5 rounded-full bg-foreground" /> : null}
          </span>
        ))}
      </div>
      <input
        id={id}
        aria-label={label}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{4,6}"
        minLength={4}
        maxLength={6}
        required
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
      />
    </div>
  );
}

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
      setError("Enter your 4 to 6 digit passcode.");
      return;
    }
    if (!pinStatus?.configured && pin !== confirmPin) {
      setError("The passcodes don’t match. Please try again.");
      return;
    }

    setBusy(true);
    try {
      if (pinStatus?.configured) {
        const result = await verifyPin({ pin });
        if (!result.valid) {
          if (result.lockedUntil) {
            const minutes = Math.ceil((result.lockedUntil - Date.now()) / 60_000);
            setError(`Too many incorrect attempts. Try again in ${Math.max(1, minutes)} minute${minutes === 1 ? "" : "s"}, or reset with your account password.`);
          } else {
            setError("That passcode doesn’t match. Please try again.");
          }
          return;
        }
      } else {
        await setPin({ pin });
      }
      finishUnlock();
    } catch {
      setError("We couldn’t verify the passcode. Please try again.");
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
    if (!/^\d{4,6}$/.test(recoveryPin)) { setError("Choose a 4 to 6 digit passcode."); return; }
    if (recoveryPin !== recoveryConfirmPin) { setError("The new passcodes don’t match."); return; }
    setBusy(true);
    try {
      await resetPin({ accountPassword, pin: recoveryPin });
      window.sessionStorage.setItem(storageKey, "1");
      setPinValue("");
      setAccountPassword("");
      setRecoveryPin("");
      setRecoveryConfirmPin("");
      setError(null);
      setRecoveryMessage("Passcode updated. Unlocking your workspace…");
      setUnlocked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message.replaceAll("MPIN", "passcode") : "Could not reset your passcode. Please try again.");
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
          <CardTitle>{settingUp ? "Create your passcode" : "Unlock NRK Jewellers ERP"}</CardTitle>
          <CardDescription>
            {settingUp
              ? "Choose a 4 to 6 digit passcode to unlock your workspace."
              : "Enter your passcode to continue to your workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="app-passcode">{settingUp ? "New passcode" : "Passcode"}</Label>
              <PasscodeBoxes id="app-passcode" label={settingUp ? "New passcode" : "Passcode"} value={pin} onChange={setPinValue} autoFocus />
            </div>
            {settingUp && (
              <div className="grid gap-2">
                <Label htmlFor="app-passcode-confirm">Confirm passcode</Label>
                <PasscodeBoxes id="app-passcode-confirm" label="Confirm passcode" value={confirmPin} onChange={setConfirmPin} />
              </div>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
              Your account stays signed in. The passcode only locks and unlocks this app; it does not sign you out.
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? "Please wait…" : settingUp ? "Save passcode and continue" : "Unlock app"}
            </Button>
          </form>
          {!settingUp && (
            <div className="mt-3 grid gap-2">
              <Button variant="ghost" className="w-full" onClick={() => { setShowRecovery((shown) => !shown); setError(null); setRecoveryMessage(""); }}>
                {showRecovery ? "Back to passcode" : "Forgot passcode? Reset with account password"}
              </Button>
              {showRecovery && <form className="grid gap-3 rounded-lg border p-3" onSubmit={handlePinRecovery}>
                <p className="text-sm text-muted-foreground">Verify your account password to choose a new passcode. You’ll stay signed in.</p>
                <div className="grid gap-2"><Label htmlFor="mpin-account-password">Account password</Label><Input id="mpin-account-password" type="password" autoComplete="current-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} required /></div>
                <div className="grid gap-2"><Label htmlFor="mpin-recovery-new">New passcode</Label><PasscodeBoxes id="mpin-recovery-new" label="New passcode" value={recoveryPin} onChange={setRecoveryPin} /></div>
                <div className="grid gap-2"><Label htmlFor="mpin-recovery-confirm">Confirm new passcode</Label><PasscodeBoxes id="mpin-recovery-confirm" label="Confirm new passcode" value={recoveryConfirmPin} onChange={setRecoveryConfirmPin} /></div>
                <Button type="submit" disabled={busy}>{busy ? "Verifying…" : "Verify and reset passcode"}</Button>
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
