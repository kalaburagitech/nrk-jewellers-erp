"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * The sidebar's Vyapar-style "+" shortcuts link to a list page with `?new=1`.
 * Once that page has rendered its create button (marked `data-create-trigger`),
 * click it to open the form, then drop the parameter so a refresh doesn't reopen it.
 */
export function CreateParamOpener() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const wantsNew = params.get("new") === "1";

  useEffect(() => {
    if (!wantsNew) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const trigger = document.querySelector<HTMLElement>(".erp-main [data-create-trigger]");
      if (trigger || tries > 50) {
        window.clearInterval(timer);
        trigger?.click();
        const next = new URLSearchParams(params.toString());
        next.delete("new");
        const query = next.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [wantsNew, params, pathname, router]);

  return null;
}
