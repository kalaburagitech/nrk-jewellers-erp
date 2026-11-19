"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/** Every box with its stock and the items inside it (an empty item list when the backend doesn't send one). */
export function useBoxes() {
  const boxes = useQuery(api.boxes.list);
  return useMemo(() => boxes?.map((box) => ({ ...box, entries: box.entries ?? [] })), [boxes]);
}
