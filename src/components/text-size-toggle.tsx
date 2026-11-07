"use client";
import { useState } from "react";
import { ALargeSmall } from "lucide-react";
import { Button } from "@/components/ui/button";
export function TextSizeToggle() {
  const [large, setLarge] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.dataset.readingSize === "large",
  );
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={large ? "Use standard text size" : "Use larger text"}
      title={large ? "Standard text size" : "Larger text"}
      aria-pressed={large}
      onClick={() => {
        const next = !large;
        setLarge(next);
        document.documentElement.dataset.readingSize = next
          ? "large"
          : "standard";
        localStorage.setItem("nrk-reading-size", next ? "large" : "standard");
      }}
    >
      <ALargeSmall className="h-5 w-5" />
    </Button>
  );
}
