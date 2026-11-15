"use client";

import { useState } from "react";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function PrivacyLockGate({
  title = "This section is Locked",
  description = "This section is hidden under Privacy Mode. Enter passcode 1968 to unlock.",
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  const { isLocked, unlock } = usePrivacyLock();
  const [privacyPasscode, setPrivacyPasscode] = useState("");
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  if (isLocked) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border bg-card p-6 sm:p-8 text-center shadow-lg my-12">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 mb-4">
          <Lock className="h-7 w-7" />
        </div>
        <h1 className="text-lg sm:text-xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-xs sm:text-sm text-muted-foreground">
          {description}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!unlock(privacyPasscode)) {
              setPrivacyError("Invalid passcode. Enter code 1968.");
            }
          }}
          className="mt-5 space-y-4"
        >
          <Input
            type="password"
            inputMode="numeric"
            autoFocus
            maxLength={4}
            placeholder="••••"
            value={privacyPasscode}
            onChange={(e) => {
              setPrivacyPasscode(e.target.value);
              setPrivacyError(null);
            }}
            className="text-center text-xl tracking-widest font-mono h-12 rounded-xl"
          />
          {privacyError && <p className="text-xs text-destructive font-medium">{privacyError}</p>}
          <Button type="submit" className="w-full h-11 bg-primary text-primary-foreground font-semibold">
            Unlock with Code 1968
          </Button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
