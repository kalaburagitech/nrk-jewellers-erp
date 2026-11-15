"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface PrivacyLockContextValue {
  isLocked: boolean;
  unlock: (code: string) => boolean;
  lock: () => void;
}

const PrivacyLockContext = createContext<PrivacyLockContextValue>({
  isLocked: true,
  unlock: () => false,
  lock: () => {},
});

const STORAGE_KEY = "nrk_privacy_unlocked_1968";
const PRIVACY_CODE = "1968";

export function PrivacyLockProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(true);

  useEffect(() => {
    try {
      const unlocked = sessionStorage.getItem(STORAGE_KEY) === "1";
      if (unlocked) {
        setIsLocked(false);
      }
    } catch {
      // Ignore sessionStorage errors
    }
  }, []);

  const unlock = (code: string) => {
    if (code.trim() === PRIVACY_CODE) {
      setIsLocked(false);
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Ignore
      }
      return true;
    }
    return false;
  };

  const lock = () => {
    setIsLocked(true);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  };

  return (
    <PrivacyLockContext.Provider value={{ isLocked, unlock, lock }}>
      {children}
    </PrivacyLockContext.Provider>
  );
}

export function usePrivacyLock() {
  return useContext(PrivacyLockContext);
}
