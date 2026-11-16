"use client";

import { useRef, useState, type ReactNode } from "react";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Press-and-hold time before the passcode popup opens. A normal click just follows the home link. */
const HOLD_MS = 5000;
/** How far a finger/mouse may drift during the hold before it counts as a drag. */
const MOVE_TOLERANCE_PX = 12;

/**
 * Hidden owner control for the privacy lock. Renders its children as plain
 * text (no button styling, no hint). A normal click behaves like the rest of the
 * logo (goes Home); only holding it for 5 seconds opens the passcode popup, or —
 * when already unlocked — offers to hide the private sections again.
 * When `enabled` is false it renders the text and does nothing.
 */
export function PrivacyUnlockTrigger({ enabled, className, children }: { enabled: boolean; className?: string; children: ReactNode }) {
  const { isLocked, unlock, lock } = usePrivacyLock();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a hold opened the popup, so the click the browser fires on release doesn't also go Home.
  const holdFired = useRef(false);
  const holdStart = useRef<{ x: number; y: number } | null>(null);

  if (!enabled) return <span className={className}>{children}</span>;

  function show() {
    setCode("");
    setError(false);
    setOpen(true);
  }
  function cancelHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdStart.current = null;
  }
  function startHold(x: number, y: number) {
    cancelHold();
    holdFired.current = false;
    holdStart.current = { x, y };
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      holdFired.current = true;
      show();
    }, HOLD_MS);
  }
  // A finger always wobbles a little; only a real drag/scroll cancels the hold.
  function moveHold(x: number, y: number) {
    const start = holdStart.current;
    if (start && Math.hypot(x - start.x, y - start.y) > MOVE_TOLERANCE_PX) cancelHold();
  }

  return (
    <>
      <span
        // touch-action:none stops the phone from turning the hold into a scroll (which
        // cancels pointer events); no callout/selection so the long-press menu stays away.
        className={`select-none touch-none [-webkit-touch-callout:none] [-webkit-user-select:none] ${className ?? ""}`}
        // A plain click falls through to the surrounding home link. Only the click
        // that ends a successful hold is swallowed.
        onClick={(event) => {
          if (!holdFired.current) return;
          holdFired.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        // Mouse / pen: pointer events.
        onPointerDown={(event) => {
          if (event.pointerType === "touch") return;
          startHold(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch") moveHold(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (event.pointerType !== "touch") cancelHold();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") cancelHold();
        }}
        // Phones: touch events. The browser fires pointercancel on a long press
        // (to show its own menu), so pointer events can't be trusted for touch.
        onTouchStart={(event) => {
          const t = event.touches[0];
          if (event.touches.length !== 1 || !t) return cancelHold();
          startHold(t.clientX, t.clientY);
        }}
        onTouchMove={(event) => {
          const t = event.touches[0];
          if (t) moveHold(t.clientX, t.clientY);
        }}
        onTouchEnd={(event) => {
          // A completed hold must not also open the home link.
          if (holdFired.current) event.preventDefault();
          cancelHold();
        }}
        onTouchCancel={cancelHold}
        onDragStart={(event) => event.preventDefault()}
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
