"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type ToastItem = { id: number; kind: "success" | "error"; message: string };
type Listener = (item: ToastItem) => void;

const listeners = new Set<Listener>();
let nextId = 1;

function emit(kind: ToastItem["kind"], message: string) {
  const item = { id: nextId++, kind, message };
  listeners.forEach((listener) => listener(item));
}

/** Lightweight app-wide confirmation messages (no extra dependency). */
export const toast = {
  success: (message: string) => emit("success", message),
  error: (message: string) => emit("error", message),
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const listener: Listener = (item) => {
      setItems((prev) => [...prev.slice(-3), item]);
      window.setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== item.id)), 3500);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,360px)] flex-col gap-2 print:hidden" aria-live="polite">
      {items.map((item) => (
        <div
          key={item.id}
          role={item.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${
            item.kind === "success"
              ? "border-emerald-500/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
              : "border-destructive/30 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100"
          }`}
        >
          {item.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
