"use client";

import { useSyncExternalStore } from "react";

/** Per-device screen zoom (%), stored in localStorage and applied on screen only — printed bills are unaffected (see globals.css). */
export const VIEW_SCALE_KEY = "nrk-view-scale";
export const VIEW_SCALE_MIN = 70;
export const VIEW_SCALE_MAX = 130;

const listeners = new Set<() => void>();

function read(): number {
  try {
    const value = Number(localStorage.getItem(VIEW_SCALE_KEY));
    return value >= VIEW_SCALE_MIN && value <= VIEW_SCALE_MAX ? value : 100;
  } catch {
    return 100;
  }
}

export function setViewScale(percent: number) {
  const value = Math.min(VIEW_SCALE_MAX, Math.max(VIEW_SCALE_MIN, Math.round(percent)));
  try {
    localStorage.setItem(VIEW_SCALE_KEY, String(value));
  } catch {
    // Storage unavailable (private mode) — still apply for this visit.
  }
  document.documentElement.style.setProperty("--nrk-view-scale", String(value / 100));
  listeners.forEach((listener) => listener());
}

export function useViewScale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => 100,
  );
}
