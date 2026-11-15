"use client";

import { useRef, useState, type ReactNode } from "react";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const HOLD_MS = 600;

/**
 * Hidden owner control for the privacy lock. Renders its children as plain
 * text (no button styling, no hint); a tap or a long-press opens a passcode
 * popup, or — when already unlocked — offers to hide the private sections again.
 * When `enabled` is false it renders the text and does nothing.
 */
export function PrivacyUnlockTrigger({ enabled, className, children }: { enabled: boolean; className?: string; children: ReactNode }) {
  const { isLocked, unlock, lock } = usePrivacyLock();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!enabled) return <span className={className}>{children}</span>;

  function show() {
    setCode("");
    setError(false);
    setOpen(true);
  }
  function cancelHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  return (
    <>
      <span
        className={`select-none [-webkit-touch-callout:none] ${className ?? ""}`}
        // The text sits inside the logo's home link: swallow the click so it doesn't navigate or close the menu.
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          show();
        }}
        onPointerDown={() => {
          cancelHold();
          holdTimer.current = setTimeout(show, HOLD_MS);
        }}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(event) => event.preventDefault()}
      >
        {children}
      </span>
      {/* Portal events still bubble through the React tree to the surrounding home link; stop them here. */}
      <span className="contents" onClick={(event) => event.stopPropagation()}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[88vw] sm:max-w-xs rounded-2xl">
          {isLocked ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (unlock(code)) setOpen(false);
                else {
                  setError(true);
                  setCode("");
                }
              }}
            >
              <DialogHeader>
                <DialogTitle>Enter passcode</DialogTitle>
                <DialogDescription className="sr-only">Owner passcode</DialogDescription>
              </DialogHeader>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                maxLength={6}
                placeholder="••••"
                aria-label="Passcode"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, ""));
                  setError(false);
                }}
                className="h-12 text-center font-mono text-xl tracking-widest"
              />
              {error && <p role="alert" className="text-center text-xs font-medium text-destructive">Incorrect passcode.</p>}
              <DialogFooter>
                <Button type="submit" className="w-full" disabled={!code}>Unlock</Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>Private sections are visible</DialogTitle>
                <DialogDescription>Hide them again from the menu, dashboard and company list.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  className="w-full"
                  onClick={() => {
                    lock();
                    setOpen(false);
                  }}
                >
                  Hide again
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      </span>
    </>
  );
}
