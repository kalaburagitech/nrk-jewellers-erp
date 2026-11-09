"use client";

import { useEffect, useState } from "react";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEMES = [
  { id: "gold", label: "Champagne Gold", swatch: "bg-[#a7833f]" },
  { id: "rose", label: "Rose Pink", swatch: "bg-[#bd4d79]" },
  { id: "green", label: "Emerald Green", swatch: "bg-[#347a54]" },
  { id: "plum", label: "Royal Plum", swatch: "bg-[#795394]" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

export function ColorThemePicker() {
  const [theme, setTheme] = useState<ThemeId>("gold");

  useEffect(() => {
    const stored = localStorage.getItem("nrk-color-theme") as ThemeId | null;
    const next = THEMES.some((item) => item.id === stored) ? stored! : "gold";
    setTheme(next);
    document.documentElement.dataset.colorTheme = next;
  }, []);

  function selectTheme(value: string) {
    if (!THEMES.some((item) => item.id === value)) return;
    const next = value as ThemeId;
    setTheme(next);
    document.documentElement.dataset.colorTheme = next;
    localStorage.setItem("nrk-color-theme", next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Choose workspace color theme" title="Workspace colors">
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspace colors</p>
        <DropdownMenuRadioGroup value={theme} onValueChange={selectTheme}>
          {THEMES.map((item) => (
            <DropdownMenuRadioItem key={item.id} value={item.id} className="gap-2">
              <span aria-hidden className={`h-3.5 w-3.5 rounded-full ring-1 ring-black/10 ${item.swatch}`} />
              <span className="flex-1">{item.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
