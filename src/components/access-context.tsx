"use client";

import { createContext, useContext, type ReactNode } from "react";

export type AccessInfo = {
  role: string;
  /** Full control, including shop-wide customisation (custom fields, dropdown lists). */
  isOwner: boolean;
  /** Staff (view only): can open screens but every add/edit/delete is blocked on the server. */
  isViewOnly: boolean;
};

const AccessContext = createContext<AccessInfo>({ role: "", isOwner: false, isViewOnly: true });

export function AccessProvider({ role, children }: { role: string; children: ReactNode }) {
  return (
    <AccessContext.Provider value={{ role, isOwner: role === "owner", isViewOnly: role === "staff" }}>
      {children}
    </AccessContext.Provider>
  );
}

export function useAccessInfo() {
  return useContext(AccessContext);
}

/** Screens that only create or destroy data — hidden from, and blocked for, view-only staff. */
export const WRITE_ONLY_PATHS = ["/sales/new", "/purchases/new", "/backup", "/manage-data"];

export function isWriteOnlyPath(pathname: string) {
  return WRITE_ONLY_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
